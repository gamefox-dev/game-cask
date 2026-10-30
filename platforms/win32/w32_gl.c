/* OpenGL 3.3 -> BGT §13. Engine-independent, bounded profile. SPDX-License-Identifier: MIT — LANE-GL */
#include "w32_gl.h"

#define N 256
#define BAD_ENUM 0x500u
#define BAD_VALUE 0x501u
#define BAD_OP 0x502u
#define OOM 0x505u
#define F32 0x1406u
#define U8 0x1401u
#define U16 0x1403u
#define U32 0x1405u
#define TEXTURE_2D 0xde1u
#define ARRAY_BUFFER 0x8892u
#define ELEMENT_BUFFER 0x8893u
#define UNIFORM_BUFFER 0x8a11u
#define FRAMEBUFFER 0x8d40u
#define RENDERBUFFER 0x8d41u
#define RGBA 0x1908u
#define DEPTH_STENCIL 0x88f0u
#define PTR(p) ((uint32_t)(uintptr_t)(p))
uint64_t w32_gl_calls, w32_gl_draws, w32_gl_state_changes, w32_gl_pipelines, w32_gl_unimplemented;
static uint32_t error, context, current, dc, pixel_format, interval = 1;
static char stub_json[8192] = "[]";
static uint32_t stub_len = 1;
static uint32_t request_id = 0x70000000u;
static uint32_t screen_depth, depth_handle = 900;
static uint32_t cmd_mem[4096];
static bgt_cmdbuf_t cmd;
static uint32_t width(void) { return w32_io->logical_width; }
static uint32_t height(void) { return w32_io->logical_height; }
static void fail(uint32_t e) { if (!error) error = e; }
static int eq(const char *a, const char *b) {
    while (*a && *a == *b) { a++; b++; } return *a == *b;
}
static void copy(void *d, const void *s, uint32_t n) {
    for (uint32_t i = 0; i < n; i++) ((uint8_t *)d)[i] = ((const uint8_t *)s)[i];
}
static void zero(void *d, uint32_t n) { for (uint32_t i = 0; i < n; i++) ((uint8_t *)d)[i] = 0; }
static uint32_t bits(float f) { union { float f; uint32_t u; } v = {f}; return v.u; }
static float argf(uint32_t n) {
    if (W32_64 && n < 4) return X.xmm[n].f32[0];
    union { uint32_t u; float f; } v = {ARG(n)}; return v.f;
}
static double argd(uint32_t n) {
    if (W32_64 && n < 4) return X.xmm[n].f64[0];
    union { uint64_t u; double d; } v = {W32_64 ? ARG64(n) : x86_rd64((uint32_t)X.r[ESP] + 4 + n * 4)};
    return v.d;
}
static void *guest(uint32_t p, uint32_t n) {
    uint8_t *v = x86_alloc(n ? n : 1);
    if (!v) { fail(OOM); return 0; }
    for (uint32_t i = 0; i < n; i++) v[i] = p ? x86_rd8(p + i) : 0;
    return v;
}
static void begin(void) { bgt_cmd_init(&cmd, cmd_mem, sizeof cmd_mem); }
static void op(uint32_t code, const uint32_t *w, uint32_t n) {
    bgt__gpu_copy(bgt_cmd_push(&cmd, (uint16_t)code, n * 4), w, n * 4);
}
static void submit(void) { if (bgt_cmd_submit(&cmd) < 0) fail(BAD_OP); }
static void send(uint32_t code, const uint32_t *w, uint32_t n) { begin(); op(code, w, n); submit(); }
#define SEND(code, ...) do { \
    const uint32_t payload[] = {__VA_ARGS__}; send(code, payload, sizeof payload / 4); \
} while (0)
static int wait_request(uint32_t id, char *log, uint32_t cap) {
    int status;
    while ((status = bgt_request_status(id)) == 0) w32_wait_frame();
    uint8_t result[4096];
    int n = status > 0 ? bgt_request_read(id, result, sizeof result) : status;
    bgt_request_close(id);
    int code = -1;
    if (n >= 4) { copy(&code, result, 4); n -= 4; }
    else n = 0;
    uint32_t k = (uint32_t)n < cap - 1 ? (uint32_t)n : cap - 1;
    copy(log, result + 4, k); log[k] = 0;
    if (code && !k) { const char *s = "BGT GPU unavailable or shader compilation failed";
        k = w32_slen(s); if (k >= cap) k = cap - 1; copy(log, s, k); log[k] = 0; }
    return code == 0;
}
int w32_gl_active(void) { return current != 0; }
const char *w32_gl_stubs_json(void) { return stub_json; }
static void missing(const char *name) {
    w32_gl_unimplemented++;
    uint32_t n = w32_slen(name);
    if (stub_len + n + 5 < sizeof stub_json) {
        if (stub_len > 1) stub_json[stub_len++] = ',';
        stub_json[stub_len++] = '"'; copy(stub_json + stub_len, name, n); stub_len += n;
        stub_json[stub_len++] = '"'; stub_json[stub_len] = ']'; stub_json[stub_len + 1] = 0;
    }
    w32_logf2("unimplemented OpenGL entry: ", name);
}

