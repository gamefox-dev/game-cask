/* GL 3.3 internal formats, pixel-transfer validation and texel conversion. Included once by w32_gl.c.
 * SPDX-License-Identifier: MIT — LANE-K6A */
enum { K_COLOR = 0, K_DEPTH, K_DS, K_STENCIL };
typedef struct {
    uint32_t internal;
    uint8_t bgt;        /* §13 storage format */
    uint8_t chans;      /* logical color channels 1..4 (0 for depth/stencil kinds) */
    uint8_t kind;
    uint8_t srgb, flt;
    uint8_t bits[6];    /* r g b a depth stencil, as actually stored */
} Fmt;
#define F(i, b, c, k, s, f, r, g, bl, a, d, st) {i, b, c, k, s, f, {r, g, bl, a, d, st}}
static const Fmt fmts[] = {
    F(0x1903, 2, 1, K_COLOR, 0, 0, 8, 0, 0, 0, 0, 0), F(0x8229, 2, 1, K_COLOR, 0, 0, 8, 0, 0, 0, 0, 0),
    F(0x8227, 3, 2, K_COLOR, 0, 0, 8, 8, 0, 0, 0, 0), F(0x822b, 3, 2, K_COLOR, 0, 0, 8, 8, 0, 0, 0, 0),
    F(0x1907, 0, 3, K_COLOR, 0, 0, 8, 8, 8, 0, 0, 0), F(0x8051, 0, 3, K_COLOR, 0, 0, 8, 8, 8, 0, 0, 0),
    F(0x804f, 0, 3, K_COLOR, 0, 0, 8, 8, 8, 0, 0, 0), F(0x8050, 0, 3, K_COLOR, 0, 0, 8, 8, 8, 0, 0, 0),
    F(0x2a10, 0, 3, K_COLOR, 0, 0, 8, 8, 8, 0, 0, 0),
    F(0x1908, 0, 4, K_COLOR, 0, 0, 8, 8, 8, 8, 0, 0), F(0x8058, 0, 4, K_COLOR, 0, 0, 8, 8, 8, 8, 0, 0),
    F(0x8056, 0, 4, K_COLOR, 0, 0, 8, 8, 8, 8, 0, 0), F(0x8057, 0, 4, K_COLOR, 0, 0, 8, 8, 8, 8, 0, 0),
    F(0x8055, 0, 4, K_COLOR, 0, 0, 8, 8, 8, 8, 0, 0),
    F(0x8c43, 1, 4, K_COLOR, 1, 0, 8, 8, 8, 8, 0, 0), F(0x8c41, 1, 3, K_COLOR, 1, 0, 8, 8, 8, 0, 0, 0),
    F(0x8059, 7, 4, K_COLOR, 0, 0, 10, 10, 10, 2, 0, 0), F(0x8052, 7, 3, K_COLOR, 0, 0, 10, 10, 10, 0, 0, 0),
    F(0x822d, 8, 1, K_COLOR, 0, 1, 16, 0, 0, 0, 0, 0), F(0x822f, 9, 2, K_COLOR, 0, 1, 16, 16, 0, 0, 0, 0),
    F(0x881b, 4, 3, K_COLOR, 0, 1, 16, 16, 16, 0, 0, 0), F(0x881a, 4, 4, K_COLOR, 0, 1, 16, 16, 16, 16, 0, 0),
    F(0x822e, 10, 1, K_COLOR, 0, 1, 32, 0, 0, 0, 0, 0), F(0x8230, 11, 2, K_COLOR, 0, 1, 32, 32, 0, 0, 0, 0),
    F(0x8815, 12, 3, K_COLOR, 0, 1, 32, 32, 32, 0, 0, 0), F(0x8814, 12, 4, K_COLOR, 0, 1, 32, 32, 32, 32, 0, 0),
    F(0x1902, 6, 0, K_DEPTH, 0, 0, 0, 0, 0, 0, 32, 0), F(0x81a5, 6, 0, K_DEPTH, 0, 0, 0, 0, 0, 0, 32, 0),
    F(0x81a6, 6, 0, K_DEPTH, 0, 0, 0, 0, 0, 0, 32, 0), F(0x81a7, 6, 0, K_DEPTH, 0, 0, 0, 0, 0, 0, 32, 0),
    F(0x8cac, 6, 0, K_DEPTH, 0, 1, 0, 0, 0, 0, 32, 0),
    F(0x84f9, 5, 0, K_DS, 0, 0, 0, 0, 0, 0, 24, 8), F(0x88f0, 5, 0, K_DS, 0, 0, 0, 0, 0, 0, 24, 8),
    F(0x8cad, 5, 0, K_DS, 0, 1, 0, 0, 0, 0, 24, 8),
    F(0x8d46, 5, 0, K_STENCIL, 0, 0, 0, 0, 0, 0, 0, 8), F(0x8d47, 5, 0, K_STENCIL, 0, 0, 0, 0, 0, 0, 0, 8),
    F(0x8d48, 5, 0, K_STENCIL, 0, 0, 0, 0, 0, 0, 0, 8), F(0x8d49, 5, 0, K_STENCIL, 0, 0, 0, 0, 0, 0, 0, 8),
};
#undef F
static const Fmt *find_fmt(uint32_t internal) {
    for (uint32_t i = 0; i < sizeof fmts / sizeof fmts[0]; i++) if (fmts[i].internal == internal) return &fmts[i];
    return 0;
}
/* Valid 3.3 internal formats this profile does not represent (neither stored nor approximated). */
static int known_unsupported(uint32_t f) {
    return (f >= 0x8231 && f <= 0x823c) || (f >= 0x8f94 && f <= 0x8f9b) || f == 0x822a || f == 0x822c ||
        f == 0x805b || f == 0x8054 || f == 0x8053 || f == 0x805a || f == 0x8c3a || f == 0x8c3d || f == 0x906f ||
        (f >= 0x8d70 && f <= 0x8d8f) || (f >= 0x83f0 && f <= 0x83f3) || (f >= 0x8dbb && f <= 0x8dbe) ||
        (f >= 0x84e9 && f <= 0x84ec) || (f >= 0x8c48 && f <= 0x8c4f) || f == 0x8e8c || f == 0x8e8d ||
        f == 0x8e8e || f == 0x8e8f || f == 0x8d62;
}
static char approx_json[4096] = "[]";
static uint32_t approx_len = 1;
static void approximate(const char *kind) {
    w32_gl_approximations++;
    uint32_t n = w32_slen(kind);
    for (uint32_t i = 1; i + n + 1 <= approx_len; i++) {
        uint32_t j = 0; while (j < n && approx_json[i + j] == kind[j]) j++;
        if (j == n && approx_json[i - 1] == '"' && approx_json[i + n] == '"') return;
    }
    if (approx_len + n + 4 < sizeof approx_json) {
        if (approx_len > 1) approx_json[approx_len++] = ',';
        approx_json[approx_len++] = '"'; copy(approx_json + approx_len, kind, n); approx_len += n;
        approx_json[approx_len++] = '"'; approx_json[approx_len] = ']'; approx_json[approx_len + 1] = 0;
    }
    w32_logf2("GL approximation or unsupported: ", kind);
}
const char *w32_gl_approximations_json(void) { return approx_json; }
static void approximate_hex(const char *what, uint32_t v) {
    char buf[64]; uint32_t n = 0; while (what[n] && n < 40) { buf[n] = what[n]; n++; }
    buf[n++] = ' '; buf[n++] = '0'; buf[n++] = 'x';
    for (int s = 28; s >= 0; s -= 4) { uint32_t d = (v >> s) & 15; if (d || n > 44 || s == 0 || buf[n - 1] != 'x')
        buf[n++] = (char)(d < 10 ? '0' + d : 'a' + d - 10); }
    buf[n] = 0; approximate(buf);
}

