/*
 * Win32 profile: GDI32 on BGT. Drawing is mapped by meaning onto BGT commands, not emulated
 * pixel by pixel:
 *   - the desktop and every bitmap are render-target textures (persistent GPU surfaces);
 *   - window DCs draw into the desktop with an origin and a clip rect, memory DCs into their
 *     selected bitmap;
 *   - fills, lines and text become rects/sprites (text from a glyph atlas); BitBlt/StretchBlt become
 *     textured sprites; ternary raster ops map onto BGT blends where an exact equivalent exists
 *     (SRCCOPY, SRCAND/SRCPAINT for masks, DSTINVERT, PATINVERT/SRCINVERT for black-and-white,
 *     PATCOPY, BLACKNESS/WHITENESS, NOTSRCCOPY), otherwise they are approximated and counted
 *     (w32_metrics.gdi_approx_rop) — a measured exception, never silent;
 *   - everything is recorded into a deferred command list during bgt_update and submitted once in
 *     bgt_render, with geometric clipping on the CPU so consecutive draws batch.
 * GPU contents are never read back. Pixel reads (GetPixel, GetDIBits) are answered from CPU pixels the
 * profile still knows (loaded/uploaded bitmaps), else by replaying the recorded ops on the CPU for the queried
 * pixels (w32_replay.c, counted as gdi_cpu_replays). Only reads without any known history are impossible
 * (counted as gdi_getpixel_noread).
 *
 * SPDX-License-Identifier: MIT
 */
#include "w32_int.h"

extern const uint8_t BGT_FONT5X7[95][7];

/* ------------------------------------------------------------------ objects */
enum { OB_NONE, OB_BITMAP, OB_BRUSH, OB_PEN, OB_FONT, OB_RGN, OB_PAL };
typedef struct {
    int type, stock;
    int32_t w, h;
    int mono;
    uint32_t tex;           /* BGT texture (render target) for bitmaps */
    uint32_t *cpu;          /* CPU pixels (0xAABBGGRR == BGT RGBA) while known */
    int cpu_valid;
    uint32_t dib_bits, dib_bmi; /* DIB section: guest pixel memory + BITMAPINFO copy */
    uint32_t color;         /* brush/pen colour (COLORREF 0x00BBGGRR) */
    int style;              /* brush: 0 solid, 1 null, 3 pattern; pen: PS_* */
    uint32_t pattern;       /* pattern brush: bitmap handle */
    int32_t width;          /* pen width */
    int32_t fh, weight;     /* font height (px, positive) */
    int32_t rl, rt, rr, rb; /* rect region */
} gobj_t;
static gobj_t *obj;
static uint32_t stock[20];

typedef struct {
    int used, kind;         /* 1 window, 2 memory, 3 screen */
    uint32_t hwnd, bmp, brush, pen, font;
    uint32_t bk, text, align;
    int bkmode, rop2;
    int32_t curx, cury, vx, vy, bx, by;
    int has_clip;
    int32_t cl, ct, cr, cb;          /* extra clip (logical coords) */
    int has_paint;
    int32_t pl, pt, pr, pb;          /* BeginPaint clip (client coords) */
    uint32_t saved[8][6]; int nsaved;
} dc_t;
static dc_t dcs[NDC];

static gobj_t *getobj(uint32_t h) { return (h >= H_OBJ && h < H_OBJ + NOBJ && obj[h - H_OBJ].type) ? &obj[h - H_OBJ] : 0; }
static dc_t *getdc(uint32_t h) { return (h >= H_DC && h < H_DC + NDC && dcs[h - H_DC].used) ? &dcs[h - H_DC] : 0; }
static uint32_t newobj(int type) {
    for (uint32_t i = 1; i < NOBJ; i++)
        if (!obj[i].type) { __builtin_memset(&obj[i], 0, sizeof obj[i]); obj[i].type = type; return H_OBJ + i; }
    x86_fault("GDI object table full", 0);
}

/* ------------------------------------------------------------------ deferred recorder */
#define REC_BYTES (1u << 20)
#define NREC 16
typedef struct { uint32_t *mem; bgt_cmdbuf_t cb; } rec_t;
static rec_t rec[NREC];
static uint32_t nrec_used;
static uint32_t cur_target = 0xffffffffu, cur_blend = 0xffffffffu, cur_tex = 0xffffffffu;
/* staging for pixel uploads (must live until the submit) */
#define STAGE_BYTES (8u << 20)
static uint8_t *stage;
static uint32_t stage_used;
static uint8_t tex_used[TEX_LIMIT + 1];
static int32_t scr_w, scr_h;
static int screen_ready;
static int chrome_depth;
void w32_gdi_chrome_begin(void) { chrome_depth++; }
void w32_gdi_chrome_end(void) { if (chrome_depth) chrome_depth--; }
static void count_op(void) { if (chrome_depth) w32_m.chrome_ops++; else w32_m.gdi_ops++; }

static bgt_cmdbuf_t *rb(uint32_t need) {
    rec_t *r = &rec[nrec_used ? nrec_used - 1 : 0];
    if (!nrec_used || r->cb.len + need + 64 > r->cb.cap) {
        if (nrec_used >= NREC) x86_fault("GDI command list full (too much drawing in one frame)", 0);
        r = &rec[nrec_used++];
        if (!r->mem) r->mem = (uint32_t *)x86_alloc(REC_BYTES);
        bgt_cmd_init(&r->cb, r->mem, REC_BYTES);
    }
    return &r->cb;
}
static void st_target(uint32_t t) { if (cur_target != t) { bgt_cmd_target(rb(16), t); cur_target = t; } }
static void st_blend(uint32_t b) { if (cur_blend != b) { bgt_cmd_blend(rb(16), b); cur_blend = b; } }
static void st_tex(uint32_t t) { if (cur_tex != t) { bgt_cmd_texture(rb(16), t, BGT_FILTER_NEAREST); cur_tex = t; } }

static uint32_t rgba_of(uint32_t colorref) { return (colorref & 0xffffffu) | 0xff000000u; }

static uint32_t alloc_tex(void) {
    for (uint32_t t = TEX_FIRST_BITMAP; t < TEX_LIMIT; t++) if (!tex_used[t]) { tex_used[t] = 1; return t; }
    x86_fault("out of BGT texture handles (too many GDI bitmaps)", 0);
}
static void free_tex(uint32_t t) {
    if (!t || t >= TEX_LIMIT || !tex_used[t]) return;
    tex_used[t] = 0;
    w32_rp_delete(t);
    if (cur_target == t) st_target(0);
    bgt_cmd_tex_delete(rb(16), t);
    if (cur_tex == t) cur_tex = 0xffffffffu;
}
static void upload(uint32_t tex, int32_t x, int32_t y, int32_t w, int32_t h, const uint32_t *px) {
    uint32_t bytes = (uint32_t)(w * h) * 4u;
    if (stage_used + bytes > STAGE_BYTES) x86_fault("GDI upload staging full", 0);
    uint8_t *d = stage + stage_used;
    __builtin_memcpy(d, px, bytes);
    stage_used += (bytes + 15u) & ~15u;
    bgt_cmd_tex_update(rb(64), tex, (uint32_t)x, (uint32_t)y, (uint32_t)w, (uint32_t)h, d, bytes);
    w32_rp_upload(tex, x, y, w, h, px);
}

/* clip a destination rect against [cl,ct,cr,cb); returns 0 if empty */
static int clip_rect(int32_t *x, int32_t *y, int32_t *w, int32_t *h, int32_t cl, int32_t ct, int32_t cr, int32_t cb) {
    int32_t x0 = imax(*x, cl), y0 = imax(*y, ct), x1 = imin(*x + *w, cr), y1 = imin(*y + *h, cb);
    if (x1 <= x0 || y1 <= y0) return 0;
    *x = x0; *y = y0; *w = x1 - x0; *h = y1 - y0;
    return 1;
}

void g_fill(uint32_t tex, int32_t cl, int32_t ct, int32_t cr, int32_t cb, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t rgb, uint32_t blend) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (!clip_rect(&x, &y, &w, &h, cl, ct, cr, cb)) return;
    count_op();
    st_target(tex); st_blend(blend); st_tex(0);
    bgt_cmd_rect(rb(64), (float)x, (float)y, (float)w, (float)h, rgba_of(rgb));
    w32_rp_fill(tex, x, y, w, h, rgba_of(rgb), blend);
}

static void g_blit(uint32_t dtex, int32_t cl, int32_t ct, int32_t cr, int32_t cb, int32_t dx, int32_t dy, int32_t dw, int32_t dh,
                   uint32_t stex, int32_t sw_tex, int32_t sh_tex, int32_t sx, int32_t sy, int32_t sw, int32_t sh, uint32_t blend, uint32_t tint) {
    if (!dw || !dh || !sw || !sh) return;
    int32_t x = dx, y = dy, w = dw, h = dh;
    if (w < 0 || h < 0) return; /* mirrored StretchBlt: not supported in v0.2 */
    if (!clip_rect(&x, &y, &w, &h, cl, ct, cr, cb)) return;
    float fx0 = (float)(x - dx) / (float)dw, fy0 = (float)(y - dy) / (float)dh;
    float fx1 = (float)(x + w - dx) / (float)dw, fy1 = (float)(y + h - dy) / (float)dh;
    float u0 = ((float)sx + fx0 * (float)sw) / (float)sw_tex, v0 = ((float)sy + fy0 * (float)sh) / (float)sh_tex;
    float u1 = ((float)sx + fx1 * (float)sw) / (float)sw_tex, v1 = ((float)sy + fy1 * (float)sh) / (float)sh_tex;
    count_op();
    st_target(dtex); st_blend(blend); st_tex(stex);
    bgt_cmd_sprite(rb(64), (float)x, (float)y, (float)w, (float)h, u0, v0, u1, v1, tint);
    w32_rp_blit(dtex, x, y, w, h, stex, u0, v0, u1, v1, blend, tint);
}

