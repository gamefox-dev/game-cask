/* Texture objects, samplers, pixel transfer and queries (GL 3.3 semantics over §13/§13.7).
 * Included once by w32_gl.c. SPDX-License-Identifier: MIT — LANE-K6A */
#define MAXLV 13
#define TEX_2D 0xde1u
#define TEX_3D 0x806fu
#define TEX_ARRAY 0x8c1au
typedef struct {
    uint32_t min, mag, ws, wt, wr, cmp_mode, cmp_func; float min_lod, max_lod, lod_bias, border[4]; uint32_t swz[4];
} Params;
typedef struct { uint32_t w, h, d, internal; } Level;
typedef struct {
    uint32_t used, kind1, gpu, gw, gh, gd, gmips, gfmt, base, maxl; Params p; Level lv[MAXLV];
} Texture;
typedef struct { uint32_t used; Params p; } Sampler;
typedef struct { uint32_t align, row_length, skip_rows, skip_pixels, image_height, skip_images, swap, lsb; } Pix;
static Pix unpack_st = {4, 0, 0, 0, 0, 0, 0, 0}, pack_st = {4, 0, 0, 0, 0, 0, 0, 0};
static Texture textures[N]; static Sampler samplers[N];
static uint32_t tex_bind[3][8];
static Level proxy_level[3];
static void params_init(Params *p) {
    zero(p, sizeof *p); p->min = 0x2702; p->mag = 0x2601; p->ws = p->wt = p->wr = 0x2901; p->cmp_func = 0x203;
    p->min_lod = -1000; p->max_lod = 1000; p->swz[0] = 0x1903; p->swz[1] = 0x1904; p->swz[2] = 0x1905; p->swz[3] = 0x1906;
}
static uint32_t dim_of(uint32_t target, int *proxy) {
    *proxy = 0;
    switch (target) {
    case TEX_2D: return 0; case TEX_3D: return 1; case TEX_ARRAY: return 2;
    case 0x8064: *proxy = 1; return 0; case 0x8070: *proxy = 1; return 1; case 0x8c1b: *proxy = 1; return 2;
    default: return 0xffffffffu;
    }
}
static uint32_t max_dim(uint32_t dim) { return dim == 1 ? 256 : 4096; }
static uint32_t chain_len(uint32_t dim, uint32_t w, uint32_t h, uint32_t d) {
    uint32_t m = w > h ? w : h; if (dim == 1 && d > m) m = d;
    uint32_t n = 1; while (m > 1) { m >>= 1; n++; } return n;
}
static uint32_t lvl_w(const Texture *t, uint32_t n) { uint32_t v = t->gw >> n; return v ? v : 1; }
static uint32_t lvl_h(const Texture *t, uint32_t n) { uint32_t v = t->gh >> n; return v ? v : 1; }
static uint32_t lvl_d(const Texture *t, uint32_t n) {
    if (t->kind1 == 2) { uint32_t v = t->gd >> n; return v ? v : 1; } /* 3D depth halves */
    return t->kind1 == 3 ? t->gd : 1;                                   /* array layers are constant */
}
static uint8_t *scratch(uint32_t n) {
    static uint8_t *buf; static uint32_t cap;
    if (n > cap) {
        uint32_t c = cap ? cap : 65536; while (c < n) c *= 2;
        uint8_t *b = x86_alloc(c); if (!b) { fail(OOM); return 0; } buf = b; cap = c;
    }
    return buf;
}