/* ---- half floats ---- */
static float h2f(uint32_t h) {
    uint32_t e = (h >> 10) & 31, m = h & 1023; float s = h & 0x8000 ? -1.0f : 1.0f;
    if (!e) return s * (float)m * (1.0f / 16777216.0f);
    if (e == 31) { union { uint32_t u; float f; } v = {(h & 0x8000) << 16 | 0x7f800000u | (m << 13)}; return v.f; }
    union { uint32_t u; float f; } v = {((e + 112) << 23) | (m << 13)}; return s * v.f;
}
static uint32_t f2h(float f) {
    union { float f; uint32_t u; } v = {f}; uint32_t x = v.u, sign = (x >> 16) & 0x8000, exp = (x >> 23) & 0xff,
        man = x & 0x7fffff;
    if (exp == 0xff) return sign | 0x7c00 | (man ? 0x200 : 0);
    int32_t e = (int32_t)exp - 127 + 15;
    if (e >= 31) return sign | 0x7c00;
    if (e <= 0) {
        if (e < -10) return sign;
        uint32_t m = (man | 0x800000) >> (1 - e), r = m & 0x1fff;
        return sign | ((m >> 13) + ((r > 0x1000 || (r == 0x1000 && (m & 0x2000))) ? 1 : 0));
    }
    uint32_t m = man >> 13, r = man & 0x1fff;
    return sign | (((uint32_t)e << 10 | m) + ((r > 0x1000 || (r == 0x1000 && (m & 1))) ? 1 : 0));
}