w32_font_t w32_font_metrics(int32_t height, int32_t weight) {
    height = imax(-254, imin(height, 256));
    if (height < 0) height = -height + 2; /* negative = character height, plus internal leading */
    if (height == 0) height = 13;
    height = imax(5, imin(height, 256));
    int32_t descent = imax(1, height * 3 / 13);
    return (w32_font_t){height, height - descent, descent, imax(1, height * 6 / 13) + (weight >= 700), weight >= 700 ? 700 : 400};
}
static void font_text(uint32_t tex, int32_t cl, int32_t ct, int32_t cr, int32_t cb, int32_t x, int32_t y, const char *s, int32_t n, uint32_t rgb, w32_font_t f) {
    for (int32_t i = 0; i < n; i++) {
        int k = (unsigned char)s[i] - 32;
        if (k <= 0 || k >= 95) continue;
        int32_t width = f.advance - (f.weight >= 700);
        g_blit(tex, cl, ct, cr, cb, x + i * f.advance, y, width, f.height, TEX_FONT, 95 * 6, 13, k * 6, 0, 6, 13, BGT_BLEND_ALPHA, rgba_of(rgb));
        if (f.weight >= 700) g_blit(tex, cl, ct, cr, cb, x + i * f.advance + 1, y, width, f.height, TEX_FONT, 95 * 6, 13, k * 6, 0, 6, 13, BGT_BLEND_ALPHA, rgba_of(rgb));
    }
}
static uint32_t chrome_font;
void w32_chrome_select_font(uint32_t font) { chrome_font = font; }
static w32_font_t chrome_metrics(void) {
    gobj_t *f = getobj(chrome_font);
    return w32_font_metrics(f ? f->fh : 13, f ? f->weight : 400);
}
int32_t g_text_w(int32_t n, int32_t scale) { return n * chrome_metrics().advance * scale; }
void g_text(uint32_t tex, int32_t cl, int32_t ct, int32_t cr, int32_t cb, int32_t x, int32_t y, const char *s, int32_t n, uint32_t rgb, int32_t scale) {
    if (scale < 1) scale = 1;
    w32_font_t f = chrome_metrics(); f.height *= scale; f.advance *= scale;
    font_text(tex, cl, ct, cr, cb, x, y - 3 * scale, s, n, rgb, f);
}

void w32_gdi_init(void) {
    obj = (gobj_t *)x86_alloc(NOBJ * sizeof(gobj_t));
    stage = (uint8_t *)x86_alloc(STAGE_BYTES);
    if (!obj || !stage) x86_fault("out of memory (GDI)", 0);
    tex_used[TEX_SCREEN] = tex_used[TEX_FONT] = 1;
    /* glyph atlas: 95 glyphs, 6 px cells, white with alpha */
    static uint32_t font_px[95 * 6 * 13];
    /* Original CC0 artwork with dedicated descenders; baseline is row 9, descent rows 10..12. */
    static const uint8_t desc[5][9] = {
        {0,0,15,17,17,15,1,1,14}, {2,0,6,2,2,2,2,18,12},
        {0,0,30,17,17,30,16,16,16}, {0,0,13,19,17,15,1,1,1}, {0,0,17,17,17,15,1,1,14}
    };
    const char *letters = "gjpqy";
    for (int g = 0; g < 95; g++) for (int r = 0; r < 10; r++) {
        uint8_t row = r < 7 ? BGT_FONT5X7[g][r] : 0;
        for (int k = 0; k < 5; k++) if (g + 32 == letters[k]) row = r < 9 ? desc[k][r] : 0;
        for (int c = 0; c < 5; c++) if ((row >> (4 - c)) & 1) font_px[(r + 3) * 95 * 6 + g * 6 + c] = 0xffffffffu;
    }
    bgt_cmd_tex_create(rb(64), TEX_FONT, 95 * 6, 13);
    w32_rp_create(TEX_FONT, 95 * 6, 13, 0);
    upload(TEX_FONT, 0, 0, 95 * 6, 13, font_px);
    /* stock objects */
    static const uint32_t brushes[5] = {0xffffff, 0xc0c0c0, 0x808080, 0x404040, 0x000000};
    for (int i = 0; i < 5; i++) { stock[i] = newobj(OB_BRUSH); getobj(stock[i])->color = brushes[i]; getobj(stock[i])->stock = 1; }
    stock[5] = newobj(OB_BRUSH); getobj(stock[5])->style = 1; getobj(stock[5])->stock = 1;
    stock[6] = newobj(OB_PEN); getobj(stock[6])->color = 0xffffff; getobj(stock[6])->width = 1; getobj(stock[6])->stock = 1;
    stock[7] = newobj(OB_PEN); getobj(stock[7])->color = 0; getobj(stock[7])->width = 1; getobj(stock[7])->stock = 1;
    stock[8] = newobj(OB_PEN); getobj(stock[8])->style = 5; getobj(stock[8])->stock = 1;
    for (int i = 10; i <= 17; i++) { stock[i] = newobj(OB_FONT); getobj(stock[i])->fh = 13; getobj(stock[i])->stock = 1; }
    stock[18] = newobj(OB_BRUSH); getobj(stock[18])->color = 0xffffff; getobj(stock[18])->stock = 1;
    stock[19] = newobj(OB_BITMAP); getobj(stock[19])->w = getobj(stock[19])->h = 1; getobj(stock[19])->stock = 1; /* default 1x1 mono bitmap */
}

void w32_gdi_screen(int32_t w, int32_t h) {
    if (w < 1 || h < 1) return;
    if (screen_ready && w == scr_w && h == scr_h) return;
    if (screen_ready) { if (cur_target == TEX_SCREEN) st_target(0); bgt_cmd_tex_delete(rb(16), TEX_SCREEN); w32_rp_delete(TEX_SCREEN); }
    if (cur_tex == TEX_SCREEN) cur_tex = 0xffffffffu;
    bgt_cmd_target_create(rb(64), TEX_SCREEN, (uint32_t)w, (uint32_t)h);
    w32_rp_create(TEX_SCREEN, w, h, 0);
    scr_w = w; scr_h = h; screen_ready = 1;
    w32_io->logical_width = (uint32_t)w;
    w32_io->logical_height = (uint32_t)h;
    w32_gdi_chrome_begin();
    g_fill(TEX_SCREEN, 0, 0, w, h, 0, 0, w, h, w32_sys_color(1), BGT_BLEND_OPAQUE); /* profile desktop colour */
    w32_gdi_chrome_end();
}
int32_t w32_gdi_screen_w(void) { return scr_w; }
int32_t w32_gdi_screen_h(void) { return scr_h; }

void w32_gdi_flush_and_present(void) {
    w32_user_present_overlay();
    for (uint32_t i = 0; i < nrec_used; i++) bgt_cmd_submit(&rec[i].cb);
    nrec_used = 0;
    stage_used = 0;
    /* after a submit the BGT draw state is the frame default; our cache must not assume anything */
    cur_target = cur_blend = cur_tex = 0xffffffffu;
    static uint32_t pres_mem[64];
    static bgt_cmdbuf_t p;
    bgt_cmd_init(&p, pres_mem, sizeof pres_mem);
    bgt_cmd_target(&p, 0);
    bgt_cmd_clear(&p, BGT_RGBA(0, 0, 0, 255));
    if (screen_ready) {
        bgt_cmd_blend(&p, BGT_BLEND_OPAQUE);
        bgt_cmd_texture(&p, TEX_SCREEN, BGT_FILTER_NEAREST);
        bgt_cmd_sprite(&p, 0, 0, (float)w32_io->logical_width, (float)w32_io->logical_height, 0, 0,
                       (float)w32_io->logical_width / (float)scr_w, (float)w32_io->logical_height / (float)scr_h, 0xffffffffu);
    }
    bgt_cmd_submit(&p);
}

void w32_gdi_targets_lost(void) {
    /* re-upload bitmaps whose pixels we still know; GPU-drawn contents are gone */
    for (uint32_t i = 1; i < NOBJ; i++) {
        gobj_t *b = &obj[i];
        if (b->type == OB_BITMAP && b->tex && b->cpu && b->cpu_valid) upload(b->tex, 0, 0, b->w, b->h, b->cpu);
    }
    if (screen_ready) { w32_gdi_chrome_begin();g_fill(TEX_SCREEN, 0, 0, scr_w, scr_h, 0, 0, scr_w, scr_h, w32_sys_color(1), BGT_BLEND_OPAQUE);w32_gdi_chrome_end(); }
}

void w32_chrome_fill(int32_t x, int32_t y, int32_t w, int32_t h, uint32_t rgb) { w32_gdi_chrome_begin(); g_fill(TEX_SCREEN, 0, 0, scr_w, scr_h, x, y, w, h, rgb, BGT_BLEND_OPAQUE); w32_gdi_chrome_end(); }
void w32_chrome_frame(int32_t x, int32_t y, int32_t w, int32_t h, uint32_t rgb) {
    w32_chrome_fill(x, y, w, 1, rgb); w32_chrome_fill(x, y + h - 1, w, 1, rgb);
    w32_chrome_fill(x, y, 1, h, rgb); w32_chrome_fill(x + w - 1, y, 1, h, rgb);
}
void w32_chrome_text(int32_t x, int32_t y, const char *s, uint32_t rgb) { w32_gdi_chrome_begin(); g_text(TEX_SCREEN, 0, 0, scr_w, scr_h, x, y, s, (int32_t)w32_slen(s), rgb, 1); w32_gdi_chrome_end(); }

/* ------------------------------------------------------------------ bitmaps */
static void ensure_tex(gobj_t *b) {
    if (b->tex || b->stock) return;
    b->tex = alloc_tex();
    bgt_cmd_target_create(rb(64), b->tex, (uint32_t)b->w, (uint32_t)b->h);
    w32_rp_create(b->tex, b->w, b->h, 0);
    if (b->cpu && b->cpu_valid) upload(b->tex, 0, 0, b->w, b->h, b->cpu);
}
static uint32_t new_bitmap(int32_t w, int32_t h, int mono) {
    uint32_t hb = newobj(OB_BITMAP);
    gobj_t *b = getobj(hb);
    b->w = w < 1 ? 1 : w; b->h = h < 1 ? 1 : h; b->mono = mono;
    return hb;
}
/* CPU pixels for a bitmap (allocated on demand, starts black like a fresh compatible bitmap) */
static uint32_t *cpu_px(gobj_t *b) {
    if (!b->cpu) {
        b->cpu = (uint32_t *)x86_alloc((uint32_t)(b->w * b->h) * 4u);
        for (int32_t i = 0; i < b->w * b->h; i++) b->cpu[i] = 0xff000000u;
        b->cpu_valid = !b->tex; /* if it was already drawn on the GPU, these pixels are not the truth */
    }
    return b->cpu;
}

