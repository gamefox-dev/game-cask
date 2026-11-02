/* Shader/program object types and reusable host storage for the GLSL frontend.
 * Included once by w32_gl.c. SPDX-License-Identifier: MIT */
/* All backing comes from x86_alloc: no libc heap, guest address space or extra reservation.
 * Address-ordered free spans split/coalesce (including adjacent growth extents); mixed shader
 * sizes must not strand free memory in power-of-two size classes. Headers remain 16-byte aligned. */
typedef union GlpBlock GlpBlock;
union GlpBlock { struct { GlpBlock *next; uint32_t size; } h; uint64_t alignment[2]; };
static GlpBlock *glp_pool;
uint64_t w32_gl_frontend_bytes, w32_gl_frontend_peak, w32_gl_frontend_reserved;
uint64_t w32_gl_frontend_allocations, w32_gl_frontend_frees, w32_gl_frontend_oom;
static void glp_insert(GlpBlock *b) {
    GlpBlock **p = &glp_pool, *prev = 0;
    while (*p && (uintptr_t)*p < (uintptr_t)b) { prev = *p; p = &(*p)->h.next; }
    b->h.next = *p; *p = b;
    if (b->h.next && (uintptr_t)b + b->h.size == (uintptr_t)b->h.next) {
        b->h.size += b->h.next->h.size; b->h.next = b->h.next->h.next;
    }
    if (prev && (uintptr_t)prev + prev->h.size == (uintptr_t)b) {
        prev->h.size += b->h.size; prev->h.next = b->h.next;
    }
}
static void *glp_alloc(uint32_t n) {
    if (n > 67108864u) { w32_gl_frontend_oom++; return 0; }
    uint32_t need = ((n ? n : 1) + 15u) / 16u * 16u + sizeof(GlpBlock);
    GlpBlock **best = 0;
    for (GlpBlock **p = &glp_pool; *p; p = &(*p)->h.next)
        if ((*p)->h.size >= need && (!best || (*p)->h.size < (*best)->h.size)) best = p;
    if (!best) {
        uint32_t grow = (need + 65535u) & ~65535u;
        GlpBlock *b = x86_alloc(grow);
        if (!b && grow != need) { grow = need; b = x86_alloc(grow); }
        if (!b) { w32_gl_frontend_oom++; return 0; }
        b->h.size = grow; w32_gl_frontend_reserved += grow; glp_insert(b);
        /* Insertion may have merged a neighboring free extent. */
        for (GlpBlock **p = &glp_pool; *p; p = &(*p)->h.next)
            if ((*p)->h.size >= need && (!best || (*p)->h.size < (*best)->h.size)) best = p;
    }
    GlpBlock *b = *best; *best = b->h.next;
    if (b->h.size - need >= sizeof(GlpBlock) + 16u) {
        GlpBlock *tail = (GlpBlock *)((uint8_t *)b + need);
        tail->h.size = b->h.size - need; b->h.size = need; glp_insert(tail);
    }
    w32_gl_frontend_bytes += b->h.size; w32_gl_frontend_allocations++;
    if (w32_gl_frontend_bytes > w32_gl_frontend_peak) w32_gl_frontend_peak = w32_gl_frontend_bytes;
    uint8_t *out = (uint8_t *)(b + 1);
    for (uint32_t i = 0; i < b->h.size - sizeof *b; i++) out[i] = 0;
    return out;
}
static void glp_free(void *p, uint32_t n) {
    (void)n; if (!p) return;
    GlpBlock *b = (GlpBlock *)p - 1;
    w32_gl_frontend_bytes -= b->h.size; w32_gl_frontend_frees++; glp_insert(b);
}
#define GS_ALLOC(n) glp_alloc(n)
#define GS_FREE(p, n) glp_free(p, n)
#include "w32_glsl.h"

typedef struct {
    uint32_t used, type, compiled, gpu, deleted, nstr, source_len;
    char *source; uint32_t *str_len; GsPreprocessed pp; GsUnit *unit; char log[4096];
} Shader;
typedef struct { uint32_t binding, warned; } Block;
typedef struct {
    uint32_t used, linked, vs, fs, vgpu, fgpu, nb, ubuf, dirty, usize, nslots, ndef, nout, validated, deleted;
    uint32_t vertex_only, tf_count, tf_separate, tf_link_count, tf_link_separate, tf_stride[4], tf_format[16], tf_type[16];
    char tf_names[16][GS_NAME], tf_link_names[16][GS_NAME], tf_builtin_names[2][GS_NAME];
    Gp *info; uint8_t *values; uint32_t slot_unit[8]; Block block[7];
    GpBinding abind[GP_MAX_BINDINGS], obind[GP_MAX_BINDINGS]; uint32_t nab, nob; char log[4096];
} Program;