/* ---- transfer formats ---- */
#define T_UBYTE 0x1401u
#define T_BYTE 0x1400u
#define T_USHORT 0x1403u
#define T_SHORT 0x1402u
#define T_UINT 0x1405u
#define T_INT 0x1404u
#define T_HALF 0x140bu
#define T_FLOAT 0x1406u
static int is_packed(uint32_t t) {
    return (t >= 0x8032 && t <= 0x8036) || (t >= 0x8362 && t <= 0x8368) || t == 0x84fa || t == 0x8dad ||
        t == 0x8c3b || t == 0x8c3e;
}
static uint32_t type_bytes(uint32_t t) {
    switch (t) {
    case T_UBYTE: case T_BYTE: case 0x8032: case 0x8362: return 1;
    case T_USHORT: case T_SHORT: case T_HALF: case 0x8033: case 0x8034: case 0x8363: case 0x8364: case 0x8365:
    case 0x8366: return 2;
    case 0x8dad: return 8;
    default: return 4;
    }
}
static int valid_type(uint32_t t) {
    return t == T_UBYTE || t == T_BYTE || t == T_USHORT || t == T_SHORT || t == T_UINT || t == T_INT ||
        t == T_HALF || t == T_FLOAT || is_packed(t);
}
static int valid_format(uint32_t f) {
    return f == 0x1903 || f == 0x8227 || f == 0x1907 || f == 0x80e0 || f == 0x1908 || f == 0x80e1 ||
        f == 0x1902 || f == 0x84f9 || (f >= 0x8d94 && f <= 0x8d9b) || f == 0x8228 || f == 0x1901;
}
static int integer_format(uint32_t f) { return (f >= 0x8d94 && f <= 0x8d9b) || f == 0x8228; }
static uint32_t format_comps(uint32_t f) {
    switch (f) {
    case 0x1903: case 0x1902: case 0x1901: case 0x8d94: return 1;
    case 0x8227: case 0x8228: case 0x84f9: return 2;
    case 0x1907: case 0x80e0: case 0x8d98: case 0x8d9a: return 3;
    default: return 4;
    }
}
/* Returns 0 if (format,type) is a legal combination, else the GL error to raise. */
static uint32_t transfer_error(uint32_t format, uint32_t type) {
    if (!valid_format(format) || !valid_type(type)) return BAD_ENUM;
    if (type == 0x8c3b || type == 0x8c3e) return BAD_ENUM; /* packed-float transfers: documented limit */
    int rgbaf = format == 0x1908 || format == 0x80e1 || format == 0x8d99 || format == 0x8d9b;
    int rgbf = format == 0x1907 || format == 0x80e0 || format == 0x8d98 || format == 0x8d9a;
    switch (type) {
    case 0x8032: case 0x8362: case 0x8363: case 0x8364: return rgbf ? 0 : BAD_OP;
    case 0x8033: case 0x8034: case 0x8365: case 0x8366: case 0x8035: case 0x8367: case 0x8036: case 0x8368:
        return rgbaf ? 0 : BAD_OP;
    case 0x84fa: case 0x8dad: return format == 0x84f9 ? 0 : BAD_OP;
    default: return format == 0x84f9 ? BAD_OP : 0;
    }
}