/* decode a packed DIB (BITMAPINFOHEADER/BITMAPCOREHEADER + palette + bits) from guest memory.
 * `bits` 0 = bits follow the header/palette. Writes RGBA; returns 1 on success. */
static int dib_decode(uint32_t bmi, uint32_t bits, uint32_t *dst, int32_t *w_out, int32_t *h_out, int *mono_out, int32_t want_w, int32_t want_h) {
    uint32_t hs = x86_rd32(bmi), w, h, bpp, comp = 0, ncol = 0, pal_entry;
    int bottom_up = 1;
    if (hs == 12) { w = x86_rd16(bmi + 4); h = x86_rd16(bmi + 6); bpp = x86_rd16(bmi + 10); pal_entry = 3; }
    else if (hs >= 40) {
        int32_t sh = (int32_t)x86_rd32(bmi + 8);
        w = x86_rd32(bmi + 4);
        if (sh < 0) { bottom_up = 0; sh = -sh; }
        h = (uint32_t)sh; bpp = x86_rd16(bmi + 14); comp = x86_rd32(bmi + 16); ncol = x86_rd32(bmi + 32); pal_entry = 4;
    } else return 0;
    if (!w || !h || w > 4096 || h > 4096) return 0;
    if (want_w > 0 && (uint32_t)want_w != w) return 0;
    if (want_h > 0 && (uint32_t)want_h != h) return 0;
    uint32_t npal = bpp <= 8 ? (ncol ? ncol : (1u << bpp)) : 0;
    uint32_t masks[3] = {0x00ff0000u, 0x0000ff00u, 0x000000ffu};
    if (bpp == 16) { masks[0] = 0x7c00u; masks[1] = 0x03e0u; masks[2] = 0x001fu; }
    uint32_t pal_off = hs;
    if (comp == 3 && (bpp == 16 || bpp == 32)) { for (int i = 0; i < 3; i++) masks[i] = x86_rd32(bmi + hs + 4u * (uint32_t)i); pal_off += 12; }
    else if (comp != 0) return 0;
    if (!bits) bits = bmi + pal_off + npal * pal_entry;
    uint32_t row = ((w * bpp + 31) / 32) * 4;
    if (w_out) *w_out = (int32_t)w;
    if (h_out) *h_out = (int32_t)h;
    int mono = bpp == 1;
    if (mono_out) *mono_out = mono;
    if (!dst) return 1;
    uint32_t pal[256];
    for (uint32_t i = 0; i < npal && i < 256; i++) {
        uint32_t q = bmi + pal_off + i * pal_entry;
        pal[i] = x86_rd8(q + 2) | (x86_rd8(q + 1) << 8) | (x86_rd8(q) << 16) | 0xff000000u;
    }
    for (uint32_t y = 0; y < h; y++) {
        uint32_t r = bits + row * (bottom_up ? (h - 1 - y) : y);
        for (uint32_t x = 0; x < w; x++) {
            uint32_t c;
            if (bpp == 32 || bpp == 16) {
                uint32_t v = bpp == 32 ? x86_rd32(r + 4 * x) : x86_rd16(r + 2 * x);
                uint32_t out[3];
                for (int k = 0; k < 3; k++) {
                    uint32_t m = masks[k];
                    if (!m) { out[k] = 0; continue; }
                    uint32_t sh = (uint32_t)__builtin_ctz(m), bits_n = (uint32_t)__builtin_popcount(m);
                    uint32_t val = (v & m) >> sh;
                    out[k] = bits_n >= 8 ? val >> (bits_n - 8) : (val * 255u) / ((1u << bits_n) - 1u);
                }
                c = out[0] | (out[1] << 8) | (out[2] << 16) | 0xff000000u;
            } else if (bpp == 24) {
                c = x86_rd8(r + 3 * x + 2) | (x86_rd8(r + 3 * x + 1) << 8) | (x86_rd8(r + 3 * x) << 16) | 0xff000000u;
            } else {
                uint32_t idx;
                if (bpp == 8) idx = x86_rd8(r + x);
                else if (bpp == 4) idx = (x86_rd8(r + (x >> 1)) >> ((x & 1) ? 0 : 4)) & 15u;
                else idx = (x86_rd8(r + (x >> 3)) >> (7 - (x & 7))) & 1u;
                c = idx < npal ? pal[idx] : 0xff000000u;
            }
            dst[y * w + x] = c;
        }
    }
    return 1;
}
static uint32_t bitmap_from_dib(uint32_t bmi, uint32_t bits) {
    int32_t w, h; int mono;
    if (!dib_decode(bmi, bits, 0, &w, &h, &mono, 0, 0)) return 0;
    uint32_t hb = new_bitmap(w, h, 0);
    gobj_t *b = getobj(hb);
    b->cpu = (uint32_t *)x86_alloc((uint32_t)(w * h) * 4u);
    dib_decode(bmi, bits, b->cpu, 0, 0, 0, 0, 0);
    b->cpu_valid = 1;
    /* a 1-bpp black/white DIB behaves as a monochrome bitmap in colour conversions */
    if (mono) { uint32_t c0 = b->cpu[0]; (void)c0; b->mono = 1; }
    return hb;
}
uint32_t w32_load_bitmap(uint32_t hmod, uint32_t name, int wide) {
    uint32_t sz, d = w32_res_find(hmod, 2, name, wide, &sz);
    return d ? bitmap_from_dib(d, 0) : 0;
}

/* ------------------------------------------------------------------ DC resolution */
typedef struct { uint32_t tex, hwnd; int32_t ox, oy, cl, ct, cr, cb; } surf_t;
#include "w32_region.h"
static void s_fill(const surf_t *s, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t color, uint32_t blend) {
    int32_t rects[W32_REGION_MAX][4];
    uint32_t n = visible_region(s->hwnd, s->cl, s->ct, s->cr, s->cb, rects);
    for (uint32_t i = 0; i < n; i++) g_fill(s->tex, rects[i][0], rects[i][1], rects[i][2], rects[i][3], x, y, w, h, color, blend);
}
static void s_blit(const surf_t *s, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t tex, int32_t tw, int32_t th, int32_t sx, int32_t sy, int32_t sw, int32_t sh, uint32_t blend, uint32_t tint) {
    int32_t rects[W32_REGION_MAX][4];
    uint32_t n = visible_region(s->hwnd, s->cl, s->ct, s->cr, s->cb, rects);
    for (uint32_t i = 0; i < n; i++) g_blit(s->tex, rects[i][0], rects[i][1], rects[i][2], rects[i][3], x, y, w, h, tex, tw, th, sx, sy, sw, sh, blend, tint);
}
/* resolve a DC to its surface, origin and clip; `for_read` = no side effects (no texture creation, the bitmap's
 * CPU pixels stay valid; tex is 0 if the bitmap was never drawn on the GPU) */
static int dc_surf_mode(dc_t *d, surf_t *s, int for_read) {
    s->hwnd = d->kind == 1 ? d->hwnd : 0;
    if (d->kind == 2) {
        gobj_t *b = getobj(d->bmp);
        if (!b || b->stock) return 0;
        if (!for_read) ensure_tex(b);
        s->tex = b->tex; s->ox = s->oy = 0; s->cl = s->ct = 0; s->cr = b->w; s->cb = b->h;
        if (b->cpu && !for_read) b->cpu_valid = 0; /* drawn on the GPU from now on */
    } else {
        if (!screen_ready) return 0;
        int32_t x, y, w, h;
        s->tex = TEX_SCREEN;
        if (d->kind == 3 || !w32_user_client(d->hwnd, &x, &y, &w, &h)) { x = 0; y = 0; w = scr_w; h = scr_h; }
        s->ox = x; s->oy = y; s->cl = x; s->ct = y; s->cr = x + w; s->cb = y + h;
        if (d->has_paint) { s->cl = imax(s->cl, x + d->pl); s->ct = imax(s->ct, y + d->pt); s->cr = imin(s->cr, x + d->pr); s->cb = imin(s->cb, y + d->pb); }
        s->cl = imax(s->cl, 0); s->ct = imax(s->ct, 0); s->cr = imin(s->cr, scr_w); s->cb = imin(s->cb, scr_h);
    }
    s->ox += d->vx; s->oy += d->vy;
    if (d->has_clip) {
        s->cl = imax(s->cl, s->ox + d->cl); s->ct = imax(s->ct, s->oy + d->ct);
        s->cr = imin(s->cr, s->ox + d->cr); s->cb = imin(s->cb, s->oy + d->cb);
    }
    return s->cr > s->cl && s->cb > s->ct;
}
static int dc_surf(dc_t *d, surf_t *s) { return dc_surf_mode(d, s, 0); }

static uint32_t brush_color(uint32_t hbr, int *is_null) {
    if (hbr && hbr <= 31) { if (is_null) *is_null = 0; return w32_sys_color(hbr - 1); } /* COLOR_xxx + 1 */
    gobj_t *b = getobj(hbr);
    if (is_null) *is_null = !b || b->style == 1;
    return b ? b->color : 0xffffff;
}

/* fill a rect (logical coords of d) with brush (solid or pattern) using blend */
static void fill_brush(dc_t *d, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t hbr, uint32_t blend) {
    surf_t s;
    if (!dc_surf(d, &s)) return;
    gobj_t *b = getobj(hbr);
    if (b && b->style == 3 && getobj(b->pattern)) {
        gobj_t *p = getobj(b->pattern);
        ensure_tex(p);
        /* tile the pattern bitmap, aligned to the brush origin */
        int32_t ax = s.ox + x, ay = s.oy + y;
        int32_t sx0 = ax - ((ax - d->bx) % p->w + p->w) % p->w, sy0 = ay - ((ay - d->by) % p->h + p->h) % p->h;
        int32_t cl = imax(s.cl, ax), ct = imax(s.ct, ay), cr = imin(s.cr, ax + w), cbm = imin(s.cb, ay + h);
        for (int32_t ty = sy0; ty < ay + h; ty += p->h)
            for (int32_t tx = sx0; tx < ax + w; tx += p->w)
                { surf_t tile = s; tile.cl = cl; tile.ct = ct; tile.cr = cr; tile.cb = cbm; s_blit(&tile, tx, ty, p->w, p->h, p->tex, p->w, p->h, 0, 0, p->w, p->h, blend, 0xffffffffu); }
        return;
    }
    int null;
    uint32_t c = brush_color(hbr, &null);
    if (null) return;
    s_fill(&s, s.ox + x, s.oy + y, w, h, c, blend);
}

