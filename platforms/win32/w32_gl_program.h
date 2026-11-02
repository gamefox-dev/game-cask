/* Shader/program types; shared host allocator supplies transient GLSL storage and
 * retained GL source/buffer data. Included once by w32_gl.c. SPDX-License-Identifier: MIT */
static void *glp_alloc(uint32_t n) { return x86_host_alloc(XH_GL, n); }
static void glp_free(void *p, uint32_t n) { (void)n; x86_host_free(p); }
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