typedef struct { uint32_t used, size, gpu; uint8_t *data; } Buffer;
typedef struct { uint32_t enabled, buffer, count, type, normalized, stride, offset, divisor, integer; } Attribute;
typedef struct { uint32_t used, element; Attribute a[16]; } Vao;
typedef struct { uint32_t used, gpu, w, h, mips, format, min, mag, u, v; uint8_t *pixels; } Texture;
typedef struct { uint32_t used, gpu, min, mag, u, v; } Sampler;
typedef struct { uint32_t used, color, mip, depth, renderbuffer; } Fbo;
typedef struct { uint32_t used, gpu, w, h, format; } Rbo;
typedef struct { uint32_t used, type, compiled, gpu, deleted; char *source; char log[4096]; } Shader;
typedef struct { char name[64], type[32]; uint32_t offset, size, sampler, unit; } Uniform;
typedef struct { char name[64]; uint32_t binding; } Block;
typedef struct {
    uint32_t used, linked, vs, fs, vgpu, fgpu, nu, nb, ubuf, dirty;
    Uniform u[64]; Block block[7]; uint8_t values[4096]; char log[4096];
} Program;
static Buffer buffers[N]; static Vao vaos[N]; static Texture textures[N]; static Sampler samplers[N];
static Fbo fbos[N]; static Rbo rbos[N]; static Shader shaders[N]; static Program programs[N];
static uint32_t vao, array, uniform, ubo[8], ubo_offset[8], ubo_size[8], active_unit, tex[8], samp[8];
static uint32_t ubo_whole[8];
static uint32_t fbo, rbo, program, unpack = 4, pack = 4, row_length, skip_rows, skip_pixels;
static uint32_t blend, depth, stencil, cull, scissor_enabled;
static uint32_t cull_face = 2, front_face, depth_write = 1, depth_compare = 1;
static uint32_t src_rgb = 1, dst_rgb, src_alpha = 1, dst_alpha, blend_op_rgb, blend_op_alpha;
static uint32_t stencil_compare = 7, stencil_read = 255, stencil_write = 255, stencil_ref;
static uint32_t stencil_fail, stencil_zfail, stencil_pass, color_mask = 15;
static float clear_color[4], clear_depth = 1, blend_color[4]; static uint32_t clear_stencil;
static int32_t viewport[4], scissor[4]; static float range_min, range_max = 1;
typedef struct { uint32_t used, n, words[200], id, hash; } Pipeline;
static Pipeline pipelines[128]; static uint32_t pipeline_count;
static uint32_t alloc_name(void *base, uint32_t stride) {
    for (uint32_t i = 1; i < N; i++) if (!*(uint32_t *)((uint8_t *)base + stride * i)) {
        zero((uint8_t *)base + stride * i, stride); *(uint32_t *)((uint8_t *)base + stride * i) = 1; return i;
    }
    fail(OOM); return 0;
}
static Buffer *bound_buffer(uint32_t target) {
    uint32_t id = target == ARRAY_BUFFER ? array : target == ELEMENT_BUFFER ? vaos[vao].element :
        target == UNIFORM_BUFFER ? uniform : 0;
    if (target != ARRAY_BUFFER && target != ELEMENT_BUFFER && target != UNIFORM_BUFFER) fail(BAD_ENUM);
    else if (!id || id >= N || !buffers[id].used) fail(BAD_OP);
    return id && id < N && buffers[id].used ? &buffers[id] : 0;
}
static uint32_t api_GenBuffers(void) {
    int32_t n = (int32_t)ARG(0); if (n < 0) { fail(BAD_VALUE); return 0; }
    for (int32_t i = 0; i < n; i++) x86_wr32(ARG(1) + 4 * i, alloc_name(buffers, sizeof(Buffer)));
    return 0;
}
static uint32_t api_BindBuffer(void) {
    uint32_t target = ARG(0), id = ARG(1); if (id >= N) { fail(BAD_VALUE); return 0; }
    if (target == ARRAY_BUFFER) array = id;
    else if (target == ELEMENT_BUFFER && vao) vaos[vao].element = id;
    else if (target == UNIFORM_BUFFER) uniform = id;
    else { fail(target == ELEMENT_BUFFER ? BAD_OP : BAD_ENUM); return 0; }
    if (id) buffers[id].used = 1; return 0;
}
static uint32_t api_BufferData(void) {
    Buffer *b = bound_buffer(ARG(0)); int64_t size = (int64_t)ARG64(1);
    if (!b) return 0;
    if (size <= 0 || size > 67108864) { fail(BAD_VALUE); return 0; }
    uint8_t *data = guest(ARG(2), (uint32_t)size); if (!data) return 0;
    uint32_t id = (uint32_t)(b - buffers);
    if (b->gpu) SEND(0x42, id);
    b->gpu = id; b->size = (uint32_t)size; b->data = data;
    SEND(0x40, id, 7, b->size, PTR(data), b->size); return 0;
}
static uint32_t api_BufferSubData(void) {
    Buffer *b = bound_buffer(ARG(0)); uint64_t off = ARG64(1), n = ARG64(2);
    if (!b) return 0;
    if (off + n < off || off + n > b->size) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < n; i++) b->data[off + i] = x86_rd8(ARG(3) + i);
    if (n) SEND(0x41, b->gpu, (uint32_t)off, PTR(b->data + off), (uint32_t)n); return 0;
}
static uint32_t api_DeleteBuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) {
        uint32_t id = x86_rd32(ARG(1) + 4 * i); if (!id || id >= N) continue;
        if (buffers[id].gpu) SEND(0x42, buffers[id].gpu);
        zero(&buffers[id], sizeof(Buffer)); if (array == id) array = 0; if (uniform == id) uniform = 0;
        for (uint32_t j = 0; j < N; j++) {
            if (vaos[j].element == id) vaos[j].element = 0;
            for (uint32_t a = 0; a < 16; a++) if (vaos[j].a[a].buffer == id) vaos[j].a[a].buffer = 0;
        }
        for (uint32_t j = 0; j < 8; j++) if (ubo[j] == id) ubo[j] = 0;
    } return 0;
}
static uint32_t api_BindBufferBase(void) {
    if (ARG(0) != UNIFORM_BUFFER) { fail(BAD_ENUM); return 0; }
    if (ARG(1) >= 8 || ARG(2) >= N) { fail(BAD_VALUE); return 0; }
    uint32_t s = ARG(1), id = ARG(2); uniform = id; ubo[s] = id; ubo_offset[s] = 0;
    if (id) buffers[id].used = 1;
    ubo_whole[s] = 1; ubo_size[s] = buffers[id].size; return 0;
}
static uint32_t api_BindBufferRange(void) {
    if (ARG(0) != UNIFORM_BUFFER) { fail(BAD_ENUM); return 0; }
    uint32_t s = ARG(1), id = ARG(2), off = ARG(3), size = ARG(4);
    if (s >= 8 || id >= N || (off & 255) || !size || (uint64_t)off + size > buffers[id].size) {
        fail(BAD_VALUE); return 0;
    }
    uniform = id; ubo[s] = id; ubo_offset[s] = off; ubo_size[s] = size; ubo_whole[s] = 0; return 0;
}
static uint32_t api_GenVertexArrays(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) x86_wr32(ARG(1) + 4 * i, alloc_name(vaos, sizeof(Vao)));
    return 0;
}
static uint32_t api_BindVertexArray(void) {
    if (ARG(0) >= N || (ARG(0) && !vaos[ARG(0)].used)) fail(BAD_OP); else vao = ARG(0); return 0;
}
static uint32_t api_DeleteVertexArrays(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + i * 4);
        if (id && id < N) { zero(&vaos[id], sizeof(Vao)); if (vao == id) vao = 0; } } return 0;
}
static uint32_t attribute(int integer) {
    uint32_t a = ARG(0), count = ARG(1), type = ARG(2), stride = ARG(integer ? 3 : 4);
    if (a >= 16 || count < 1 || count > 4 || stride > 2048) { fail(BAD_VALUE); return 0; }
    if (!vao || !array) { fail(BAD_OP); return 0; }
    if (integer ? (type != U32 && type != 0x1404) :
        (type != F32 && !(type == U8 && count == 4 && ARG(3)))) {
        /* Numeric conversion of other GL vertex formats needs expansion, never bit reinterpretation. */
        fail(BAD_ENUM); return 0;
    }
    Attribute *v = &vaos[vao].a[a]; v->buffer = array; v->count = count; v->type = type;
    v->normalized = integer ? 0 : ARG(3); v->integer = integer;
    v->stride = stride ? stride : count * (type == U8 ? 1 : 4); v->offset = ARG(integer ? 4 : 5); return 0;
}
static uint32_t api_VertexAttribPointer(void) { return attribute(0); }
static uint32_t api_VertexAttribIPointer(void) { return attribute(1); }
static uint32_t api_EnableVertexAttribArray(void) {
    if (ARG(0) >= 16) fail(BAD_VALUE); else if (!vao) fail(BAD_OP); else vaos[vao].a[ARG(0)].enabled = 1;
    return 0;
}
static uint32_t api_DisableVertexAttribArray(void) {
    if (ARG(0) >= 16) fail(BAD_VALUE); else if (!vao) fail(BAD_OP); else vaos[vao].a[ARG(0)].enabled = 0;
    return 0;
}
static uint32_t api_VertexAttribDivisor(void) {
    if (ARG(0) >= 16) fail(BAD_VALUE); else if (!vao) fail(BAD_OP);
    else if (ARG(1) > 1) fail(BAD_VALUE); else vaos[vao].a[ARG(0)].divisor = ARG(1); return 0;
}

