/* Shader/program object types and the pooled allocator behind the GLSL front end.
 * Included once by w32_gl.c. SPDX-License-Identifier: MIT — LANE-K6b */
#define GLP_CLASSES 26
static void *glp_pool[GLP_CLASSES];
static uint32_t glp_class(uint32_t n) { uint32_t c = 6; while (((uint64_t)1 << c) < n) c++; return c; }
static void *glp_alloc(uint32_t n) {
    uint32_t c = glp_class(n); if (c >= GLP_CLASSES) return 0;
    void *p = glp_pool[c];
    if (p) { glp_pool[c] = *(void **)p; uint8_t *b = (uint8_t *)p; for (uint32_t i = 0; i < (1u << c); i++) b[i] = 0; return p; }
    return x86_alloc(1u << c);
}
static void glp_free(void *p, uint32_t n) {
    if (!p) return; uint32_t c = glp_class(n); if (c >= GLP_CLASSES) return;
    *(void **)p = glp_pool[c]; glp_pool[c] = p;
}
#define GS_ALLOC(n) glp_alloc(n)
#define GS_FREE(p, n) glp_free(p, n)
#include "w32_glsl.h"

typedef struct {
    uint32_t used, type, compiled, gpu, deleted, nstr, source_len;
    char *source; uint32_t *str_len; GsPreprocessed pp; GsUnit *unit; char log[4096];
} Shader;
typedef struct { uint32_t binding; } Block;
typedef struct {
    uint32_t used, linked, vs, fs, vgpu, fgpu, nb, ubuf, dirty, usize, nslots, ndef, nout, validated, deleted;
    Gp *info; uint8_t *values; uint32_t slot_unit[8]; Block block[7];
    GpBinding abind[GP_MAX_BINDINGS], obind[GP_MAX_BINDINGS]; uint32_t nab, nob; char log[4096];
} Program;