static uint32_t api_GenTextures(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) {
        uint32_t id = alloc_name(textures, sizeof(Texture)); if (id) params_init(&textures[id].p);
        textures[id].base = 0; textures[id].maxl = 1000; x86_wr32(ARG(1) + 4 * i, id);
    } return 0;
}
static uint32_t api_ActiveTexture(void) {
    if (ARG(0) < 0x84c0 || ARG(0) >= 0x84c8) fail(BAD_ENUM); else active_unit = ARG(0) - 0x84c0; return 0;
}
static uint32_t api_BindTexture(void) {
    int proxy; uint32_t dim = dim_of(ARG(0), &proxy), id = ARG(1);
    if (dim == 0xffffffffu || proxy) { fail(BAD_ENUM); return 0; }
    if (id >= N) { fail(BAD_VALUE); return 0; }
    if (id) {
        Texture *t = &textures[id];
        if (!t->used) { zero(t, sizeof *t); t->used = 1; params_init(&t->p); t->maxl = 1000; }
        if (t->kind1 && t->kind1 != dim + 1) { fail(BAD_OP); return 0; }
        t->kind1 = dim + 1;
    }
    tex_bind[dim][active_unit] = id; return 0;
}
static uint32_t api_PixelStorei(void) {
    uint32_t key = ARG(0), v = ARG(1); Pix *p; uint32_t k;
    if ((key >= 0xcf0 && key <= 0xcf5) || key == 0x806d || key == 0x806e) {
        p = &unpack_st; k = key == 0x806d ? 6 : key == 0x806e ? 7 : key - 0xcf0;
    } else if ((key >= 0xd00 && key <= 0xd05) || key == 0x806b || key == 0x806c) {
        p = &pack_st; k = key == 0x806b ? 6 : key == 0x806c ? 7 : key - 0xd00;
    } else { fail(BAD_ENUM); return 0; }
    /* k: 0 swap, 1 lsb, 2 row_length, 3 skip_rows, 4 skip_pixels, 5 align, 6 skip_images, 7 image_height */
    if (k <= 1) { if (v) approximate(k ? "GL_*_LSB_FIRST" : "GL_*_SWAP_BYTES"); (&p->swap)[k] = !!v; return 0; }
    if (k == 5) { if (v != 1 && v != 2 && v != 4 && v != 8) fail(BAD_VALUE); else p->align = v; return 0; }
    if ((int32_t)v < 0) { fail(BAD_VALUE); return 0; }
    switch (k) { case 2: p->row_length = v; break; case 3: p->skip_rows = v; break; case 4: p->skip_pixels = v; break;
        case 6: p->skip_images = v; break; default: p->image_height = v; }
    return 0;
}
static uint32_t pixel_bytes(uint32_t format, uint32_t type) {
    return is_packed(type) ? type_bytes(type) : format_comps(format) * type_bytes(type);
}
/* Byte offset of pixel (x,y,z) within a client image of w pixels / h rows, honouring store state. */
static uint64_t pix_offset(const Pix *st, uint32_t format, uint32_t type, uint32_t w, uint32_t h, uint32_t x,
        uint32_t y, uint32_t z) {
    uint64_t px = pixel_bytes(format, type), rl = st->row_length ? st->row_length : w;
    uint64_t row = (rl * px + st->align - 1) / st->align * st->align;
    uint64_t ih = st->image_height ? st->image_height : h;
    return ((uint64_t)st->skip_images + z) * row * ih + ((uint64_t)st->skip_rows + y) * row +
        ((uint64_t)st->skip_pixels + x) * px;
}
/* Convert and upload [x,y,z]+[w,h,d] (GL coordinates, rows bottom-up) of level `lvl` from client memory. */
static void upload_region(Texture *t, uint32_t id, uint32_t lvl, uint32_t x, uint32_t y, uint32_t z,
        uint32_t w, uint32_t h, uint32_t d, uint32_t format, uint32_t type, uint32_t src, int null_fill) {
    uint32_t bpp = storage_bytes(t->gfmt), mh = lvl_h(t, lvl), gfmt = t->gfmt;
    Pix store = unpack_st; if (t->kind1 == 1) store.skip_images = store.image_height = 0;
    int legacy = t->kind1 == 1 && gfmt <= 6;
    uint32_t comps = format_comps(format);
    const Fmt *logical = find_fmt(t->lv[lvl].internal);
    int fast = src && type == T_UBYTE && (gfmt == 0 || gfmt == 1) &&
        (format == 0x1907 || (format == 0x1908 && logical && logical->chans == 4));
    int fast1 = src && type == T_UBYTE && gfmt == 2 && format == 0x1903;
    int fast2 = src && type == T_UBYTE && gfmt == 3 && format == 0x8227;
    uint32_t bh = (1u << 20) / (w * bpp); if (!bh) bh = 1;
    for (uint32_t zi = 0; zi < d; zi++) for (uint32_t yo = 0; yo < h; yo += bh) {
        uint32_t rows = h - yo < bh ? h - yo : bh; uint8_t *buf = scratch(w * rows * bpp); if (!buf) return;
        for (uint32_t r = 0; r < rows; r++) {
            uint8_t *dst = buf + (uint64_t)(rows - 1 - r) * w * bpp;
            uint32_t base = src ? src + (uint32_t)pix_offset(&store, format, type, w, h, 0, yo + r, zi) : 0;
            if (fast || fast1 || fast2) {
                if (fast && comps == 4) for (uint32_t i = 0; i < w; i++) put32(dst + i * 4, x86_rd32(base + i * 4));
                else if (fast) for (uint32_t i = 0; i < w; i++) {
                    dst[i*4] = (uint8_t)x86_rd8(base + i*3); dst[i*4+1] = (uint8_t)x86_rd8(base + i*3+1);
                    dst[i*4+2] = (uint8_t)x86_rd8(base + i*3+2); dst[i*4+3] = 255;
                } else for (uint32_t i = 0; i < w * bpp; i++) dst[i] = (uint8_t)x86_rd8(base + i);
                continue;
            }
            for (uint32_t i = 0; i < w; i++) {
                float v[4] = {0, 0, 0, 1};
                if (src) decode_pixel(base + i * pixel_bytes(format, type), format, type, v);
                else if (!null_fill) continue;
                if (logical && logical->chans == 3) v[3] = 1;
                encode_texel(dst + i * bpp, gfmt, v);
            }
        }
        uint32_t by = mh - (y + yo + rows);
        if (legacy) SEND(0x44, id, lvl, x, by, w, rows, PTR(buf), w * rows * bpp);
        else SEND(0x5a, id, lvl, x, by, z + zi, w, rows, 1, PTR(buf), w * rows * bpp);
    }
}
static void gpu_create(Texture *t, uint32_t id, uint32_t dim, uint32_t w, uint32_t h, uint32_t d, uint32_t bgt) {
    t->gpu = id; t->gw = w; t->gh = h; t->gd = d; t->gfmt = bgt; t->gmips = chain_len(dim, w, h, d);
    if (dim == 0 && bgt <= 6) SEND(0x43, id, w, h, t->gmips, bgt, 3);
    else SEND(0x59, id, dim, w, h, dim == 0 ? 1 : d, t->gmips, bgt, dim == 0 ? 3 : 1);
}
static void gpu_destroy(Texture *t) { if (t->gpu) SEND(0x45, t->gpu); t->gpu = 0; }
static void init_alpha_2d(Texture *t, uint32_t id) {
    for (uint32_t mip = 0; mip < t->gmips; mip++) {
        begin(); uint32_t w[14] = {1, 0, 0, 0, 0, 0, 0, id, mip, 1, 0, 0, 0, bits(1)}; op(0x4c, w, 14); op(0x4d, 0, 0);
        submit();
    }
}
static const Fmt *image_format(uint32_t internal, int rbo) {
    const Fmt *f = find_fmt(internal);
    if (!f && known_unsupported(internal)) { approximate_hex("internalformat unsupported", internal); fail(BAD_ENUM); return 0; }
    if (!f) { fail(BAD_VALUE); return 0; }
    if (!rbo && f->kind == K_STENCIL) { fail(BAD_ENUM); return 0; }
    return f;
}
/* Shared TexImage2D/3D. dim: 0 2D, 1 3D, 2 array. */
static void tex_image(uint32_t dim, int proxy, uint32_t level, uint32_t internal, int32_t w, int32_t h, int32_t d,
        int32_t border, uint32_t format, uint32_t type, uint32_t pixels) {
    if (!valid_format(format) || !valid_type(type) || format == 0x1901) { fail(BAD_ENUM); return; }
    const Fmt *f = image_format(internal, 0); if (!f) return;
    if (level >= MAXLV || w < 0 || h < 0 || d < 0 || border) { fail(BAD_VALUE); return; }
    uint32_t e = transfer_error(format, type); if (e) { fail(e); return; }
    int depth_format = format == 0x1902 || format == 0x84f9;
    if (depth_format != (f->kind != K_COLOR) || (f->kind == K_DEPTH && format != 0x1902) ||
        (f->kind == K_DS && format != 0x84f9) || integer_format(format)) { fail(BAD_OP); return; }
    if (f->kind != K_COLOR && dim != 0) { approximate("depth 3D/array textures"); fail(BAD_OP); return; }
    uint32_t edge = max_dim(dim) >> level, dmax = dim == 0 ? 1 : dim == 1 ? 256u >> level : 256;
    if (!edge || !dmax) { fail(BAD_VALUE); return; }
    if (dim == 0) d = 1;
    int too_big = (uint32_t)w > edge || (uint32_t)h > edge || (uint32_t)d > dmax;
    if (proxy) {
        Level *l = &proxy_level[dim]; zero(l, sizeof *l);
        if (!too_big && w && h && d) { l->w = (uint32_t)w; l->h = (uint32_t)h; l->d = (uint32_t)d; l->internal = internal; }
        return;
    }
    if (too_big) { fail(BAD_VALUE); return; }
    uint32_t id = tex_bind[dim][active_unit]; if (!id) { fail(BAD_OP); return; }
    if (pixels && f->kind != K_COLOR) { approximate("depth/stencil pixel upload"); fail(BAD_OP); return; }
    Texture *t = &textures[id];
    uint32_t lw = (uint32_t)w, lh = (uint32_t)h, ld = (uint32_t)d;
    int reallocate = 0;
    if (level == 0) {
        reallocate = !t->gpu || t->gw != lw || t->gh != lh || (dim && t->gd != ld) || t->gfmt != f->bgt;
        if (reallocate && t->gpu) { gpu_destroy(t); for (uint32_t n = 1; n < MAXLV; n++) t->lv[n].w = 0; }
        if (reallocate && lw && lh && ld) {
            gpu_create(t, id, dim, lw, lh, ld, f->bgt); reallocate = 1;
        }
    } else if (!t->gpu && lw && lh && ld) {
        /* Level defined before level 0: allocate from this level's implied base size. */
        gpu_create(t, id, dim, lw << level, lh << level, dim == 1 ? ld << level : ld, f->bgt); reallocate = 1;
    }
    Level *lv = &t->lv[level];
    int same = lv->w == lw && lv->h == lh && lv->d == ld && lv->internal == internal;
    lv->w = lw; lv->h = lh; lv->d = ld; lv->internal = internal;
    if (!lw || !lh || !ld || !t->gpu) return;
    int fits = lw == lvl_w(t, level) && lh == lvl_h(t, level) && ld == lvl_d(t, level) &&
        f->bgt == t->gfmt && level < t->gmips;
    if (!fits) { approximate("texture level not representable (inconsistent mip chain)"); return; }
    int rgb_only = f->kind == K_COLOR && f->chans == 3 && (f->bgt == 0 || f->bgt == 1 || f->bgt == 4 || f->bgt == 7 || f->bgt == 12);
    if (pixels) upload_region(t, id, level, 0, 0, 0, lw, lh, ld, format, type, pixels, 1);
    else if (rgb_only && (reallocate || !same)) {
        if (dim == 0) { if (level == 0) init_alpha_2d(t, id); else { begin(); uint32_t pw[14] = {1, 0, 0, 0, 0, 0, 0, id, level, 1, 0, 0, 0, bits(1)};
            op(0x4c, pw, 14); op(0x4d, 0, 0); submit(); } }
        else upload_region(t, id, level, 0, 0, 0, lw, lh, ld, 0x1908, T_UBYTE, 0, 1);
    }
}
static uint32_t api_TexImage2D(void) {
    int proxy; uint32_t dim = dim_of(ARG(0), &proxy);
    if (dim != 0) { fail(BAD_ENUM); return 0; }
    tex_image(0, proxy, ARG(1), ARG(2), (int32_t)ARG(3), (int32_t)ARG(4), 1, (int32_t)ARG(5), ARG(6), ARG(7), ARG(8));
    return 0;
}
static uint32_t api_TexImage3D(void) {
    int proxy; uint32_t dim = dim_of(ARG(0), &proxy);
    if (dim == 0xffffffffu || dim == 0) { fail(BAD_ENUM); return 0; }
    tex_image(dim, proxy, ARG(1), ARG(2), (int32_t)ARG(3), (int32_t)ARG(4), (int32_t)ARG(5), (int32_t)ARG(6),
        ARG(7), ARG(8), ARG(9));
    return 0;
}
static void tex_sub_image(uint32_t dim, uint32_t level, int32_t x, int32_t y, int32_t z, int32_t w, int32_t h,
        int32_t d, uint32_t format, uint32_t type, uint32_t pixels) {
    if (!valid_format(format) || !valid_type(type) || format == 0x1901) { fail(BAD_ENUM); return; }
    uint32_t e = transfer_error(format, type); if (e) { fail(e); return; }
    uint32_t id = tex_bind[dim][active_unit]; if (!id) { fail(BAD_OP); return; }
    Texture *t = &textures[id]; if (level >= MAXLV) { fail(BAD_VALUE); return; }
    Level *lv = &t->lv[level]; if (!lv->w) { fail(BAD_OP); return; }
    const Fmt *f = find_fmt(lv->internal);
    int depth_format = format == 0x1902 || format == 0x84f9;
    if (!f || depth_format != (f->kind != K_COLOR) || (f->kind == K_DEPTH && format != 0x1902) ||
        (f->kind == K_DS && format != 0x84f9) || integer_format(format)) { fail(BAD_OP); return; }
    if (x < 0 || y < 0 || z < 0 || w < 0 || h < 0 || d < 0 || (uint64_t)x + (uint32_t)w > lv->w ||
        (uint64_t)y + (uint32_t)h > lv->h || (uint64_t)z + (uint32_t)d > lv->d) { fail(BAD_VALUE); return; }
    if (!w || !h || !d || !pixels) return;
    if (f->kind != K_COLOR) { approximate("depth/stencil pixel upload"); fail(BAD_OP); return; }
    if (!t->gpu || f->bgt != t->gfmt || level >= t->gmips) { fail(BAD_OP); return; }
    upload_region(t, id, level, (uint32_t)x, (uint32_t)y, (uint32_t)z, (uint32_t)w, (uint32_t)h, (uint32_t)d,
        format, type, pixels, 0);
}
static uint32_t api_TexSubImage2D(void) {
    int proxy; if (dim_of(ARG(0), &proxy) != 0 || proxy) { fail(BAD_ENUM); return 0; }
    tex_sub_image(0, ARG(1), (int32_t)ARG(2), (int32_t)ARG(3), 0, (int32_t)ARG(4), (int32_t)ARG(5), 1, ARG(6), ARG(7), ARG(8));
    return 0;
}
static uint32_t api_TexSubImage3D(void) {
    int proxy; uint32_t dim = dim_of(ARG(0), &proxy);
    if (dim == 0xffffffffu || dim == 0 || proxy) { fail(BAD_ENUM); return 0; }
    tex_sub_image(dim, ARG(1), (int32_t)ARG(2), (int32_t)ARG(3), (int32_t)ARG(4), (int32_t)ARG(5), (int32_t)ARG(6),
        (int32_t)ARG(7), ARG(8), ARG(9), ARG(10));
    return 0;
}
static uint32_t api_GenerateMipmap(void) {
    int proxy; uint32_t dim = dim_of(ARG(0), &proxy);
    if (dim == 0xffffffffu || proxy) { fail(BAD_ENUM); return 0; }
    uint32_t id = tex_bind[dim][active_unit]; if (!id) { fail(BAD_OP); return 0; }
    Texture *t = &textures[id]; uint32_t b = t->base;
    if (b >= MAXLV || !t->lv[b].w || !t->gpu) { fail(BAD_OP); return 0; }
    const Fmt *f = find_fmt(t->lv[b].internal);
    if (!f || f->kind != K_COLOR || b >= t->gmips) { fail(BAD_OP); return 0; }
    SEND(0x5d, id, b);
    for (uint32_t n = b + 1; n < t->gmips; n++) {
        t->lv[n].w = lvl_w(t, n); t->lv[n].h = lvl_h(t, n); t->lv[n].d = lvl_d(t, n);
        t->lv[n].internal = t->lv[b].internal;
    }
    return 0;
}