static uint32_t api_GenTextures(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) {
        uint32_t id = alloc_name(textures, sizeof(Texture));
        textures[id].min = 0x2702; textures[id].mag = 0x2601; textures[id].u = textures[id].v = 0x2901;
        x86_wr32(ARG(1) + 4 * i, id);
    } return 0;
}
static uint32_t api_ActiveTexture(void) {
    if (ARG(0) < 0x84c0 || ARG(0) >= 0x84c8) fail(BAD_ENUM); else active_unit = ARG(0) - 0x84c0; return 0;
}
static uint32_t api_BindTexture(void) {
    if (ARG(0) != TEXTURE_2D) fail(BAD_ENUM);
    else if (ARG(1) >= N) fail(BAD_VALUE);
    else { uint32_t id = ARG(1); tex[active_unit] = id;
        if (id && !textures[id].used) { textures[id].used = 1; textures[id].min = 0x2702;
            textures[id].mag = 0x2601; textures[id].u = textures[id].v = 0x2901; } } return 0;
}
static uint32_t api_PixelStorei(void) {
    uint32_t key = ARG(0), value = ARG(1);
    if (key == 0xcf5 || key == 0xd05) {
        if (value != 1 && value != 2 && value != 4 && value != 8) fail(BAD_VALUE);
        else if (key == 0xcf5) unpack = value; else pack = value;
    } else if (key == 0xcf2 || key == 0xcf3 || key == 0xcf4) {
        if ((int32_t)value < 0) fail(BAD_VALUE);
        else if (key == 0xcf2) row_length = value; else if (key == 0xcf3) skip_rows = value;
        else skip_pixels = value;
    } else fail(BAD_ENUM); return 0;
}
static uint32_t levels(uint32_t w, uint32_t h) {
    uint32_t n = 1; while (w > 1 || h > 1) { w >>= 1; h >>= 1; n++; } return n;
}
static uint32_t bytes_per(uint32_t format) { return format == 2 ? 1 : format == 3 ? 2 : format == 4 ? 8 : 4; }
static int format_of(uint32_t f) {
    if (f == RGBA || f == 0x8058) return 0; if (f == 0x8c43) return 1;
    if (f == 0x8229 || f == 0x1903) return 2; if (f == 0x822b || f == 0x8227) return 3;
    if (f == 0x881a) return 4; if (f == 0x88f0) return 5; if (f == 0x8cac) return 6;
    return -1;
}
static uint8_t *pixel_data(uint32_t p, uint32_t w, uint32_t h, uint32_t components, uint32_t out_components) {
    uint8_t *data = x86_alloc(w * h * out_components); if (!data) { fail(OOM); return 0; }
    uint32_t row = ((row_length ? row_length : w) * components + unpack - 1) & ~(unpack - 1);
    if (p) p += skip_rows * row + skip_pixels * components;
    for (uint32_t y = 0; y < h; y++) for (uint32_t x = 0; x < w; x++)
        for (uint32_t c = 0; c < out_components; c++)
            data[((h - 1 - y) * w + x) * out_components + c] = !p ? 0 : c < components ?
                x86_rd8(p + y * row + x * components + c) : 255;
    return data;
}
static uint32_t api_TexImage2D(void) {
    uint32_t id = tex[active_unit], mip = ARG(1), w = ARG(3), h = ARG(4), f = ARG(6);
    int fmt = format_of(ARG(2));
    if (ARG(0) != TEXTURE_2D) { fail(BAD_ENUM); return 0; }
    if (!id) { fail(BAD_OP); return 0; }
    if (!w || !h || w > 4096 || h > 4096 || mip > 12 || ARG(5)) { fail(BAD_VALUE); return 0; }
    if (fmt < 0 || (ARG(7) != U8 && ARG(7) != 0x140b) ||
        (f != RGBA && f != 0x1907 && f != 0x1903 && f != 0x8227)) { fail(BAD_ENUM); return 0; }
    if (fmt >= 5 || (fmt == 4) != (ARG(7) == 0x140b)) { fail(BAD_OP); return 0; }
    Texture *t = &textures[id];
    if (!mip) {
        if (t->gpu) SEND(0x45, id);
        t->w = w; t->h = h; t->format = (uint32_t)fmt; t->mips = levels(w, h); t->gpu = id;
        SEND(0x43, id, w, h, t->mips, t->format, 3);
    } else if (!t->gpu || mip >= t->mips || w != (t->w >> mip ? t->w >> mip : 1) ||
        h != (t->h >> mip ? t->h >> mip : 1) || t->format != (uint32_t)fmt) { fail(BAD_VALUE); return 0; }
    uint32_t components = f == RGBA ? 4 : f == 0x1907 ? 3 : f == 0x8227 ? 2 : 1;
    if (ARG(7) == 0x140b) components *= 2;
    uint32_t bpp = bytes_per(t->format); uint8_t *data = pixel_data(ARG(8), w, h, components, bpp);
    if (!data) return 0;
    if (!mip) t->pixels = data;
    SEND(0x44, id, mip, 0, 0, w, h, PTR(data), w * h * bpp); return 0;
}
static uint32_t api_TexSubImage2D(void) {
    uint32_t id = tex[active_unit], mip = ARG(1), x = ARG(2), y = ARG(3), w = ARG(4), h = ARG(5);
    if (ARG(0) != TEXTURE_2D || ARG(6) != RGBA || ARG(7) != U8) { fail(BAD_ENUM); return 0; }
    Texture *t = &textures[id];
    if (mip > 12) { fail(BAD_VALUE); return 0; }
    uint32_t mw = t->w >> mip, mh = t->h >> mip;
    if (!mw) mw = 1; if (!mh) mh = 1;
    if (!id || !t->gpu) { fail(BAD_OP); return 0; }
    if (mip >= t->mips || (uint64_t)x + w > mw || (uint64_t)y + h > mh) { fail(BAD_VALUE); return 0; }
    if (!w || !h) return 0;
    uint8_t *data = pixel_data(ARG(8), w, h, 4, 4); if (!data) return 0;
    if (t->format > 1) { fail(BAD_OP); return 0; }
    if (!mip && t->pixels) for (uint32_t row = 0; row < h; row++)
        copy(t->pixels + ((mh - y - h + row) * t->w + x) * 4, data + row * w * 4, w * 4);
    SEND(0x44, id, mip, x, mh - y - h, w, h, PTR(data), w * h * 4); return 0;
}
static uint32_t api_GenerateMipmap(void) {
    uint32_t id = tex[active_unit]; Texture *t = &textures[id];
    if (ARG(0) != TEXTURE_2D) { fail(BAD_ENUM); return 0; }
    if (!id || !t->gpu || !t->pixels || t->format > 3) { fail(BAD_OP); return 0; }
    uint32_t w = t->w, h = t->h, bpp = bytes_per(t->format); uint8_t *prev = t->pixels;
    for (uint32_t mip = 1; mip < t->mips; mip++) {
        uint32_t nw = w > 1 ? w / 2 : 1, nh = h > 1 ? h / 2 : 1; uint8_t *data = x86_alloc(nw * nh * bpp);
        if (!data) { fail(OOM); return 0; }
        for (uint32_t y = 0; y < nh; y++) for (uint32_t x = 0; x < nw; x++) for (uint32_t c = 0; c < bpp; c++) {
            uint32_t sum = 0;
            for (uint32_t j = 0; j < 2; j++) for (uint32_t i = 0; i < 2; i++) {
                uint32_t sx = x * 2 + i, sy = y * 2 + j; if (sx >= w) sx = w - 1; if (sy >= h) sy = h - 1;
                sum += prev[(sy * w + sx) * bpp + c];
            }
            data[(y * nw + x) * bpp + c] = (uint8_t)(sum / 4);
        }
        SEND(0x44, id, mip, 0, 0, nw, nh, PTR(data), nw * nh * bpp); prev = data; w = nw; h = nh;
    } return 0;
}
static int parameter(uint32_t key, uint32_t v, uint32_t *min, uint32_t *mag, uint32_t *u, uint32_t *w) {
    if (key == 0x2801 && (v == 0x2600 || v == 0x2601 || (v >= 0x2700 && v <= 0x2703))) *min = v;
    else if (key == 0x2800 && (v == 0x2600 || v == 0x2601)) *mag = v;
    else if ((key == 0x2802 || key == 0x2803) && (v == 0x812f || v == 0x2901 || v == 0x8370)) {
        if (key == 0x2802) *u = v; else *w = v;
    } else { fail(BAD_ENUM); return 0; } return 1;
}
static uint32_t api_TexParameteri(void) {
    if (ARG(0) != TEXTURE_2D) fail(BAD_ENUM); else if (!tex[active_unit]) fail(BAD_OP);
    else { Texture *t = &textures[tex[active_unit]]; parameter(ARG(1), ARG(2), &t->min, &t->mag, &t->u, &t->v); }
    return 0;
}
static uint32_t api_GenSamplers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = alloc_name(samplers, sizeof(Sampler));
        samplers[id].min = 0x2702; samplers[id].mag = 0x2601; samplers[id].u = samplers[id].v = 0x2901;
        x86_wr32(ARG(1) + i * 4, id); } return 0;
}
static uint32_t api_BindSampler(void) {
    if (ARG(0) >= 8 || ARG(1) >= N) fail(BAD_VALUE);
    else if (ARG(1) && !samplers[ARG(1)].used) fail(BAD_OP); else samp[ARG(0)] = ARG(1); return 0;
}
static uint32_t api_SamplerParameteri(void) {
    if (!ARG(0) || ARG(0) >= N || !samplers[ARG(0)].used) fail(BAD_OP);
    else { Sampler *s = &samplers[ARG(0)]; parameter(ARG(1), ARG(2), &s->min, &s->mag, &s->u, &s->v); }
    return 0;
}
static uint32_t api_DeleteSamplers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + i * 4);
        if (id && id < N) { samplers[id].used = 0;
            for (uint32_t j = 0; j < 8; j++) if (samp[j] == id) samp[j] = 0; } } return 0;
}
static uint32_t api_DeleteTextures(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + i * 4);
        if (id && id < N) { if (textures[id].gpu) SEND(0x45, id); zero(&textures[id], sizeof(Texture));
            for (uint32_t j = 0; j < 8; j++) if (tex[j] == id) tex[j] = 0; } } return 0;
}

