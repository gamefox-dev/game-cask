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
uint64_t w32_gl_calls, w32_gl_draws, w32_gl_state_changes, w32_gl_pipelines, w32_gl_unimplemented,
    w32_gl_approximations;
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
#include "w32_gl_program.h" /* K6b frontend; K6a texture/FBO objects live in their own headers. */
static Buffer buffers[N]; static Vao vaos[N];
static Shader shaders[N]; static Program programs[N];
static uint32_t vao, array, uniform, ubo[8], ubo_offset[8], ubo_size[8], active_unit, samp[8];
static uint32_t ubo_whole[8];
static uint32_t program;
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

#include "w32_gl_fmt.h"
#include "w32_gl_tex.h"
#include "w32_gl_fbo.h"

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