static float unorm_f(uint32_t v, uint32_t bits) { return (float)v / (float)((1u << bits) - 1u); }
/* Decode one external pixel at guest address `a` into r,g,b,a (missing components 0, alpha 1). */
static void decode_pixel(uint32_t a, uint32_t format, uint32_t type, float *out) {
    float c[4] = {0, 0, 0, 1}; uint32_t comps = format_comps(format);
    int bgr = format == 0x80e0 || format == 0x80e1 || format == 0x8d9a || format == 0x8d9b;
    float raw[4] = {0, 0, 0, 1};
    if (is_packed(type)) {
        uint32_t v = type_bytes(type) == 1 ? x86_rd8(a) : type_bytes(type) == 2 ? x86_rd16(a) : x86_rd32(a);
        switch (type) {
        case 0x8032: raw[0] = unorm_f(v >> 5, 3); raw[1] = unorm_f((v >> 2) & 7, 3); raw[2] = unorm_f(v & 3, 2); break;
        case 0x8362: raw[0] = unorm_f(v & 7, 3); raw[1] = unorm_f((v >> 3) & 7, 3); raw[2] = unorm_f(v >> 6, 2); break;
        case 0x8363: raw[0] = unorm_f(v >> 11, 5); raw[1] = unorm_f((v >> 5) & 63, 6); raw[2] = unorm_f(v & 31, 5); break;
        case 0x8364: raw[0] = unorm_f(v & 31, 5); raw[1] = unorm_f((v >> 5) & 63, 6); raw[2] = unorm_f(v >> 11, 5); break;
        case 0x8033: for (int i = 0; i < 4; i++) raw[i] = unorm_f((v >> (12 - 4 * i)) & 15, 4); break;
        case 0x8365: for (int i = 0; i < 4; i++) raw[i] = unorm_f((v >> (4 * i)) & 15, 4); break;
        case 0x8034: for (int i = 0; i < 3; i++) raw[i] = unorm_f((v >> (11 - 5 * i)) & 31, 5); raw[3] = (float)(v & 1); break;
        case 0x8366: for (int i = 0; i < 3; i++) raw[i] = unorm_f((v >> (5 * i)) & 31, 5); raw[3] = (float)(v >> 15); break;
        case 0x8035: for (int i = 0; i < 4; i++) raw[i] = unorm_f((v >> (24 - 8 * i)) & 255, 8); break;
        case 0x8367: for (int i = 0; i < 4; i++) raw[i] = unorm_f((v >> (8 * i)) & 255, 8); break;
        case 0x8036: for (int i = 0; i < 3; i++) raw[i] = unorm_f((v >> (22 - 10 * i)) & 1023, 10);
            raw[3] = unorm_f(v & 3, 2); break;
        case 0x8368: for (int i = 0; i < 3; i++) raw[i] = unorm_f((v >> (10 * i)) & 1023, 10);
            raw[3] = unorm_f(v >> 30, 2); break;
        default: break;
        }
    } else for (uint32_t i = 0; i < comps; i++) {
        float f;
        switch (type) {
        case T_UBYTE: f = (float)x86_rd8(a + i) / 255.0f; break;
        case T_BYTE: { int32_t s = (int8_t)x86_rd8(a + i); f = (float)s / 127.0f; if (f < -1) f = -1; break; }
        case T_USHORT: f = (float)x86_rd16(a + i * 2) / 65535.0f; break;
        case T_SHORT: { int32_t s = (int16_t)x86_rd16(a + i * 2); f = (float)s / 32767.0f; if (f < -1) f = -1; break; }
        case T_UINT: f = (float)((double)x86_rd32(a + i * 4) / 4294967295.0); break;
        case T_INT: { int32_t s = (int32_t)x86_rd32(a + i * 4); f = (float)((double)s / 2147483647.0); if (f < -1) f = -1; break; }
        case T_HALF: f = h2f(x86_rd16(a + i * 2)); break;
        default: { union { uint32_t u; float f; } v = {x86_rd32(a + i * 4)}; f = v.f; break; }
        }
        raw[i] = f;
    }
    if (is_packed(type)) {
        /* Packed components are already in R,G,B,A order for RGB/RGBA; BGR/BGRA swap first and third. */
        for (int i = 0; i < 4; i++) c[i] = raw[i];
        if (comps < 4) c[3] = 1;
        if (bgr) { float t = c[0]; c[0] = c[2]; c[2] = t; }
    } else if (bgr) {
        c[2] = raw[0]; c[1] = raw[1]; c[0] = raw[2]; if (comps == 4) c[3] = raw[3];
    } else for (uint32_t i = 0; i < comps; i++) c[i] = raw[i];
    for (int i = 0; i < 4; i++) out[i] = c[i];
}
static float clamp01(float f) { return f != f || f < 0 ? 0 : f > 1 ? 1 : f; }
static uint8_t to_u8(float f) { return (uint8_t)(clamp01(f) * 255.0f + 0.5f); }
static void put16(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void put32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }
static uint32_t storage_bytes(uint32_t bgt) {
    static const uint32_t b[] = {4, 4, 1, 2, 8, 4, 4, 4, 2, 4, 4, 8, 16}; return b[bgt];
}
/* Encode r,g,b,a into BGT storage `bgt`; rgb-only logical formats get alpha one. */
static void encode_texel(uint8_t *p, uint32_t bgt, const float *v) {
    switch (bgt) {
    case 0: case 1: for (int i = 0; i < 4; i++) p[i] = to_u8(v[i]); break;
    case 2: p[0] = to_u8(v[0]); break;
    case 3: p[0] = to_u8(v[0]); p[1] = to_u8(v[1]); break;
    case 4: for (int i = 0; i < 4; i++) put16(p + i * 2, f2h(v[i])); break;
    case 7: put32(p, (uint32_t)(clamp01(v[0]) * 1023.0f + 0.5f) | (uint32_t)(clamp01(v[1]) * 1023.0f + 0.5f) << 10 |
        (uint32_t)(clamp01(v[2]) * 1023.0f + 0.5f) << 20 | (uint32_t)(clamp01(v[3]) * 3.0f + 0.5f) << 30); break;
    case 8: put16(p, f2h(v[0])); break;
    case 9: put16(p, f2h(v[0])); put16(p + 2, f2h(v[1])); break;
    case 10: case 11: case 12: { uint32_t n = bgt == 10 ? 1 : bgt == 11 ? 2 : 4;
        for (uint32_t i = 0; i < n; i++) put32(p + i * 4, bits(v[i])); break; }
    default: break;
    }
}
/* Decode one BGT storage texel (for readbacks) into r,g,b,a (missing 0,0,0,1). */
static void decode_texel(const uint8_t *p, uint32_t bgt, float *v) {
    v[0] = v[1] = v[2] = 0; v[3] = 1;
    switch (bgt) {
    case 0: case 1: for (int i = 0; i < 4; i++) v[i] = (float)p[i] / 255.0f; break;
    case 2: v[0] = (float)p[0] / 255.0f; break;
    case 3: v[0] = (float)p[0] / 255.0f; v[1] = (float)p[1] / 255.0f; break;
    case 4: for (int i = 0; i < 4; i++) v[i] = h2f(p[i * 2] | p[i * 2 + 1] << 8); break;
    case 7: { uint32_t u = p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24;
        v[0] = (float)(u & 1023) / 1023.0f; v[1] = (float)((u >> 10) & 1023) / 1023.0f;
        v[2] = (float)((u >> 20) & 1023) / 1023.0f; v[3] = (float)(u >> 30) / 3.0f; break; }
    case 8: v[0] = h2f(p[0] | p[1] << 8); break;
    case 9: v[0] = h2f(p[0] | p[1] << 8); v[1] = h2f(p[2] | p[3] << 8); break;
    case 10: case 11: case 12: { uint32_t n = bgt == 10 ? 1 : bgt == 11 ? 2 : 4;
        for (uint32_t i = 0; i < n; i++) { union { uint32_t u; float f; } w = {p[i*4] | p[i*4+1] << 8 | p[i*4+2] << 16 |
            (uint32_t)p[i*4+3] << 24}; v[i] = w.f; } break; }
    default: break;
    }
}