/* ternary raster op dispatch for BitBlt/StretchBlt/PatBlt */
static void do_rop(dc_t *dd, int32_t x, int32_t y, int32_t w, int32_t h, dc_t *sd, int32_t sx, int32_t sy, int32_t sw, int32_t sh, uint32_t rop) {
    surf_t ds;
    if (!dc_surf(dd, &ds)) return;
    uint32_t code = (rop >> 16) & 0xffu;
    switch (code) {
    case 0x00: s_fill(&ds, ds.ox + x, ds.oy + y, w, h, 0, BGT_BLEND_OPAQUE); return;          /* BLACKNESS */
    case 0xff: s_fill(&ds, ds.ox + x, ds.oy + y, w, h, 0xffffff, BGT_BLEND_OPAQUE); return;   /* WHITENESS */
    case 0x55: s_fill(&ds, ds.ox + x, ds.oy + y, w, h, 0xffffff, BGT_BLEND_INVERT); return;   /* DSTINVERT */
    case 0xaa: return;                                                                                                     /* NOP (D) */
    case 0xf0: fill_brush(dd, x, y, w, h, dd->brush, BGT_BLEND_OPAQUE); return;                                             /* PATCOPY */
    case 0x5a: fill_brush(dd, x, y, w, h, dd->brush, BGT_BLEND_INVERT); return;                                             /* PATINVERT */
    default: break;
    }
    if (!sd) { w32_m.gdi_unsupported++; return; }
    gobj_t *sb = 0;
    surf_t ss;
    uint32_t stex;
    int32_t stw, sth, sox = 0, soy = 0;
    if (sd->kind == 2) {
        sb = getobj(sd->bmp);
        if (!sb || sb->stock) return;
        ensure_tex(sb);
        stex = sb->tex; stw = sb->w; sth = sb->h;
    } else {
        if (!dc_surf(sd, &ss)) return;
        stex = TEX_SCREEN; stw = scr_w; sth = scr_h; sox = ss.ox; soy = ss.oy;
    }
    if (stex == ds.tex) {
        /* copying within one surface (e.g. scrolling the desktop): BGT cannot sample its draw target */
        w32_m.gdi_unsupported++;
        return;
    }
    uint32_t tint = 0xffffffffu;
    int mono_src = sb && sb->mono;
    if (mono_src) {
        /* monochrome -> colour: 1 bits become the background colour, 0 bits the text colour; exact
         * only for the default black text on white background */
        if ((dd->text & 0xffffff) != 0 || (dd->bk & 0xffffff) != 0xffffff) w32_m.mono_color_blits++;
    }
    int32_t ax = ds.ox + x, ay = ds.oy + y, bsx = sox + sx, bsy = soy + sy;
    switch (code) {
    case 0xcc: s_blit(&ds, ax, ay, w, h, stex, stw, sth, bsx, bsy, sw, sh, BGT_BLEND_OPAQUE, tint); return; /* SRCCOPY */
    case 0x88: /* SRCAND: exact as multiply for 0/255 masks */
        if (!mono_src) w32_m.gdi_approx_rop++;
        s_blit(&ds, ax, ay, w, h, stex, stw, sth, bsx, bsy, sw, sh, BGT_BLEND_MULTIPLY, tint); return;
    case 0xee: /* SRCPAINT: OR == ADD when bits do not overlap (sprite-after-mask idiom) */
        w32_m.gdi_approx_rop += !mono_src;
        s_blit(&ds, ax, ay, w, h, stex, stw, sth, bsx, bsy, sw, sh, BGT_BLEND_ADD, tint); return;
    case 0x66: /* SRCINVERT: XOR, exact for black/white */
        if (!mono_src) w32_m.gdi_approx_rop++;
        s_blit(&ds, ax, ay, w, h, stex, stw, sth, bsx, bsy, sw, sh, BGT_BLEND_INVERT, tint); return;
    case 0x33: /* NOTSRCCOPY: copy, then invert */
        s_blit(&ds, ax, ay, w, h, stex, stw, sth, bsx, bsy, sw, sh, BGT_BLEND_OPAQUE, tint);
        s_fill(&ds, ax, ay, w, h, 0xffffff, BGT_BLEND_INVERT); return;
    default:
        w32_m.gdi_approx_rop++;
        s_blit(&ds, ax, ay, w, h, stex, stw, sth, bsx, bsy, sw, sh, BGT_BLEND_OPAQUE, tint); return;
    }
}

/* ------------------------------------------------------------------ API: DCs */
static uint32_t new_dc(int kind, uint32_t hwnd) {
    for (uint32_t i = 1; i < NDC; i++)
        if (!dcs[i].used) {
            __builtin_memset(&dcs[i], 0, sizeof dcs[i]);
            dc_t *d = &dcs[i];
            d->used = 1; d->kind = kind; d->hwnd = hwnd;
            d->brush = stock[0]; d->pen = stock[7]; d->font = stock[13]; d->bmp = stock[19];
            d->bk = 0xffffff; d->text = 0; d->bkmode = 2; d->rop2 = 13;
            return H_DC + i;
        }
    x86_fault("GDI DC table full", 0);
}
uint32_t w32_gdi_window_dc(uint32_t hwnd, int paint, int32_t l, int32_t t, int32_t r, int32_t b) {
    uint32_t h = new_dc(hwnd ? 1 : 3, hwnd);
    dc_t *d = getdc(h);
    uint32_t font = w32_user_font(hwnd); if (font) d->font = font;
    if (paint) { d->has_paint = 1; d->pl = l; d->pt = t; d->pr = r; d->pb = b; }
    return h;
}
void w32_gdi_release_dc(uint32_t hdc) { dc_t *d = getdc(hdc); if (d) d->used = 0; }
void w32_gdi_fill_window(uint32_t hdc, int32_t l, int32_t t, int32_t r, int32_t b, uint32_t hbr) {
    dc_t *d = getdc(hdc);
    if (d) fill_brush(d, l, t, r - l, b - t, hbr, BGT_BLEND_OPAQUE);
}

