/*
 * Win32 profile: CPU replay of recorded GDI drawing, so pixel reads (GetPixel, GetDIBits, ...) on GPU surfaces
 * return exactly what the GPU shows, without GPU readback.
 *
 * Every BGT command the GDI recorder emits into a texture (rect fills and textured sprites with a blend mode and
 * tint, uploads of known pixels, target creation/deletion) is also appended to an op log. Each texture has a CPU
 * "base" image that is its exact content at the start of the log (or at its creation). A read is answered on demand
 * for the queried pixel only: walk that texture's ops backwards to the last opaque op covering the pixel, then
 * apply the newer ops forwards with the same blend arithmetic the renderers use (bgt/renderers: fp32 per channel,
 * unorm8 rounding). A blit's source texel is resolved the same way, at the time of that blit.
 *
 * Bounded cost: the log holds LOG_CAP ops; when it is full (or before a texture with logged ops is deleted or
 * overwritten by an upload) all ops are applied to the bases in order ("compaction") and the log restarts.
 * Region reads larger than a few pixels compact first and read the bases. A small cache answers repeated reads.
 *
 * The recorder only feeds the log after w32_rp_enable(), which the profile calls when a module imports a pixel-read
 * API (or obtains one through GetProcAddress). Programs that never read pixels pay nothing.
 * A read is impossible (counted as gdi_getpixel_noread) only when the surface's history is unknown: it existed
 * before replay was enabled and the pixel has not been covered opaquely since.
 *
 * SPDX-License-Identifier: MIT
 */
#include "w32_int.h"

#define LOG_CAP 16384
#define STACK_CAP 256
#define MAX_DEPTH 12
#define CACHE_N 256

enum { OP_FILL = 1, OP_BLIT = 2 };
typedef struct {
    uint16_t kind, blend, dst, src;
    int32_t x, y, w, h;   /* destination rect (already clipped), texture pixels */
    uint32_t color;       /* fill colour, or blit tint (RGBA8) */
    float u0, v0, u1, v1; /* blit: normalized source coordinates at the rect's edges */
    int32_t prev;         /* previous op on the same destination, -1 */
} rp_op_t;

typedef struct {
    int live;
    int32_t w, h;
    uint32_t *base;       /* content at log start (NULL = unknown history) */
    int32_t head;         /* newest op on this texture, -1 */
    int touched;          /* read or written by an op in the current log */
} rp_surf_t;

static int enabled;
static rp_op_t *ops;
static int32_t nops;
static rp_surf_t surf[TEX_LIMIT + 1];
static uint32_t gen; /* bumped whenever a base changes outside the log (compaction, create, delete, upload) */

/* ------------------------------------------------------------------ base buffers (exact-size free list) */
typedef struct fb { struct fb *next; uint32_t bytes; } fb_t;
static fb_t *free_bufs;
static uint32_t *buf_alloc(uint32_t bytes) {
    for (fb_t **p = &free_bufs; *p; p = &(*p)->next)
        if ((*p)->bytes == bytes) { fb_t *f = *p; *p = f->next; __builtin_memset(f, 0, bytes); return (uint32_t *)f; }
    return (uint32_t *)x86_alloc(bytes < sizeof(fb_t) ? sizeof(fb_t) : bytes);
}
static void buf_free(uint32_t *p, uint32_t bytes) {
    if (!p) return;
    fb_t *f = (fb_t *)p;
    f->bytes = bytes;
    f->next = free_bufs;
    free_bufs = f;
}
static uint32_t surf_bytes(const rp_surf_t *s) { uint32_t b = (uint32_t)(s->w * s->h) * 4u; return b < sizeof(fb_t) ? (uint32_t)sizeof(fb_t) : b; }

