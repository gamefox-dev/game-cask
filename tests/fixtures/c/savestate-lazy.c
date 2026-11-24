/* SPDX-License-Identifier: CC0-1.0. A clear-only lazy color target and an unreadable
 * (non-finite) materialized texture. Only the guest's eventual read needs the lazy texture. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint32_t commands[128], tick, hash;
static bgt_cmdbuf_t cb;
/* The command stores a guest pointer; the texel must still be live at submit. */
static const uint16_t inf_texel[4]={0x7c00,0,0,0x3c00};
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width=io.logical_height=4;
    bgt_cmd_init(&cb,commands,sizeof commands); return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;
    if (++tick==1) {
        bgt_gpu_texture_create_ex_t a={1,0,4,4,1,1,BGT_GPU_FORMAT_RGBA8,3}, b={2,0,4,4,1,1,BGT_GPU_FORMAT_RGBA16F,3};
        bgt_cmd_gpu_texture_create_ex(&cb,&a); bgt_cmd_gpu_texture_create_ex(&cb,&b);
        bgt_gpu_pass_begin_t pass={.color_count=1};
        bgt_gpu_color_attachment_t col={1,0,BGT_GPU_LOAD_CLEAR,1.0f,0,0,1.0f};
        bgt_cmd_gpu_pass_begin(&cb,&pass,&col); bgt_cmd_gpu_pass_end(&cb);
        bgt_gpu_texture_update_ex_t update={2,0,0,0,0,1,1,1,(uint32_t)(uintptr_t)inf_texel,sizeof inf_texel};
        bgt_cmd_gpu_texture_update_ex(&cb,&update);
    } else if (tick==2) {
        bgt_gpu_texture_delete_t del={2}; bgt_cmd_gpu_texture_delete(&cb,&del);
    } else if (tick==3) {
        bgt_gpu_texture_readback_t read={1,0,0,0,0,1,1,1,1};
        bgt_cmd_gpu_texture_readback(&cb,&read);
    } else if (tick>=4 && bgt_request_status(1)==1) {
        if(bgt_request_read(1,&hash,4)!=4)bgt_abort(-1,"read",4);
        bgt_request_close(1);
    }
    if(cb.count && bgt_cmd_submit(&cb)<0) bgt_abort(-1,"submit",6);
}
BGT_EXPORT(bgt_render) void bgt_render(void){}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void){}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void){return hash;}
