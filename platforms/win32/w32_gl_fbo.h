/* Renderbuffers, framebuffer objects, completeness, draw/read buffers. Included once by w32_gl.c.
 * SPDX-License-Identifier: MIT — LANE-K6A */
typedef struct { uint32_t type, name, level; } Attach; /* type: 0 none, 1 texture, 2 renderbuffer */
typedef struct { uint32_t used; Attach color[4], depth, stencil; uint32_t draw[4], read; } Fbo;
typedef struct { uint32_t used, gpu, w, h, internal; } Rbo;
typedef struct { uint32_t gpu, mip, bgt, w, h; const Fmt *fmt; } Image;
typedef struct {
    uint32_t status, ncolor, w, h; Image color[4]; int gap[4]; int has_depth, has_stencil; Image ds;
} Target;
static Fbo fbos[N]; static Rbo rbos[N];
static uint32_t fbo, fbo_read, rbo, dfb_draw = 0x405, dfb_read = 0x405;
#define FB_DRAW 0x8ca9u
#define FB_READ 0x8ca8u
#define FB_BOTH 0x8d40u

static uint32_t api_GenRenderbuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) x86_wr32(ARG(1) + i * 4, alloc_name(rbos, sizeof(Rbo))); return 0;
}
static uint32_t api_BindRenderbuffer(void) {
    if (ARG(0) != RENDERBUFFER) fail(BAD_ENUM); else if (ARG(1) >= N) fail(BAD_VALUE);
    else { rbo = ARG(1); if (rbo) rbos[rbo].used = 1; } return 0;
}
static void renderbuffer_storage(uint32_t internal, uint32_t w, uint32_t h) {
    const Fmt *f = image_format(internal, 1); if (!f) return;
    if (!rbo) { fail(BAD_OP); return; }
    if (w > 4096 || h > 4096 || (int32_t)w < 0 || (int32_t)h < 0) { fail(BAD_VALUE); return; }
    Rbo *r = &rbos[rbo]; if (r->gpu) SEND(0x45, r->gpu);
    r->gpu = 0; r->w = w; r->h = h; r->internal = internal;
    if (!w || !h) return;
    r->gpu = 256 + rbo;
    if (f->bgt <= 6) SEND(0x43, r->gpu, w, h, 1, f->bgt, 2); else SEND(0x59, r->gpu, 0, w, h, 1, 1, f->bgt, 2);
    if (f->kind == K_COLOR && f->chans == 3 && f->bgt != 2 && f->bgt != 3) {
        begin(); uint32_t pw[14] = {1, 0, 0, 0, 0, 0, 0, r->gpu, 0, 1, 0, 0, 0, bits(1)}; op(0x4c, pw, 14); op(0x4d, 0, 0);
        submit();
    }
}
static uint32_t api_RenderbufferStorage(void) {
    if (ARG(0) != RENDERBUFFER) fail(BAD_ENUM); else renderbuffer_storage(ARG(1), ARG(2), ARG(3)); return 0;
}
static uint32_t api_RenderbufferStorageMultisample(void) {
    if (ARG(0) != RENDERBUFFER) { fail(BAD_ENUM); return 0; }
    if (ARG(1)) { approximate("multisample renderbuffers (MAX_SAMPLES is 0)"); fail(BAD_OP); return 0; }
    renderbuffer_storage(ARG(2), ARG(3), ARG(4)); return 0;
}
static uint32_t api_GetRenderbufferParameteriv(void) {
    if (ARG(0) != RENDERBUFFER) { fail(BAD_ENUM); return 0; }
    if (!rbo) { fail(BAD_OP); return 0; }
    Rbo *r = &rbos[rbo]; const Fmt *f = r->internal ? find_fmt(r->internal) : 0; int32_t v;
    switch (ARG(1)) {
    case 0x8d42: v = (int32_t)r->w; break; case 0x8d43: v = (int32_t)r->h; break;
    case 0x8d44: v = r->internal ? (int32_t)r->internal : 0x8058; break;
    case 0x8d50: v = f ? f->bits[0] : 0; break; case 0x8d51: v = f ? f->bits[1] : 0; break;
    case 0x8d52: v = f ? f->bits[2] : 0; break; case 0x8d53: v = f ? f->bits[3] : 0; break;
    case 0x8d54: v = f ? f->bits[4] : 0; break; case 0x8d55: v = f ? f->bits[5] : 0; break;
    case 0x8cab: v = 0; break;
    default: fail(BAD_ENUM); return 0;
    }
    x86_wr32(ARG(2), (uint32_t)v); return 0;
}
static uint32_t api_DeleteRenderbuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + i * 4);
        if (id && id < N) { if (rbos[id].gpu) SEND(0x45, rbos[id].gpu);
            zero(&rbos[id], sizeof(Rbo)); if (rbo == id) rbo = 0;
            uint32_t bound[2] = {fbo, fbo_read};
            for (uint32_t b = 0; b < 2; b++) if (bound[b]) { Fbo *f = &fbos[bound[b]];
                for (uint32_t k = 0; k < 4; k++) if (f->color[k].type == 2 && f->color[k].name == id) zero(&f->color[k], sizeof(Attach));
                if (f->depth.type == 2 && f->depth.name == id) zero(&f->depth, sizeof(Attach));
                if (f->stencil.type == 2 && f->stencil.name == id) zero(&f->stencil, sizeof(Attach)); } } }
    return 0;
}
static uint32_t api_GenFramebuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = alloc_name(fbos, sizeof(Fbo));
        if (id) { fbos[id].draw[0] = fbos[id].read = 0x8ce0; } x86_wr32(ARG(1) + i * 4, id); } return 0;
}
static uint32_t api_BindFramebuffer(void) {
    uint32_t t = ARG(0), id = ARG(1);
    if (t != FB_BOTH && t != FB_DRAW && t != FB_READ) { fail(BAD_ENUM); return 0; }
    if (id >= N) { fail(BAD_VALUE); return 0; }
    if (id && !fbos[id].used) { fbos[id].used = 1; fbos[id].draw[0] = fbos[id].read = 0x8ce0; }
    if (t != FB_READ) fbo = id;
    if (t != FB_DRAW) fbo_read = id;
    return 0;
}
static uint32_t api_DeleteFramebuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + i * 4);
        if (id && id < N) { zero(&fbos[id], sizeof(Fbo)); if (fbo == id) fbo = 0; if (fbo_read == id) fbo_read = 0; } }
    return 0;
}
static Fbo *target_fbo(uint32_t target, uint32_t *id) {
    if (target != FB_BOTH && target != FB_DRAW && target != FB_READ) { fail(BAD_ENUM); return 0; }
    *id = target == FB_READ ? fbo_read : fbo;
    if (!*id) { fail(BAD_OP); return 0; }
    return &fbos[*id];
}
/* Selects the attachment slot: 0..3 color, 4 depth, 5 stencil, 6 depth+stencil; -1 with error raised. */
static int attach_point(uint32_t a) {
    if (a >= 0x8ce0 && a <= 0x8cef) { if (a - 0x8ce0 >= 4) { fail(BAD_OP); return -1; } return (int)(a - 0x8ce0); }
    if (a == 0x8d00) return 4;
    if (a == 0x8d20) return 5;
    if (a == 0x821a) return 6;
    fail(BAD_ENUM); return -1;
}
static void set_attach(Fbo *f, int point, Attach v) {
    if (point < 4) f->color[point] = v;
    else if (point == 4) f->depth = v;
    else if (point == 5) f->stencil = v;
    else { f->depth = v; f->stencil = v; }
}
static uint32_t api_FramebufferTexture2D(void) {
    uint32_t id; Fbo *f = target_fbo(ARG(0), &id); if (!f) return 0;
    int point = attach_point(ARG(1)); if (point < 0) return 0;
    uint32_t tex = ARG(3), level = ARG(4);
    if (tex && ARG(2) != TEXTURE_2D) { fail(BAD_ENUM); return 0; }
    if (tex >= N) { fail(BAD_VALUE); return 0; }
    if (tex && (!textures[tex].used || !textures[tex].kind1)) { fail(BAD_OP); return 0; }
    if (tex && textures[tex].kind1 != 1) { fail(BAD_OP); return 0; }
    if (level >= MAXLV) { fail(BAD_VALUE); return 0; }
    Attach a = {tex ? 1u : 0u, tex, level}; set_attach(f, point, a); return 0;
}
static uint32_t api_FramebufferRenderbuffer(void) {
    uint32_t id; Fbo *f = target_fbo(ARG(0), &id); if (!f) return 0;
    int point = attach_point(ARG(1)); if (point < 0) return 0;
    if (ARG(2) != RENDERBUFFER) { fail(BAD_ENUM); return 0; }
    uint32_t rb = ARG(3); if (rb >= N) { fail(BAD_VALUE); return 0; }
    if (rb && !rbos[rb].used) { fail(BAD_OP); return 0; }
    Attach a = {rb ? 2u : 0u, rb, 0}; set_attach(f, point, a); return 0;
}
/* Resolve one attachment to a renderable image. Returns 0 if the attachment is incomplete. */
static int image_of(const Attach *a, int point, Image *im) {
    const Fmt *f; uint32_t gpu, mip = 0, w, h;
    if (a->type == 1) {
        if (a->name >= N) return 0;
        Texture *t = &textures[a->name]; if (!t->used || !t->gpu || t->kind1 != 1 || a->level >= t->gmips) return 0;
        Level *lv = &t->lv[a->level]; if (!lv->w || lv->w != lvl_w(t, a->level) || lv->h != lvl_h(t, a->level)) return 0;
        f = find_fmt(lv->internal); if (!f || f->bgt != t->gfmt) return 0;
        gpu = t->gpu; mip = a->level; w = lv->w; h = lv->h;
    } else if (a->type == 2) {
        if (a->name >= N) return 0;
        Rbo *r = &rbos[a->name]; if (!r->used || !r->gpu || !r->w || !r->h) return 0;
        f = find_fmt(r->internal); if (!f) return 0; gpu = r->gpu; w = r->w; h = r->h;
    } else return 0;
    if (point < 4 ? f->kind != K_COLOR : point == 4 ? (f->kind != K_DEPTH && f->kind != K_DS) :
        point == 5 ? (f->kind != K_DS && f->kind != K_STENCIL) : f->kind != K_DS) return 0;
    im->gpu = gpu; im->mip = mip; im->bgt = f->bgt; im->w = w; im->h = h; im->fmt = f; return 1;
}
static int same_attach(const Attach *a, const Attach *b) { return a->type == b->type && a->name == b->name && a->level == b->level; }
/* GL 3.3 completeness (4.4.4) plus the §13 restrictions: attachments must share one size. */
static uint32_t resolve_fbo(uint32_t id, int for_read, Target *tg) {
    zero(tg, sizeof *tg);
    if (!id) {
        tg->w = width(); tg->h = height(); tg->ncolor = 1; tg->color[0].gpu = 0; tg->color[0].bgt = 0;
        tg->color[0].w = tg->w; tg->color[0].h = tg->h; tg->has_depth = tg->has_stencil = 1;
        tg->ds.gpu = depth_handle; tg->ds.bgt = 5; tg->ds.w = tg->w; tg->ds.h = tg->h;
        if (dfb_draw == 0 && !for_read) tg->ncolor = 1; /* write mask removes colour writes (see draw) */
        return tg->status = 0x8cd5;
    }
    Fbo *f = &fbos[id]; int any = f->depth.type || f->stencil.type;
    for (uint32_t i = 0; i < 4; i++) if (f->color[i].type) any = 1;
    if (!any) return tg->status = 0x8cd7;
    Image color[4]; int have[4] = {0, 0, 0, 0};
    for (uint32_t i = 0; i < 4; i++) if (f->color[i].type) {
        if (!image_of(&f->color[i], (int)i, &color[i])) return tg->status = 0x8cd6; have[i] = 1;
    }
    Image depth, stencil; int hd = 0, hs = 0, shared = same_attach(&f->depth, &f->stencil);
    if (f->depth.type) {
        if (!image_of(&f->depth, shared ? 6 : 4, &depth)) return tg->status = 0x8cd6;
        hd = 1;
    }
    if (f->stencil.type) {
        if (!image_of(&f->stencil, shared ? 6 : 5, &stencil)) return tg->status = 0x8cd6;
        hs = 1;
    }
    if (hd && hs && !same_attach(&f->depth, &f->stencil)) return tg->status = 0x8cdd;
    for (uint32_t i = 0; i < 4; i++) if (f->draw[i] && !have[f->draw[i] - 0x8ce0]) return tg->status = 0x8cdb;
    if (f->read && !have[f->read - 0x8ce0]) return tg->status = 0x8cdc;
    uint32_t w = 0, h = 0; int mismatch = 0;
    for (uint32_t i = 0; i < 4; i++) if (have[i]) { if (w && (w != color[i].w || h != color[i].h)) mismatch = 1; w = color[i].w; h = color[i].h; }
    if (hd) { if (w && (w != depth.w || h != depth.h)) mismatch = 1; w = depth.w; h = depth.h; }
    if (hs) { if (w && (w != stencil.w || h != stencil.h)) mismatch = 1; w = stencil.w; h = stencil.h; }
    if (mismatch) return tg->status = 0x8cdd;
    tg->w = w; tg->h = h; tg->has_depth = hd; tg->has_stencil = hs;
    if (hd) tg->ds = depth; else if (hs) tg->ds = stencil;
    if (!for_read) {
        uint32_t n = 0; for (uint32_t i = 0; i < 4; i++) if (f->draw[i]) n = i + 1;
        tg->ncolor = n;
        for (uint32_t i = 0; i < n; i++) {
            if (f->draw[i]) tg->color[i] = color[f->draw[i] - 0x8ce0]; else tg->gap[i] = 1;
        }
    } else if (f->read) tg->color[0] = color[f->read - 0x8ce0];
    return tg->status = 0x8cd5;
}
static uint32_t api_CheckFramebufferStatus(void) {
    uint32_t t = ARG(0);
    if (t != FB_BOTH && t != FB_DRAW && t != FB_READ) { fail(BAD_ENUM); return 0; }
    Target tg; return resolve_fbo(t == FB_READ ? fbo_read : fbo, t == FB_READ, &tg);
}
static uint32_t buffer_mode_ok(uint32_t mode, int fbo_bound, int draw) {
    if (mode == 0) return 0;
    if (mode >= 0x8ce0 && mode <= 0x8cef) { if (!fbo_bound) return BAD_OP; return mode - 0x8ce0 >= 4 ? BAD_OP : 0; }
    if (mode >= 0x400 && mode <= 0x408) {
        if (!draw && mode == 0x408) return BAD_ENUM;
        if (fbo_bound) return BAD_OP;
        return mode == 0x401 || mode == 0x403 || mode == 0x407 ? BAD_OP : 0;
    }
    return BAD_ENUM;
}
static uint32_t api_DrawBuffer(void) {
    uint32_t e = buffer_mode_ok(ARG(0), fbo != 0, 1); if (e) { fail(e); return 0; }
    if (!fbo) { dfb_draw = ARG(0); return 0; }
    Fbo *f = &fbos[fbo]; for (uint32_t i = 0; i < 4; i++) f->draw[i] = 0; f->draw[0] = ARG(0); return 0;
}
static uint32_t api_DrawBuffers(void) {
    int32_t n = (int32_t)ARG(0);
    if (n < 0 || n > 4) { fail(BAD_VALUE); return 0; }
    uint32_t bufs[4] = {0, 0, 0, 0};
    for (int32_t i = 0; i < n; i++) {
        bufs[i] = x86_rd32(ARG(1) + 4 * i);
        /* DrawBuffers permits individual default images, not DrawBuffer's aggregate FRONT/BACK/LEFT enums. */
        if (!fbo && bufs[i] && (bufs[i] < 0x400 || bufs[i] > 0x403)) { fail(BAD_ENUM); return 0; }
        uint32_t e = buffer_mode_ok(bufs[i], fbo != 0, 1);
        if (e) { fail(e); return 0; }
        for (int32_t j = 0; j < i; j++) if (bufs[i] && bufs[i] == bufs[j]) { fail(BAD_OP); return 0; }
    }
    if (!fbo) {
        dfb_draw = 0; uint32_t selected = 0;
        for (int32_t i = 0; i < n; i++) if (bufs[i]) { dfb_draw = bufs[i]; selected++; }
        if (selected > 1) approximate("default front/back draw images share the logical surface");
        return 0;
    }
    Fbo *f = &fbos[fbo]; for (uint32_t i = 0; i < 4; i++) f->draw[i] = bufs[i]; return 0;
}
static uint32_t api_ReadBuffer(void) {
    uint32_t e = buffer_mode_ok(ARG(0), fbo_read != 0, 0); if (e) { fail(e); return 0; }
    if (!fbo_read) dfb_read = ARG(0); else fbos[fbo_read].read = ARG(0); return 0;
}
static uint32_t api_GetFramebufferAttachmentParameteriv(void) {
    uint32_t id; uint32_t t = ARG(0);
    if (t != FB_BOTH && t != FB_DRAW && t != FB_READ) { fail(BAD_ENUM); return 0; }
    id = t == FB_READ ? fbo_read : fbo; uint32_t a = ARG(1), pname = ARG(2); int32_t v = 0;
    if (!id) {
        if (!(a == 0x405 || a == 0x404 || a == 0x1801 || a == 0x1802 || a == 0x402 || a == 0x400)) { fail(BAD_ENUM); return 0; }
        switch (pname) {
        case 0x8cd0: v = 0x8218; break; case 0x8cd1: v = 0; break;
        case 0x8212: case 0x8213: case 0x8214: v = (a == 0x1801 || a == 0x1802) ? 0 : 8; break;
        case 0x8215: v = (a == 0x1801 || a == 0x1802) ? 0 : 8; break;
        case 0x8216: v = a == 0x1801 ? 24 : 0; break; case 0x8217: v = a == 0x1802 ? 8 : 0; break;
        case 0x8211: v = 0x8c17; break; case 0x8210: v = 0x2601; break;
        default: fail(BAD_ENUM); return 0;
        }
        x86_wr32(ARG(3), (uint32_t)v); return 0;
    }
    Fbo *f = &fbos[id]; int point = attach_point(a); if (point < 0) return 0;
    const Attach *at = point < 4 ? &f->color[point] : point == 4 ? &f->depth : point == 5 ? &f->stencil : &f->depth;
    if (point == 6 && !same_attach(&f->depth, &f->stencil)) { fail(BAD_OP); return 0; }
    const Fmt *fm = 0;
    if (at->type == 1 && at->name < N) { Texture *tx = &textures[at->name]; if (at->level < MAXLV && tx->lv[at->level].w) fm = find_fmt(tx->lv[at->level].internal); }
    if (at->type == 2 && at->name < N) fm = find_fmt(rbos[at->name].internal);
    switch (pname) {
    case 0x8cd0: v = at->type == 1 ? 0x1702 : at->type == 2 ? 0x8d41 : 0; break;
    case 0x8cd1: if (!at->type) { fail(BAD_ENUM); return 0; } v = (int32_t)at->name; break;
    case 0x8cd2: if (at->type != 1) { fail(BAD_ENUM); return 0; } v = (int32_t)at->level; break;
    case 0x8cd3: case 0x8cd4: if (at->type != 1) { fail(BAD_ENUM); return 0; } v = 0; break;
    case 0x8da7: if (at->type != 1) { fail(BAD_ENUM); return 0; } v = 0; break;
    case 0x8212: case 0x8213: case 0x8214: case 0x8215: case 0x8216: case 0x8217: {
        if (!at->type) { fail(BAD_ENUM); return 0; }
        static const uint8_t idx[] = {0, 1, 2, 3, 4, 5}; v = fm ? fm->bits[idx[pname - 0x8212]] : 0; break; }
    case 0x8211: if (!at->type) { fail(BAD_ENUM); return 0; } v = fm ? (int32_t)(fm->flt ? 0x1406 : 0x8c17) : 0; break;
    case 0x8210: if (!at->type) { fail(BAD_ENUM); return 0; } v = fm && fm->srgb ? 0x8c40 : 0x2601; break;
    default: fail(BAD_ENUM); return 0;
    }
    x86_wr32(ARG(3), (uint32_t)v); return 0;
}
static uint32_t api_DeleteTextures(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) {
        uint32_t id = x86_rd32(ARG(1) + i * 4); if (!id || id >= N) continue;
        if (textures[id].gpu) SEND(0x45, textures[id].gpu);
        zero(&textures[id], sizeof(Texture));
        for (uint32_t d = 0; d < 3; d++) for (uint32_t u = 0; u < 8; u++) if (tex_bind[d][u] == id) tex_bind[d][u] = 0;
        uint32_t bound[2] = {fbo, fbo_read};
        for (uint32_t b = 0; b < 2; b++) if (bound[b]) { Fbo *f = &fbos[bound[b]];
            for (uint32_t k = 0; k < 4; k++) if (f->color[k].type == 1 && f->color[k].name == id) zero(&f->color[k], sizeof(Attach));
            if (f->depth.type == 1 && f->depth.name == id) zero(&f->depth, sizeof(Attach));
            if (f->stencil.type == 1 && f->stencil.name == id) zero(&f->stencil, sizeof(Attach)); }
    }
    return 0;
}