/* ---- parameters ---- */
static int enum_ok(uint32_t pname, uint32_t v) {
    switch (pname) {
    case 0x2801: return v == 0x2600 || v == 0x2601 || (v >= 0x2700 && v <= 0x2703);
    case 0x2800: return v == 0x2600 || v == 0x2601;
    case 0x2802: case 0x2803: case 0x8072: return v == 0x812f || v == 0x2901 || v == 0x8370 || v == 0x812d;
    case 0x884c: return v == 0 || v == 0x884e;
    case 0x884d: return v >= 0x200 && v <= 0x207;
    case 0x8e42: case 0x8e43: case 0x8e44: case 0x8e45: return v == 0 || v == 1 || (v >= 0x1903 && v <= 0x1906);
    default: return 0;
    }
}
static int enum_param(uint32_t pname) {
    return pname == 0x2801 || pname == 0x2800 || pname == 0x2802 || pname == 0x2803 || pname == 0x8072 ||
        pname == 0x884c || pname == 0x884d || (pname >= 0x8e42 && pname <= 0x8e45);
}
/* is_float: f[] holds floats; otherwise i[] holds ints. `tex` is null for sampler objects. */
static void param_set(Params *p, Texture *t, uint32_t pname, const float *f, const int32_t *i, int is_float, int sampler) {
    if (enum_param(pname)) {
        uint32_t v = is_float ? (uint32_t)(int32_t)(f[0] + (f[0] < 0 ? -0.5f : 0.5f)) : (uint32_t)i[0];
        if (!enum_ok(pname, v) || (sampler && pname >= 0x8e42)) { fail(BAD_ENUM); return; }
        if (v == 0x812d) approximate("GL_CLAMP_TO_BORDER treated as CLAMP_TO_EDGE");
        switch (pname) {
        case 0x2801: p->min = v; break; case 0x2800: p->mag = v; break; case 0x2802: p->ws = v; break;
        case 0x2803: p->wt = v; break; case 0x8072: p->wr = v; break; case 0x884c: p->cmp_mode = v; break;
        case 0x884d: p->cmp_func = v; break;
        default: p->swz[pname - 0x8e42] = v;
        }
        return;
    }
    float fv = is_float ? f[0] : (float)i[0];
    switch (pname) {
    case 0x813a: p->min_lod = fv; return;
    case 0x813b: p->max_lod = fv; return;
    case 0x8501: p->lod_bias = fv; if (fv != 0) approximate("GL_TEXTURE_LOD_BIAS ignored"); return;
    case 0x1004:
        for (int k = 0; k < 4; k++) p->border[k] = is_float ? f[k] : (float)((2.0 * (double)i[k] + 1.0) / 4294967295.0);
        return;
    case 0x8e46:
        if (sampler) break;
        for (int k = 0; k < 4; k++) {
            uint32_t v = is_float ? (uint32_t)f[k] : (uint32_t)i[k];
            if (!enum_ok(0x8e42, v)) { fail(BAD_ENUM); return; }
        }
        for (int k = 0; k < 4; k++) {
            p->swz[k] = is_float ? (uint32_t)f[k] : (uint32_t)i[k];
        }
        return;
    case 0x813c: case 0x813d:
        if (sampler || !t) break;
        if (fv < 0) { fail(BAD_VALUE); return; }
        if (pname == 0x813c) t->base = (uint32_t)fv; else t->maxl = (uint32_t)fv;
        return;
    default: break;
    }
    fail(BAD_ENUM);
}
static Texture *param_texture(uint32_t target) {
    int proxy; uint32_t dim = dim_of(target, &proxy);
    if (dim == 0xffffffffu || proxy) { fail(BAD_ENUM); return 0; }
    uint32_t id = tex_bind[dim][active_unit]; if (!id) { fail(BAD_OP); return 0; }
    return &textures[id];
}
static uint32_t pcount(uint32_t pname) { return pname == 0x1004 || pname == 0x8e46 ? 4 : 1; }
static uint32_t api_TexParameteri(void) {
    Texture *t = param_texture(ARG(0)); int32_t v[4] = {(int32_t)ARG(2), 0, 0, 0};
    if (t) param_set(&t->p, t, ARG(1), 0, v, 0, 0); return 0;
}
static uint32_t api_TexParameterf(void) {
    Texture *t = param_texture(ARG(0)); float v[4] = {argf(2), 0, 0, 0};
    if (t) param_set(&t->p, t, ARG(1), v, 0, 1, 0); return 0;
}
static uint32_t api_TexParameteriv(void) {
    Texture *t = param_texture(ARG(0)); if (!t) return 0;
    int32_t v[4]; for (uint32_t k = 0; k < pcount(ARG(1)); k++) v[k] = (int32_t)x86_rd32(ARG(2) + 4 * k);
    param_set(&t->p, t, ARG(1), 0, v, 0, 0); return 0;
}
static uint32_t api_TexParameterfv(void) {
    Texture *t = param_texture(ARG(0)); if (!t) return 0;
    float v[4]; for (uint32_t k = 0; k < pcount(ARG(1)); k++) { union { uint32_t u; float f; } w = {x86_rd32(ARG(2) + 4 * k)}; v[k] = w.f; }
    param_set(&t->p, t, ARG(1), v, 0, 1, 0); return 0;
}
static uint32_t api_TexParameterIiv(void) { return api_TexParameteriv(); }
static uint32_t api_TexParameterIuiv(void) { return api_TexParameteriv(); }
static Sampler *sampler_object(uint32_t id) {
    if (!id || id >= N || !samplers[id].used) { fail(BAD_OP); return 0; } return &samplers[id];
}
static uint32_t api_GenSamplers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = alloc_name(samplers, sizeof(Sampler));
        if (id) params_init(&samplers[id].p); x86_wr32(ARG(1) + i * 4, id); } return 0;
}
static uint32_t api_BindSampler(void) {
    if (ARG(0) >= 8 || ARG(1) >= N) fail(BAD_VALUE);
    else if (ARG(1) && !samplers[ARG(1)].used) fail(BAD_OP); else samp[ARG(0)] = ARG(1); return 0;
}
static uint32_t api_SamplerParameteri(void) {
    Sampler *s = sampler_object(ARG(0)); int32_t v[4] = {(int32_t)ARG(2), 0, 0, 0};
    if (s) param_set(&s->p, 0, ARG(1), 0, v, 0, 1); return 0;
}
static uint32_t api_SamplerParameterf(void) {
    Sampler *s = sampler_object(ARG(0)); float v[4] = {argf(2), 0, 0, 0};
    if (s) param_set(&s->p, 0, ARG(1), v, 0, 1, 1); return 0;
}
static uint32_t api_SamplerParameteriv(void) {
    Sampler *s = sampler_object(ARG(0)); if (!s) return 0;
    int32_t v[4]; for (uint32_t k = 0; k < pcount(ARG(1)); k++) v[k] = (int32_t)x86_rd32(ARG(2) + 4 * k);
    param_set(&s->p, 0, ARG(1), 0, v, 0, 1); return 0;
}
static uint32_t api_SamplerParameterfv(void) {
    Sampler *s = sampler_object(ARG(0)); if (!s) return 0;
    float v[4]; for (uint32_t k = 0; k < pcount(ARG(1)); k++) { union { uint32_t u; float f; } w = {x86_rd32(ARG(2) + 4 * k)}; v[k] = w.f; }
    param_set(&s->p, 0, ARG(1), v, 0, 1, 1); return 0;
}
static uint32_t api_SamplerParameterIiv(void) { return api_SamplerParameteriv(); }
static uint32_t api_SamplerParameterIuiv(void) { return api_SamplerParameteriv(); }
static uint32_t api_DeleteSamplers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + i * 4);
        if (id && id < N) { samplers[id].used = 0;
            for (uint32_t j = 0; j < 8; j++) if (samp[j] == id) samp[j] = 0; } } return 0;
}
/* Read any parameter as floats (n values); returns 0 on invalid pname. */
static uint32_t param_get(const Params *p, const Texture *t, uint32_t pname, float *o, int sampler) {
    switch (pname) {
    case 0x2801: o[0] = (float)p->min; return 1; case 0x2800: o[0] = (float)p->mag; return 1;
    case 0x2802: o[0] = (float)p->ws; return 1; case 0x2803: o[0] = (float)p->wt; return 1;
    case 0x8072: o[0] = (float)p->wr; return 1; case 0x884c: o[0] = (float)p->cmp_mode; return 1;
    case 0x884d: o[0] = (float)p->cmp_func; return 1; case 0x813a: o[0] = p->min_lod; return 1;
    case 0x813b: o[0] = p->max_lod; return 1; case 0x8501: o[0] = p->lod_bias; return 1;
    case 0x1004: for (int k = 0; k < 4; k++) o[k] = p->border[k]; return 4;
    case 0x8e42: case 0x8e43: case 0x8e44: case 0x8e45: o[0] = (float)p->swz[pname - 0x8e42]; return 1;
    case 0x8e46: if (sampler) return 0; for (int k = 0; k < 4; k++) o[k] = (float)p->swz[k]; return 4;
    case 0x813c: if (sampler || !t) return 0; o[0] = (float)t->base; return 1;
    case 0x813d: if (sampler || !t) return 0; o[0] = (float)t->maxl; return 1;
    default: return 0;
    }
}
static void write_params(uint32_t dst, const float *o, uint32_t n, uint32_t pname, int as_float) {
    for (uint32_t k = 0; k < n; k++) {
        if (as_float) x86_wr32(dst + 4 * k, bits(o[k]));
        else if (pname == 0x1004) { double v = (double)o[k] * 2147483647.0; x86_wr32(dst + 4 * k, (uint32_t)(int32_t)(v > 2147483647.0 ? 2147483647.0 : v < -2147483648.0 ? -2147483648.0 : v)); }
        else x86_wr32(dst + 4 * k, (uint32_t)(int32_t)(o[k] + (o[k] < 0 ? -0.5f : 0.5f)));
    }
}
static uint32_t tex_get(int as_float) {
    Texture *t = param_texture(ARG(0)); if (!t) return 0;
    float o[4]; uint32_t n = param_get(&t->p, t, ARG(1), o, 0);
    if (!n) { fail(BAD_ENUM); return 0; } write_params(ARG(2), o, n, ARG(1), as_float); return 0;
}
static uint32_t api_GetTexParameteriv(void) { return tex_get(0); }
static uint32_t api_GetTexParameterfv(void) { return tex_get(1); }
static uint32_t api_GetTexParameterIiv(void) { return tex_get(0); }
static uint32_t api_GetTexParameterIuiv(void) { return tex_get(0); }
static uint32_t sampler_get(int as_float) {
    Sampler *s = sampler_object(ARG(0)); if (!s) return 0;
    float o[4]; uint32_t n = param_get(&s->p, 0, ARG(1), o, 1);
    if (!n) { fail(BAD_ENUM); return 0; } write_params(ARG(2), o, n, ARG(1), as_float); return 0;
}
static uint32_t api_GetSamplerParameteriv(void) { return sampler_get(0); }
static uint32_t api_GetSamplerParameterfv(void) { return sampler_get(1); }
static uint32_t api_GetSamplerParameterIiv(void) { return sampler_get(0); }
static uint32_t api_GetSamplerParameterIuiv(void) { return sampler_get(0); }
static uint32_t comp_type(const Fmt *f, uint32_t channel) {
    /* TEXTURE_*_TYPE: GL_NONE, UNSIGNED_NORMALIZED 0x8c17 or FLOAT 0x1406 */
    if (f->kind == K_COLOR) return channel < 4 && f->bits[channel] ? (f->flt ? 0x1406u : 0x8c17u) : 0;
    if (channel == 4) return f->bits[4] ? (f->flt ? 0x1406u : 0x8c17u) : 0;
    return 0;
}
static uint32_t level_get(int as_float) {
    int proxy; uint32_t dim = dim_of(ARG(0), &proxy), level = ARG(1), pname = ARG(2);
    if (dim == 0xffffffffu) { fail(BAD_ENUM); return 0; }
    if (level >= MAXLV) { fail(BAD_VALUE); return 0; }
    Level none = {0, 0, 0, 0x1908}, *lv = &none;
    if (proxy) lv = &proxy_level[dim];
    else { uint32_t id = tex_bind[dim][active_unit]; if (!id) { fail(BAD_OP); return 0; }
        if (textures[id].lv[level].w) lv = &textures[id].lv[level]; }
    const Fmt *f = lv->w ? find_fmt(lv->internal) : 0; int32_t v = 0;
    switch (pname) {
    case 0x1000: v = (int32_t)lv->w; break; case 0x1001: v = (int32_t)lv->h; break;
    case 0x8071: v = (int32_t)lv->d; break; case 0x1003: v = (int32_t)lv->internal; break;
    case 0x1005: v = 0; break; case 0x86a1: v = 0; break; case 0x8c3f: v = 0; break;
    case 0x805c: v = f ? f->bits[0] : 0; break; case 0x805d: v = f ? f->bits[1] : 0; break;
    case 0x805e: v = f ? f->bits[2] : 0; break; case 0x805f: v = f ? f->bits[3] : 0; break;
    case 0x884a: v = f ? f->bits[4] : 0; break; case 0x88f1: v = f ? f->bits[5] : 0; break;
    case 0x8c10: v = f ? (int32_t)comp_type(f, 0) : 0; break; case 0x8c11: v = f ? (int32_t)comp_type(f, 1) : 0; break;
    case 0x8c12: v = f ? (int32_t)comp_type(f, 2) : 0; break; case 0x8c13: v = f ? (int32_t)comp_type(f, 3) : 0; break;
    case 0x8c16: v = f ? (int32_t)comp_type(f, 4) : 0; break;
    default: fail(BAD_ENUM); return 0;
    }
    if (as_float) x86_wr32(ARG(3), bits((float)v)); else x86_wr32(ARG(3), (uint32_t)v);
    return 0;
}
static uint32_t api_GetTexLevelParameteriv(void) { return level_get(0); }
static uint32_t api_GetTexLevelParameterfv(void) { return level_get(1); }