/* ------------------------------------------------------------------ blend arithmetic (mirrors the renderers) */
static inline float ch(uint32_t v, int c) { return (float)((v >> (8 * c)) & 0xffu) * (1.0f / 255.0f); }
static inline uint32_t q8(float f) {
    if (!(f > 0.0f)) return 0;
    if (f >= 1.0f) return 255;
    return (uint32_t)(f * 255.0f + 0.5f);
}
static uint32_t blend_px(uint32_t mode, uint32_t src, uint32_t dst) {
    float s[4], d[4], o[4];
    for (int c = 0; c < 4; c++) { s[c] = ch(src, c); d[c] = ch(dst, c); }
    switch (mode) {
    case BGT_BLEND_OPAQUE: return src;
    case BGT_BLEND_ALPHA:
        for (int c = 0; c < 3; c++) o[c] = s[c] * s[3] + d[c] * (1.0f - s[3]);
        o[3] = s[3] + d[3] * (1.0f - s[3]);
        break;
    case BGT_BLEND_ADD:
        for (int c = 0; c < 3; c++) o[c] = s[c] * s[3] + d[c];
        o[3] = d[3];
        break;
    case BGT_BLEND_PREMULTIPLIED:
        for (int c = 0; c < 3; c++) o[c] = s[c] + d[c] * (1.0f - s[3]);
        o[3] = s[3] + d[3] * (1.0f - s[3]);
        break;
    case BGT_BLEND_INVERT:
        for (int c = 0; c < 3; c++) o[c] = s[c] * (1.0f - d[c]) + d[c] * (1.0f - s[c]);
        o[3] = d[3];
        break;
    case BGT_BLEND_MULTIPLY:
        for (int c = 0; c < 3; c++) o[c] = s[c] * d[c];
        o[3] = d[3];
        break;
    default: return src;
    }
    return q8(o[0]) | (q8(o[1]) << 8) | (q8(o[2]) << 16) | (q8(o[3]) << 24);
}
/* texel * vertex colour (the sprite shader's `texture(...) * v_col`) */
static uint32_t tinted(uint32_t texel, uint32_t tint) {
    if (tint == 0xffffffffu) return texel;
    uint32_t out = 0;
    for (int c = 0; c < 4; c++) out |= q8(ch(texel, c) * ch(tint, c)) << (8 * c);
    return out;
}
/* nearest sample of a blit at destination pixel (px,py): the texel under the pixel centre */
static void blit_texel(const rp_op_t *o, const rp_surf_t *s, int32_t px, int32_t py, int32_t *tx, int32_t *ty) {
    float fx = ((float)px + 0.5f - (float)o->x) / (float)o->w, fy = ((float)py + 0.5f - (float)o->y) / (float)o->h;
    float u = o->u0 + (o->u1 - o->u0) * fx, v = o->v0 + (o->v1 - o->v0) * fy;
    int32_t x = (int32_t)__builtin_floorf(u * (float)s->w), y = (int32_t)__builtin_floorf(v * (float)s->h);
    *tx = x < 0 ? 0 : x >= s->w ? s->w - 1 : x;
    *ty = y < 0 ? 0 : y >= s->h ? s->h - 1 : y;
}

/* ------------------------------------------------------------------ log */
static void compact(void);

int w32_rp_enabled(void) { return enabled; }

void w32_rp_enable(void) {
    if (enabled) return;
    ops = (rp_op_t *)x86_alloc(LOG_CAP * sizeof(rp_op_t));
    if (!ops) return; /* no memory: reads stay impossible (counted) */
    enabled = 1;
    nops = 0;
    for (uint32_t t = 0; t <= TEX_LIMIT; t++) { surf[t].head = -1; surf[t].touched = 0; surf[t].base = 0; }
    /* textures created before this point have unknown contents (base NULL) */
}

static rp_surf_t *S(uint32_t tex) { return tex && tex <= TEX_LIMIT ? &surf[tex] : 0; }

void w32_rp_create(uint32_t tex, int32_t w, int32_t h, const uint32_t *px) {
    rp_surf_t *s = S(tex);
    if (!s) return;
    if (enabled && s->live && s->touched) compact();
    if (s->base) buf_free(s->base, surf_bytes(s));
    s->live = 1; s->w = w; s->h = h; s->head = -1; s->touched = 0; s->base = 0;
    gen++;
    if (!enabled) return;
    s->base = buf_alloc(surf_bytes(s)); /* render targets start transparent black */
    if (s->base && px) __builtin_memcpy(s->base, px, (uint32_t)(w * h) * 4u);
}

