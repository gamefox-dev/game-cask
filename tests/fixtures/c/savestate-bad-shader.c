/* CC0-1.0. Handled failed GLSL compilation, live failure then deletion/reuse. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint32_t tick,hash=1,commands[256];
static bgt_cmdbuf_t cb;
static const char source[]="#version 300 es\nthis is deliberately invalid GLSL;";
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p;io.logical_width=32;io.logical_height=32;bgt_cmd_init(&cb,commands,sizeof commands);return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;tick++;
    if(tick==1 || tick==5) {
        bgt_gpu_shader_create_t shader={1,1,2,(uint32_t)(uintptr_t)source,sizeof(source)-1,71};
        bgt_cmd_gpu_shader_create(&cb,&shader);
    }
    if(tick==2 || tick==6) {
        int32_t code=0;hash=hash*33u+(uint32_t)bgt_request_status(71);
        hash=hash*33u+(uint32_t)bgt_request_read(71,&code,sizeof code);hash^=(uint32_t)code;
        bgt_request_close(71);
    }
    if(tick==4 || tick==8) {bgt_gpu_shader_delete_t shader={1};bgt_cmd_gpu_shader_delete(&cb,&shader);}
    hash=hash*33u+tick;bgt_cmd_submit(&cb);
}
BGT_EXPORT(bgt_render) void bgt_render(void) {bgt_cmd_clear(&cb,BGT_RGBA(tick*17,hash,0,255));bgt_cmd_submit(&cb);}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) {return hash;}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