/* ---- texture readback (GetTexImage, FBO ReadPixels) ---- */
static void encode_external(uint32_t a, uint32_t format, uint32_t type, const float *v) {
    uint32_t comps = format_comps(format); int bgr = format == 0x80e0 || format == 0x80e1;
    float c[4] = {v[0], v[1], v[2], v[3]};
    if (bgr) { c[0] = v[2]; c[2] = v[0]; }
    if (is_packed(type)) {
        static const struct { uint32_t type; uint8_t n, w[4], rev, size; } pk[] = {
            {0x8032, 3, {3, 3, 2, 0}, 0, 1}, {0x8362, 3, {3, 3, 2, 0}, 1, 1}, {0x8363, 3, {5, 6, 5, 0}, 0, 2},
            {0x8364, 3, {5, 6, 5, 0}, 1, 2}, {0x8033, 4, {4, 4, 4, 4}, 0, 2}, {0x8365, 4, {4, 4, 4, 4}, 1, 2},
            {0x8034, 4, {5, 5, 5, 1}, 0, 2}, {0x8366, 4, {5, 5, 5, 1}, 1, 2}, {0x8035, 4, {8, 8, 8, 8}, 0, 4},
            {0x8367, 4, {8, 8, 8, 8}, 1, 4}, {0x8036, 4, {10, 10, 10, 2}, 0, 4}, {0x8368, 4, {10, 10, 10, 2}, 1, 4},
        };
        for (uint32_t k = 0; k < sizeof pk / sizeof pk[0]; k++) if (pk[k].type == type) {
            uint32_t acc = 0, shift = 0;
            for (uint32_t i = 0; i < pk[k].n; i++) {
                uint32_t q = (uint32_t)(clamp01(c[i]) * (float)((1u << pk[k].w[i]) - 1u) + 0.5f);
                if (pk[k].rev) { acc |= q << shift; shift += pk[k].w[i]; } else acc = (acc << pk[k].w[i]) | q;
            }
            if (pk[k].size == 1) x86_wr8(a, acc); else if (pk[k].size == 2) x86_wr16(a, acc); else x86_wr32(a, acc);
            return;
        }
        return;
    }
    for (uint32_t i = 0; i < comps; i++) {
        float f = c[i];
        switch (type) {
        case T_UBYTE: x86_wr8(a + i, to_u8(f)); break;
        case T_BYTE: x86_wr8(a + i, (uint32_t)(int32_t)((f < -1 ? -1 : f > 1 ? 1 : f) * 127.0f + (f < 0 ? -0.5f : 0.5f))); break;
        case T_USHORT: x86_wr16(a + i * 2, (uint32_t)(clamp01(f) * 65535.0f + 0.5f)); break;
        case T_SHORT: x86_wr16(a + i * 2, (uint32_t)(int32_t)((f < -1 ? -1 : f > 1 ? 1 : f) * 32767.0f + (f < 0 ? -0.5f : 0.5f))); break;
        case T_UINT: x86_wr32(a + i * 4, (uint32_t)((double)clamp01(f) * 4294967295.0 + 0.5)); break;
        case T_INT: { double s = (double)(f < -1 ? -1 : f > 1 ? 1 : f) * 2147483647.0; x86_wr32(a + i * 4, (uint32_t)(int32_t)(s + (s < 0 ? -0.5 : 0.5))); break; }
        case T_HALF: x86_wr16(a + i * 2, f2h(f)); break;
        default: x86_wr32(a + i * 4, bits(f)); break;
        }
    }
}
static uint32_t request_id_next(void) { return ++request_id; }
/* Fetch texels of a BGT texture (color) with TEXTURE_READBACK in bounded bands; calls sink for each band.
 * Rows are top-first as stored. Returns 0 on failure. */
