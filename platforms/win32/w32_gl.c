/* OpenGL 3.3 -> BGT §13. Engine-independent, bounded profile. SPDX-License-Identifier: MIT — LANE-GL */
#include "w32_gl.h"
/* Deterministic test work census; compiled out of production hot paths. */
#ifdef W32_GL_TEST_WORK
static uint32_t gl_test_work;
#define GL_WORK() (++gl_test_work)
#else
#define GL_WORK() ((void)0)
#endif

/* ABI §13.1: bounded live objects, NOT a bound on GLuint values. Slot zero is default state. */
/* Test-only demand probe: never an ABI promise. Real transport still validates its caps. */
#ifndef W32_GL_TEST_CAPACITY
#define W32_GL_TEST_CAPACITY BGT_GPU_LIMIT_HANDLES
#endif
#define GPU_MAX W32_GL_TEST_CAPACITY
#define N (W32_GL_TEST_CAPACITY + 1u)
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
#define FEEDBACK_BUFFER 0x8c8eu
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
static void *glp_alloc(uint32_t n);
static void glp_free(void *p, uint32_t n);
static void *guest(uint32_t p, uint32_t n) {
    uint8_t *v = glp_alloc(n ? n : 1);
    if (!v) { fail(OOM); return 0; }
    for (uint32_t i = 0; i < n; i++) v[i] = p ? x86_rd8(p + i) : 0;
    return v;
}
static void begin(void) { bgt_cmd_init(&cmd, cmd_mem, sizeof cmd_mem); }
static void op(uint32_t code, const uint32_t *w, uint32_t n) {
    bgt__gpu_copy(bgt_cmd_push(&cmd, (uint16_t)code, n * 4), w, n * 4);
}
static int flush_padded_cleanup(void);
static int submit(void) {
    if (!flush_padded_cleanup()) { bgt_cmd_reset(&cmd); return 0; }
    /* Keep immediate validation/owned uploads and exact ordering. Only GPU-only lists opt into
     * §13.12's bounded aggregate budget; legacy screen readback retains its frozen header. */
    uint16_t flags = BGT_CMD_GPU_CONTINUATION;
    for (uint32_t off = 16; off < cmd.len;) {
        uint32_t code = cmd.buf[off] | ((uint32_t)cmd.buf[off + 1] << 8), size;
        copy(&size, cmd.buf + off + 4, 4);
        if (code < 0x40 || code > 0x64) flags = 0;
        off += 8 + size;
    }
    int32_t rc = bgt_cmd_submit_flags(&cmd, flags);
    if (rc < 0) { fail(rc == -3 ? OOM : BAD_OP); return 0; }
    return 1;
}
/* Track accepted wire generations, including private resources. Private reservations are kept
 * even while unmaterialized: textures900..921; buffers1000..1006 and1023. */
