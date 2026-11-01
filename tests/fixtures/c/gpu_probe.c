#include "bgt_cmd.h"
static uint32_t storage[4096];
static bgt_cmdbuf_t cb;
static const uint32_t layouts[] = {
    BGT_GPU_LIMIT_HANDLES, BGT_GPU_LIMIT_BUDGET, BGT_GPU_LIMIT_BUFFER_SIZE, BGT_GPU_LIMIT_TEXTURE_DIMENSION,
    BGT_GPU_LIMIT_VERTEX_BUFFERS, BGT_GPU_LIMIT_ATTRIBUTES, BGT_GPU_LIMIT_SLOTS, BGT_GPU_LIMIT_COLOR_ATTACHMENTS,
    BGT_GPU_LIMIT_UNIFORM_ALIGNMENT, BGT_GPU_LIMIT_UNIFORM_RANGE, BGT_GPU_LIMIT_STRIDE, BGT_GPU_LIMIT_SHADER_BYTES,
    BGT_GPU_LIMITS_SIZE, BGT_CAP_GPU, sizeof(bgt_gpu_limits_v3_t),
    offsetof(bgt_gpu_limits_v3_t, gpu_supported),
    offsetof(bgt_gpu_limits_v3_t, max_gpu_handles),
    offsetof(bgt_gpu_limits_v3_t, gpu_budget_bytes),
    offsetof(bgt_gpu_limits_v3_t, max_buffer_bytes),
    offsetof(bgt_gpu_limits_v3_t, max_vertex_buffers),
    offsetof(bgt_gpu_limits_v3_t, max_attributes),
    offsetof(bgt_gpu_limits_v3_t, max_binding_slots),
    offsetof(bgt_gpu_limits_v3_t, max_color_attachments),
    offsetof(bgt_gpu_limits_v3_t, uniform_offset_alignment),
    offsetof(bgt_gpu_limits_v3_t, max_uniform_range),
    offsetof(bgt_gpu_limits_v3_t, max_vertex_stride),
    offsetof(bgt_gpu_limits_v3_t, max_shader_bytes),
    offsetof(bgt_gpu_limits_v3_t, shader_languages),
    offsetof(bgt_gpu_limits_v3_t, max_mip_levels),
    offsetof(bgt_gpu_limits_v3_t, max_instances),
    offsetof(bgt_gpu_limits_v3_t, reserved),
    sizeof(bgt_gpu_buffer_create_t),
    offsetof(bgt_gpu_buffer_create_t, handle),
    offsetof(bgt_gpu_buffer_create_t, usage),
    offsetof(bgt_gpu_buffer_create_t, size),
    offsetof(bgt_gpu_buffer_create_t, data_ptr),
    offsetof(bgt_gpu_buffer_create_t, data_len),
    sizeof(bgt_gpu_buffer_update_t),
    offsetof(bgt_gpu_buffer_update_t, handle),
    offsetof(bgt_gpu_buffer_update_t, offset),
    offsetof(bgt_gpu_buffer_update_t, data_ptr),
    offsetof(bgt_gpu_buffer_update_t, data_len),
    sizeof(bgt_gpu_buffer_delete_t),
    offsetof(bgt_gpu_buffer_delete_t, handle),
    sizeof(bgt_gpu_texture_create_t),
    offsetof(bgt_gpu_texture_create_t, handle),
    offsetof(bgt_gpu_texture_create_t, width),
    offsetof(bgt_gpu_texture_create_t, height),
    offsetof(bgt_gpu_texture_create_t, mips),
    offsetof(bgt_gpu_texture_create_t, format),
    offsetof(bgt_gpu_texture_create_t, usage),
    sizeof(bgt_gpu_texture_update_t),
    offsetof(bgt_gpu_texture_update_t, handle),
    offsetof(bgt_gpu_texture_update_t, mip),
    offsetof(bgt_gpu_texture_update_t, x),
    offsetof(bgt_gpu_texture_update_t, y),
    offsetof(bgt_gpu_texture_update_t, width),
    offsetof(bgt_gpu_texture_update_t, height),
    offsetof(bgt_gpu_texture_update_t, data_ptr),
    offsetof(bgt_gpu_texture_update_t, data_len),
    sizeof(bgt_gpu_texture_delete_t),
    offsetof(bgt_gpu_texture_delete_t, handle),
    sizeof(bgt_gpu_sampler_create_t),
    offsetof(bgt_gpu_sampler_create_t, handle),
    offsetof(bgt_gpu_sampler_create_t, min_filter),
    offsetof(bgt_gpu_sampler_create_t, mag_filter),
    offsetof(bgt_gpu_sampler_create_t, mip_filter),
    offsetof(bgt_gpu_sampler_create_t, wrap_u),
    offsetof(bgt_gpu_sampler_create_t, wrap_v),
    offsetof(bgt_gpu_sampler_create_t, compare_enable),
    offsetof(bgt_gpu_sampler_create_t, compare),
    sizeof(bgt_gpu_sampler_delete_t),
    offsetof(bgt_gpu_sampler_delete_t, handle),
    sizeof(bgt_gpu_shader_create_t),
    offsetof(bgt_gpu_shader_create_t, handle),
    offsetof(bgt_gpu_shader_create_t, stage),
    offsetof(bgt_gpu_shader_create_t, language),
    offsetof(bgt_gpu_shader_create_t, source_ptr),
    offsetof(bgt_gpu_shader_create_t, source_len),
    offsetof(bgt_gpu_shader_create_t, request),
    sizeof(bgt_gpu_shader_delete_t),
    offsetof(bgt_gpu_shader_delete_t, handle),
    sizeof(bgt_gpu_pipeline_delete_t),
    offsetof(bgt_gpu_pipeline_delete_t, handle),
    sizeof(bgt_gpu_pipeline_t),
    offsetof(bgt_gpu_pipeline_t, handle),
    sizeof(bgt_gpu_viewport_t),
    offsetof(bgt_gpu_viewport_t, x),
    offsetof(bgt_gpu_viewport_t, y),
    offsetof(bgt_gpu_viewport_t, width),
    offsetof(bgt_gpu_viewport_t, height),
    offsetof(bgt_gpu_viewport_t, min_depth),
    offsetof(bgt_gpu_viewport_t, max_depth),
    sizeof(bgt_gpu_scissor_t),
    offsetof(bgt_gpu_scissor_t, x),
    offsetof(bgt_gpu_scissor_t, y),
    offsetof(bgt_gpu_scissor_t, width),
    offsetof(bgt_gpu_scissor_t, height),
    sizeof(bgt_gpu_stencil_ref_t),
    offsetof(bgt_gpu_stencil_ref_t, value),
    sizeof(bgt_gpu_blend_constant_t),
    offsetof(bgt_gpu_blend_constant_t, r),
    offsetof(bgt_gpu_blend_constant_t, g),
    offsetof(bgt_gpu_blend_constant_t, b),
    offsetof(bgt_gpu_blend_constant_t, a),
    sizeof(bgt_gpu_vertex_buffer_t),
    offsetof(bgt_gpu_vertex_buffer_t, slot),
    offsetof(bgt_gpu_vertex_buffer_t, handle),
    offsetof(bgt_gpu_vertex_buffer_t, offset),
    offsetof(bgt_gpu_vertex_buffer_t, size),
    sizeof(bgt_gpu_index_buffer_t),
    offsetof(bgt_gpu_index_buffer_t, handle),
    offsetof(bgt_gpu_index_buffer_t, format),
    offsetof(bgt_gpu_index_buffer_t, offset),
    offsetof(bgt_gpu_index_buffer_t, size),
    sizeof(bgt_gpu_uniform_buffer_t),
    offsetof(bgt_gpu_uniform_buffer_t, slot),
    offsetof(bgt_gpu_uniform_buffer_t, handle),
    offsetof(bgt_gpu_uniform_buffer_t, offset),
    offsetof(bgt_gpu_uniform_buffer_t, size),
    sizeof(bgt_gpu_texture_t),
    offsetof(bgt_gpu_texture_t, slot),
    offsetof(bgt_gpu_texture_t, handle),
    offsetof(bgt_gpu_texture_t, sampler),
    sizeof(bgt_gpu_draw_t),
    offsetof(bgt_gpu_draw_t, count),
    offsetof(bgt_gpu_draw_t, instances),
    offsetof(bgt_gpu_draw_t, first),
    offsetof(bgt_gpu_draw_t, first_instance),
    sizeof(bgt_gpu_draw_indexed_t),
    offsetof(bgt_gpu_draw_indexed_t, count),
    offsetof(bgt_gpu_draw_indexed_t, instances),
    offsetof(bgt_gpu_draw_indexed_t, first),
    offsetof(bgt_gpu_draw_indexed_t, base_vertex),
    offsetof(bgt_gpu_draw_indexed_t, first_instance),
    sizeof(bgt_gpu_pipeline_create_t),
    offsetof(bgt_gpu_pipeline_create_t, handle),
    offsetof(bgt_gpu_pipeline_create_t, vertex_shader),
    offsetof(bgt_gpu_pipeline_create_t, fragment_shader),
    offsetof(bgt_gpu_pipeline_create_t, topology),
    offsetof(bgt_gpu_pipeline_create_t, cull),
    offsetof(bgt_gpu_pipeline_create_t, front_face),
    offsetof(bgt_gpu_pipeline_create_t, depth_format),
    offsetof(bgt_gpu_pipeline_create_t, depth_test),
    offsetof(bgt_gpu_pipeline_create_t, depth_write),
    offsetof(bgt_gpu_pipeline_create_t, depth_compare),
    offsetof(bgt_gpu_pipeline_create_t, stencil_enable),
    offsetof(bgt_gpu_pipeline_create_t, stencil_read_mask),
    offsetof(bgt_gpu_pipeline_create_t, stencil_write_mask),
    offsetof(bgt_gpu_pipeline_create_t, front_compare),
    offsetof(bgt_gpu_pipeline_create_t, front_fail),
    offsetof(bgt_gpu_pipeline_create_t, front_depth_fail),
    offsetof(bgt_gpu_pipeline_create_t, front_pass),
    offsetof(bgt_gpu_pipeline_create_t, back_compare),
    offsetof(bgt_gpu_pipeline_create_t, back_fail),
    offsetof(bgt_gpu_pipeline_create_t, back_depth_fail),
    offsetof(bgt_gpu_pipeline_create_t, back_pass),
    offsetof(bgt_gpu_pipeline_create_t, uniform_mask),
    offsetof(bgt_gpu_pipeline_create_t, texture_mask),
    offsetof(bgt_gpu_pipeline_create_t, buffer_count),
    offsetof(bgt_gpu_pipeline_create_t, attribute_count),
    offsetof(bgt_gpu_pipeline_create_t, color_count),
    sizeof(bgt_gpu_vertex_layout_t),
    offsetof(bgt_gpu_vertex_layout_t, stride),
    offsetof(bgt_gpu_vertex_layout_t, step),
    sizeof(bgt_gpu_attribute_t),
    offsetof(bgt_gpu_attribute_t, location),
    offsetof(bgt_gpu_attribute_t, buffer),
    offsetof(bgt_gpu_attribute_t, offset),
    offsetof(bgt_gpu_attribute_t, format),
    sizeof(bgt_gpu_color_target_t),
    offsetof(bgt_gpu_color_target_t, format),
    offsetof(bgt_gpu_color_target_t, blend),
    offsetof(bgt_gpu_color_target_t, src_rgb),
    offsetof(bgt_gpu_color_target_t, dst_rgb),
    offsetof(bgt_gpu_color_target_t, op_rgb),
    offsetof(bgt_gpu_color_target_t, src_alpha),
    offsetof(bgt_gpu_color_target_t, dst_alpha),
    offsetof(bgt_gpu_color_target_t, op_alpha),
    offsetof(bgt_gpu_color_target_t, write_mask),
    sizeof(bgt_gpu_pass_begin_t),
    offsetof(bgt_gpu_pass_begin_t, color_count),
    offsetof(bgt_gpu_pass_begin_t, depth_texture),
    offsetof(bgt_gpu_pass_begin_t, depth_mip),
    offsetof(bgt_gpu_pass_begin_t, depth_load),
    offsetof(bgt_gpu_pass_begin_t, stencil_load),
    offsetof(bgt_gpu_pass_begin_t, clear_depth),
    offsetof(bgt_gpu_pass_begin_t, clear_stencil),
    sizeof(bgt_gpu_color_attachment_t),
    offsetof(bgt_gpu_color_attachment_t, texture),
    offsetof(bgt_gpu_color_attachment_t, mip),
    offsetof(bgt_gpu_color_attachment_t, load),
    offsetof(bgt_gpu_color_attachment_t, r),
    offsetof(bgt_gpu_color_attachment_t, g),
    offsetof(bgt_gpu_color_attachment_t, b),
    offsetof(bgt_gpu_color_attachment_t, a),
    sizeof(bgt_gpu_texture_create_ex_t),
    offsetof(bgt_gpu_texture_create_ex_t, handle),
    offsetof(bgt_gpu_texture_create_ex_t, dimension),
    offsetof(bgt_gpu_texture_create_ex_t, width),
    offsetof(bgt_gpu_texture_create_ex_t, height),
    offsetof(bgt_gpu_texture_create_ex_t, depth),
    offsetof(bgt_gpu_texture_create_ex_t, mips),
    offsetof(bgt_gpu_texture_create_ex_t, format),
    offsetof(bgt_gpu_texture_create_ex_t, usage),
    sizeof(bgt_gpu_texture_update_ex_t),
    offsetof(bgt_gpu_texture_update_ex_t, handle),
    offsetof(bgt_gpu_texture_update_ex_t, mip),
    offsetof(bgt_gpu_texture_update_ex_t, x),
    offsetof(bgt_gpu_texture_update_ex_t, y),
    offsetof(bgt_gpu_texture_update_ex_t, z),
    offsetof(bgt_gpu_texture_update_ex_t, width),
    offsetof(bgt_gpu_texture_update_ex_t, height),
    offsetof(bgt_gpu_texture_update_ex_t, depth),
    offsetof(bgt_gpu_texture_update_ex_t, data_ptr),
    offsetof(bgt_gpu_texture_update_ex_t, data_len),
    sizeof(bgt_gpu_sampler_create_ex_t),
    offsetof(bgt_gpu_sampler_create_ex_t, handle),
    offsetof(bgt_gpu_sampler_create_ex_t, min_filter),
    offsetof(bgt_gpu_sampler_create_ex_t, mag_filter),
    offsetof(bgt_gpu_sampler_create_ex_t, mip_filter),
    offsetof(bgt_gpu_sampler_create_ex_t, wrap_u),
    offsetof(bgt_gpu_sampler_create_ex_t, wrap_v),
    offsetof(bgt_gpu_sampler_create_ex_t, wrap_w),
    offsetof(bgt_gpu_sampler_create_ex_t, compare_enable),
    offsetof(bgt_gpu_sampler_create_ex_t, compare),
    offsetof(bgt_gpu_sampler_create_ex_t, min_lod),
    offsetof(bgt_gpu_sampler_create_ex_t, max_lod),
    sizeof(bgt_gpu_texture_readback_t),
    offsetof(bgt_gpu_texture_readback_t, handle),
    offsetof(bgt_gpu_texture_readback_t, mip),
    offsetof(bgt_gpu_texture_readback_t, x),
    offsetof(bgt_gpu_texture_readback_t, y),
    offsetof(bgt_gpu_texture_readback_t, z),
    offsetof(bgt_gpu_texture_readback_t, width),
    offsetof(bgt_gpu_texture_readback_t, height),
    offsetof(bgt_gpu_texture_readback_t, depth),
    offsetof(bgt_gpu_texture_readback_t, request),
    sizeof(bgt_gpu_texture_generate_mips_t),
    offsetof(bgt_gpu_texture_generate_mips_t, handle),
    offsetof(bgt_gpu_texture_generate_mips_t, base_level),
    BGT_GPU_BUFFER_VERTEX,
    BGT_GPU_BUFFER_INDEX,
    BGT_GPU_BUFFER_UNIFORM,
    BGT_GPU_TEXTURE_SAMPLED,
    BGT_GPU_TEXTURE_ATTACHMENT,
    BGT_GPU_FORMAT_RGBA8,
    BGT_GPU_FORMAT_RGBA8_SRGB,
    BGT_GPU_FORMAT_R8,
    BGT_GPU_FORMAT_RG8,
    BGT_GPU_FORMAT_RGBA16F,
    BGT_GPU_FORMAT_DEPTH24_STENCIL8,
    BGT_GPU_FORMAT_DEPTH32F,
    BGT_GPU_FORMAT_RGB10A2, BGT_GPU_FORMAT_R16F, BGT_GPU_FORMAT_RG16F, BGT_GPU_FORMAT_R32F,
    BGT_GPU_FORMAT_RG32F, BGT_GPU_FORMAT_RGBA32F,
    BGT_GPU_FORMAT_R8UI, BGT_GPU_FORMAT_R8I, BGT_GPU_FORMAT_R16UI, BGT_GPU_FORMAT_R16I,
    BGT_GPU_FORMAT_R32UI, BGT_GPU_FORMAT_R32I, BGT_GPU_FORMAT_RG8UI, BGT_GPU_FORMAT_RG8I,
    BGT_GPU_FORMAT_RG16UI, BGT_GPU_FORMAT_RG16I, BGT_GPU_FORMAT_RG32UI, BGT_GPU_FORMAT_RG32I,
    BGT_GPU_FORMAT_RGBA8UI, BGT_GPU_FORMAT_RGBA8I, BGT_GPU_FORMAT_RGBA16UI, BGT_GPU_FORMAT_RGBA16I,
    BGT_GPU_FORMAT_RGBA32UI, BGT_GPU_FORMAT_RGBA32I,
    BGT_GPU_DIM_2D, BGT_GPU_DIM_3D, BGT_GPU_DIM_2D_ARRAY,
    BGT_GPU_LIMIT_VOLUME_DIMENSION, BGT_GPU_LIMIT_ARRAY_LAYERS,
    BGT_GPU_FORMAT_NONE,
    BGT_GPU_FILTER_NEAREST,
    BGT_GPU_FILTER_LINEAR,
    BGT_GPU_MIP_NONE,
    BGT_GPU_MIP_NEAREST,
    BGT_GPU_MIP_LINEAR,
    BGT_GPU_WRAP_CLAMP,
    BGT_GPU_WRAP_REPEAT,
    BGT_GPU_WRAP_MIRROR,
    BGT_GPU_COMPARE_NEVER,
    BGT_GPU_COMPARE_LESS,
    BGT_GPU_COMPARE_EQUAL,
    BGT_GPU_COMPARE_LEQUAL,
    BGT_GPU_COMPARE_GREATER,
    BGT_GPU_COMPARE_NOT_EQUAL,
    BGT_GPU_COMPARE_GEQUAL,
    BGT_GPU_COMPARE_ALWAYS,
    BGT_GPU_STENCIL_KEEP,
    BGT_GPU_STENCIL_ZERO,
    BGT_GPU_STENCIL_REPLACE,
    BGT_GPU_STENCIL_INCREMENT_CLAMP,
    BGT_GPU_STENCIL_DECREMENT_CLAMP,
    BGT_GPU_STENCIL_INVERT,
    BGT_GPU_STENCIL_INCREMENT_WRAP,
    BGT_GPU_STENCIL_DECREMENT_WRAP,
    BGT_GPU_STAGE_VERTEX,
    BGT_GPU_STAGE_FRAGMENT,
    BGT_GPU_STAGE_COMBINED,
    BGT_GPU_LANG_WGSL,
    BGT_GPU_LANG_GLSL330,
    BGT_GPU_LANG_GLSLES300,
    BGT_GPU_TOPOLOGY_POINTS,
    BGT_GPU_TOPOLOGY_LINES,
    BGT_GPU_TOPOLOGY_LINE_STRIP,
    BGT_GPU_TOPOLOGY_TRIANGLES,
    BGT_GPU_TOPOLOGY_TRIANGLE_STRIP,
    BGT_GPU_CULL_NONE,
    BGT_GPU_CULL_FRONT,
    BGT_GPU_CULL_BACK,
    BGT_GPU_FRONT_CCW,
    BGT_GPU_FRONT_CW,
    BGT_GPU_BLEND_ZERO,
    BGT_GPU_BLEND_ONE,
    BGT_GPU_BLEND_SRC_COLOR,
    BGT_GPU_BLEND_ONE_MINUS_SRC_COLOR,
    BGT_GPU_BLEND_DST_COLOR,
    BGT_GPU_BLEND_ONE_MINUS_DST_COLOR,
    BGT_GPU_BLEND_SRC_ALPHA,
    BGT_GPU_BLEND_ONE_MINUS_SRC_ALPHA,
    BGT_GPU_BLEND_DST_ALPHA,
    BGT_GPU_BLEND_ONE_MINUS_DST_ALPHA,
    BGT_GPU_BLEND_CONSTANT,
    BGT_GPU_BLEND_ONE_MINUS_CONSTANT,
    BGT_GPU_BLEND_ADD,
    BGT_GPU_BLEND_SUBTRACT,
    BGT_GPU_BLEND_REVERSE_SUBTRACT,
    BGT_GPU_BLEND_MIN,
    BGT_GPU_BLEND_MAX,
    BGT_GPU_VERTEX_FLOAT,
    BGT_GPU_VERTEX_FLOAT2,
    BGT_GPU_VERTEX_FLOAT3,
    BGT_GPU_VERTEX_FLOAT4,
    BGT_GPU_VERTEX_UNORM8X4,
    BGT_GPU_VERTEX_SINT,
    BGT_GPU_VERTEX_SINT2,
    BGT_GPU_VERTEX_SINT3,
    BGT_GPU_VERTEX_SINT4,
    BGT_GPU_VERTEX_UINT,
    BGT_GPU_VERTEX_UINT2,
    BGT_GPU_VERTEX_UINT3,
    BGT_GPU_VERTEX_UINT4,
    BGT_GPU_STEP_VERTEX,
    BGT_GPU_STEP_INSTANCE,
    BGT_GPU_INDEX_UINT16,
    BGT_GPU_INDEX_UINT32,
    BGT_GPU_LOAD_LOAD,
    BGT_GPU_LOAD_CLEAR,
    BGT_OP_GPU_BUFFER_CREATE,
    BGT_OP_GPU_BUFFER_UPDATE,
    BGT_OP_GPU_BUFFER_DELETE,
    BGT_OP_GPU_TEXTURE_CREATE,
    BGT_OP_GPU_TEXTURE_UPDATE,
    BGT_OP_GPU_TEXTURE_DELETE,
    BGT_OP_GPU_SAMPLER_CREATE,
    BGT_OP_GPU_SAMPLER_DELETE,
    BGT_OP_GPU_SHADER_CREATE,
    BGT_OP_GPU_SHADER_DELETE,
    BGT_OP_GPU_PIPELINE_CREATE,
    BGT_OP_GPU_PIPELINE_DELETE,
    BGT_OP_GPU_PASS_BEGIN,
    BGT_OP_GPU_PASS_END,
    BGT_OP_GPU_PIPELINE,
    BGT_OP_GPU_VIEWPORT,
    BGT_OP_GPU_SCISSOR,
    BGT_OP_GPU_STENCIL_REF,
    BGT_OP_GPU_BLEND_CONSTANT,
    BGT_OP_GPU_VERTEX_BUFFER,
    BGT_OP_GPU_INDEX_BUFFER,
    BGT_OP_GPU_UNIFORM_BUFFER,
    BGT_OP_GPU_TEXTURE,
    BGT_OP_GPU_DRAW,
    BGT_OP_GPU_DRAW_INDEXED,
    BGT_OP_GPU_TEXTURE_CREATE_EX, BGT_OP_GPU_TEXTURE_UPDATE_EX, BGT_OP_GPU_SAMPLER_CREATE_EX,
    BGT_OP_GPU_TEXTURE_READBACK, BGT_OP_GPU_TEXTURE_GENERATE_MIPS, BGT_OP_GPU_TEXTURE_ALLOCATE_MIPS,
    BGT_OP_GPU_CLEAR_BUFFER, sizeof(bgt_gpu_clear_buffer_t), offsetof(bgt_gpu_clear_buffer_t, kind_class_masks),
    offsetof(bgt_gpu_clear_buffer_t, index), offsetof(bgt_gpu_clear_buffer_t, value),
};
BGT_EXPORT(gpu_layout) uint32_t gpu_layout(void) { return (uint32_t)(uintptr_t)layouts; }
BGT_EXPORT(gpu_layout_count) uint32_t gpu_layout_count(void) { return sizeof layouts / 4; }
BGT_EXPORT(gpu_encode) int32_t gpu_encode(void) {
    bgt_cmd_init(&cb, storage, sizeof storage);
    bgt_gpu_buffer_create_t v_buffer_create;
    uint32_t w_buffer_create[] = {1,2,3,4,5};
    bgt__gpu_copy((uint8_t *)&v_buffer_create, w_buffer_create, sizeof v_buffer_create);
    bgt_cmd_gpu_buffer_create(&cb, &v_buffer_create);
    bgt_gpu_buffer_update_t v_buffer_update;
    uint32_t w_buffer_update[] = {1,2,3,4};
    bgt__gpu_copy((uint8_t *)&v_buffer_update, w_buffer_update, sizeof v_buffer_update);
    bgt_cmd_gpu_buffer_update(&cb, &v_buffer_update);
    bgt_gpu_buffer_delete_t v_buffer_delete;
    uint32_t w_buffer_delete[] = {1};
    bgt__gpu_copy((uint8_t *)&v_buffer_delete, w_buffer_delete, sizeof v_buffer_delete);
    bgt_cmd_gpu_buffer_delete(&cb, &v_buffer_delete);
    bgt_gpu_texture_create_t v_texture_create;
    uint32_t w_texture_create[] = {1,2,3,4,5,6};
    bgt__gpu_copy((uint8_t *)&v_texture_create, w_texture_create, sizeof v_texture_create);
    bgt_cmd_gpu_texture_create(&cb, &v_texture_create);
    bgt_gpu_texture_update_t v_texture_update;
    uint32_t w_texture_update[] = {1,2,3,4,5,6,7,8};
    bgt__gpu_copy((uint8_t *)&v_texture_update, w_texture_update, sizeof v_texture_update);
    bgt_cmd_gpu_texture_update(&cb, &v_texture_update);
    bgt_gpu_texture_delete_t v_texture_delete;
    uint32_t w_texture_delete[] = {1};
    bgt__gpu_copy((uint8_t *)&v_texture_delete, w_texture_delete, sizeof v_texture_delete);
    bgt_cmd_gpu_texture_delete(&cb, &v_texture_delete);
    bgt_gpu_sampler_create_t v_sampler_create;
    uint32_t w_sampler_create[] = {1,2,3,4,5,6,7,8};
    bgt__gpu_copy((uint8_t *)&v_sampler_create, w_sampler_create, sizeof v_sampler_create);
    bgt_cmd_gpu_sampler_create(&cb, &v_sampler_create);
    bgt_gpu_sampler_delete_t v_sampler_delete;
    uint32_t w_sampler_delete[] = {1};
    bgt__gpu_copy((uint8_t *)&v_sampler_delete, w_sampler_delete, sizeof v_sampler_delete);
    bgt_cmd_gpu_sampler_delete(&cb, &v_sampler_delete);
    bgt_gpu_shader_create_t v_shader_create;
    uint32_t w_shader_create[] = {1,2,3,4,5,6};
    bgt__gpu_copy((uint8_t *)&v_shader_create, w_shader_create, sizeof v_shader_create);
    bgt_cmd_gpu_shader_create(&cb, &v_shader_create);
    bgt_gpu_shader_delete_t v_shader_delete;
    uint32_t w_shader_delete[] = {1};
    bgt__gpu_copy((uint8_t *)&v_shader_delete, w_shader_delete, sizeof v_shader_delete);
    bgt_cmd_gpu_shader_delete(&cb, &v_shader_delete);
    bgt_gpu_pipeline_create_t v_pipeline_create;
    uint32_t w_pipeline_create[] = {1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,1,1,1};
    bgt__gpu_copy((uint8_t *)&v_pipeline_create, w_pipeline_create, sizeof v_pipeline_create);
    bgt_gpu_vertex_layout_t buffer = {16, 0};
    bgt_gpu_attribute_t attr = {0, 0, 0, 3};
    bgt_gpu_color_target_t color = {0, 1, 1, 0, 0, 1, 0, 0, 15};
    bgt_cmd_gpu_pipeline_create(&cb, &v_pipeline_create, &buffer, &attr, &color);
    bgt_gpu_pipeline_delete_t v_pipeline_delete;
    uint32_t w_pipeline_delete[] = {1};
    bgt__gpu_copy((uint8_t *)&v_pipeline_delete, w_pipeline_delete, sizeof v_pipeline_delete);
    bgt_cmd_gpu_pipeline_delete(&cb, &v_pipeline_delete);
    bgt_gpu_pass_begin_t v_pass_begin;
    uint32_t w_pass_begin[] = {1,2,3,4,5,6,7};
    bgt__gpu_copy((uint8_t *)&v_pass_begin, w_pass_begin, sizeof v_pass_begin);
    bgt_gpu_color_attachment_t attachment = {0};
    bgt_cmd_gpu_pass_begin(&cb, &v_pass_begin, &attachment);
    bgt_cmd_gpu_pass_end(&cb);
    bgt_gpu_pipeline_t v_pipeline;
    uint32_t w_pipeline[] = {1};
    bgt__gpu_copy((uint8_t *)&v_pipeline, w_pipeline, sizeof v_pipeline);
    bgt_cmd_gpu_pipeline(&cb, &v_pipeline);
    bgt_gpu_viewport_t v_viewport;
    uint32_t w_viewport[] = {1,2,3,4,5,6};
    bgt__gpu_copy((uint8_t *)&v_viewport, w_viewport, sizeof v_viewport);
    bgt_cmd_gpu_viewport(&cb, &v_viewport);
    bgt_gpu_scissor_t v_scissor;
    uint32_t w_scissor[] = {1,2,3,4};
    bgt__gpu_copy((uint8_t *)&v_scissor, w_scissor, sizeof v_scissor);
    bgt_cmd_gpu_scissor(&cb, &v_scissor);
    bgt_gpu_stencil_ref_t v_stencil_ref;
    uint32_t w_stencil_ref[] = {1};
    bgt__gpu_copy((uint8_t *)&v_stencil_ref, w_stencil_ref, sizeof v_stencil_ref);
    bgt_cmd_gpu_stencil_ref(&cb, &v_stencil_ref);
    bgt_gpu_blend_constant_t v_blend_constant;
    uint32_t w_blend_constant[] = {1,2,3,4};
    bgt__gpu_copy((uint8_t *)&v_blend_constant, w_blend_constant, sizeof v_blend_constant);
    bgt_cmd_gpu_blend_constant(&cb, &v_blend_constant);
    bgt_gpu_vertex_buffer_t v_vertex_buffer;
    uint32_t w_vertex_buffer[] = {1,2,3,4};
    bgt__gpu_copy((uint8_t *)&v_vertex_buffer, w_vertex_buffer, sizeof v_vertex_buffer);
    bgt_cmd_gpu_vertex_buffer(&cb, &v_vertex_buffer);
    bgt_gpu_index_buffer_t v_index_buffer;
    uint32_t w_index_buffer[] = {1,2,3,4};
    bgt__gpu_copy((uint8_t *)&v_index_buffer, w_index_buffer, sizeof v_index_buffer);
    bgt_cmd_gpu_index_buffer(&cb, &v_index_buffer);
    bgt_gpu_uniform_buffer_t v_uniform_buffer;
    uint32_t w_uniform_buffer[] = {1,2,3,4};
    bgt__gpu_copy((uint8_t *)&v_uniform_buffer, w_uniform_buffer, sizeof v_uniform_buffer);
    bgt_cmd_gpu_uniform_buffer(&cb, &v_uniform_buffer);
    bgt_gpu_texture_t v_texture;
    uint32_t w_texture[] = {1,2,3};
    bgt__gpu_copy((uint8_t *)&v_texture, w_texture, sizeof v_texture);
    bgt_cmd_gpu_texture(&cb, &v_texture);
    bgt_gpu_draw_t v_draw;
    uint32_t w_draw[] = {1,2,3,4};
    bgt__gpu_copy((uint8_t *)&v_draw, w_draw, sizeof v_draw);
    bgt_cmd_gpu_draw(&cb, &v_draw);
    bgt_gpu_draw_indexed_t v_draw_indexed;
    uint32_t w_draw_indexed[] = {1,2,3,4,5};
    bgt__gpu_copy((uint8_t *)&v_draw_indexed, w_draw_indexed, sizeof v_draw_indexed);
    bgt_cmd_gpu_draw_indexed(&cb, &v_draw_indexed);
    bgt_gpu_texture_create_ex_t v_texture_create_ex;
    uint32_t w_texture_create_ex[] = {1,2,3,4,5,6,7,8};
    bgt__gpu_copy((uint8_t *)&v_texture_create_ex, w_texture_create_ex, sizeof v_texture_create_ex);
    bgt_cmd_gpu_texture_create_ex(&cb, &v_texture_create_ex);
    bgt_gpu_texture_update_ex_t v_texture_update_ex;
    uint32_t w_texture_update_ex[] = {1,2,3,4,5,6,7,8,9,10};
    bgt__gpu_copy((uint8_t *)&v_texture_update_ex, w_texture_update_ex, sizeof v_texture_update_ex);
    bgt_cmd_gpu_texture_update_ex(&cb, &v_texture_update_ex);
    bgt_gpu_sampler_create_ex_t v_sampler_create_ex;
    uint32_t w_sampler_create_ex[] = {1,2,3,4,5,6,7,8,9,10,11};
    bgt__gpu_copy((uint8_t *)&v_sampler_create_ex, w_sampler_create_ex, sizeof v_sampler_create_ex);
    bgt_cmd_gpu_sampler_create_ex(&cb, &v_sampler_create_ex);
    bgt_gpu_texture_readback_t v_texture_readback;
    uint32_t w_texture_readback[] = {1,2,3,4,5,6,7,8,9};
    bgt__gpu_copy((uint8_t *)&v_texture_readback, w_texture_readback, sizeof v_texture_readback);
    bgt_cmd_gpu_texture_readback(&cb, &v_texture_readback);
    bgt_gpu_texture_generate_mips_t v_texture_generate_mips;
    uint32_t w_texture_generate_mips[] = {1,2};
    bgt__gpu_copy((uint8_t *)&v_texture_generate_mips, w_texture_generate_mips, sizeof v_texture_generate_mips);
    bgt_cmd_gpu_texture_generate_mips(&cb, &v_texture_generate_mips);
    bgt_gpu_texture_allocate_mips_t v_texture_allocate_mips;
    uint32_t w_texture_allocate_mips[] = {1,2};
    bgt__gpu_copy((uint8_t *)&v_texture_allocate_mips, w_texture_allocate_mips, sizeof v_texture_allocate_mips);
    bgt_cmd_gpu_texture_allocate_mips(&cb, &v_texture_allocate_mips);
    bgt_gpu_clear_buffer_t clear = {1,2,{3,4,5,6}}; bgt_cmd_gpu_clear_buffer(&cb, &clear);
    return bgt_cmd_submit(&cb);
}
