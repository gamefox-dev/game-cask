/* State, pass lowering and immutable pipeline cache. SPDX-License-Identifier: MIT — LANE-GL */
static uint32_t compare(uint32_t v) {
    if (v < 0x200 || v > 0x207) { fail(BAD_ENUM); return 7; } return v - 0x200;
}
static uint32_t factor(uint32_t v) {
    switch (v) {
    case 0: return 0; case 1: return 1; case 0x300: return 2; case 0x301: return 3;
    case 0x306: return 4; case 0x307: return 5; case 0x302: return 6; case 0x303: return 7;
    case 0x304: return 8; case 0x305: return 9; case 0x8001: return 10; case 0x8002: return 11;
    case 0x8003: case 0x8004: fail(BAD_OP); return 1; /* §13 has RGBA constant, not alpha splat. */
    default: fail(BAD_ENUM); return 1;
    }
}
static uint32_t equation(uint32_t v) {
    switch (v) { case 0x8006: return 0; case 0x800a: return 1; case 0x800b: return 2;
        case 0x8007: return 3; case 0x8008: return 4; default: fail(BAD_ENUM); return 0; }
}
static uint32_t stencil_op(uint32_t v) {
    switch (v) { case 0x1e00: return 0; case 0: return 1; case 0x1e01: return 2;
        case 0x1e02: return 3; case 0x1e03: return 4; case 0x150a: return 5;
        case 0x8507: return 6; case 0x8508: return 7; default: fail(BAD_ENUM); return 0; }
}
static uint32_t *capability(uint32_t cap) {
    switch (cap) { case 0xbe2: return &blend; case 0xb71: return &depth; case 0xb90: return &stencil;
        case 0xb44: return &cull; case 0xc11: return &scissor_enabled; default: return 0; }
}
static uint32_t enable(int enabled) {
    uint32_t *v = capability(ARG(0)); if (!v) fail(BAD_ENUM); else *v = (uint32_t)enabled; return 0;
}
static uint32_t api_Enable(void) { return enable(1); }
static uint32_t api_Disable(void) { return enable(0); }
static uint32_t api_IsEnabled(void) { uint32_t *v = capability(ARG(0)); if (!v) fail(BAD_ENUM); return v ? *v : 0; }
static uint32_t api_BlendFunc(void) {
    uint32_t a = factor(ARG(0)), b = factor(ARG(1)); if (error) return 0;
    src_rgb = src_alpha = a; dst_rgb = dst_alpha = b; return 0;
}
static uint32_t api_BlendFuncSeparate(void) {
    uint32_t a = factor(ARG(0)), b = factor(ARG(1)), c = factor(ARG(2)), d = factor(ARG(3));
    if (!error) { src_rgb = a; dst_rgb = b; src_alpha = c; dst_alpha = d; } return 0;
}
static uint32_t api_BlendEquation(void) {
    uint32_t v = equation(ARG(0)); if (!error) blend_op_rgb = blend_op_alpha = v; return 0;
}
static uint32_t api_BlendEquationSeparate(void) {
    uint32_t a = equation(ARG(0)), b = equation(ARG(1)); if (!error) { blend_op_rgb = a; blend_op_alpha = b; }
    return 0;
}
static float clamp(float f) { return f != f || f < 0 ? 0 : f > 1 ? 1 : f; }
static uint32_t api_BlendColor(void) { for (uint32_t i = 0; i < 4; i++) blend_color[i] = clamp(argf(i)); return 0; }
static uint32_t api_DepthFunc(void) { uint32_t v = compare(ARG(0)); if (!error) depth_compare = v; return 0; }
static uint32_t api_DepthMask(void) { depth_write = !!ARG(0); return 0; }
static uint32_t api_DepthRange(void) {
    float a = clamp((float)argd(0)), b = clamp((float)argd(W32_64 ? 1 : 2));
    if (a > b) fail(BAD_VALUE); else { range_min = a; range_max = b; } return 0;
}
static uint32_t api_ColorMask(void) {
    color_mask = (!!ARG(0)) | ((!!ARG(1)) << 1) | ((!!ARG(2)) << 2) | ((!!ARG(3)) << 3); return 0;
}
static uint32_t api_CullFace(void) {
    if (ARG(0) == 0x404) cull_face = 1; else if (ARG(0) == 0x405) cull_face = 2;
    else fail(BAD_ENUM); return 0;
}
static uint32_t api_FrontFace(void) {
    if (ARG(0) == 0x900 || ARG(0) == 0x901) front_face = ARG(0) == 0x900; else fail(BAD_ENUM); return 0;
}
static uint32_t api_StencilFunc(void) {
    uint32_t v = compare(ARG(0)); if (!error) { stencil_compare = v; stencil_ref = ARG(1) & 255;
        stencil_read = ARG(2) & 255; } return 0;
}
static uint32_t api_StencilMask(void) { stencil_write = ARG(0) & 255; return 0; }
static uint32_t api_StencilOp(void) {
    uint32_t a = stencil_op(ARG(0)), b = stencil_op(ARG(1)), c = stencil_op(ARG(2));
    if (!error) { stencil_fail = a; stencil_zfail = b; stencil_pass = c; } return 0;
}
static uint32_t api_Viewport(void) {
    if ((int32_t)ARG(2) < 0 || (int32_t)ARG(3) < 0) fail(BAD_VALUE);
    else for (uint32_t i = 0; i < 4; i++) viewport[i] = (int32_t)ARG(i); return 0;
}
static uint32_t api_Scissor(void) {
    if ((int32_t)ARG(2) < 0 || (int32_t)ARG(3) < 0) fail(BAD_VALUE);
    else for (uint32_t i = 0; i < 4; i++) scissor[i] = (int32_t)ARG(i); return 0;
}
/* Float colour buffers keep values outside [0,1]; fixed-point targets clamp when written (§13 PASS_BEGIN). */
static float finite_f(float f) { return f != f ? 0 : f > 3e38f ? 3e38f : f < -3e38f ? -3e38f : f; }
static uint32_t api_ClearColor(void) { for (uint32_t i = 0; i < 4; i++) clear_color[i] = finite_f(argf(i)); return 0; }
static uint32_t api_ClearDepth(void) { clear_depth = clamp((float)argd(0)); return 0; }
static uint32_t api_ClearStencil(void) { clear_stencil = ARG(0) & 255; return 0; }
static uint32_t dummy_w, dummy_h;
static void ensure_screen_depth(void) {
    if (!screen_depth) { SEND(0x43, depth_handle, width(), height(), 1, 5, 2); screen_depth = 1; }
}
/* Scratch colour target for colour outputs whose draw buffer is GL_NONE; sized to the pass. */
static uint32_t dummy_color(uint32_t w, uint32_t h) {
    if (dummy_w != w || dummy_h != h) {
        if (dummy_w) SEND(0x45, 904);
        SEND(0x43, 904, w, h, 1, 0, 2); dummy_w = w; dummy_h = h;
    }
    return 904;
}
static int rgb_only(const Fmt *f) { return f && f->kind == K_COLOR && f->chans == 3; }
static uint32_t pass_words(const Target *tg, uint32_t clear, uint32_t *w) {
    int ds = tg->has_depth || tg->has_stencil;
    if (!tg->ds.gpu || tg->ds.gpu == depth_handle) { if (ds) ensure_screen_depth(); }
    w[0] = tg->ncolor; w[1] = ds ? tg->ds.gpu : 0; w[2] = ds ? tg->ds.mip : 0;
    w[3] = ds && tg->has_depth && (clear & 0x100); w[4] = ds && tg->has_stencil && (clear & 0x400) && tg->ds.bgt == 5;
    w[5] = bits(clear_depth); w[6] = clear_stencil;
    for (uint32_t i = 0; i < tg->ncolor; i++) {
        uint32_t j = 7 + i * 7;
        w[j] = tg->gap[i] ? dummy_color(tg->w, tg->h) : tg->color[i].gpu; w[j + 1] = tg->gap[i] ? 0 : tg->color[i].mip;
        w[j + 2] = !!(clear & 0x4000);
        for (uint32_t k = 0; k < 4; k++) w[j + 3 + k] = bits(clear_color[k]);
        if (rgb_only(tg->color[i].fmt)) w[j + 6] = bits(1);
    }
    return 7 + tg->ncolor * 7;
}
static uint32_t api_Clear(void) {
    uint32_t mask = ARG(0);
    if (mask & ~(0x4000u | 0x100u | 0x400u)) { fail(BAD_VALUE); return 0; }
    Target tg; if (resolve_fbo(fbo, 0, &tg) != 0x8cd5) { fail(0x506); return 0; }
    if (!mask) return 0;
    /* §13 load clears are whole attachment. Partial/masked clears are not silently approximated. */
    if (scissor_enabled || color_mask != 15 || ((mask & 0x100) && !depth_write) ||
        ((mask & 0x400) && stencil_write != 255)) { fail(BAD_OP); return 0; }
    if (!fbo && dfb_draw == 0) mask &= ~0x4000u;
    if (!tg.ncolor && !tg.has_depth && !tg.has_stencil) return 0;
    if (!mask) return 0;
    uint32_t w[35]; uint32_t n = pass_words(&tg, mask, w); begin(); op(0x4c, w, n); op(0x4d, 0, 0); submit(); return 0;
}
static uint32_t topology(uint32_t mode) {
    switch (mode) { case 0: return 0; case 1: return 1; case 3: return 2; case 4: return 3; case 5: return 4;
        default: fail(BAD_ENUM); return 0xffffffffu; }
}
static uint32_t sampler_cache[128][12], sampler_count;
static uint32_t wrap(uint32_t v) { return v == 0x2901 ? 1 : v == 0x8370 ? 2 : 0; } /* CLAMP_TO_BORDER -> edge */
/* Sampling parameters -> §13 sampler. shadow: sampler2DShadow (comparison) uniform. */
static uint32_t sampler_id(const Texture *t, const Sampler *s, int shadow, uint32_t dimension) {
    const Params *p = s ? &s->p : &t->p;
    uint32_t min = p->min, mip = min == 0x2600 || min == 0x2601 ? 0 : min == 0x2700 || min == 0x2701 ? 1 : 2;
    uint32_t last = t->gmips ? t->gmips - 1 : 0; if (t->maxl < last) last = t->maxl;
    float lo = (float)t->base + p->min_lod, hi = (float)t->base + p->max_lod;
    if (lo < 0) lo = 0; if (hi > (float)last) hi = 1000; if (hi < lo) hi = lo;
    if (!mip) hi = lo;
    if (lo <= 0) lo = 0;
    uint32_t w[12] = {0, min == 0x2601 || min == 0x2701 || min == 0x2703, p->mag == 0x2601, mip, wrap(p->ws),
        wrap(p->wt), dimension == 1 ? wrap(p->wr) : 0, shadow, shadow ? p->cmp_func - 0x200 : 7, bits(lo), bits(hi), 0};
    for (uint32_t i = 0; i < sampler_count; i++) {
        uint32_t j; for (j = 1; j < 11 && w[j] == sampler_cache[i][j]; j++);
        if (j == 11) return i + 1;
    }
    if (sampler_count == 128) { fail(OOM); return 0; }
    w[0] = ++sampler_count; copy(sampler_cache[sampler_count - 1], w, sizeof w);
    int legacy = !w[6] && w[9] == bits(0) && (!mip || w[10] == bits(1000));
    if (legacy) { uint32_t l[8] = {w[0], w[1], w[2], w[3], w[4], w[5], w[7], w[8]}; send(0x46, l, 8); }
    else send(0x5b, w, 11);
    return w[0];
}
/* GL 3.3 completeness for sampling (8.17): returns nonzero when the texture is usable as a sampler source. */
static int tex_complete(const Texture *t, const Sampler *s, int shadow) {
    if (!t->used || !t->gpu || t->base >= MAXLV) return 0;
    const Level *b = &t->lv[t->base]; const Fmt *bf = b->w ? find_fmt(b->internal) : 0;
    if (!bf || t->base >= t->gmips || bf->bgt != t->gfmt) return 0;
    if (shadow && bf->kind == K_COLOR) return 0;
    if (b->w != lvl_w(t, t->base) || b->h != lvl_h(t, t->base) || b->d != lvl_d(t, t->base)) return 0;
    uint32_t min = (s ? &s->p : &t->p)->min;
    if (min == 0x2600 || min == 0x2601) return 1;
    uint32_t last = t->gmips - 1; if (t->maxl < last) last = t->maxl;
    for (uint32_t n = t->base + 1; n <= last; n++) {
        const Level *l = &t->lv[n];
        if (l->w != lvl_w(t, n) || l->h != lvl_h(t, n) || l->d != lvl_d(t, n) || l->internal != b->internal) return 0;
    }
    return 1;
}
static uint32_t fallback_ready;
/* Incomplete or unbound textures sample (0,0,0,1) in GL; bind an equivalent private texture. */
static uint32_t fallback_texture(uint32_t dim, int shadow) {
    uint32_t id = shadow ? 905 : 901 + dim, bit = 1u << (id - 901);
    if (!(fallback_ready & bit)) {
        fallback_ready |= bit;
        if (shadow) SEND(0x43, id, 1, 1, 1, 6, 3);
        else {
            static const uint8_t black[4] = {0, 0, 0, 255};
            if (dim == 0) { SEND(0x43, id, 1, 1, 1, 0, 3); SEND(0x44, id, 0, 0, 0, 1, 1, PTR(black), 4); }
            else { SEND(0x59, id, dim, 1, 1, 1, 1, 0, 1); SEND(0x5a, id, 0, 0, 0, 0, 1, 1, 1, PTR(black), 4); }
        }
    }
    return id;
}
static uint32_t fallback_sampler(int shadow) {
    Texture t; zero(&t, sizeof t); params_init(&t.p); t.p.min = t.p.mag = 0x2600; t.p.ws = t.p.wt = t.p.wr = 0x812f;
    t.gmips = 1; t.p.cmp_func = 0x207; return sampler_id(&t, 0, shadow, 0);
}
static uint32_t draw(uint32_t mode, int32_t count, int32_t instances, uint32_t first, uint32_t index_type,
        uint32_t index_offset, int32_t base_vertex) {
    uint32_t topo = topology(mode); if (topo == 0xffffffffu) return 0;
    if (count < 0 || instances < 0 || instances > 65535) { fail(BAD_VALUE); return 0; }
    if (!count || !instances) return 0;
    if (!vao || !program || !programs[program].linked) { fail(BAD_OP); return 0; }
    Target tg; if (resolve_fbo(fbo, 0, &tg) != 0x8cd5) { fail(0x506); return 0; }
    if (index_type && index_type != U16 && index_type != U32) { fail(BAD_ENUM); return 0; }
    if (viewport[0] < 0 || viewport[1] < 0 || viewport[2] <= 0 || viewport[3] <= 0 ||
        (uint64_t)viewport[0] + viewport[2] > tg.w ||
        (uint64_t)viewport[1] + viewport[3] > tg.h) { fail(BAD_VALUE); return 0; }
    /* Colour outputs the shader declares but the pass lacks (e.g. depth-only FBOs) go to a scratch target
     * with writes disabled, because §13 rejects outputs without an attachment. */
    if (programs[program].nout > 4) { fail(BAD_OP); return 0; }
    for (uint32_t i = tg.ncolor; i < programs[program].nout; i++) tg.gap[i] = 1;
    if (programs[program].nout > tg.ncolor) tg.ncolor = programs[program].nout;
    if (!tg.ncolor && !tg.has_depth && !tg.has_stencil) return 0;
    Program *p = &programs[program]; uint32_t smask = 0, umask = 1, sampler_ids[8] = {0}, bound[8] = {0};
    for (uint32_t i = 0; i < p->nu; i++) if (p->u[i].sampler) {
        uint32_t unit = p->u[i].unit, slot = p->u[i].sampler - 1, dim = p->u[i].dim, shadow = p->u[i].shadow;
        uint32_t id = tex_bind[dim][unit]; const Sampler *so = samp[unit] ? &samplers[samp[unit]] : 0;
        if (id && tex_complete(&textures[id], so, shadow)) {
            Texture *t = &textures[id];
            if (t->gpu == tg.ds.gpu && (tg.has_depth || tg.has_stencil)) { fail(BAD_OP); return 0; }
            for (uint32_t c = 0; c < tg.ncolor; c++) if (!tg.gap[c] && tg.color[c].gpu == t->gpu && tg.color[c].gpu) { fail(BAD_OP); return 0; }
            bound[slot] = t->gpu; sampler_ids[slot] = sampler_id(t, so, shadow, dim);
        } else { bound[slot] = fallback_texture(dim, shadow); sampler_ids[slot] = fallback_sampler(shadow); }
        smask |= 1 << slot;
    }
    for (uint32_t i = 0; i < p->nb; i++) { uint32_t s = p->block[i].binding;
        if (ubo_whole[s]) ubo_size[s] = buffers[ubo[s]].size;
        if (!ubo[s] || !buffers[ubo[s]].gpu || !ubo_size[s] || (ubo_size[s] & 15)) { fail(BAD_OP); return 0; }
        umask |= 1 << (i + 1);
    }
    uint32_t ds = tg.has_depth || tg.has_stencil, depth_format = ds ? tg.ds.bgt : 0xffffffffu;
    uint32_t w[200] = {0, p->vgpu, p->fgpu, topo, cull ? cull_face : 0, front_face,
        depth_format, depth && tg.has_depth, depth && tg.has_depth && depth_write, depth_compare,
        stencil && tg.has_stencil, stencil_read, stencil_write,
        stencil_compare, stencil_fail, stencil_zfail, stencil_pass, stencil_compare, stencil_fail, stencil_zfail,
        stencil_pass, umask, smask, 0, 0, tg.ncolor};
    uint32_t slots[8], attr_slots[16], nslots = 0, nattrs = 0;
    for (uint32_t i = 0; i < 16; i++) if (vaos[vao].a[i].enabled) {
        Attribute *a = &vaos[vao].a[i];
        if (!a->buffer || !buffers[a->buffer].gpu || !a->stride || (a->stride & 3) ||
            a->offset % a->stride + a->count * (a->type == U8 ? 1 : 4) > a->stride ||
            (a->type != U8 && (a->offset & 3))) { fail(BAD_OP); return 0; }
        uint32_t s;
        for (s = 0; s < nslots; s++) {
            Attribute *b = &vaos[vao].a[slots[s]];
            if (a->buffer == b->buffer && a->stride == b->stride && a->divisor == b->divisor &&
                a->offset / a->stride == b->offset / b->stride) break;
        }
        if (s == nslots) {
            if (nslots == 8) { fail(BAD_OP); return 0; }
            slots[nslots] = i; w[26 + nslots * 2] = a->stride; w[27 + nslots * 2] = a->divisor; nslots++;
        }
        attr_slots[i] = s; nattrs++;
    }
    w[23] = nslots; w[24] = nattrs; uint32_t at = 26 + nslots * 2;
    for (uint32_t i = 0; i < 16; i++) if (vaos[vao].a[i].enabled) {
        Attribute *a = &vaos[vao].a[i];
        uint32_t format = a->type == U8 ? 4 : a->integer ? (a->type == U32 ? 9 : 5) + a->count - 1 :
            a->count - 1;
        w[at++] = i; w[at++] = attr_slots[i]; w[at++] = a->offset % a->stride; w[at++] = format;
    }
    for (uint32_t c = 0; c < tg.ncolor; c++) {
        uint32_t mask = color_mask; if (rgb_only(tg.color[c].fmt)) mask &= 7;
        if (tg.gap[c] || (!fbo && dfb_draw == 0)) mask = 0;
        uint32_t fmt = tg.gap[c] ? 0 : tg.color[c].bgt;
        uint32_t color[] = {fmt, blend, src_rgb, dst_rgb, blend_op_rgb, src_alpha, dst_alpha, blend_op_alpha, mask};
        copy(w + at, color, sizeof color); at += 9;
    }
    uint32_t pipe = 0, hash = 2166136261u;
    for (uint32_t j = 1; j < at; j++) hash = (hash ^ w[j]) * 16777619u;
    for (uint32_t i = 0; i < pipeline_count; i++)
        if (pipelines[i].used && pipelines[i].hash == hash && pipelines[i].n == at) {
        uint32_t j; for (j = 1; j < at && w[j] == pipelines[i].words[j]; j++);
        if (j == at) { pipe = pipelines[i].id; break; }
    }
    if (!pipe) {
        if (pipeline_count == 128) { fail(OOM); return 0; }
        Pipeline *c = &pipelines[pipeline_count++]; c->used = 1; c->id = pipe = pipeline_count;
        w[0] = pipe; copy(c->words, w, at * 4); c->n = at; c->hash = hash;
        send(0x4a, w, at); w32_gl_pipelines++;
    }
    uint32_t max_index = first + (uint32_t)count - 1;
    Buffer *ib = &buffers[vaos[vao].element]; uint32_t index_size = index_type == U16 ? 2 : 4;
    if (index_type) {
        if (!ib->gpu || index_offset % index_size || (uint64_t)index_offset + (uint32_t)count * index_size > ib->size) {
            fail(BAD_OP); return 0;
        }
        max_index = 0;
        for (uint32_t i = 0; i < (uint32_t)count; i++) {
            uint32_t index = 0; copy(&index, ib->data + index_offset + i * index_size, index_size);
            int64_t v = (int64_t)index + base_vertex;
            if (v < 0 || v > 0xffffffffu) { fail(BAD_OP); return 0; }
            if ((uint32_t)v > max_index) max_index = (uint32_t)v;
        }
    }
    for (uint32_t i = 0; i < 16; i++) if (vaos[vao].a[i].enabled) {
        Attribute *a = &vaos[vao].a[i];
        uint64_t end = (uint64_t)a->offset + (uint64_t)(a->divisor ? instances - 1 : max_index) * a->stride +
            a->count * (a->type == U8 ? 1 : 4);
        if (end > buffers[a->buffer].size) { fail(BAD_OP); return 0; }
    }
    float h = (float)tg.h; copy(p->values, &h, 4);
    SEND(0x41, p->ubuf, 0, PTR(p->values), 4096); p->dirty = 0;
    uint32_t pass_w[35]; uint32_t pass_n = pass_words(&tg, 0, pass_w);
    begin(); op(0x4c, pass_w, pass_n); uint32_t pw[] = {pipe}; op(0x4e, pw, 1);
    uint32_t vp[] = {bits((float)viewport[0]), bits(h - viewport[1] - viewport[3]), bits((float)viewport[2]),
        bits((float)viewport[3]), bits(range_min), bits(range_max)}; op(0x4f, vp, 6);
    if (scissor_enabled) {
        int32_t x = imin((int32_t)tg.w, imax(0, scissor[0]));
        int32_t y = imin((int32_t)tg.h, imax(0, scissor[1]));
        uint32_t sw = (uint32_t)imax(0, imin(scissor[0] + scissor[2], (int32_t)tg.w) - x);
        uint32_t sh = (uint32_t)imax(0, imin(scissor[1] + scissor[3], (int32_t)tg.h) - y);
        uint32_t sc[] = {(uint32_t)x, tg.h - (uint32_t)y - sh, sw, sh}; op(0x50, sc, 4);
    }
    uint32_t sr[] = {stencil_ref}; op(0x51, sr, 1);
    uint32_t bc[] = {bits(blend_color[0]), bits(blend_color[1]), bits(blend_color[2]), bits(blend_color[3])};
    op(0x52, bc, 4);
    for (uint32_t s = 0; s < nslots; s++) { Attribute *a = &vaos[vao].a[slots[s]]; Buffer *b = &buffers[a->buffer];
        uint32_t offset = a->offset - a->offset % a->stride;
        uint32_t vb[] = {s, b->gpu, offset, b->size - offset}; op(0x53, vb, 4);
    }
    uint32_t ub[] = {0, p->ubuf, 0, 4096}; op(0x55, ub, 4);
    for (uint32_t i = 0; i < p->nb; i++) { uint32_t s = p->block[i].binding;
        uint32_t b[] = {i + 1, buffers[ubo[s]].gpu, ubo_offset[s], ubo_size[s]}; op(0x55, b, 4);
    }
    for (uint32_t i = 0; i < p->nu; i++) if (p->u[i].sampler) {
        uint32_t slot = p->u[i].sampler - 1, unit = p->u[i].unit;
        uint32_t t[] = {slot, bound[slot], sampler_ids[slot]}; (void)unit; op(0x56, t, 3);
    }
    if (index_type) {
        uint32_t b[] = {ib->gpu, index_type == U32, 0, ib->size}; op(0x54, b, 4);
        uint32_t d[] = {(uint32_t)count, (uint32_t)instances, index_offset / index_size, (uint32_t)base_vertex, 0};
        op(0x58, d, 5);
    } else { uint32_t d[] = {(uint32_t)count, (uint32_t)instances, first, 0}; op(0x57, d, 4); }
    op(0x4d, 0, 0); submit(); w32_gl_draws++; return 0;
}
static uint32_t api_DrawArrays(void) {
    if ((int32_t)ARG(1) < 0) { fail(BAD_VALUE); return 0; }
    return draw(ARG(0), (int32_t)ARG(2), 1, ARG(1), 0, 0, 0);
}
static uint32_t api_DrawElements(void) { return draw(ARG(0), (int32_t)ARG(1), 1, 0, ARG(2), ARG(3), 0); }
static uint32_t api_DrawArraysInstanced(void) {
    if ((int32_t)ARG(1) < 0) { fail(BAD_VALUE); return 0; }
    return draw(ARG(0), (int32_t)ARG(2), (int32_t)ARG(3), ARG(1), 0, 0, 0);
}
static uint32_t api_DrawElementsInstanced(void) {
    return draw(ARG(0), (int32_t)ARG(1), (int32_t)ARG(4), 0, ARG(2), ARG(3), 0);
}
static uint32_t api_DrawElementsBaseVertex(void) {
    return draw(ARG(0), (int32_t)ARG(1), 1, 0, ARG(2), ARG(3), (int32_t)ARG(4));
}
static uint32_t api_DrawElementsInstancedBaseVertex(void) {
    return draw(ARG(0), (int32_t)ARG(1), (int32_t)ARG(4), 0, ARG(2), ARG(3), (int32_t)ARG(5));
}
static uint32_t api_ReadPixels(void) {
    int32_t x = (int32_t)ARG(0), y = (int32_t)ARG(1), w = (int32_t)ARG(2), h = (int32_t)ARG(3);
    uint32_t format = ARG(4), type = ARG(5), dst = ARG(6);
    if (!valid_format(format) || !valid_type(type)) { fail(BAD_ENUM); return 0; }
    uint32_t e = transfer_error(format, type); if (e) { fail(e); return 0; }
    if (w < 0 || h < 0) { fail(BAD_VALUE); return 0; }
    Target tg; if (resolve_fbo(fbo_read, 1, &tg) != 0x8cd5) { fail(0x506); return 0; }
    if (format == 0x1902 || format == 0x84f9 || format == 0x1901 || integer_format(format)) {
        approximate("glReadPixels of depth/stencil or integer data"); fail(BAD_OP); return 0;
    }
    if (fbo_read ? !fbos[fbo_read].read : dfb_read == 0) { fail(BAD_OP); return 0; }
    if (!w || !h) return 0;
    /* Pixels outside the framebuffer are unspecified in GL; leave those client bytes untouched. */
    int32_t x0 = x < 0 ? 0 : x, y0 = y < 0 ? 0 : y, x1 = x + w > (int32_t)tg.w ? (int32_t)tg.w : x + w,
        y1 = y + h > (int32_t)tg.h ? (int32_t)tg.h : y + h;
    if (x1 <= x0 || y1 <= y0) return 0;
    uint32_t rw = (uint32_t)(x1 - x0), rh = (uint32_t)(y1 - y0);
    /* The clipped region is written at its place inside the requested client rectangle. */
    Pix st = pack_st; st.skip_pixels += (uint32_t)(x0 - x); st.skip_rows += (uint32_t)(y0 - y);
    ReadCtx r = {0, format, type, dst, rw, rh, 0, 0, 0, &st};
    if (!fbo_read) {
        uint32_t req = request_id_next(); begin(); bgt_cmd_readback(&cmd, req, 0, (uint32_t)x0, tg.h - (uint32_t)y1, rw, rh);
        submit();
        int status; while ((status = bgt_request_status(req)) == 0) w32_wait_frame();
        uint32_t n = rw * rh * 4; uint8_t *data = scratch(n);
        int got = data && status > 0 ? bgt_request_read(req, data, n) : -1; bgt_request_close(req);
        if (got != (int)n) { fail(BAD_OP); return 0; }
        sink_external(&r, 0, rh, data); return 0;
    }
    const Image *im = &tg.color[0];
    r.bgt = im->bgt;
    fetch_texels(im->gpu, im->mip, (uint32_t)x0, tg.h - (uint32_t)y1, 0, rw, rh, im->bgt, sink_external, &r);
    return 0;
}
static uint32_t api_Flush(void) { return 0; }
static uint32_t api_Finish(void) { return 0; }
