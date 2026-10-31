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
static uint32_t api_ClearColor(void) { for (uint32_t i = 0; i < 4; i++) clear_color[i] = clamp(argf(i)); return 0; }
static uint32_t api_ClearDepth(void) { clear_depth = clamp((float)argd(0)); return 0; }
static uint32_t api_ClearStencil(void) { clear_stencil = ARG(0) & 255; return 0; }
static uint32_t target_width(void) { return fbo ? textures[fbos[fbo].color].w >> fbos[fbo].mip : width(); }
static uint32_t target_height(void) { return fbo ? textures[fbos[fbo].color].h >> fbos[fbo].mip : height(); }
static uint32_t target_depth(void) {
    if (fbo) { Fbo *f = &fbos[fbo]; return f->depth ? f->renderbuffer ? rbos[f->depth].gpu :
        textures[f->depth].gpu : 0; }
    if (!screen_depth) { SEND(0x43, depth_handle, width(), height(), 1, 5, 2); screen_depth = 1; }
    return depth_handle;
}
static uint32_t target_depth_format(void) {
    if (!fbo) return 5; Fbo *f = &fbos[fbo]; if (!f->depth) return 0xffffffffu;
    return f->renderbuffer ? rbos[f->depth].format : textures[f->depth].format;
}
static void pass(uint32_t clear) {
    uint32_t w[14] = {1, target_depth(), 0, !!(clear & 0x100), !!(clear & 0x400), bits(clear_depth), clear_stencil,
        fbo ? fbos[fbo].color : 0, fbo ? fbos[fbo].mip : 0, !!(clear & 0x4000),
        bits(clear_color[0]), bits(clear_color[1]), bits(clear_color[2]), bits(clear_color[3])};
    if (!w[1]) w[3] = w[4] = 0;
    if (target_depth_format() == 6) w[4] = 0;
    op(0x4c, w, 14);
}
static uint32_t api_Clear(void) {
    uint32_t mask = ARG(0);
    if (mask & ~(0x4000u | 0x100u | 0x400u)) { fail(BAD_VALUE); return 0; }
    if (framebuffer_status() != 0x8cd5) { fail(0x506); return 0; }
    if (!mask) return 0;
    /* §13 load clears are whole attachment. Partial/masked clears are not silently approximated. */
    if (scissor_enabled || color_mask != 15 || ((mask & 0x100) && !depth_write) ||
        ((mask & 0x400) && stencil_write != 255)) { fail(BAD_OP); return 0; }
    (void)target_depth(); begin(); pass(mask); op(0x4d, 0, 0); submit(); return 0;
}
static uint32_t topology(uint32_t mode) {
    switch (mode) { case 0: return 0; case 1: return 1; case 3: return 2; case 4: return 3; case 5: return 4;
        default: fail(BAD_ENUM); return 0xffffffffu; }
}
static uint32_t sampler_cache[128][8], sampler_count;
static uint32_t wrap(uint32_t v) { return v == 0x2901 ? 1 : v == 0x8370 ? 2 : 0; }
static uint32_t sampler_for(Texture *t, Sampler *s) {
    uint32_t min = s ? s->min : t->min, mag = s ? s->mag : t->mag;
    uint32_t u = s ? s->u : t->u, v = s ? s->v : t->v;
    uint32_t w[8] = {0, min == 0x2601 || min == 0x2701 || min == 0x2703, mag == 0x2601,
        min == 0x2600 || min == 0x2601 ? 0 : min == 0x2700 || min == 0x2701 ? 1 : 2,
        wrap(u), wrap(v), 0, 7};
    for (uint32_t i = 0; i < sampler_count; i++) {
        uint32_t j; for (j = 1; j < 8 && w[j] == sampler_cache[i][j]; j++);
        if (j == 8) return i + 1;
    }
    if (sampler_count == 128) { fail(OOM); return 0; }
    w[0] = ++sampler_count; copy(sampler_cache[sampler_count - 1], w, sizeof w); send(0x46, w, 8); return w[0];
}
static uint32_t draw(uint32_t mode, int32_t count, int32_t instances, uint32_t first, uint32_t index_type,
        uint32_t index_offset, int32_t base_vertex) {
    uint32_t topo = topology(mode); if (topo == 0xffffffffu) return 0;
    if (count < 0 || instances < 0 || instances > 65535) { fail(BAD_VALUE); return 0; }
    if (!count || !instances) return 0;
    if (!vao || !program || !programs[program].linked) { fail(BAD_OP); return 0; }
    if (framebuffer_status() != 0x8cd5) { fail(0x506); return 0; }
    if (index_type && index_type != U16 && index_type != U32) { fail(BAD_ENUM); return 0; }
    if (viewport[0] < 0 || viewport[1] < 0 || viewport[2] <= 0 || viewport[3] <= 0 ||
        (uint64_t)viewport[0] + viewport[2] > target_width() ||
        (uint64_t)viewport[1] + viewport[3] > target_height()) { fail(BAD_VALUE); return 0; }
    Program *p = &programs[program]; uint32_t smask = 0, umask = 1, sampler_ids[8] = {0};
    for (uint32_t i = 0; i < p->nu; i++) if (p->u[i].sampler) {
        uint32_t unit = p->u[i].unit, slot = p->u[i].sampler - 1, id = tex[unit];
        if (!id || !textures[id].gpu || (fbo && id == fbos[fbo].color)) { fail(BAD_OP); return 0; }
        sampler_ids[slot] = sampler_for(&textures[id], samp[unit] ? &samplers[samp[unit]] : 0); smask |= 1 << slot;
    }
    for (uint32_t i = 0; i < p->nb; i++) { uint32_t s = p->block[i].binding;
        if (ubo_whole[s]) ubo_size[s] = buffers[ubo[s]].size;
        if (!ubo[s] || !buffers[ubo[s]].gpu || !ubo_size[s] || (ubo_size[s] & 15)) { fail(BAD_OP); return 0; }
        umask |= 1 << (i + 1);
    }
    uint32_t depth_format = target_depth_format(), has_depth = depth_format != 0xffffffffu;
    uint32_t w[200] = {0, p->vgpu, p->fgpu, topo, cull ? cull_face : 0, front_face,
        depth_format, depth && has_depth, depth && has_depth && depth_write, depth_compare,
        stencil && depth_format == 5, stencil_read, stencil_write,
        stencil_compare, stencil_fail, stencil_zfail, stencil_pass, stencil_compare, stencil_fail, stencil_zfail,
        stencil_pass, umask, smask, 0, 0, 1};
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
    uint32_t color[] = {fbo ? textures[fbos[fbo].color].format : 0, blend, src_rgb, dst_rgb, blend_op_rgb,
        src_alpha, dst_alpha, blend_op_alpha, color_mask}; copy(w + at, color, sizeof color); at += 9;
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
    (void)target_depth(); float h = (float)target_height(); copy(p->values, &h, 4);
    SEND(0x41, p->ubuf, 0, PTR(p->values), 4096); p->dirty = 0;
    begin(); pass(0); uint32_t pw[] = {pipe}; op(0x4e, pw, 1);
    uint32_t vp[] = {bits((float)viewport[0]), bits(h - viewport[1] - viewport[3]), bits((float)viewport[2]),
        bits((float)viewport[3]), bits(range_min), bits(range_max)}; op(0x4f, vp, 6);
    if (scissor_enabled) {
        int32_t x = imin((int32_t)target_width(), imax(0, scissor[0]));
        int32_t y = imin((int32_t)target_height(), imax(0, scissor[1]));
        uint32_t sw = (uint32_t)imax(0, imin(scissor[0] + scissor[2], (int32_t)target_width()) - x);
        uint32_t sh = (uint32_t)imax(0, imin(scissor[1] + scissor[3], (int32_t)target_height()) - y);
        uint32_t sc[] = {(uint32_t)x, target_height() - (uint32_t)y - sh, sw, sh}; op(0x50, sc, 4);
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
        uint32_t t[] = {slot, textures[tex[unit]].gpu, sampler_ids[slot]}; op(0x56, t, 3);
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
    uint32_t x = ARG(0), y = ARG(1), w = ARG(2), h = ARG(3);
    if (ARG(4) != RGBA || ARG(5) != U8) { fail(BAD_ENUM); return 0; }
    if ((int32_t)w < 0 || (int32_t)h < 0) { fail(BAD_VALUE); return 0; }
    if (fbo || (uint64_t)x + w > width() || (uint64_t)y + h > height()) { fail(BAD_OP); return 0; }
    if (!w || !h) return 0;
    uint32_t req = ++request_id; begin(); bgt_cmd_readback(&cmd, req, 0, x, height() - y - h, w, h); submit();
    int status; while ((status = bgt_request_status(req)) == 0) w32_wait_frame();
    uint32_t n = w * h * 4; static uint8_t *data; static uint32_t cap;
    if (cap < n) { data = x86_alloc(n); cap = n; }
    int got = data && status > 0 ? bgt_request_read(req, data, n) : -1; bgt_request_close(req);
    if (got != (int)n) { fail(BAD_OP); return 0; }
    uint32_t row = (w * 4 + pack - 1) & ~(pack - 1);
    for (uint32_t j = 0; j < h; j++) for (uint32_t i = 0; i < w * 4; i++)
        x86_wr8(ARG(6) + j * row + i, data[(h - 1 - j) * w * 4 + i]);
    return 0;
}
static uint32_t api_Flush(void) { return 0; }
static uint32_t api_Finish(void) { return 0; }
