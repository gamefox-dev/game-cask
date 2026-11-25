/* SPDX-License-Identifier: CC0-1.0. Static and GPU-written legacy textures
 * outlive the temporary unreadable resource that forces the journal to drop. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint32_t commands[256], tick;
static bgt_cmdbuf_t cb;
static const uint16_t inf_texel[4]={0x7c00,0,0,0x3c00};
static const uint32_t static_texel=BGT_RGBA(0,0,255,255);
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width=io.logical_height=4;
    bgt_cmd_init(&cb,commands,sizeof commands); return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt; ++tick;
    if(tick==1) {
        bgt_cmd_tex_create(&cb,1,1,1);
        bgt_cmd_tex_update(&cb,1,0,0,1,1,&static_texel,sizeof static_texel);
        bgt_cmd_target_create(&cb,2,2,2);
        bgt_gpu_texture_create_ex_t bad={3,0,1,1,1,1,BGT_GPU_FORMAT_RGBA16F,3};
        bgt_cmd_gpu_texture_create_ex(&cb,&bad);
        bgt_gpu_texture_update_ex_t upload={3,0,0,0,0,1,1,1,(uint32_t)(uintptr_t)inf_texel,sizeof inf_texel};
        bgt_cmd_gpu_texture_update_ex(&cb,&upload);
    }
    if(tick==264) { bgt_gpu_texture_delete_t del={3}; bgt_cmd_gpu_texture_delete(&cb,&del); }
    if(cb.count && bgt_cmd_submit(&cb)<0) bgt_abort(-1,"update",6);
}
BGT_EXPORT(bgt_render) void bgt_render(void) {
    if(!tick)return;
    if(tick==1) {
        bgt_cmd_target(&cb,2);
        bgt_cmd_clear(&cb,BGT_RGBA(0,255,0,255));
        bgt_cmd_scissor(&cb,1,0,0,2,1);
        bgt_cmd_clear(&cb,BGT_RGBA(255,0,0,255));
        bgt_cmd_target(&cb,0);
    }
    bgt_cmd_texture(&cb,1,BGT_FILTER_NEAREST);
    bgt_cmd_rect(&cb,0,0,2,4,0xffffffffu);
    bgt_cmd_texture(&cb,2,BGT_FILTER_NEAREST);
    bgt_cmd_rect(&cb,2,0,2,4,0xffffffffu);
    if(bgt_cmd_submit(&cb)<0) bgt_abort(-1,"render",6);
}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return tick; }
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
