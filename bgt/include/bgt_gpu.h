#ifndef BGT_GPU_H
#define BGT_GPU_H

#include <stdint.h>

/* v0.3 GPU wire structs. Each member occupies one little-endian 32-bit word. */
#define BGT_GPU_LIMIT_HANDLES 1023u
#define BGT_GPU_LIMIT_BUDGET (256u * 1024u * 1024u)
#define BGT_GPU_LIMIT_BUFFER_SIZE (64u * 1024u * 1024u)
#define BGT_GPU_LIMIT_TEXTURE_DIMENSION 4096u
#define BGT_GPU_LIMIT_VERTEX_BUFFERS 8u
#define BGT_GPU_LIMIT_ATTRIBUTES 16u
#define BGT_GPU_LIMIT_SLOTS 8u
#define BGT_GPU_LIMIT_COLOR_ATTACHMENTS 4u
#define BGT_GPU_LIMIT_UNIFORM_ALIGNMENT 256u
#define BGT_GPU_LIMIT_UNIFORM_RANGE 65536u
#define BGT_GPU_LIMIT_STRIDE 2048u
#define BGT_GPU_LIMIT_SHADER_BYTES (1024u * 1024u)
#define BGT_GPU_LIMITS_SIZE 80u
#define BGT_GPU_BUFFER_VERTEX 1u
#define BGT_GPU_BUFFER_INDEX 2u
#define BGT_GPU_BUFFER_UNIFORM 4u
#define BGT_GPU_TEXTURE_SAMPLED 1u
#define BGT_GPU_TEXTURE_ATTACHMENT 2u
#define BGT_GPU_FORMAT_RGBA8 0u
#define BGT_GPU_FORMAT_RGBA8_SRGB 1u
#define BGT_GPU_FORMAT_R8 2u
#define BGT_GPU_FORMAT_RG8 3u
#define BGT_GPU_FORMAT_RGBA16F 4u
#define BGT_GPU_FORMAT_DEPTH24_STENCIL8 5u
#define BGT_GPU_FORMAT_DEPTH32F 6u
#define BGT_GPU_FORMAT_RGB10A2 7u
#define BGT_GPU_FORMAT_R16F 8u
#define BGT_GPU_FORMAT_RG16F 9u
#define BGT_GPU_FORMAT_R32F 10u
#define BGT_GPU_FORMAT_RG32F 11u
#define BGT_GPU_FORMAT_RGBA32F 12u
#define BGT_GPU_DIM_2D 0u
#define BGT_GPU_DIM_3D 1u
#define BGT_GPU_DIM_2D_ARRAY 2u
#define BGT_GPU_LIMIT_VOLUME_DIMENSION 256u
#define BGT_GPU_LIMIT_ARRAY_LAYERS 256u
#define BGT_GPU_FORMAT_NONE 4294967295u
#define BGT_GPU_FILTER_NEAREST 0u
#define BGT_GPU_FILTER_LINEAR 1u
#define BGT_GPU_MIP_NONE 0u
#define BGT_GPU_MIP_NEAREST 1u
#define BGT_GPU_MIP_LINEAR 2u
#define BGT_GPU_WRAP_CLAMP 0u
#define BGT_GPU_WRAP_REPEAT 1u
#define BGT_GPU_WRAP_MIRROR 2u
#define BGT_GPU_COMPARE_NEVER 0u
#define BGT_GPU_COMPARE_LESS 1u
#define BGT_GPU_COMPARE_EQUAL 2u
#define BGT_GPU_COMPARE_LEQUAL 3u
#define BGT_GPU_COMPARE_GREATER 4u
#define BGT_GPU_COMPARE_NOT_EQUAL 5u
#define BGT_GPU_COMPARE_GEQUAL 6u
#define BGT_GPU_COMPARE_ALWAYS 7u
#define BGT_GPU_STENCIL_KEEP 0u
#define BGT_GPU_STENCIL_ZERO 1u
#define BGT_GPU_STENCIL_REPLACE 2u
#define BGT_GPU_STENCIL_INCREMENT_CLAMP 3u
#define BGT_GPU_STENCIL_DECREMENT_CLAMP 4u
#define BGT_GPU_STENCIL_INVERT 5u
#define BGT_GPU_STENCIL_INCREMENT_WRAP 6u
#define BGT_GPU_STENCIL_DECREMENT_WRAP 7u
#define BGT_GPU_STAGE_VERTEX 1u
#define BGT_GPU_STAGE_FRAGMENT 2u
#define BGT_GPU_STAGE_COMBINED 3u
#define BGT_GPU_LANG_WGSL 0u
#define BGT_GPU_LANG_GLSL330 1u
#define BGT_GPU_LANG_GLSLES300 2u
#define BGT_GPU_TOPOLOGY_POINTS 0u
#define BGT_GPU_TOPOLOGY_LINES 1u
#define BGT_GPU_TOPOLOGY_LINE_STRIP 2u
#define BGT_GPU_TOPOLOGY_TRIANGLES 3u
#define BGT_GPU_TOPOLOGY_TRIANGLE_STRIP 4u
#define BGT_GPU_CULL_NONE 0u
#define BGT_GPU_CULL_FRONT 1u
#define BGT_GPU_CULL_BACK 2u
#define BGT_GPU_FRONT_CCW 0u
#define BGT_GPU_FRONT_CW 1u
#define BGT_GPU_BLEND_ZERO 0u
#define BGT_GPU_BLEND_ONE 1u
#define BGT_GPU_BLEND_SRC_COLOR 2u
#define BGT_GPU_BLEND_ONE_MINUS_SRC_COLOR 3u
#define BGT_GPU_BLEND_DST_COLOR 4u
#define BGT_GPU_BLEND_ONE_MINUS_DST_COLOR 5u
#define BGT_GPU_BLEND_SRC_ALPHA 6u
#define BGT_GPU_BLEND_ONE_MINUS_SRC_ALPHA 7u
#define BGT_GPU_BLEND_DST_ALPHA 8u
#define BGT_GPU_BLEND_ONE_MINUS_DST_ALPHA 9u
#define BGT_GPU_BLEND_CONSTANT 10u
#define BGT_GPU_BLEND_ONE_MINUS_CONSTANT 11u
#define BGT_GPU_BLEND_ADD 0u
#define BGT_GPU_BLEND_SUBTRACT 1u
#define BGT_GPU_BLEND_REVERSE_SUBTRACT 2u
#define BGT_GPU_BLEND_MIN 3u
#define BGT_GPU_BLEND_MAX 4u
#define BGT_GPU_VERTEX_FLOAT 0u
#define BGT_GPU_VERTEX_FLOAT2 1u
#define BGT_GPU_VERTEX_FLOAT3 2u
#define BGT_GPU_VERTEX_FLOAT4 3u
#define BGT_GPU_VERTEX_UNORM8X4 4u
#define BGT_GPU_VERTEX_SINT 5u
#define BGT_GPU_VERTEX_SINT2 6u
#define BGT_GPU_VERTEX_SINT3 7u
#define BGT_GPU_VERTEX_SINT4 8u
#define BGT_GPU_VERTEX_UINT 9u
#define BGT_GPU_VERTEX_UINT2 10u
#define BGT_GPU_VERTEX_UINT3 11u
#define BGT_GPU_VERTEX_UINT4 12u
#define BGT_GPU_STEP_VERTEX 0u
#define BGT_GPU_STEP_INSTANCE 1u
#define BGT_GPU_INDEX_UINT16 0u
#define BGT_GPU_INDEX_UINT32 1u
#define BGT_GPU_LOAD_LOAD 0u
#define BGT_GPU_LOAD_CLEAR 1u
typedef struct bgt_gpu_buffer_create {
    uint32_t handle;
    uint32_t usage;
    uint32_t size;
    uint32_t data_ptr;
    uint32_t data_len;
} bgt_gpu_buffer_create_t; /* 20 bytes */
typedef struct bgt_gpu_buffer_update {
    uint32_t handle;
    uint32_t offset;
    uint32_t data_ptr;
    uint32_t data_len;
} bgt_gpu_buffer_update_t; /* 16 bytes */
typedef struct bgt_gpu_buffer_delete {
    uint32_t handle;
} bgt_gpu_buffer_delete_t; /* 4 bytes */
typedef struct bgt_gpu_texture_create {
    uint32_t handle;
    uint32_t width;
    uint32_t height;
    uint32_t mips;
    uint32_t format;
    uint32_t usage;
} bgt_gpu_texture_create_t; /* 24 bytes */
typedef struct bgt_gpu_texture_update {
    uint32_t handle;
    uint32_t mip;
    uint32_t x;
    uint32_t y;
    uint32_t width;
    uint32_t height;
    uint32_t data_ptr;
    uint32_t data_len;
} bgt_gpu_texture_update_t; /* 32 bytes */
typedef struct bgt_gpu_texture_delete {
    uint32_t handle;
} bgt_gpu_texture_delete_t; /* 4 bytes */
typedef struct bgt_gpu_sampler_create {
    uint32_t handle;
    uint32_t min_filter;
    uint32_t mag_filter;
    uint32_t mip_filter;
    uint32_t wrap_u;
    uint32_t wrap_v;
    uint32_t compare_enable;
    uint32_t compare;
} bgt_gpu_sampler_create_t; /* 32 bytes */
typedef struct bgt_gpu_sampler_delete {
    uint32_t handle;
} bgt_gpu_sampler_delete_t; /* 4 bytes */
typedef struct bgt_gpu_shader_create {
    uint32_t handle;
    uint32_t stage;
    uint32_t language;
    uint32_t source_ptr;
    uint32_t source_len;
    uint32_t request;
} bgt_gpu_shader_create_t; /* 24 bytes */
typedef struct bgt_gpu_shader_delete {
    uint32_t handle;
} bgt_gpu_shader_delete_t; /* 4 bytes */
typedef struct bgt_gpu_pipeline_delete {
    uint32_t handle;
} bgt_gpu_pipeline_delete_t; /* 4 bytes */
typedef struct bgt_gpu_pipeline {
    uint32_t handle;
} bgt_gpu_pipeline_t; /* 4 bytes */
typedef struct bgt_gpu_viewport {
    float x;
    float y;
    float width;
    float height;
    float min_depth;
    float max_depth;
} bgt_gpu_viewport_t; /* 24 bytes */
typedef struct bgt_gpu_scissor {
    uint32_t x;
    uint32_t y;
    uint32_t width;
    uint32_t height;
} bgt_gpu_scissor_t; /* 16 bytes */
typedef struct bgt_gpu_stencil_ref {
    uint32_t value;
} bgt_gpu_stencil_ref_t; /* 4 bytes */
typedef struct bgt_gpu_blend_constant {
    float r;
    float g;
    float b;
    float a;
} bgt_gpu_blend_constant_t; /* 16 bytes */
typedef struct bgt_gpu_vertex_buffer {
    uint32_t slot;
    uint32_t handle;
    uint32_t offset;
    uint32_t size;
} bgt_gpu_vertex_buffer_t; /* 16 bytes */
typedef struct bgt_gpu_index_buffer {
    uint32_t handle;
    uint32_t format;
    uint32_t offset;
    uint32_t size;
} bgt_gpu_index_buffer_t; /* 16 bytes */
typedef struct bgt_gpu_uniform_buffer {
    uint32_t slot;
    uint32_t handle;
    uint32_t offset;
    uint32_t size;
} bgt_gpu_uniform_buffer_t; /* 16 bytes */
typedef struct bgt_gpu_texture {
    uint32_t slot;
    uint32_t handle;
    uint32_t sampler;
} bgt_gpu_texture_t; /* 12 bytes */
typedef struct bgt_gpu_draw {
    uint32_t count;
    uint32_t instances;
    uint32_t first;
    uint32_t first_instance;
} bgt_gpu_draw_t; /* 16 bytes */
typedef struct bgt_gpu_draw_indexed {
    uint32_t count;
    uint32_t instances;
    uint32_t first;
    int32_t base_vertex;
    uint32_t first_instance;
} bgt_gpu_draw_indexed_t; /* 20 bytes */
typedef struct bgt_gpu_pipeline_create {
    uint32_t handle;
    uint32_t vertex_shader;
    uint32_t fragment_shader;
    uint32_t topology;
    uint32_t cull;
    uint32_t front_face;
    uint32_t depth_format;
    uint32_t depth_test;
    uint32_t depth_write;
    uint32_t depth_compare;
    uint32_t stencil_enable;
    uint32_t stencil_read_mask;
    uint32_t stencil_write_mask;
    uint32_t front_compare;
    uint32_t front_fail;
    uint32_t front_depth_fail;
    uint32_t front_pass;
    uint32_t back_compare;
    uint32_t back_fail;
    uint32_t back_depth_fail;
    uint32_t back_pass;
    uint32_t uniform_mask;
    uint32_t texture_mask;
    uint32_t buffer_count;
    uint32_t attribute_count;
    uint32_t color_count;
} bgt_gpu_pipeline_create_t; /* 104 bytes */
typedef struct bgt_gpu_vertex_layout {
    uint32_t stride;
    uint32_t step;
} bgt_gpu_vertex_layout_t; /* 8 bytes */
typedef struct bgt_gpu_attribute {
    uint32_t location;
    uint32_t buffer;
    uint32_t offset;
    uint32_t format;
} bgt_gpu_attribute_t; /* 16 bytes */
typedef struct bgt_gpu_color_target {
    uint32_t format;
    uint32_t blend;
    uint32_t src_rgb;
    uint32_t dst_rgb;
    uint32_t op_rgb;
    uint32_t src_alpha;
    uint32_t dst_alpha;
    uint32_t op_alpha;
    uint32_t write_mask;
} bgt_gpu_color_target_t; /* 36 bytes */
typedef struct bgt_gpu_pass_begin {
    uint32_t color_count;
    uint32_t depth_texture;
    uint32_t depth_mip;
    uint32_t depth_load;
    uint32_t stencil_load;
    float clear_depth;
    uint32_t clear_stencil;
} bgt_gpu_pass_begin_t; /* 28 bytes */
typedef struct bgt_gpu_color_attachment {
    uint32_t texture;
    uint32_t mip;
    uint32_t load;
    float r;
    float g;
    float b;
    float a;
} bgt_gpu_color_attachment_t; /* 28 bytes */
typedef struct bgt_gpu_texture_create_ex {
    uint32_t handle;
    uint32_t dimension;
    uint32_t width;
    uint32_t height;
    uint32_t depth;
    uint32_t mips;
    uint32_t format;
    uint32_t usage;
} bgt_gpu_texture_create_ex_t; /* 32 bytes */
typedef struct bgt_gpu_texture_update_ex {
    uint32_t handle;
    uint32_t mip;
    uint32_t x;
    uint32_t y;
    uint32_t z;
    uint32_t width;
    uint32_t height;
    uint32_t depth;
    uint32_t data_ptr;
    uint32_t data_len;
} bgt_gpu_texture_update_ex_t; /* 40 bytes */
typedef struct bgt_gpu_sampler_create_ex {
    uint32_t handle;
    uint32_t min_filter;
    uint32_t mag_filter;
    uint32_t mip_filter;
    uint32_t wrap_u;
    uint32_t wrap_v;
    uint32_t wrap_w;
    uint32_t compare_enable;
    uint32_t compare;
    float min_lod;
    float max_lod;
} bgt_gpu_sampler_create_ex_t; /* 44 bytes */
typedef struct bgt_gpu_texture_readback {
    uint32_t handle;
    uint32_t mip;
    uint32_t x;
    uint32_t y;
    uint32_t z;
    uint32_t width;
    uint32_t height;
    uint32_t depth;
    uint32_t request;
} bgt_gpu_texture_readback_t; /* 36 bytes */
typedef struct bgt_gpu_texture_generate_mips {
    uint32_t handle;
    uint32_t base_level;
} bgt_gpu_texture_generate_mips_t; /* 8 bytes */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(bgt_gpu_buffer_create_t) == 20, "GPU buffer_create layout");
_Static_assert(sizeof(bgt_gpu_buffer_update_t) == 16, "GPU buffer_update layout");
_Static_assert(sizeof(bgt_gpu_buffer_delete_t) == 4, "GPU buffer_delete layout");
_Static_assert(sizeof(bgt_gpu_texture_create_t) == 24, "GPU texture_create layout");
_Static_assert(sizeof(bgt_gpu_texture_update_t) == 32, "GPU texture_update layout");
_Static_assert(sizeof(bgt_gpu_texture_delete_t) == 4, "GPU texture_delete layout");
_Static_assert(sizeof(bgt_gpu_sampler_create_t) == 32, "GPU sampler_create layout");
_Static_assert(sizeof(bgt_gpu_sampler_delete_t) == 4, "GPU sampler_delete layout");
_Static_assert(sizeof(bgt_gpu_shader_create_t) == 24, "GPU shader_create layout");
_Static_assert(sizeof(bgt_gpu_shader_delete_t) == 4, "GPU shader_delete layout");
_Static_assert(sizeof(bgt_gpu_pipeline_delete_t) == 4, "GPU pipeline_delete layout");
_Static_assert(sizeof(bgt_gpu_pipeline_t) == 4, "GPU pipeline layout");
_Static_assert(sizeof(bgt_gpu_viewport_t) == 24, "GPU viewport layout");
_Static_assert(sizeof(bgt_gpu_scissor_t) == 16, "GPU scissor layout");
_Static_assert(sizeof(bgt_gpu_stencil_ref_t) == 4, "GPU stencil_ref layout");
_Static_assert(sizeof(bgt_gpu_blend_constant_t) == 16, "GPU blend_constant layout");
_Static_assert(sizeof(bgt_gpu_vertex_buffer_t) == 16, "GPU vertex_buffer layout");
_Static_assert(sizeof(bgt_gpu_index_buffer_t) == 16, "GPU index_buffer layout");
_Static_assert(sizeof(bgt_gpu_uniform_buffer_t) == 16, "GPU uniform_buffer layout");
_Static_assert(sizeof(bgt_gpu_texture_t) == 12, "GPU texture layout");
_Static_assert(sizeof(bgt_gpu_draw_t) == 16, "GPU draw layout");
_Static_assert(sizeof(bgt_gpu_draw_indexed_t) == 20, "GPU draw_indexed layout");
_Static_assert(sizeof(bgt_gpu_pipeline_create_t) == 104, "GPU pipeline_create layout");
_Static_assert(sizeof(bgt_gpu_vertex_layout_t) == 8, "GPU vertex_layout layout");
_Static_assert(sizeof(bgt_gpu_attribute_t) == 16, "GPU attribute layout");
_Static_assert(sizeof(bgt_gpu_color_target_t) == 36, "GPU color_target layout");
_Static_assert(sizeof(bgt_gpu_pass_begin_t) == 28, "GPU pass_begin layout");
_Static_assert(sizeof(bgt_gpu_color_attachment_t) == 28, "GPU color_attachment layout");
_Static_assert(sizeof(bgt_gpu_texture_create_ex_t) == 32, "GPU texture_create_ex layout");
_Static_assert(sizeof(bgt_gpu_texture_update_ex_t) == 40, "GPU texture_update_ex layout");
_Static_assert(sizeof(bgt_gpu_sampler_create_ex_t) == 44, "GPU sampler_create_ex layout");
_Static_assert(sizeof(bgt_gpu_texture_readback_t) == 36, "GPU texture_readback layout");
_Static_assert(sizeof(bgt_gpu_texture_generate_mips_t) == 8, "GPU texture_generate_mips layout");
#endif

#endif