static uint8_t gpu_texture[N], gpu_buffer_initial[N], gpu_shader[N], gpu_pipeline[N];
static uint8_t *gpu_buffer = gpu_buffer_initial;
static uint32_t buffer_wire_slots = N, buffer_handles_enabled, buffer_next_free = 1;
static int send(uint32_t code, const uint32_t *w, uint32_t n) {
    begin(); op(code, w, n); int ok = submit();
    if (ok && n && w[0] && w[0] < buffer_wire_slots && (code == 0x40 || code == 0x42)) {
        gpu_buffer[w[0]] = code == 0x40;
        if (code == 0x42 && w[0] < buffer_next_free) buffer_next_free = w[0];
    }
    if (ok && n && w[0] && w[0] < N) {
        if (code == 0x43 || code == 0x59 || code == 0x45) gpu_texture[w[0]] = code != 0x45;
        if (code == 0x48 || code == 0x49) gpu_shader[w[0]] = code == 0x48;
        if (code == 0x4a || code == 0x4b) gpu_pipeline[w[0]] = code == 0x4a;
    }
    return ok;
}
#define SEND(code, ...) do { \
    const uint32_t payload[] = {__VA_ARGS__}; send(code, payload, sizeof payload / 4); \
} while (0)
static int wait_request(uint32_t id, char *log, uint32_t cap) {
    int status;
    while ((status = bgt_request_status(id)) == 0) w32_wait_frame();
    uint8_t result[4096] = {0};
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

typedef struct { uint32_t used, size, gpu, generated; uint8_t *data;
    uint32_t map, map_offset, map_size, map_flags, map_access, bound, vao_refs, collect_next, collect_queued; } Buffer;
static void approximate(const char *kind);
static void unmap_storage(Buffer *b);
typedef struct { uint32_t enabled, buffer, count, type, normalized, stride, offset, divisor, integer; } Attribute;
typedef struct { uint32_t used, element, bound; Attribute a[16]; } Vao;
#include "w32_gl_program.h" /* K6b frontend; K6a texture/FBO objects live in their own headers. */
static Buffer buffers_initial[N]; static Vao vaos_initial[N];
static Buffer *buffers = buffers_initial; static Vao *vaos = vaos_initial;
static uint32_t buffer_slots = N, vao_slots = N;
#define BN buffer_slots
#define VN vao_slots
/* Generic current values belong to the context, not the VAO (GL 3.3 §2.8). */
static float current_attr[16][4]; static uint32_t current_attr_ready;
static void init_current_attr(void) {
    if (!current_attr_ready) { for (uint32_t i = 0; i < 16; i++) current_attr[i][3] = 1; current_attr_ready = 1; }
}
static uint32_t current_attribute(uint32_t n, int vector) {
    uint32_t index = ARG(0); if (index >= 16) { fail(BAD_VALUE); return 0; }
    init_current_attr();
    for (uint32_t i = 0; i < 4; i++) {
        union { uint32_t u; float f; } v = {vector && i < n ? x86_rd32(ARG(1) + 4 * i) : 0};
        current_attr[index][i] = i < n ? (vector ? v.f : argf(i + 1)) : i == 3 ? 1.0f : 0.0f;
    }
    return 0;
}
#define CURRENT_ATTR(n) \
    static uint32_t api_VertexAttrib##n##f(void) { return current_attribute(n, 0); } \
    static uint32_t api_VertexAttrib##n##fv(void) { return current_attribute(n, 1); }
CURRENT_ATTR(1) CURRENT_ATTR(2) CURRENT_ATTR(3) CURRENT_ATTR(4)
#undef CURRENT_ATTR
static Shader shaders[N]; static Program programs[N];
static uint32_t vao, array, uniform, ubo[8], ubo_offset[8], ubo_size[8], active_unit, samp[8];
static uint32_t current_gpu, current_capacity; static uint32_t *current_data;
static uint32_t ubo_whole[8], padded_ubo[7], padded_ubo_size[7], padded_generated[7], padded_cleanup[7];
/* Retire generated private temporaries even when materialization or a later submission fails.
 * If the aggregate wire budget is exhausted, retry before the next public submission: a source
 * cannot be successfully deleted/reuploaded while an inaccessible generated temporary remains. */
static int flush_padded_cleanup(void) {
    uint32_t storage[25]; bgt_cmdbuf_t cleanup; bgt_cmd_init(&cleanup, storage, sizeof storage);
    for (uint32_t i = 0; i < 7; i++) if (padded_cleanup[i]) {
        uint8_t *payload = bgt_cmd_push(&cleanup, 0x42, 4); bgt__gpu_copy(payload, &padded_ubo[i], 4);
    }
    if (!cleanup.count) return 1;
    int32_t rc = bgt_cmd_submit_flags(&cleanup, BGT_CMD_GPU_CONTINUATION);
    if (rc < 0) { fail(rc == -3 ? OOM : BAD_OP); return 0; }
    for (uint32_t i = 0; i < 7; i++) if (padded_cleanup[i])
        padded_ubo[i] = padded_ubo_size[i] = padded_generated[i] = padded_cleanup[i] = 0;
    return 1;
}
static void retire_generated_ubos(void) {
    for (uint32_t i = 0; i < 7; i++) if (padded_generated[i]) padded_cleanup[i] = 1;
    flush_padded_cleanup();
}
static uint32_t copy_read, copy_write, pixel_pack, pixel_unpack, texture_buffer;
static uint32_t program;
static uint32_t tf_buffer, tf_active, tf_mode, rasterizer_discard;
static uint32_t tf_bound[4], tf_offset[4], tf_size[4], tf_whole[4], tf_cursor[4];
typedef struct { uint32_t used, target, active, result; } GlQuery;
static GlQuery gl_queries[N]; static uint32_t tf_query;
static uint32_t blend, depth, stencil, cull, scissor_enabled;
static uint32_t cull_face = 2, front_face, depth_write = 1, depth_compare = 1;
static uint32_t src_rgb = 1, dst_rgb, src_alpha = 1, dst_alpha, blend_op_rgb, blend_op_alpha;
static uint32_t stencil_compare = 7, stencil_read = 255, stencil_write = 255, stencil_ref;
static uint32_t stencil_fail, stencil_zfail, stencil_pass, color_mask = 15, color_masks[4] = {15, 15, 15, 15};
static float clear_color[4], clear_depth = 1, blend_color[4]; static uint32_t clear_stencil;
static int32_t viewport[4], scissor[4]; static float range_min, range_max = 1;
typedef struct { uint32_t used, n, words[200], id, hash; } Pipeline;
static Pipeline pipelines[128]; static uint32_t pipeline_count;
/* Retired buffers enter a work list only on deletion or the final VAO detach.
 * A retained generation does not cause a capacity scan on every unrelated GL call. */
static uint32_t retired_buffer_head, image_collection_dirty;
static void queue_retired_buffer(uint32_t slot) {
    if (!buffers[slot].collect_queued) {
        buffers[slot].collect_next = retired_buffer_head; buffers[slot].collect_queued = 1;
        retired_buffer_head = slot;
    }
}
#include "w32_gl_names.h"
static void buffer_unref(uint32_t slot) {
    if (slot && !--buffers[slot].vao_refs && gl_retired && OBJECTS(buffers)->retired[slot]) queue_retired_buffer(slot);
}
/* Abandoned wire generations stay occupied until their destroy is accepted. This also
 * covers relink snapshots which no longer have a guest object owner. */
static uint8_t abandoned_buffer_initial[N], abandoned_shader[N], abandoned_pipeline[N];
static uint8_t *abandoned_buffer = abandoned_buffer_initial;
static uint32_t abandoned_buffers, abandoned_shaders, abandoned_pipelines;
static int cleanup_send(const char *kind, uint32_t code, uint32_t handle) {
    uint32_t pending = error; error = 0; int ok = send(code, &handle, 1);
    if (!ok && error == OOM) object_exhaustion(kind, "GPU resource retirement budget", 1);
    if (pending) error = pending;
    return ok;
}
static void release_wire(uint32_t code, uint32_t handle, const char *kind) {
    if (!handle) return;
    uint8_t *pending = code == 0x42 ? abandoned_buffer : code == 0x49 ? abandoned_shader : abandoned_pipeline;
    uint32_t *count = code == 0x42 ? &abandoned_buffers : code == 0x49 ? &abandoned_shaders : &abandoned_pipelines;
    if (pending[handle]) (*count)--;
    pending[handle] = cleanup_send(kind, code, handle) ? 0 : eq(kind, "shaders") ? 1 : 2;
    if (pending[handle]) (*count)++;
}
static void collect_wire(void) {
    for (uint32_t h = 1; abandoned_buffers && h < buffer_wire_slots; h++)
        if ((GL_WORK(), abandoned_buffer[h]) && cleanup_send("programs", 0x42, h)) { abandoned_buffer[h] = 0; abandoned_buffers--; }
    for (uint32_t h = 1; (abandoned_shaders || abandoned_pipelines) && h < N; h++) {
        GL_WORK();
        if (abandoned_shader[h] && cleanup_send(abandoned_shader[h] == 1 ? "shaders" : "programs", 0x49, h)) { abandoned_shader[h] = 0; abandoned_shaders--; }
        if (abandoned_pipeline[h] && cleanup_send("programs", 0x4b, h)) { abandoned_pipeline[h] = 0; abandoned_pipelines--; }
    }
}
static uint32_t buffer_handle(uint32_t preferred, const char *kind) {
    if (preferred && preferred <= GPU_MAX && !(preferred >= 1000 && preferred <= 1006) &&
        preferred != 1023 && !gpu_buffer[preferred]) return preferred;
    /* Lowest-free high-water cursor: identical handle choices, but each occupied
     * entry is skipped once, not once per creation (quadratic at game scale).
     * Only an accepted destroy rewinds it; failed creates remain retryable. */
    uint32_t limit = buffer_handles_enabled ? buffer_wire_slots : N;
    while (buffer_next_free < limit && (gpu_buffer[buffer_next_free] ||
        (buffer_next_free >= 1000 && buffer_next_free <= 1006) || buffer_next_free == 1023)) {
        GL_WORK(); buffer_next_free++;
    }
    if (buffer_next_free < limit) return buffer_next_free;
    if (buffer_handles_enabled) {
        if (buffer_wire_slots <= UINT32_MAX / 4u) {
            uint32_t cap = buffer_wire_slots * 2u;
            uint8_t *p = glp_alloc(cap * 2u);
            if (p) {
                zero(p, cap * 2u); copy(p, gpu_buffer, buffer_wire_slots);
                copy(p + cap, abandoned_buffer, buffer_wire_slots);
                if (gpu_buffer != gpu_buffer_initial) glp_free(gpu_buffer, buffer_wire_slots * 2u);
                uint32_t h = buffer_wire_slots; gpu_buffer = p; abandoned_buffer = p + cap; buffer_wire_slots = cap; return h;
            }
        }
        object_exhaustion(kind, "GPU buffer ownership memory", 1); return 0;
    }
    object_exhaustion(kind, "GPU buffer handles (capability not negotiated)", 1); return 0;
}
static Buffer *bound_buffer(uint32_t target) {
    uint32_t id = target == ARRAY_BUFFER ? array : target == ELEMENT_BUFFER ? vaos[vao].element :
        target == UNIFORM_BUFFER ? uniform : target == FEEDBACK_BUFFER ? tf_buffer :
        target == 0x8f36 ? copy_read : target == 0x8f37 ? copy_write : target == 0x88eb ? pixel_pack :
        target == 0x88ec ? pixel_unpack : target == 0x8c2a ? texture_buffer : 0;
    if (target != ARRAY_BUFFER && target != ELEMENT_BUFFER && target != UNIFORM_BUFFER && target != FEEDBACK_BUFFER &&
        target != 0x8f36 && target != 0x8f37 && target != 0x88eb && target != 0x88ec && target != 0x8c2a) fail(BAD_ENUM);
    else if (!id || id >= BN || !buffers[id].used) fail(BAD_OP);
    return id && id < BN && buffers[id].used ? &buffers[id] : 0;
}
static uint32_t api_GenBuffers(void) {
    GEN_CHECK(buffers); int32_t n = (int32_t)ARG(0);
    for (int32_t i = 0; i < n; i++) x86_wr32(ARG(1) + 4 * i, NAME(buffers, alloc_name(buffers, sizeof(Buffer))));
    return 0;
}
/* Reviewer #136: Windows default-element storage survives even a core VAO-0 bind.
 * Only element state is VAO-owned; the other eight targets already work without a VAO.
 * Attribute setup and draws retain core errors: no supplied vendor evidence for those. */
static void default_element_compat(uint32_t target, const char *kind) {
    if (!vao && target == ELEMENT_BUFFER) approximate(kind);
}
static uint32_t api_BindBuffer(void) {
    uint32_t target = ARG(0), id = ARG(1);
    if (target != ARRAY_BUFFER && target != ELEMENT_BUFFER && target != UNIFORM_BUFFER && target != FEEDBACK_BUFFER &&
        target != 0x8f36 && target != 0x8f37 && target != 0x88eb && target != 0x88ec && target != 0x8c2a) { fail(BAD_ENUM); return 0; }
    id = BIND(buffers, id); if (id >= BN) return 0;
    if (id) buffers[id].bound = 1;
    if (target == ARRAY_BUFFER) array = id;
    else if (target == ELEMENT_BUFFER) {
        buffer_unref(vaos[vao].element);
        vaos[vao].element = id; if (id) buffers[id].vao_refs++;
    }
    else if (target == UNIFORM_BUFFER) uniform = id;
    else if (target == FEEDBACK_BUFFER) tf_buffer = id;
    else if (target == 0x8f36) copy_read = id;
    else if (target == 0x8f37) copy_write = id;
    else if (target == 0x88eb) pixel_pack = id;
    else if (target == 0x88ec) pixel_unpack = id;
    else if (target == 0x8c2a) texture_buffer = id;
    else { fail(target == ELEMENT_BUFFER ? BAD_OP : BAD_ENUM); return 0; }

    default_element_compat(target, "core VAO 0 element-buffer binding"); return 0;
}
static uint32_t api_BufferData(void) {
    Buffer *b = bound_buffer(ARG(0)); int64_t size = (int64_t)ARG64(1);
    if (!b) return 0;
    if (size <= 0 || size > 67108864) { fail(BAD_VALUE); return 0; }
    if (tf_active) for (uint32_t i = 0; i < 4; i++) if (tf_bound[i] == (uint32_t)(b - buffers)) { fail(BAD_OP); return 0; }
    uint8_t *data = guest(ARG(2), (uint32_t)size); if (!data) return 0;
    uint32_t id = b->gpu;
    if (b->gpu && !send(0x42, &id, 1)) { glp_free(data, (uint32_t)size); return 0; }
    /* BufferData replaces the store and resets mapping state (GL3.3 table 2.10). */
    unmap_storage(b); b->map_access = 0x88ba;
    glp_free(b->data, b->size); b->data = 0;
    b->gpu = 0; b->size = 0; b->generated = 0;
    id = buffer_handle((uint32_t)(b - buffers) < 256 ? (uint32_t)(b - buffers) : 0, "buffers");
    if (!id) { glp_free(data, (uint32_t)size); return 0; }
    uint32_t create[] = {id, 15, (uint32_t)size, PTR(data), (uint32_t)size};
    if (!send(0x40, create, 5)) { if (error == OOM) object_exhaustion("buffers", "GPU byte/submission budget", 1); glp_free(data, (uint32_t)size); return 0; }
    b->gpu = id; b->size = (uint32_t)size; b->data = data;
    default_element_compat(ARG(0), "core VAO 0 element-buffer data upload"); return 0;
}
static uint32_t api_BufferSubData(void) {
    Buffer *b = bound_buffer(ARG(0)); uint64_t off = ARG64(1), n = ARG64(2);
    if (!b) return 0;
    if (b->map) { fail(BAD_OP); return 0; }
    if (off + n < off || off + n > b->size) { fail(BAD_VALUE); return 0; }
    if (tf_active) for (uint32_t i = 0; i < 4; i++) if (tf_bound[i] == (uint32_t)(b - buffers)) { fail(BAD_OP); return 0; }
    if (b->generated && ((off & 3) || (n & 3)) && (off || n != b->size)) { fail(BAD_OP); return 0; }
    if (n) {
        uint8_t *data = glp_alloc((uint32_t)n); if (!data) { fail(OOM); return 0; }
        for (uint32_t i = 0; i < n; i++) data[i] = x86_rd8(ARG(3) + i);
        uint32_t w[] = {b->gpu, (uint32_t)off, PTR(data), (uint32_t)n}; int accepted = send(0x41, w, 4);
        if (accepted) copy(b->data + off, data, (uint32_t)n);
        glp_free(data, (uint32_t)n); if (!accepted) return 0;
    }
    if (!off && n == b->size) b->generated = 0;
    default_element_compat(ARG(0), "core VAO 0 element-buffer sub-data upload"); return 0;
}
static uint32_t api_CopyBufferSubData(void) {
    Buffer *src = bound_buffer(ARG(0)), *dst = bound_buffer(ARG(1));
    int64_t so = (int64_t)ARG64(2), off = (int64_t)ARG64(3), size = (int64_t)ARG64(4);
    if (!src || !dst) return 0;
    if (src->map || dst->map) { fail(BAD_OP); return 0; }
    if (so < 0 || off < 0 || size < 0 || (uint64_t)so > src->size || (uint64_t)off > dst->size ||
        (uint64_t)size > src->size - (uint64_t)so || (uint64_t)size > dst->size - (uint64_t)off ||
        (src == dst && so < off + size && off < so + size)) { fail(BAD_VALUE); return 0; }
    if (tf_active) for (uint32_t i = 0; i < 4; i++) if (tf_bound[i] == (uint32_t)(src - buffers) ||
        tf_bound[i] == (uint32_t)(dst - buffers)) { fail(BAD_OP); return 0; }
    if (!size) return 0;
    uint32_t w[] = {src->gpu, (uint32_t)so, dst->gpu, (uint32_t)off, (uint32_t)size};
    if (send(0x64, w, 5)) {
        copy(dst->data + off, src->data + so, (uint32_t)size);
        if (src->generated) dst->generated = 1; else if (!off && (uint64_t)size == dst->size) dst->generated = 0;
    }
    return 0;
}
static void collect_deleted(void);
static uint32_t api_DeleteBuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) {
        uint32_t id = SLOT(buffers, x86_rd32(ARG(1) + 4 * i)); if (!id || id >= BN) continue;
        if (tf_active) { int bound = 0; for (uint32_t j = 0; j < 4; j++) if (tf_bound[j] == id) bound = 1;
            if (bound) { fail(BAD_OP); continue; } }
        uint32_t local = vaos[vao].element == id;
        for (uint32_t a = 0; a < 16; a++) local += vaos[vao].a[a].buffer == id;
        int retained = buffers[id].vao_refs > local;
        if (!retained && buffers[id].gpu) {
            if (!send(0x42, &buffers[id].gpu, 1)) continue;
            buffers[id].gpu = 0;
        }
        retire_name(OBJECTS(buffers), id);
        if (array == id) array = 0;
        if (uniform == id) uniform = 0;
        { uint32_t j = vao;
            if (vaos[j].element == id) { vaos[j].element = 0; buffer_unref(id); }
            for (uint32_t a = 0; a < 16; a++) if (vaos[j].a[a].buffer == id) { vaos[j].a[a].buffer = 0; buffer_unref(id); }
        }
        for (uint32_t j = 0; j < 8; j++) if (ubo[j] == id) ubo[j] = 0;
        if (tf_buffer == id) tf_buffer = 0;
        if (copy_read == id) copy_read = 0; if (copy_write == id) copy_write = 0;
        if (pixel_pack == id) pixel_pack = 0; if (pixel_unpack == id) pixel_unpack = 0;
        if (texture_buffer == id) texture_buffer = 0;
        for (uint32_t j = 0; j < 4; j++) if (tf_bound[j] == id) tf_bound[j] = 0;
    } collect_deleted(); return 0;
}
static uint32_t api_BindBufferBase(void) {
    if (ARG(0) == FEEDBACK_BUFFER) {
        uint32_t s = ARG(1);
        if (s >= 4) { fail(BAD_VALUE); return 0; }
        if (tf_active) { fail(BAD_OP); return 0; }
        uint32_t id = BIND(buffers, ARG(2)); if (id >= BN) return 0;

        if (id) buffers[id].bound = 1;
        tf_buffer = tf_bound[s] = id; tf_offset[s] = 0; tf_whole[s] = 1; tf_size[s] = buffers[id].size; return 0;
    }
    if (ARG(0) != UNIFORM_BUFFER) { fail(BAD_ENUM); return 0; }
    if (ARG(1) >= 8) { fail(BAD_VALUE); return 0; }
    uint32_t s = ARG(1), id = BIND(buffers, ARG(2)); if (id >= BN) return 0; if (id) buffers[id].bound = 1; uniform = id; ubo[s] = id; ubo_offset[s] = 0;

    ubo_whole[s] = 1; ubo_size[s] = buffers[id].size; return 0;
}
static uint32_t api_BindBufferRange(void) {
    if (ARG(0) == FEEDBACK_BUFFER) {
        uint32_t s = ARG(1), id = SLOT(buffers, ARG(2)); int64_t off = (int64_t)ARG64(3), size = (int64_t)ARG64(4);
        if (s >= 4 || id >= BN) { fail(BAD_VALUE); return 0; }
        if (tf_active) { fail(BAD_OP); return 0; }
        if (id && (off < 0 || size <= 0 || (off & 3) || (size & 3) || (uint64_t)off + (uint64_t)size > buffers[id].size)) { fail(BAD_VALUE); return 0; }

        tf_buffer = tf_bound[s] = id; tf_offset[s] = id ? (uint32_t)off : 0; tf_size[s] = id ? (uint32_t)size : 0; tf_whole[s] = 0; return 0;
    }
    if (ARG(0) != UNIFORM_BUFFER) { fail(BAD_ENUM); return 0; }
    uint32_t s = ARG(1), id = SLOT(buffers, ARG(2)); int64_t off = (int64_t)ARG64(3), size = (int64_t)ARG64(4);
    if (s >= 8 || id >= BN || (id && (off < 0 || size <= 0 || (off & 255) ||
        (uint64_t)off > buffers[id].size || (uint64_t)size > buffers[id].size - (uint64_t)off))) {
        fail(BAD_VALUE); return 0;
    }

    uniform = id; ubo[s] = id; ubo_offset[s] = id ? (uint32_t)off : 0;
    ubo_size[s] = id ? (uint32_t)size : 0; ubo_whole[s] = 0; return 0;
}
static uint32_t api_GenVertexArrays(void) {
    GEN_CHECK(vaos);
    for (uint32_t i = 0; i < ARG(0); i++) x86_wr32(ARG(1) + 4 * i, NAME(vaos, alloc_name(vaos, sizeof(Vao))));
    return 0;
}
static uint32_t api_BindVertexArray(void) {
    uint32_t id = SLOT(vaos, ARG(0));
    if (id >= VN) { fail(BAD_OP); return 0; }
    vao = id; if (id) vaos[id].bound = 1; return 0;
}
static uint32_t api_DeleteVertexArrays(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = SLOT(vaos, x86_rd32(ARG(1) + i * 4));
        if (id && id < VN) {
            buffer_unref(vaos[id].element);
            for (uint32_t a = 0; a < 16; a++) buffer_unref(vaos[id].a[a].buffer);
            erase_name(OBJECTS(vaos), id); if (vao == id) vao = 0;
        } } return 0;
}
static uint32_t attribute(int integer) {
    uint32_t a = ARG(0), count = ARG(1), type = ARG(2), stride = ARG(integer ? 3 : 4);
    if (a >= 16 || count < 1 || count > 4 || stride > 2048) { fail(BAD_VALUE); return 0; }
    if (!vao || !array) { fail(BAD_OP); return 0; }
    if (integer ? (type != U32 && type != 0x1404) :
        (type != F32 && !(type == U8 && count == 4 && (ARG(3) & 255)))) {
        /* Numeric conversion of other GL vertex formats needs expansion, never bit reinterpretation. */
        fail(BAD_ENUM); return 0;
    }
    Attribute *v = &vaos[vao].a[a];
    buffer_unref(v->buffer);
    buffers[array].vao_refs++; v->buffer = array; v->count = count; v->type = type;
    v->normalized = integer ? 0 : (ARG(3) & 255); v->integer = integer;
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
static void ensure_current_buffer(uint32_t instances) {
    init_current_attr(); if (!instances) instances = 1;
    if (instances > current_capacity) {
        uint32_t capacity = 1; while (capacity < instances) capacity *= 2;
        uint32_t *data = (uint32_t *)glp_alloc(capacity * 256u);
        if (!data) { fail(OOM); return; }
        if (current_gpu) SEND(0x42, current_gpu);
        glp_free(current_data, current_capacity * 256u); current_data = data; current_capacity = capacity;
        /* Private current-attribute handle, excluded from the shared public/uniform pool. */
        current_gpu = 1023;
        SEND(0x40, current_gpu, 1, capacity * 256u, 0, 0);
        if (error) {
            glp_free(current_data, current_capacity * 256u); current_data = 0;
            current_gpu = current_capacity = 0; return;
        }
    }
    for (uint32_t n = 0; n < instances; n++) for (uint32_t i = 0; i < 16; i++) for (uint32_t j = 0; j < 4; j++)
        current_data[n * 64 + i * 4 + j] = bits(current_attr[i][j]);
    SEND(0x41, current_gpu, 0, PTR(current_data), instances * 256u);
}
static uint32_t api_VertexAttribDivisor(void) {
    if (ARG(0) >= 16) fail(BAD_VALUE); else if (!vao) fail(BAD_OP);
    else if (ARG(1) > 1) fail(BAD_VALUE); else vaos[vao].a[ARG(0)].divisor = ARG(1); return 0;
}

#include "w32_gl_buffer.h"
#include "w32_gl_fmt.h"
static uint32_t texture_handle(uint32_t preferred, const char *kind) {
    if (preferred && preferred <= GPU_MAX && !(preferred >= 900 && preferred <= 921) && !gpu_texture[preferred]) return preferred;
    for (uint32_t h = 1; h <= GPU_MAX; h++) if (!(h >= 900 && h <= 921) && !gpu_texture[h]) return h;
    object_exhaustion(kind, "GPU texture handles", 1); return 0;
}
#include "w32_gl_tex.h"
#include "w32_gl_fbo.h"

#include "w32_gl_feedback.h"
#include "w32_gl_shader.h"
#include "w32_gl_draw.h"
#include "w32_gl_query.h"

static void init_objects(void) {
    OBJECTS(textures); OBJECTS(buffers); OBJECTS(vaos); OBJECTS(fbos); OBJECTS(rbos);
    OBJECTS(samplers); OBJECTS(gl_queries); OBJECTS(shaders); OBJECTS(programs);
}

/* Deleted names are reusable immediately; unbound container references retain the old
 * object/handle generation until detached. Slots are never reused underneath an attachment. */
static int attached_image(uint32_t type, uint32_t id) {
    for (uint32_t f = 1; f < N; f++) if (fbos[f].used) {
        Fbo *p = &fbos[f];
        for (uint32_t c = 0; c < 4; c++) if (p->color[c].type == type && p->color[c].name == id) return 1;
        if ((p->depth.type == type && p->depth.name == id) || (p->stencil.type == type && p->stencil.name == id)) return 1;
    }
    return 0;
}
/* Retirement is cold work. Sort only its candidates (not the live namespace),
 * preserving the historical ascending-slot destroy stream without allocating. */
static uint32_t sort_retired_buffers(uint32_t head) {
    if (!head || !buffers[head].collect_next) return head;
    uint32_t slow = head, fast = buffers[head].collect_next;
    while (fast && buffers[fast].collect_next) {
        slow = buffers[slow].collect_next; fast = buffers[buffers[fast].collect_next].collect_next;
    }
    uint32_t right = buffers[slow].collect_next; buffers[slow].collect_next = 0;
    uint32_t a = sort_retired_buffers(head), b = sort_retired_buffers(right), result = 0, *tail = &result;
    while (a || b) {
        uint32_t next;
        if (!b || (a && a < b)) { next = a; a = buffers[a].collect_next; }
        else { next = b; b = buffers[b].collect_next; }
        *tail = next; tail = &buffers[next].collect_next;
    }
    *tail = 0; return result;
}
static void collect_deleted(void) {
    if (!gl_retired) return;
    /* Detach the candidate list: rejected destroys retry on the next call, not in
     * an infinite loop here. Slot links survive table relocation. */
    uint32_t candidate = sort_retired_buffers(retired_buffer_head); retired_buffer_head = 0;
    while (candidate) {
        GL_WORK();
        uint32_t id = candidate; candidate = buffers[id].collect_next;
        buffers[id].collect_next = buffers[id].collect_queued = 0;
        if (buffers[id].vao_refs) continue;
        if (buffers[id].gpu && !cleanup_send("buffers", 0x42, buffers[id].gpu)) { queue_retired_buffer(id); continue; }
        unmap_storage(&buffers[id]); glp_free(buffers[id].data, buffers[id].size);
        erase_name(OBJECTS(buffers), id);
    }
    if (!image_collection_dirty) return;
    image_collection_dirty = 0;
    GlObjects *to = OBJECTS(textures), *ro = OBJECTS(rbos);
    for (uint32_t id = 1; id < N; id++) {
        GL_WORK();
        if (to->retired[id] && !attached_image(1, id)) {
            if (textures[id].gpu && !cleanup_send("textures", 0x45, textures[id].gpu)) image_collection_dirty = 1;
            else { zero(&textures[id], sizeof(Texture)); to->retired[id] = 0; gl_retired--; }
        }
        if (ro->retired[id] && !attached_image(2, id)) {
            if (rbos[id].gpu && !cleanup_send("rbos", 0x45, rbos[id].gpu)) image_collection_dirty = 1;
            else { zero(&rbos[id], sizeof(Rbo)); ro->retired[id] = 0; gl_retired--; }
        }
    }
}
static int object_entry(const char *name, const char *part) {
    for (; *name; name++) { const char *a = name, *b = part; while (*b && *a == *b) { a++; b++; } if (!*b) return 1; }
    return 0;
}
static const char *entry_objects(const char *name) {
    if (object_entry(name, "Renderbuffer")) { OBJECTS(rbos); return "rbos"; }
    if (object_entry(name, "Framebuffer")) { OBJECTS(fbos); return "fbos"; }
    if (object_entry(name, "Tex")) { OBJECTS(textures); return "textures"; }
    if (object_entry(name, "Buffer")) { OBJECTS(buffers); return "buffers"; }
    if (object_entry(name, "Sampler")) { OBJECTS(samplers); return "samplers"; }
    if (object_entry(name, "VertexArray")) { OBJECTS(vaos); return "vaos"; }
    if (object_entry(name, "Shader")) { OBJECTS(shaders); return "shaders"; }
    if (object_entry(name, "Quer")) { OBJECTS(gl_queries); return "gl_queries"; }
    OBJECTS(programs); return "programs";
}
#define API(name, fn, nargs, mutates) \
    static uint32_t call_##fn(void) { \
        w32_gl_calls++; \
        if (eq(name, "glGetError")) return api_##fn(); \
        uint32_t pending = error, exhaustion_before = gl_exhaustion_events; error = 0; \
        int protects_source = eq(name, "glBufferData") || eq(name, "glBufferSubData") || \
            eq(name, "glDeleteBuffers") || eq(name, "glCopyBufferSubData") || \
            eq(name, "glUnmapBuffer") || eq(name, "glFlushMappedBufferRange"); \
        uint32_t result = (!protects_source || flush_padded_cleanup()) ? api_##fn() : 0; \
        collect_deleted(); collect_wire(); \
        if (error == OOM && exhaustion_before == gl_exhaustion_events) \
            object_exhaustion(entry_objects(name), "host/GPU byte or submission budget", 1); \
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