static uint32_t g_CreateCompatibleDC(void) { return new_dc(2, 0); }
static uint32_t g_DeleteDC(void) { dc_t *d = getdc(ARG(0)); if (d) d->used = 0; return 1; }
static uint32_t g_SaveDC(void) {
    dc_t *d = getdc(ARG(0));
    if (!d || d->nsaved >= 8) return 0;
    uint32_t *s = d->saved[d->nsaved++];
    s[0] = d->brush; s[1] = d->pen; s[2] = d->font; s[3] = d->bk; s[4] = d->text; s[5] = d->bmp;
    return (uint32_t)d->nsaved;
}
static uint32_t g_RestoreDC(void) {
    dc_t *d = getdc(ARG(0));
    if (!d || !d->nsaved) return 0;
    uint32_t *s = d->saved[--d->nsaved];
    d->brush = s[0]; d->pen = s[1]; d->font = s[2]; d->bk = s[3]; d->text = s[4]; d->bmp = s[5];
    return 1;
}
static uint32_t g_SelectObject(void) {
    dc_t *d = getdc(ARG(0));
    gobj_t *o = getobj(ARG(1));
    if (!d || !o) return 0;
    uint32_t old = 0;
    switch (o->type) {
    case OB_BITMAP: old = d->bmp; d->bmp = ARG(1); break;
    case OB_BRUSH: old = d->brush; d->brush = ARG(1); break;
    case OB_PEN: old = d->pen; d->pen = ARG(1); break;
    case OB_FONT: old = d->font; d->font = ARG(1); break;
    case OB_RGN: d->has_clip = 1; d->cl = o->rl; d->ct = o->rt; d->cr = o->rr; d->cb = o->rb; return 1; /* SIMPLEREGION */
    default: break;
    }
    return old;
}
static uint32_t g_GetCurrentObject(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    switch (ARG(1)) { case 1: return d->pen; case 2: return d->brush; case 6: return d->font; case 7: return d->bmp; default: return 0; }
}
static uint32_t g_DeleteObject(void) {
    gobj_t *o = getobj(ARG(0));
    if (!o || o->stock) return 1;
    if (o->type == OB_BITMAP && o->tex) free_tex(o->tex);
    o->type = OB_NONE;
    return 1;
}
static uint32_t g_GetStockObject(void) { return ARG(0) < 20 ? stock[ARG(0)] : 0; }
static uint32_t g_SetBkColor(void) { dc_t *d = getdc(ARG(0)); if (!d) return 0xffffffffu; uint32_t o = d->bk; d->bk = ARG(1); return o; }
static uint32_t g_SetTextColor(void) { dc_t *d = getdc(ARG(0)); if (!d) return 0xffffffffu; uint32_t o = d->text; d->text = ARG(1); return o; }
static uint32_t g_GetBkColor(void) { dc_t *d = getdc(ARG(0)); return d ? d->bk : 0; }
static uint32_t g_GetTextColor(void) { dc_t *d = getdc(ARG(0)); return d ? d->text : 0; }
static uint32_t g_SetBkMode(void) { dc_t *d = getdc(ARG(0)); if (!d) return 0; uint32_t o = (uint32_t)d->bkmode; d->bkmode = (int)ARG(1); return o; }
static uint32_t g_SetROP2(void) { dc_t *d = getdc(ARG(0)); if (!d) return 0; uint32_t o = (uint32_t)d->rop2; d->rop2 = (int)ARG(1); return o; }
static uint32_t g_SetTextAlign(void) { dc_t *d = getdc(ARG(0)); if (!d) return 0; uint32_t o = d->align; d->align = ARG(1); return o; }
static uint32_t g_SetBrushOrgEx(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    if (ARG(3)) { x86_wr32(ARG(3), (uint32_t)d->bx); x86_wr32(ARG(3) + 4, (uint32_t)d->by); }
    d->bx = (int32_t)ARG(1); d->by = (int32_t)ARG(2);
    return 1;
}
static uint32_t g_SetViewportOrgEx(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    if (ARG(3)) { x86_wr32(ARG(3), (uint32_t)d->vx); x86_wr32(ARG(3) + 4, (uint32_t)d->vy); }
    d->vx = (int32_t)ARG(1); d->vy = (int32_t)ARG(2);
    return 1;
}
static uint32_t g_OffsetViewportOrgEx(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    if (ARG(3)) { x86_wr32(ARG(3), (uint32_t)d->vx); x86_wr32(ARG(3) + 4, (uint32_t)d->vy); }
    d->vx += (int32_t)ARG(1); d->vy += (int32_t)ARG(2);
    return 1;
}
static uint32_t g_GetDCOrgEx(void) {
    dc_t *d = getdc(ARG(0));
    int32_t x = 0, y = 0, w, h;
    if (d && d->kind == 1) w32_user_client(d->hwnd, &x, &y, &w, &h);
    x86_wr32(ARG(1), (uint32_t)x); x86_wr32(ARG(1) + 4, (uint32_t)y);
    return 1;
}
static uint32_t g_GetDeviceCaps(void) {
    switch (ARG(1)) {
    case 8: return (uint32_t)(scr_w ? scr_w : 640);   /* HORZRES */
    case 10: return (uint32_t)(scr_h ? scr_h : 480);  /* VERTRES */
    case 12: return 32;                               /* BITSPIXEL */
    case 14: return 1;                                /* PLANES */
    case 24: return 0xffffffffu;                      /* NUMCOLORS: -1 for >8bpp */
    case 38: return 0x7e99;                           /* RASTERCAPS */
    case 88: case 90: return 96;                      /* LOGPIXELSX/Y */
    case 104: return 0;                               /* SIZEPALETTE */
    case 4: return 320; case 6: return 240;           /* HORZSIZE/VERTSIZE mm */
    default: return 0;
    }
}
static uint32_t g_IntersectClipRect(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    int32_t l = (int32_t)ARG(1), t = (int32_t)ARG(2), r = (int32_t)ARG(3), b = (int32_t)ARG(4);
    if (d->has_clip) { l = imax(l, d->cl); t = imax(t, d->ct); r = imin(r, d->cr); b = imin(b, d->cb); }
    d->has_clip = 1; d->cl = l; d->ct = t; d->cr = r; d->cb = b;
    return r > l && b > t ? 2 : 1;
}
static uint32_t g_SelectClipRgn(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    gobj_t *r = getobj(ARG(1));
    if (!r) { d->has_clip = 0; return 2; }
    d->has_clip = 1; d->cl = r->rl; d->ct = r->rt; d->cr = r->rr; d->cb = r->rb;
    return 2;
}
static uint32_t g_ExcludeClipRect(void) { w32_m.gdi_unsupported++; return 2; } /* rect-only clip model: ignored (counted) */
static uint32_t g_CreateRectRgn(void) {
    uint32_t h = newobj(OB_RGN);
    gobj_t *o = getobj(h);
    o->rl = (int32_t)ARG(0); o->rt = (int32_t)ARG(1); o->rr = (int32_t)ARG(2); o->rb = (int32_t)ARG(3);
    return h;
}
static uint32_t g_CreateRectRgnIndirect(void) {
    uint32_t h = newobj(OB_RGN), r = ARG(0);
    gobj_t *o = getobj(h);
    o->rl = (int32_t)x86_rd32(r); o->rt = (int32_t)x86_rd32(r + 4); o->rr = (int32_t)x86_rd32(r + 8); o->rb = (int32_t)x86_rd32(r + 12);
    return h;
}
static uint32_t g_GetClipBox(void) {
    dc_t *d = getdc(ARG(0));
    surf_t s;
    if (!d || !dc_surf(d, &s)) { for (int i = 0; i < 4; i++) x86_wr32(ARG(1) + 4u * (uint32_t)i, 0); return 1; }
    x86_wr32(ARG(1), (uint32_t)(s.cl - s.ox)); x86_wr32(ARG(1) + 4, (uint32_t)(s.ct - s.oy));
    x86_wr32(ARG(1) + 8, (uint32_t)(s.cr - s.ox)); x86_wr32(ARG(1) + 12, (uint32_t)(s.cb - s.oy));
    return 2;
}
static uint32_t g_PtVisible(void) {
    dc_t *d = getdc(ARG(0));
    surf_t s;
    if (!d || !dc_surf(d, &s)) return 0;
    int32_t x = s.ox + (int32_t)ARG(1), y = s.oy + (int32_t)ARG(2);
    return x >= s.cl && y >= s.ct && x < s.cr && y < s.cb;
}
static uint32_t g_RectVisible(void) {
    dc_t *d = getdc(ARG(0));
    surf_t s;
    if (!d || !dc_surf(d, &s)) return 0;
    uint32_t r = ARG(1);
    int32_t l = s.ox + (int32_t)x86_rd32(r), t = s.oy + (int32_t)x86_rd32(r + 4), rr = s.ox + (int32_t)x86_rd32(r + 8), b = s.oy + (int32_t)x86_rd32(r + 12);
    return l < s.cr && rr > s.cl && t < s.cb && b > s.ct;
}

/* ------------------------------------------------------------------ API: objects */
static uint32_t g_CreateSolidBrush(void) { uint32_t h = newobj(OB_BRUSH); getobj(h)->color = ARG(0) & 0xffffffu; return h; }
static uint32_t g_CreateHatchBrush(void) { w32_m.gdi_approx_rop++; uint32_t h = newobj(OB_BRUSH); getobj(h)->color = ARG(1) & 0xffffffu; return h; }
static uint32_t g_CreatePatternBrush(void) { uint32_t h = newobj(OB_BRUSH); getobj(h)->style = 3; getobj(h)->pattern = ARG(0); return h; }
static uint32_t g_CreateBrushIndirect(void) {
    uint32_t lb = ARG(0), h = newobj(OB_BRUSH), style = x86_rd32(lb);
    gobj_t *o = getobj(h);
    o->color = x86_rd32(lb + 4) & 0xffffffu;
    if (style == 1) o->style = 1;
    if (style == 3) { o->style = 3; o->pattern = x86_rd32(lb + 8); }
    return h;
}
static uint32_t g_CreatePen(void) {
    uint32_t h = newobj(OB_PEN);
    gobj_t *o = getobj(h);
    o->style = (int)ARG(0); o->width = imax(1, (int32_t)ARG(1)); o->color = ARG(2) & 0xffffffu;
    return h;
}
static uint32_t font_h(int32_t lh) { return (uint32_t)w32_font_metrics(lh, 400).height; }
uint32_t w32_gdi_make_font(int32_t height, int32_t weight) { uint32_t h = newobj(OB_FONT); getobj(h)->fh = (int32_t)font_h(height); getobj(h)->weight = weight; return h; }
static uint32_t g_CreateFont(void) { return w32_gdi_make_font((int32_t)ARG(0), (int32_t)ARG(4)); }
static uint32_t g_CreateFontIndirect(void) { uint32_t h = newobj(OB_FONT); getobj(h)->fh = (int32_t)font_h((int32_t)x86_rd32(ARG(0))); getobj(h)->weight = (int32_t)x86_rd32(ARG(0) + 16); return h; }
static uint32_t g_CreateCompatibleBitmap(void) { return new_bitmap((int32_t)ARG(1), (int32_t)ARG(2), 0); }
static uint32_t g_CreateBitmap(void) {
    int32_t w = (int32_t)ARG(0), h = (int32_t)ARG(1);
    uint32_t bpp = ARG(2) * ARG(3), bits = ARG(4);
    uint32_t hb = new_bitmap(w, h, bpp == 1);
    gobj_t *b = getobj(hb);
    if (bits && (bpp == 1 || bpp == 32)) {
        uint32_t *px = cpu_px(b);
        uint32_t row = bpp == 1 ? (uint32_t)((w + 15) / 16) * 2 : (uint32_t)w * 4;
        for (int32_t y = 0; y < h; y++)
            for (int32_t x = 0; x < w; x++) {
                uint32_t c;
                if (bpp == 1) c = ((x86_rd8(bits + (uint32_t)y * row + (uint32_t)(x >> 3)) >> (7 - (x & 7))) & 1u) ? 0xffffffffu : 0xff000000u;
                else { uint32_t v = x86_rd32(bits + (uint32_t)y * row + 4u * (uint32_t)x); c = ((v >> 16) & 0xff) | (v & 0xff00) | ((v & 0xff) << 16) | 0xff000000u; }
                px[y * w + x] = c;
            }
        b->cpu_valid = 1;
    } else if (bits) w32_m.gdi_unsupported++;
    return hb;
}
static uint32_t g_CreateDIBitmap(void) {
    uint32_t bmi = ARG(4) ? ARG(4) : ARG(1), bits = ARG(3);
    if (!(ARG(2) & 4u) || !bits) { /* no CBM_INIT: just a sized bitmap */
        int32_t w, h;
        if (!dib_decode(ARG(1), 0, 0, &w, &h, 0, 0, 0)) return 0;
        return new_bitmap(w, h, 0);
    }
    return bitmap_from_dib(bmi, bits);
}
static uint32_t g_CreateDIBSection(void) {
    int32_t w, h; int mono;
    if (!dib_decode(ARG(1), 1, 0, &w, &h, &mono, 0, 0)) return 0;
    uint32_t bpp = x86_rd16(ARG(1) + 14), row = ((uint32_t)w * bpp + 31) / 32 * 4;
    uint32_t bits = w32_heap_alloc(row * (uint32_t)h, 1);
    uint32_t hb = new_bitmap(w, h, mono);
    gobj_t *b = getobj(hb);
    b->dib_bits = bits;
    uint32_t hs = x86_rd32(ARG(1)), npal = bpp <= 8 ? (x86_rd32(ARG(1) + 32) ? x86_rd32(ARG(1) + 32) : 1u << bpp) : (x86_rd32(ARG(1) + 16) == 3 ? 3 : 0);
    b->dib_bmi = w32_heap_alloc(hs + 4 * npal, 0);
    for (uint32_t i = 0; i < hs + 4 * npal; i++) x86_wr8(b->dib_bmi + i, x86_rd8(ARG(1) + i));
    if (ARG(3)) x86_wr32(ARG(3), bits);
    return hb;
}
uint32_t g_LoadBitmapA(void) { return w32_load_bitmap(ARG(0), ARG(1), 0); }
uint32_t g_LoadBitmapW(void) { return w32_load_bitmap(ARG(0), ARG(1), 1); }
static uint32_t g_GetObject(void) {
    gobj_t *o = getobj(ARG(0));
    uint32_t n = ARG(1), p = ARG(2);
    if (!o) return 0;
    if (o->type == OB_BITMAP) {
        if (!p) return 24;
        uint32_t vals[6] = {0, (uint32_t)o->w, (uint32_t)o->h, (uint32_t)((o->mono ? (o->w + 15) / 16 * 2 : o->w * 4)), 0, 0};
        for (uint32_t i = 0; i < 4 && 4 * i < n; i++) x86_wr32(p + 4 * i, vals[i]);
        if (n >= 16) { x86_wr16(p + 16, 1); x86_wr16(p + 18, o->mono ? 1 : 32); }
        if (n >= 24) x86_wr32(p + 20, o->dib_bits);
        return n < 24 ? n : 24;
    }
    if (o->type == OB_BRUSH) { if (p && n >= 12) { x86_wr32(p, o->style == 1 ? 1 : o->style == 3 ? 3 : 0); x86_wr32(p + 4, o->color); x86_wr32(p + 8, 0); } return 12; }
    if (o->type == OB_PEN) { if (p && n >= 16) { x86_wr32(p, (uint32_t)o->style); x86_wr32(p + 4, (uint32_t)o->width); x86_wr32(p + 8, 0); x86_wr32(p + 12, o->color); } return 16; }
    if (o->type == OB_FONT) { if (p && n >= 4) { for (uint32_t i = 0; i < n && i < 60; i++) x86_wr8(p + i, 0); x86_wr32(p, (uint32_t)(-o->fh)); } return 60; }
    return 0;
}
static uint32_t g_noop1(void) { return 1; }
static uint32_t g_zero(void) { return 0; }