void w32_rp_delete(uint32_t tex) {
    rp_surf_t *s = S(tex);
    if (!s || !s->live) return;
    if (enabled && s->touched) compact(); /* pending ops may still read it */
    if (s->base) buf_free(s->base, surf_bytes(s));
    s->base = 0; s->live = 0; s->head = -1; s->touched = 0;
    gen++;
}

static rp_op_t *append(uint32_t dst) {
    if (nops >= LOG_CAP) compact();
    rp_op_t *o = &ops[nops];
    rp_surf_t *s = &surf[dst];
    o->prev = s->head;
    s->head = nops++;
    s->touched = 1;
    return o;
}

void w32_rp_fill(uint32_t tex, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t rgba, uint32_t blend) {
    rp_surf_t *s = S(tex);
    if (!enabled || !s || !s->live || w <= 0 || h <= 0) return;
    if (blend == BGT_BLEND_OPAQUE && x <= 0 && y <= 0 && x + w >= s->w && y + h >= s->h && s->head < 0 && !s->touched && s->base) {
        /* a full opaque fill of an untouched texture: just set the base (keeps the log short) */
        for (int32_t i = 0; i < s->w * s->h; i++) s->base[i] = rgba;
        gen++;
        return;
    }
    rp_op_t *o = append(tex);
    o->kind = OP_FILL; o->blend = (uint16_t)blend; o->dst = (uint16_t)tex; o->src = 0;
    o->x = x; o->y = y; o->w = w; o->h = h; o->color = rgba;
}

void w32_rp_blit(uint32_t dtex, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t stex, float u0, float v0, float u1, float v1, uint32_t blend, uint32_t tint) {
    rp_surf_t *d = S(dtex), *s = S(stex);
    if (!enabled || !d || !d->live || !s || !s->live || w <= 0 || h <= 0) return;
    rp_op_t *o = append(dtex);
    o->kind = OP_BLIT; o->blend = (uint16_t)blend; o->dst = (uint16_t)dtex; o->src = (uint16_t)stex;
    o->x = x; o->y = y; o->w = w; o->h = h; o->color = tint;
    o->u0 = u0; o->v0 = v0; o->u1 = u1; o->v1 = v1;
    s->touched = 1;
}

void w32_rp_upload(uint32_t tex, int32_t x, int32_t y, int32_t w, int32_t h, const uint32_t *px) {
    rp_surf_t *s = S(tex);
    if (!enabled || !s || !s->live) return;
    if (s->touched) compact(); /* earlier ops on it, or reads of it, must see the old pixels */
    gen++;
    if (!s->base) {
        if (x > 0 || y > 0 || x + w < s->w || y + h < s->h) return; /* partial upload over unknown content */
        s->base = buf_alloc(surf_bytes(s));
        if (!s->base) return;
    }
    for (int32_t r = 0; r < h; r++)
        for (int32_t c = 0; c < w; c++)
            if (x + c >= 0 && y + r >= 0 && x + c < s->w && y + r < s->h) s->base[(y + r) * s->w + x + c] = px[r * w + c];
}

/* ------------------------------------------------------------------ compaction: apply every op to the bases */
static void compact(void) {
    if (!enabled) return;
    w32_m.gdi_replay_compactions++;
    gen++;
    for (int32_t i = 0; i < nops; i++) {
        const rp_op_t *o = &ops[i];
        rp_surf_t *d = &surf[o->dst];
        if (!d->base) continue; /* unknown history stays unknown (reads of it are counted as impossible) */
        const rp_surf_t *s = o->kind == OP_BLIT ? &surf[o->src] : 0;
        if (s && !s->base) {
            /* drawing unknown pixels into it: conservatively, the whole destination becomes unknown */
            buf_free(d->base, surf_bytes(d));
            d->base = 0;
            continue;
        }
        for (int32_t py = o->y; py < o->y + o->h; py++) {
            if (py < 0 || py >= d->h) continue;
            for (int32_t px = o->x; px < o->x + o->w; px++) {
                if (px < 0 || px >= d->w) continue;
                uint32_t src = o->color;
                if (s) {
                    int32_t tx, ty;
                    blit_texel(o, s, px, py, &tx, &ty);
                    src = tinted(s->base[ty * s->w + tx], o->color);
                }
                uint32_t *p = &d->base[py * d->w + px];
                *p = blend_px(o->blend, src, *p);
            }
        }
    }
    nops = 0;
    for (uint32_t t = 0; t <= TEX_LIMIT; t++) { surf[t].head = -1; surf[t].touched = 0; }
}

