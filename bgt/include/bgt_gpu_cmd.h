#ifndef BGT_GPU_CMD_H
#define BGT_GPU_CMD_H

/* v0.3 GPU commands: §13. Source pointers are wasm32 offsets, not host pointers. */
enum {
    BGT_OP_GPU_BUFFER_CREATE = 0x40,
    BGT_OP_GPU_BUFFER_UPDATE = 0x41,
    BGT_OP_GPU_BUFFER_DELETE = 0x42,
    BGT_OP_GPU_TEXTURE_CREATE = 0x43,
    BGT_OP_GPU_TEXTURE_UPDATE = 0x44,
    BGT_OP_GPU_TEXTURE_DELETE = 0x45,
    BGT_OP_GPU_SAMPLER_CREATE = 0x46,
    BGT_OP_GPU_SAMPLER_DELETE = 0x47,
    BGT_OP_GPU_SHADER_CREATE = 0x48,
    BGT_OP_GPU_SHADER_DELETE = 0x49,
    BGT_OP_GPU_PIPELINE_CREATE = 0x4a,
    BGT_OP_GPU_PIPELINE_DELETE = 0x4b,
    BGT_OP_GPU_PASS_BEGIN = 0x4c,
    BGT_OP_GPU_PASS_END = 0x4d,
    BGT_OP_GPU_PIPELINE = 0x4e,
    BGT_OP_GPU_VIEWPORT = 0x4f,
    BGT_OP_GPU_SCISSOR = 0x50,
    BGT_OP_GPU_STENCIL_REF = 0x51,
    BGT_OP_GPU_BLEND_CONSTANT = 0x52,
    BGT_OP_GPU_VERTEX_BUFFER = 0x53,
    BGT_OP_GPU_INDEX_BUFFER = 0x54,
    BGT_OP_GPU_UNIFORM_BUFFER = 0x55,
    BGT_OP_GPU_TEXTURE = 0x56,
    BGT_OP_GPU_DRAW = 0x57,
    BGT_OP_GPU_DRAW_INDEXED = 0x58,
    BGT_OP_GPU_TEXTURE_CREATE_EX = 0x59,
    BGT_OP_GPU_TEXTURE_UPDATE_EX = 0x5a,
    BGT_OP_GPU_SAMPLER_CREATE_EX = 0x5b,
    BGT_OP_GPU_TEXTURE_READBACK = 0x5c,
    BGT_OP_GPU_TEXTURE_GENERATE_MIPS = 0x5d,
};
static inline void bgt__gpu_copy(uint8_t *dst, const void *src, uint32_t bytes) {
    const uint8_t *s = (const uint8_t *)src;
    if (dst) for (uint32_t i = 0; i < bytes; i++) dst[i] = s[i];
}
/* Struct encoders require the ABI little-endian C target (wasm32). */
static inline void bgt_cmd_gpu_buffer_create(bgt_cmdbuf_t *b, const bgt_gpu_buffer_create_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_BUFFER_CREATE, 20), v, 20);
}
static inline void bgt_cmd_gpu_buffer_update(bgt_cmdbuf_t *b, const bgt_gpu_buffer_update_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_BUFFER_UPDATE, 16), v, 16);
}
static inline void bgt_cmd_gpu_buffer_delete(bgt_cmdbuf_t *b, const bgt_gpu_buffer_delete_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_BUFFER_DELETE, 4), v, 4);
}
static inline void bgt_cmd_gpu_texture_create(bgt_cmdbuf_t *b, const bgt_gpu_texture_create_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_TEXTURE_CREATE, 24), v, 24);
}
static inline void bgt_cmd_gpu_texture_update(bgt_cmdbuf_t *b, const bgt_gpu_texture_update_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_TEXTURE_UPDATE, 32), v, 32);
}
static inline void bgt_cmd_gpu_texture_delete(bgt_cmdbuf_t *b, const bgt_gpu_texture_delete_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_TEXTURE_DELETE, 4), v, 4);
}
static inline void bgt_cmd_gpu_sampler_create(bgt_cmdbuf_t *b, const bgt_gpu_sampler_create_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_SAMPLER_CREATE, 32), v, 32);
}
static inline void bgt_cmd_gpu_sampler_delete(bgt_cmdbuf_t *b, const bgt_gpu_sampler_delete_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_SAMPLER_DELETE, 4), v, 4);
}
static inline void bgt_cmd_gpu_shader_create(bgt_cmdbuf_t *b, const bgt_gpu_shader_create_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_SHADER_CREATE, 24), v, 24);
}
static inline void bgt_cmd_gpu_shader_delete(bgt_cmdbuf_t *b, const bgt_gpu_shader_delete_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_SHADER_DELETE, 4), v, 4);
}
static inline void bgt_cmd_gpu_pipeline_delete(bgt_cmdbuf_t *b, const bgt_gpu_pipeline_delete_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_PIPELINE_DELETE, 4), v, 4);
}
static inline void bgt_cmd_gpu_pass_end(bgt_cmdbuf_t *b) {
    (void)bgt_cmd_push(b, BGT_OP_GPU_PASS_END, 0);
}
static inline void bgt_cmd_gpu_pipeline(bgt_cmdbuf_t *b, const bgt_gpu_pipeline_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_PIPELINE, 4), v, 4);
}
static inline void bgt_cmd_gpu_viewport(bgt_cmdbuf_t *b, const bgt_gpu_viewport_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_VIEWPORT, 24), v, 24);
}
static inline void bgt_cmd_gpu_scissor(bgt_cmdbuf_t *b, const bgt_gpu_scissor_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_SCISSOR, 16), v, 16);
}
static inline void bgt_cmd_gpu_stencil_ref(bgt_cmdbuf_t *b, const bgt_gpu_stencil_ref_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_STENCIL_REF, 4), v, 4);
}
static inline void bgt_cmd_gpu_blend_constant(bgt_cmdbuf_t *b, const bgt_gpu_blend_constant_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_BLEND_CONSTANT, 16), v, 16);
}
static inline void bgt_cmd_gpu_vertex_buffer(bgt_cmdbuf_t *b, const bgt_gpu_vertex_buffer_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_VERTEX_BUFFER, 16), v, 16);
}
static inline void bgt_cmd_gpu_index_buffer(bgt_cmdbuf_t *b, const bgt_gpu_index_buffer_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_INDEX_BUFFER, 16), v, 16);
}
static inline void bgt_cmd_gpu_uniform_buffer(bgt_cmdbuf_t *b, const bgt_gpu_uniform_buffer_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_UNIFORM_BUFFER, 16), v, 16);
}
static inline void bgt_cmd_gpu_texture(bgt_cmdbuf_t *b, const bgt_gpu_texture_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_TEXTURE, 12), v, 12);
}
static inline void bgt_cmd_gpu_draw(bgt_cmdbuf_t *b, const bgt_gpu_draw_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_DRAW, 16), v, 16);
}
static inline void bgt_cmd_gpu_draw_indexed(bgt_cmdbuf_t *b, const bgt_gpu_draw_indexed_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_DRAW_INDEXED, 20), v, 20);
}
static inline void bgt_cmd_gpu_texture_create_ex(bgt_cmdbuf_t *b, const bgt_gpu_texture_create_ex_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_TEXTURE_CREATE_EX, 32), v, 32);
}
static inline void bgt_cmd_gpu_texture_update_ex(bgt_cmdbuf_t *b, const bgt_gpu_texture_update_ex_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_TEXTURE_UPDATE_EX, 40), v, 40);
}
static inline void bgt_cmd_gpu_sampler_create_ex(bgt_cmdbuf_t *b, const bgt_gpu_sampler_create_ex_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_SAMPLER_CREATE_EX, 44), v, 44);
}
static inline void bgt_cmd_gpu_texture_readback(bgt_cmdbuf_t *b, const bgt_gpu_texture_readback_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_TEXTURE_READBACK, 36), v, 36);
}
static inline void bgt_cmd_gpu_texture_generate_mips(bgt_cmdbuf_t *b, const bgt_gpu_texture_generate_mips_t *v) {
    bgt__gpu_copy(bgt_cmd_push(b, BGT_OP_GPU_TEXTURE_GENERATE_MIPS, 8), v, 8);
}
static inline void bgt_cmd_gpu_pipeline_create(bgt_cmdbuf_t *b, const bgt_gpu_pipeline_create_t *v,
        const bgt_gpu_vertex_layout_t *buffers, const bgt_gpu_attribute_t *attrs,
        const bgt_gpu_color_target_t *colors) {
    if (v->buffer_count > 8 || v->attribute_count > 16 || v->color_count > 4) {
        b->error = BGT_E_LIMIT; return;
    }
    uint32_t nb = v->buffer_count * 8, na = v->attribute_count * 16, nc = v->color_count * 36;
    uint8_t *p = bgt_cmd_push(b, BGT_OP_GPU_PIPELINE_CREATE, 104 + nb + na + nc);
    if (!p) return;
    bgt__gpu_copy(p, v, 104); bgt__gpu_copy(p + 104, buffers, nb);
    bgt__gpu_copy(p + 104 + nb, attrs, na); bgt__gpu_copy(p + 104 + nb + na, colors, nc);
}
static inline void bgt_cmd_gpu_pass_begin(bgt_cmdbuf_t *b, const bgt_gpu_pass_begin_t *v,
        const bgt_gpu_color_attachment_t *colors) {
    if (v->color_count > 4) { b->error = BGT_E_LIMIT; return; }
    uint8_t *p = bgt_cmd_push(b, BGT_OP_GPU_PASS_BEGIN, 28 + v->color_count * 28);
    if (!p) return;
    bgt__gpu_copy(p, v, 28); bgt__gpu_copy(p + 28, colors, v->color_count * 28);
}

#endif