/* ------------------------------------------------------------------ API: drawing */
static uint32_t g_PatBlt(void) {
    dc_t *d = getdc(ARG(0));
    if (d) do_rop(d, (int32_t)ARG(1), (int32_t)ARG(2), (int32_t)ARG(3), (int32_t)ARG(4), 0, 0, 0, 0, 0, ARG(5));
    return 1;
}
static uint32_t g_BitBlt(void) {
    dc_t *d = getdc(ARG(0)), *s = getdc(ARG(5));
    int32_t w = (int32_t)ARG(3), h = (int32_t)ARG(4);
    if (d) do_rop(d, (int32_t)ARG(1), (int32_t)ARG(2), w, h, s, (int32_t)ARG(6), (int32_t)ARG(7), w, h, ARG(8));
    return 1;
}
static uint32_t g_StretchBlt(void) {
    dc_t *d = getdc(ARG(0)), *s = getdc(ARG(5));
    if (d) do_rop(d, (int32_t)ARG(1), (int32_t)ARG(2), (int32_t)ARG(3), (int32_t)ARG(4), s, (int32_t)ARG(6), (int32_t)ARG(7), (int32_t)ARG(8), (int32_t)ARG(9), ARG(10));
    return 1;
}
static uint32_t g_SetStretchBltMode(void) { return 3; }
/* draw guest DIB bits directly (StretchDIBits / SetDIBitsToDevice) via a temporary texture */
static uint32_t dib_tmp_tex;
static int32_t dib_tmp_w, dib_tmp_h;
static void dib_draw(dc_t *d, int32_t dx, int32_t dy, int32_t dw, int32_t dh, int32_t sx, int32_t sy, int32_t sw, int32_t sh, uint32_t bits, uint32_t bmi, uint32_t rop) {
    int32_t w, h;
    if (!dib_decode(bmi, bits, 0, &w, &h, 0, 0, 0)) return;
    static uint32_t *px;
    static uint32_t cap;
    if ((uint32_t)(w * h) > cap) { px = (uint32_t *)x86_alloc((uint32_t)(w * h) * 4u); cap = (uint32_t)(w * h); }
    dib_decode(bmi, bits, px, 0, 0, 0, 0, 0);
    if (!dib_tmp_tex || dib_tmp_w != w || dib_tmp_h != h) {
        if (dib_tmp_tex) free_tex(dib_tmp_tex);
        dib_tmp_tex = alloc_tex();
        bgt_cmd_tex_create(rb(64), dib_tmp_tex, (uint32_t)w, (uint32_t)h);
        w32_rp_create(dib_tmp_tex, w, h, 0);
        dib_tmp_w = w; dib_tmp_h = h;
    }
    upload(dib_tmp_tex, 0, 0, w, h, px);
    surf_t ds;
    if (!dc_surf(d, &ds)) return;
    if (((rop >> 16) & 0xff) != 0xcc) w32_m.gdi_approx_rop++;
    s_blit(&ds, ds.ox + dx, ds.oy + dy, dw, dh, dib_tmp_tex, w, h, sx, sy, sw, sh, BGT_BLEND_OPAQUE, 0xffffffffu);
}
static uint32_t g_StretchDIBits(void) {
    dc_t *d = getdc(ARG(0));
    if (d) dib_draw(d, (int32_t)ARG(1), (int32_t)ARG(2), (int32_t)ARG(3), (int32_t)ARG(4), (int32_t)ARG(5), (int32_t)ARG(6), (int32_t)ARG(7), (int32_t)ARG(8), ARG(9), ARG(10), ARG(12));
    return ARG(8);
}
static uint32_t g_SetDIBitsToDevice(void) {
    dc_t *d = getdc(ARG(0));
    int32_t w = (int32_t)ARG(3), h = (int32_t)ARG(4);
    if (d) dib_draw(d, (int32_t)ARG(1), (int32_t)ARG(2), w, h, (int32_t)ARG(5), (int32_t)ARG(6), w, h, ARG(9), ARG(10), 0xcc0020);
    return (uint32_t)h;
}
static uint32_t g_SetDIBits(void) {
    gobj_t *b = getobj(ARG(1));
    if (!b) return 0;
    int32_t w, h;
    if (!dib_decode(ARG(5), ARG(4), 0, &w, &h, 0, 0, 0) || w != b->w) { w32_m.gdi_unsupported++; return 0; }
    uint32_t *px = (uint32_t *)x86_alloc((uint32_t)(w * h) * 4u);
    dib_decode(ARG(5), ARG(4), px, 0, 0, 0, 0, 0);
    uint32_t *c = cpu_px(b);
    for (int32_t i = 0; i < w * imin(h, b->h); i++) c[i] = px[i];
    b->cpu_valid = 1;
    ensure_tex(b);
    upload(b->tex, 0, 0, w, imin(h, b->h), c);
    return ARG(3);
}
/* GetDIBits(hdc, hbm, start, lines, bits, bmi, usage): 24/32-bpp BI_RGB output, bottom-up or top-down (negative
 * biHeight); scan lines are counted in the DIB's own order. */