/* ------------------------------------------------------------------ on-demand pixel resolve */
/* value of texture `tex` at (x,y) after the ops with index < `before`; 1 known, 0 unknown, -1 too complex */
static int resolve(uint32_t tex, int32_t x, int32_t y, int32_t before, uint32_t *out, int depth) {
    rp_surf_t *s = S(tex);
    if (!s || !s->live || x < 0 || y < 0 || x >= s->w || y >= s->h) return 0;
    if (depth > MAX_DEPTH) return -1;
    int32_t stack[STACK_CAP];
    int n = 0, have = 0;
    uint32_t v = 0;
    int32_t i = s->head;
    while (i >= before) i = ops[i].prev;
    for (; i >= 0; i = ops[i].prev) {
        const rp_op_t *o = &ops[i];
        if (x < o->x || y < o->y || x >= o->x + o->w || y >= o->y + o->h) continue;
        if (n == STACK_CAP) return -1;
        stack[n++] = i;
        if (o->blend == BGT_BLEND_OPAQUE) { have = 1; break; }
    }
    if (!have) {
        if (!s->base) return 0;
        v = s->base[y * s->w + x];
    }
    while (n) {
        const rp_op_t *o = &ops[stack[--n]];
        uint32_t src = o->color;
        if (o->kind == OP_BLIT) {
            int32_t tx, ty;
            uint32_t t;
            blit_texel(o, &surf[o->src], x, y, &tx, &ty);
            int r = resolve(o->src, tx, ty, (int32_t)(o - ops), &t, depth + 1);
            if (r <= 0) return r;
            src = tinted(t, o->color);
        }
        v = blend_px(o->blend, src, v);
    }
    *out = v;
    return 1;
}

/* a texture's pixel only changes through ops on that texture (its head) or base changes (gen) */
typedef struct { uint32_t tex, gen; int32_t x, y, head; uint32_t v; } cache_t;
static cache_t cache[CACHE_N];

int w32_rp_pixel(uint32_t tex, int32_t x, int32_t y, uint32_t *rgba) {
    rp_surf_t *s = S(tex);
    if (!enabled || !s || !s->live) return 0;
    cache_t *c = &cache[((uint32_t)x * 31u + (uint32_t)y * 1009u + tex * 7u) & (CACHE_N - 1u)];
    if (c->tex == tex && c->x == x && c->y == y && c->head == s->head && c->gen == gen) { *rgba = c->v; return 1; }
    uint32_t v;
    int r = resolve(tex, x, y, nops, &v, 0);
    if (r < 0) { compact(); r = resolve(tex, x, y, nops, &v, 0); }
    if (r <= 0) return 0;
    c->tex = tex; c->x = x; c->y = y; c->head = s->head; c->gen = gen; c->v = v;
    *rgba = v;
    return 1;
}

int w32_rp_read(uint32_t tex, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t *out) {
    rp_surf_t *s = S(tex);
    if (!enabled || !s || !s->live) return 0;
    if (w * h > 64) { /* region reads: apply the log once, then copy */
        compact();
        if (!s->base) return 0;
        for (int32_t r = 0; r < h; r++)
            for (int32_t c = 0; c < w; c++) {
                int32_t px = x + c, py = y + r;
                out[r * w + c] = px >= 0 && py >= 0 && px < s->w && py < s->h ? s->base[py * s->w + px] : 0;
            }
        return 1;
    }
    for (int32_t r = 0; r < h; r++)
        for (int32_t c = 0; c < w; c++)
            if (!w32_rp_pixel(tex, x + c, y + r, &out[r * w + c])) return 0;
    return 1;
}