static int fetch_texels(uint32_t gpu, uint32_t lvl, uint32_t x, uint32_t y, uint32_t z, uint32_t w, uint32_t h,
        uint32_t bgt, void (*sink)(void *, uint32_t row0, uint32_t rows, const uint8_t *), void *ctx) {
    uint32_t bpp = storage_bytes(bgt), bh = (1u << 21) / (w * bpp); if (!bh) bh = 1;
    uint8_t *buf = scratch(w * (h < bh ? h : bh) * bpp); if (!buf) return 0;
    for (uint32_t yo = 0; yo < h; yo += bh) {
        uint32_t rows = h - yo < bh ? h - yo : bh, req = request_id_next();
        SEND(0x5c, gpu, lvl, x, y + yo, z, w, rows, 1, req);
        int status; while ((status = bgt_request_status(req)) == 0) w32_wait_frame();
        int got = status > 0 ? bgt_request_read(req, buf, w * rows * bpp) : -1; bgt_request_close(req);
        if (got != (int)(w * rows * bpp)) { fail(BAD_OP); return 0; }
        sink(ctx, yo, rows, buf);
    }
    return 1;
}
typedef struct { uint32_t bgt, format, type, dst, w, h, d_index, mh, y0; const Pix *st; } ReadCtx;
static void sink_external(void *c, uint32_t row0, uint32_t rows, const uint8_t *data) {
    ReadCtx *r = (ReadCtx *)c; uint32_t bpp = storage_bytes(r->bgt);
    for (uint32_t j = 0; j < rows; j++) {
        /* BGT row (row0+j) from the top maps to GL row (h-1-(row0+j)) from the bottom of the read region. */
        uint32_t glrow = r->h - 1 - (row0 + j);
        for (uint32_t i = 0; i < r->w; i++) {
            float v[4]; decode_texel(data + (j * r->w + i) * bpp, r->bgt, v);
            encode_external(r->dst + (uint32_t)pix_offset(r->st, r->format, r->type, r->w, r->h, i, glrow, r->d_index),
                r->format, r->type, v);
        }
    }
}
static uint32_t api_GetTexImage(void) {
    int proxy; uint32_t dim = dim_of(ARG(0), &proxy), level = ARG(1), format = ARG(2), type = ARG(3);
    if (dim == 0xffffffffu || proxy) { fail(BAD_ENUM); return 0; }
    if (!valid_format(format) || !valid_type(type)) { fail(BAD_ENUM); return 0; }
    uint32_t e = transfer_error(format, type); if (e) { fail(e); return 0; }
    if (level >= MAXLV) { fail(BAD_VALUE); return 0; }
    uint32_t id = tex_bind[dim][active_unit]; if (!id) { fail(BAD_OP); return 0; }
    Texture *t = &textures[id]; Level *lv = &t->lv[level];
    if (!lv->w) return 0;
    const Fmt *f = find_fmt(lv->internal);
    if (!f || f->kind != K_COLOR || integer_format(format) || format == 0x1902 || format == 0x84f9 || format == 0x1901) {
        approximate("glGetTexImage of depth/stencil or integer data"); fail(BAD_OP); return 0; }
    if (!t->gpu || level >= t->gmips || f->bgt != t->gfmt) { fail(BAD_OP); return 0; }
    Pix store = pack_st; if (dim == 0) store.skip_images = store.image_height = 0;
    for (uint32_t zi = 0; zi < lv->d; zi++) {
        ReadCtx r = {t->gfmt, format, type, ARG(4), lv->w, lv->h, zi, lv->h, 0, &store};
        if (!fetch_texels(t->gpu, level, 0, 0, zi, lv->w, lv->h, t->gfmt, sink_external, &r)) return 0;
    }
    return 0;
}