static uint32_t g_GetDIBits(void) {
    gobj_t *b = getobj(ARG(1));
    uint32_t bi = ARG(5);
    if (!b || !bi) return 0;
    if (!ARG(4)) { /* fill in the BITMAPINFOHEADER only */
        x86_wr32(bi + 4, (uint32_t)b->w); x86_wr32(bi + 8, (uint32_t)b->h); x86_wr16(bi + 12, 1); x86_wr16(bi + 14, 32);
        x86_wr32(bi + 16, 0); x86_wr32(bi + 20, (uint32_t)(b->w * b->h * 4));
        return 1;
    }
    w32_m.gdi_pixel_reads++;
    uint32_t bpp = x86_rd16(bi + 14), comp = x86_rd32(bi + 16);
    int32_t dh = (int32_t)x86_rd32(bi + 8);
    int top_down = dh < 0;
    if ((bpp != 32 && bpp != 24) || comp != 0) { w32_m.gdi_unsupported++; return 0; }
    uint32_t bits = ARG(4), start = ARG(2), lines = ARG(3), row = ((uint32_t)b->w * bpp + 31) / 32 * 4;
    if (start >= (uint32_t)b->h) return 0;
    if (lines > (uint32_t)b->h - start) lines = (uint32_t)b->h - start;
    static uint32_t *px;
    static uint32_t cap;
    uint32_t need = (uint32_t)(b->w * b->h);
    if (!(b->cpu && b->cpu_valid) && b->tex) {
        if (need > cap) { px = (uint32_t *)x86_alloc(need * 4u); cap = need; }
        if (!px || !w32_rp_read(b->tex, 0, 0, b->w, b->h, px)) { w32_m.gdi_getpixel_noread++; return 0; }
        w32_m.gdi_cpu_replays++;
    }
    for (uint32_t i = 0; i < lines; i++) {
        /* bottom-up DIBs store the bottom scan line first; top-down ones the top line */
        int32_t sy = top_down ? (int32_t)(start + i) : b->h - 1 - (int32_t)(start + i);
        uint32_t r = bits + i * row;
        for (int32_t x = 0; x < b->w; x++) {
            uint32_t c = b->cpu && b->cpu_valid ? b->cpu[sy * b->w + x] : b->tex ? px[sy * b->w + x] : 0xff000000u;
            if (bpp == 32) x86_wr32(r + 4u * (uint32_t)x, ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff));
            else { x86_wr8(r + 3u * (uint32_t)x, (c >> 16) & 0xff); x86_wr8(r + 3u * (uint32_t)x + 1, (c >> 8) & 0xff); x86_wr8(r + 3u * (uint32_t)x + 2, c & 0xff); }
        }
    }
    return lines;
}
static uint32_t g_FillRect(void) {
    dc_t *d = getdc(ARG(0));
    uint32_t r = ARG(1);
    if (d) { int32_t l = (int32_t)x86_rd32(r), t = (int32_t)x86_rd32(r + 4); fill_brush(d, l, t, (int32_t)x86_rd32(r + 8) - l, (int32_t)x86_rd32(r + 12) - t, ARG(2), BGT_BLEND_OPAQUE); }
    return 1;
}
static uint32_t g_FrameRect(void) {
    dc_t *d = getdc(ARG(0));
    uint32_t r = ARG(1);
    if (!d) return 0;
    int32_t l = (int32_t)x86_rd32(r), t = (int32_t)x86_rd32(r + 4), rr = (int32_t)x86_rd32(r + 8), b = (int32_t)x86_rd32(r + 12);
    fill_brush(d, l, t, rr - l, 1, ARG(2), BGT_BLEND_OPAQUE); fill_brush(d, l, b - 1, rr - l, 1, ARG(2), BGT_BLEND_OPAQUE);
    fill_brush(d, l, t, 1, b - t, ARG(2), BGT_BLEND_OPAQUE); fill_brush(d, rr - 1, t, 1, b - t, ARG(2), BGT_BLEND_OPAQUE);
    return 1;
}
static uint32_t g_InvertRect(void) {
    dc_t *d = getdc(ARG(0));
    surf_t s;
    uint32_t r = ARG(1);
    if (d && dc_surf(d, &s)) {
        int32_t l = (int32_t)x86_rd32(r), t = (int32_t)x86_rd32(r + 4);
        s_fill(&s, s.ox + l, s.oy + t, (int32_t)x86_rd32(r + 8) - l, (int32_t)x86_rd32(r + 12) - t, 0xffffff, BGT_BLEND_INVERT);
    }
    return 1;
}
/* line in the current pen; h/v lines are exact, diagonals are drawn as 1px steps */
static void pen_line(dc_t *d, int32_t x0, int32_t y0, int32_t x1, int32_t y1, int last) {
    gobj_t *p = getobj(d->pen);
    if (!p || p->style == 5) return;
    surf_t s;
    if (!dc_surf(d, &s)) return;
    uint32_t blend = BGT_BLEND_OPAQUE, c = p->color;
    if (d->rop2 == 6 || d->rop2 == 7) { blend = BGT_BLEND_INVERT; c = d->rop2 == 6 ? 0xffffff : c; } /* R2_NOT / R2_XORPEN */
    else if (d->rop2 != 13) w32_m.gdi_approx_rop++;
    int32_t wdt = p->width;
    if (y0 == y1) { int32_t a = imin(x0, x1), b = imax(x0, x1) + (last ? 1 : 0); s_fill(&s, s.ox + a, s.oy + y0 - wdt / 2, b - a, wdt, c, blend); return; }
    if (x0 == x1) { int32_t a = imin(y0, y1), b = imax(y0, y1) + (last ? 1 : 0); s_fill(&s, s.ox + x0 - wdt / 2, s.oy + a, wdt, b - a, c, blend); return; }
    int32_t dx = x1 > x0 ? x1 - x0 : x0 - x1, dy = y1 > y0 ? y0 - y1 : y1 - y0, sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (int32_t n = 0; n < 8192; n++) {
        if (x0 == x1 && y0 == y1 && !last) break;
        s_fill(&s, s.ox + x0, s.oy + y0, wdt, wdt, c, blend);
        if (x0 == x1 && y0 == y1) break;
        int32_t e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}
static uint32_t g_MoveToEx(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    if (ARG(3)) { x86_wr32(ARG(3), (uint32_t)d->curx); x86_wr32(ARG(3) + 4, (uint32_t)d->cury); }
    d->curx = (int32_t)ARG(1); d->cury = (int32_t)ARG(2);
    return 1;
}
static uint32_t g_LineTo(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    pen_line(d, d->curx, d->cury, (int32_t)ARG(1), (int32_t)ARG(2), 0);
    d->curx = (int32_t)ARG(1); d->cury = (int32_t)ARG(2);
    return 1;
}
static uint32_t g_Polyline(void) {
    dc_t *d = getdc(ARG(0));
    uint32_t pts = ARG(1), n = ARG(2);
    if (!d) return 0;
    for (uint32_t i = 1; i < n; i++)
        pen_line(d, (int32_t)x86_rd32(pts + 8 * (i - 1)), (int32_t)x86_rd32(pts + 8 * (i - 1) + 4), (int32_t)x86_rd32(pts + 8 * i), (int32_t)x86_rd32(pts + 8 * i + 4), 0);
    return 1;
}
static uint32_t g_Rectangle(void) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    int32_t l = (int32_t)ARG(1), t = (int32_t)ARG(2), r = (int32_t)ARG(3), b = (int32_t)ARG(4);
    fill_brush(d, l + 1, t + 1, r - l - 2, b - t - 2, d->brush, BGT_BLEND_OPAQUE);
    pen_line(d, l, t, r - 1, t, 1); pen_line(d, l, b - 1, r - 1, b - 1, 1);
    pen_line(d, l, t, l, b - 1, 1); pen_line(d, r - 1, t, r - 1, b - 1, 1);
    return 1;
}
static uint32_t g_Ellipse(void) { w32_m.gdi_approx_rop++; return g_Rectangle(); } /* INFERRED approximation (counted) */
static uint32_t g_RoundRect(void) { w32_m.gdi_approx_rop++; return g_Rectangle(); }
static uint32_t g_SetPixel(void) {
    dc_t *d = getdc(ARG(0));
    surf_t s;
    if (d && dc_surf(d, &s)) s_fill(&s, s.ox + (int32_t)ARG(1), s.oy + (int32_t)ARG(2), 1, 1, ARG(3), BGT_BLEND_OPAQUE);
    return ARG(3);
}
int w32_is_pixel_read_api(const char *name) {
    static const char *const names[] = {"GetPixel", "GetDIBits"};
    for (uint32_t i = 0; i < sizeof names / sizeof names[0]; i++) if (w32_streqi(names[i], name)) return 1;
    return 0;
}
/* the colour of one surface pixel as GDI sees it (COLORREF), from known CPU pixels or the CPU replay;
 * returns 0 when the pixel's history is unknown */
static int read_px(gobj_t *b, uint32_t tex, int32_t x, int32_t y, uint32_t *rgba) {
    if (b && b->cpu && b->cpu_valid) { *rgba = b->cpu[y * b->w + x]; return 1; }
    if (b && !b->tex) { *rgba = 0xff000000u; return 1; } /* never drawn or uploaded: a fresh (black) bitmap */
    if (!w32_rp_pixel(tex, x, y, rgba)) return 0;
    w32_m.gdi_cpu_replays++;
    return 1;
}
static uint32_t g_GetPixel(void) {
    dc_t *d = getdc(ARG(0));
    surf_t s;
    w32_m.gdi_pixel_reads++;
    if (!d || !dc_surf_mode(d, &s, 1)) return 0xffffffffu;
    int32_t x = s.ox + (int32_t)ARG(1), y = s.oy + (int32_t)ARG(2);
    /* outside the clipping region: CLR_INVALID (Win32 contract, not a failure) */
    if (x < s.cl || y < s.ct || x >= s.cr || y >= s.cb) return 0xffffffffu;
    int32_t cuts[NWND][4]; uint32_t nc = w32_user_exclusions(s.hwnd, cuts);
    for (uint32_t i = 0; i < nc; i++) if (x >= cuts[i][0] && x < cuts[i][2] && y >= cuts[i][1] && y < cuts[i][3]) return 0xffffffffu;
    gobj_t *b = d->kind == 2 ? getobj(d->bmp) : 0;
    uint32_t v;
    if (!read_px(b, s.tex, x, y, &v)) { w32_m.gdi_getpixel_noread++; return 0xffffffffu; }
    return v & 0xffffffu;
}

/* ------------------------------------------------------------------ text */
static w32_font_t dc_font(dc_t *d) {
    gobj_t *f = d ? getobj(d->font) : 0;
    return w32_font_metrics(f ? f->fh : 13, f ? f->weight : 400);
}
static void text_out(dc_t *d, int32_t x, int32_t y, const char *s, int32_t n) {
    surf_t sf;
    if (!dc_surf(d, &sf)) return;
    w32_font_t f = dc_font(d);
    int32_t ch = f.height, w = n * f.advance;
    if (d->align & 6u) x -= (d->align & 6u) == 6 ? w / 2 : w; /* TA_CENTER / TA_RIGHT */
    if ((d->align & 24u) == 24u) y -= f.ascent; /* TA_BASELINE */
    else if (d->align & 8u) y -= ch; /* TA_BOTTOM */
    if (d->bkmode == 2) s_fill(&sf, sf.ox + x, sf.oy + y, w, ch, d->bk, BGT_BLEND_OPAQUE);
    int32_t rects[W32_REGION_MAX][4];
    uint32_t nr = visible_region(sf.hwnd, sf.cl, sf.ct, sf.cr, sf.cb, rects);
    for (uint32_t i = 0; i < nr; i++) font_text(sf.tex, rects[i][0], rects[i][1], rects[i][2], rects[i][3], sf.ox + x, sf.oy + y, s, n, d->text, f);
}
static uint32_t g_TextOut(int wide) {
    dc_t *d = getdc(ARG(0));
    char s[512];
    uint32_t n = w32_gstrn(ARG(3), (int32_t)ARG(4), wide, s, sizeof s);
    if (d) text_out(d, (int32_t)ARG(1), (int32_t)ARG(2), s, (int32_t)n);
    return 1;
}
static uint32_t g_TextOutA(void) { return g_TextOut(0); }
static uint32_t g_TextOutW(void) { return g_TextOut(1); }
static uint32_t g_ExtTextOut(int wide) {
    dc_t *d = getdc(ARG(0));
    if (!d) return 0;
    uint32_t opts = ARG(3), r = ARG(4);
    if ((opts & 2u) && r) { /* ETO_OPAQUE */
        surf_t s;
        if (dc_surf(d, &s)) {
            int32_t l = (int32_t)x86_rd32(r), t = (int32_t)x86_rd32(r + 4);
            s_fill(&s, s.ox + l, s.oy + t, (int32_t)x86_rd32(r + 8) - l, (int32_t)x86_rd32(r + 12) - t, d->bk, BGT_BLEND_OPAQUE);
        }
    }
    char s[512];
    uint32_t n = w32_gstrn(ARG(5), (int32_t)ARG(6), wide, s, sizeof s);
    int bm = d->bkmode;
    if (opts & 2u) d->bkmode = 1;
    text_out(d, (int32_t)ARG(1), (int32_t)ARG(2), s, (int32_t)n);
    d->bkmode = bm;
    return 1;
}
static uint32_t g_ExtTextOutA(void) { return g_ExtTextOut(0); }
static uint32_t g_ExtTextOutW(void) { return g_ExtTextOut(1); }
static uint32_t g_GetTextExtent(int wide) {
    dc_t *d = getdc(ARG(0));
    char s[512];
    uint32_t n = w32_gstrn(ARG(1), (int32_t)ARG(2), wide, s, sizeof s);
    w32_font_t f = dc_font(d);
    x86_wr32(ARG(3), n * (uint32_t)f.advance); x86_wr32(ARG(3) + 4, (uint32_t)f.height);
    return 1;
}
static uint32_t g_GetTextExtentA(void) { return g_GetTextExtent(0); }
static uint32_t g_GetTextExtentW(void) { return g_GetTextExtent(1); }
static uint32_t g_GetTextMetrics(int wide) {
    dc_t *d = getdc(ARG(0));
    w32_font_t f = dc_font(d);
    uint32_t p = ARG(1), size = wide ? 60 : 56;
    for (uint32_t i = 0; i < size; i++) x86_wr8(p + i, 0);
    x86_wr32(p, (uint32_t)f.height); x86_wr32(p + 4, (uint32_t)f.ascent); x86_wr32(p + 8, (uint32_t)f.descent);
    x86_wr32(p + 20, (uint32_t)f.advance); x86_wr32(p + 24, (uint32_t)f.advance); x86_wr32(p + 28, (uint32_t)f.weight);
    return 1;
}
static uint32_t g_GetTextMetricsA(void) { return g_GetTextMetrics(0); }
static uint32_t g_GetTextMetricsW(void) { return g_GetTextMetrics(1); }