static uint32_t api_GenFramebuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) x86_wr32(ARG(1) + i * 4, alloc_name(fbos, sizeof(Fbo))); return 0;
}
static uint32_t api_BindFramebuffer(void) {
    if (ARG(0) != FRAMEBUFFER) fail(BAD_ENUM); else if (ARG(1) >= N) fail(BAD_VALUE);
    else { fbo = ARG(1); if (fbo) fbos[fbo].used = 1; } return 0;
}
static uint32_t api_FramebufferTexture2D(void) {
    if (ARG(0) != FRAMEBUFFER || ARG(2) != TEXTURE_2D) fail(BAD_ENUM);
    else if (!fbo) fail(BAD_OP); else if (ARG(3) >= N || ARG(4) > 12) fail(BAD_VALUE);
    else if (ARG(1) == 0x8ce0) { fbos[fbo].color = ARG(3); fbos[fbo].mip = ARG(4); }
    else if (ARG(1) == 0x821a || ARG(1) == 0x8d00) { fbos[fbo].depth = ARG(3); fbos[fbo].renderbuffer = 0; }
    else fail(BAD_ENUM); return 0;
}
static uint32_t api_GenRenderbuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) x86_wr32(ARG(1) + i * 4, alloc_name(rbos, sizeof(Rbo))); return 0;
}
static uint32_t api_BindRenderbuffer(void) {
    if (ARG(0) != RENDERBUFFER) fail(BAD_ENUM); else if (ARG(1) >= N) fail(BAD_VALUE);
    else { rbo = ARG(1); if (rbo) rbos[rbo].used = 1; } return 0;
}
static uint32_t api_RenderbufferStorage(void) {
    int format = format_of(ARG(1));
    if (ARG(0) != RENDERBUFFER || format < 5) fail(BAD_ENUM);
    else if (!rbo) fail(BAD_OP);
    else if (!ARG(2) || !ARG(3) || ARG(2) > 4096 || ARG(3) > 4096) fail(BAD_VALUE);
    else { Rbo *r = &rbos[rbo]; if (r->gpu) SEND(0x45, r->gpu);
        r->gpu = 256 + rbo; r->format = (uint32_t)format; r->w = ARG(2); r->h = ARG(3);
        SEND(0x43, r->gpu, r->w, r->h, 1, r->format, 2); } return 0;
}
static uint32_t api_FramebufferRenderbuffer(void) {
    if (ARG(0) != FRAMEBUFFER || ARG(2) != RENDERBUFFER || (ARG(1) != 0x821a && ARG(1) != 0x8d00))
        fail(BAD_ENUM);
    else if (!fbo) fail(BAD_OP); else if (ARG(3) >= N) fail(BAD_VALUE);
    else { fbos[fbo].depth = ARG(3); fbos[fbo].renderbuffer = 1; } return 0;
}
static uint32_t framebuffer_status(void) {
    if (!fbo) return 0x8cd5;
    Fbo *f = &fbos[fbo]; Texture *t = &textures[f->color];
    if (!f->color || !t->gpu) return 0x8cd7;
    if (f->depth) {
        uint32_t w = f->renderbuffer ? rbos[f->depth].w : textures[f->depth].w;
        uint32_t h = f->renderbuffer ? rbos[f->depth].h : textures[f->depth].h;
        if (w != (t->w >> f->mip) || h != (t->h >> f->mip)) return 0x8cd6;
    } return 0x8cd5;
}
static uint32_t api_CheckFramebufferStatus(void) {
    if (ARG(0) != FRAMEBUFFER) { fail(BAD_ENUM); return 0; } return framebuffer_status();
}
static uint32_t api_DeleteFramebuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + i * 4);
        if (id && id < N) { zero(&fbos[id], sizeof(Fbo)); if (fbo == id) fbo = 0; } } return 0;
}
static uint32_t api_DeleteRenderbuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + i * 4);
        if (id && id < N) { if (rbos[id].gpu) SEND(0x45, rbos[id].gpu);
            zero(&rbos[id], sizeof(Rbo)); if (rbo == id) rbo = 0; } } return 0;
}

#include "w32_gl_shader.h"
#include "w32_gl_draw.h"
#include "w32_gl_query.h"

#define API(name, fn, nargs, mutates) \
    static uint32_t call_##fn(void) { \
        w32_gl_calls++; \
        if (eq(name, "glGetError")) return api_##fn(); \
        uint32_t pending = error; error = 0; uint32_t result = api_##fn(); \
        if (!error) w32_gl_state_changes += mutates; \
        if (pending) error = pending; return result; \
    }
#define GLSTUB(name, fn, nargs, mutates) \
    static uint32_t call_##fn(void) { w32_gl_calls++; missing(name); fail(BAD_OP); return 0; }
#include "w32_gl_api.h"
#undef API
#undef GLSTUB
#define API(name, fn, nargs, mutates) {name, nargs, 0, call_##fn},
#define GLSTUB API
const w32_api_t w32_api_gl[] = {
#include "w32_gl_api.h"
};
#undef API
#undef GLSTUB
const uint32_t w32_api_gl_n = sizeof w32_api_gl / sizeof w32_api_gl[0];