/* DrawText: single line or simple word wrap; returns text height */
uint32_t w32_draw_text(uint32_t hdc, const char *s, int32_t n, uint32_t rect, uint32_t fmt) {
    dc_t *d = getdc(hdc);
    if (!d) return 0;
    char clean[512];
    int32_t k = 0, marks[512], nm = 0;
    for (int32_t i = 0; i < n && k < 511; i++) {
        if (s[i] == '&' && !(fmt & 0x800u)) {
            if (i + 1 < n && s[i + 1] == '&') { clean[k++] = '&'; i++; }
            else if (i + 1 < n && !(fmt & 0x100000u)) marks[nm++] = k;
            continue;
        }
        clean[k++] = s[i];
    }
    clean[k] = 0;
    w32_font_t f = dc_font(d);
    int32_t ch = f.height;
    int32_t l = (int32_t)x86_rd32(rect), t = (int32_t)x86_rd32(rect + 4), r = (int32_t)x86_rd32(rect + 8), b = (int32_t)x86_rd32(rect + 12);
    int32_t w = k * f.advance;
    if (fmt & 0x400u) { x86_wr32(rect + 8, (uint32_t)(l + w)); x86_wr32(rect + 12, (uint32_t)(t + ch)); return (uint32_t)ch; } /* DT_CALCRECT */
    int32_t x = l, y = t;
    if (fmt & 1u) x = l + (r - l - w) / 2;      /* DT_CENTER */
    else if (fmt & 2u) x = r - w;               /* DT_RIGHT */
    if ((fmt & 0x20u) && (fmt & 4u)) y = t + (b - t - ch) / 2; /* DT_SINGLELINE | DT_VCENTER */
    else if ((fmt & 0x20u) && (fmt & 8u)) y = b - ch;          /* DT_BOTTOM */
    int bm = d->bkmode;
    text_out(d, x, y, clean, k);
    surf_t sf;
    if (nm && dc_surf(d, &sf)) for (int32_t i = 0; i < nm; i++)
        s_fill(&sf, sf.ox + x + marks[i] * f.advance, sf.oy + y + f.ascent + 1, f.advance - 1, 1, d->text, BGT_BLEND_OPAQUE);
    d->bkmode = bm;
    return (uint32_t)ch;
}

/* ------------------------------------------------------------------ misc */
static uint32_t g_LineDDA(void) {
    int32_t x0 = (int32_t)ARG(0), y0 = (int32_t)ARG(1), x1 = (int32_t)ARG(2), y1 = (int32_t)ARG(3);
    uint32_t fn = ARG(4), data = ARG(5);
    int32_t dx = x1 > x0 ? x1 - x0 : x0 - x1, dy = y1 > y0 ? y0 - y1 : y1 - y0, sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (int32_t n = 0; n < 65536 && !(x0 == x1 && y0 == y1); n++) {
        uint32_t args[3] = {(uint32_t)x0, (uint32_t)y0, data};
        x86_callback(fn, 3, args);
        int32_t e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return 1;
}

#define API(n, a, f) {n, a, 0, f}
#define STUB(n, a) {n, a, 0, 0}
const w32_api_t w32_api_gdi[] = {
    API("CreateCompatibleDC", 1, g_CreateCompatibleDC), API("DeleteDC", 1, g_DeleteDC), API("SaveDC", 1, g_SaveDC), API("RestoreDC", 2, g_RestoreDC),
    API("SelectObject", 2, g_SelectObject), API("DeleteObject", 1, g_DeleteObject), API("GetStockObject", 1, g_GetStockObject),
    API("GetCurrentObject", 2, g_GetCurrentObject),
    API("SetBkColor", 2, g_SetBkColor), API("SetTextColor", 2, g_SetTextColor), API("GetBkColor", 1, g_GetBkColor), API("GetTextColor", 1, g_GetTextColor),
    API("SetBkMode", 2, g_SetBkMode), API("SetROP2", 2, g_SetROP2), API("SetTextAlign", 2, g_SetTextAlign),
    API("SetBrushOrgEx", 4, g_SetBrushOrgEx), API("SetViewportOrgEx", 4, g_SetViewportOrgEx), API("OffsetViewportOrgEx", 4, g_OffsetViewportOrgEx),
    API("SetWindowOrgEx", 4, g_SetViewportOrgEx), API("GetDCOrgEx", 2, g_GetDCOrgEx), API("SetMapMode", 2, g_noop1), API("GetDeviceCaps", 2, g_GetDeviceCaps),
    API("IntersectClipRect", 5, g_IntersectClipRect), API("SelectClipRgn", 2, g_SelectClipRgn), API("ExcludeClipRect", 5, g_ExcludeClipRect),
    API("CreateRectRgn", 4, g_CreateRectRgn), API("CreateRectRgnIndirect", 1, g_CreateRectRgnIndirect), API("GetClipBox", 2, g_GetClipBox),
    API("PtVisible", 3, g_PtVisible), API("RectVisible", 2, g_RectVisible),
    API("CreateSolidBrush", 1, g_CreateSolidBrush), API("CreateHatchBrush", 2, g_CreateHatchBrush), API("CreatePatternBrush", 1, g_CreatePatternBrush),
    API("CreateBrushIndirect", 1, g_CreateBrushIndirect), API("CreatePen", 3, g_CreatePen),
    API("CreateFontA", 14, g_CreateFont), API("CreateFontW", 14, g_CreateFont), API("CreateFontIndirectA", 1, g_CreateFontIndirect), API("CreateFontIndirectW", 1, g_CreateFontIndirect),
    API("CreateCompatibleBitmap", 3, g_CreateCompatibleBitmap), API("CreateBitmap", 5, g_CreateBitmap), API("CreateDIBitmap", 6, g_CreateDIBitmap),
    API("CreateDIBSection", 6, g_CreateDIBSection), API("GetObjectA", 3, g_GetObject), API("GetObjectW", 3, g_GetObject),
    API("SetDIBits", 7, g_SetDIBits), API("GetDIBits", 7, g_GetDIBits), API("StretchDIBits", 13, g_StretchDIBits), API("SetDIBitsToDevice", 12, g_SetDIBitsToDevice),
    API("PatBlt", 6, g_PatBlt), API("BitBlt", 9, g_BitBlt), API("StretchBlt", 11, g_StretchBlt), API("SetStretchBltMode", 2, g_SetStretchBltMode),
    API("MoveToEx", 4, g_MoveToEx), API("LineTo", 3, g_LineTo), API("Polyline", 3, g_Polyline), API("Rectangle", 5, g_Rectangle),
    API("Ellipse", 5, g_Ellipse), API("RoundRect", 7, g_RoundRect), API("SetPixel", 4, g_SetPixel), API("SetPixelV", 4, g_SetPixel), API("GetPixel", 3, g_GetPixel),
    API("TextOutA", 5, g_TextOutA), API("TextOutW", 5, g_TextOutW), API("ExtTextOutA", 8, g_ExtTextOutA), API("ExtTextOutW", 8, g_ExtTextOutW),
    API("GetTextExtentPoint32A", 4, g_GetTextExtentA), API("GetTextExtentPoint32W", 4, g_GetTextExtentW),
    API("GetTextExtentPointA", 4, g_GetTextExtentA), API("GetTextExtentPointW", 4, g_GetTextExtentW),
    API("GetTextMetricsA", 2, g_GetTextMetricsA), API("GetTextMetricsW", 2, g_GetTextMetricsW),
    API("GdiFlush", 0, g_noop1), API("RealizePalette", 1, g_zero), API("SelectPalette", 3, g_zero), API("CreatePalette", 1, g_zero),
    API("LineDDA", 6, g_LineDDA),
    /* USER32 drawing helpers implemented on GDI */
    API("FillRect", 3, g_FillRect), API("FrameRect", 3, g_FrameRect), API("InvertRect", 2, g_InvertRect),
    API("LoadBitmapA", 2, g_LoadBitmapA), API("LoadBitmapW", 2, g_LoadBitmapW),
};
const uint32_t w32_api_gdi_n = sizeof w32_api_gdi / sizeof w32_api_gdi[0];
