/* CC0-1.0. Clear-every-frame scene with packed stencil, changing/deleted sample
 * resources and retained attachments. No lifted game or proprietary shader data. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint32_t commands[2048],tick,hash=1,ready;
static bgt_cmdbuf_t cb;
static uint32_t pixel=0xff112244u;
static const char vs[]="#version 300 es\nprecision highp float;void main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[bgt_vertex_index],0.5,1);}";
static const char fs[]="#version 300 es\nprecision highp float;uniform sampler2D bgt_t0;layout(location=0) out vec4 c;void main(){c=texture(bgt_t0,vec2(0.5));}";
static void check(int32_t code) {if(code<0)bgt_abort(code,"savestate GPU fixture",21);}
static void texture(uint32_t handle,uint32_t width,uint32_t height,uint32_t format) {
    bgt_gpu_texture_create_t t={handle,width,height,1,format,3};bgt_cmd_gpu_texture_create(&cb,&t);
}
static void upload(void) {bgt_gpu_texture_update_t u={3,0,0,0,1,1,(uint32_t)(uintptr_t)&pixel,4};bgt_cmd_gpu_texture_update(&cb,&u);}
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p;io.logical_width=64;io.logical_height=64;bgt_cmd_init(&cb,commands,sizeof commands);
    texture(1,64,64,0);texture(2,64,64,5);texture(3,1,1,0);upload();
    bgt_gpu_sampler_create_t s={1,0,0,0,0,0,0,7};bgt_cmd_gpu_sampler_create(&cb,&s);
    bgt_gpu_shader_create_t v={1,1,2,(uint32_t)(uintptr_t)vs,sizeof(vs)-1,81},f={2,2,2,(uint32_t)(uintptr_t)fs,sizeof(fs)-1,82};
    bgt_cmd_gpu_shader_create(&cb,&v);bgt_cmd_gpu_shader_create(&cb,&f);return bgt_cmd_submit(&cb);
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;tick++;
    if(!ready) {
        if(!bgt_request_status(81)||!bgt_request_status(82))return;
        int32_t code;check(bgt_request_read(81,&code,4));check(code);check(bgt_request_read(82,&code,4));check(code);
        bgt_request_close(81);bgt_request_close(82);
        bgt_gpu_pipeline_create_t p={0};p.handle=1;p.vertex_shader=1;p.fragment_shader=2;p.topology=3;p.depth_format=5;
        p.depth_test=1;p.depth_write=1;p.depth_compare=7;p.stencil_enable=1;p.stencil_read_mask=255;p.stencil_write_mask=255;
        p.front_compare=7;p.back_compare=7;p.front_pass=2;p.back_pass=2;p.texture_mask=1;p.color_count=1;
        bgt_gpu_color_target_t color={0};color.write_mask=15;bgt_cmd_gpu_pipeline_create(&cb,&p,0,0,&color);ready=1;
    }
    bgt_gpu_color_attachment_t color={1,0,1,0,0,0,1};
    bgt_gpu_pass_begin_t pass={1,2,0,1,1,1.0f,0};
#ifdef NO_CLEAR
    /* After a short lead-in, retaining old stencil must reject bounded snapshots. */
    if(tick>3) {pass.depth_load=0;pass.stencil_load=0;}
#endif
    bgt_cmd_gpu_pass_begin(&cb,&pass,&color);
    bgt_gpu_pipeline_t pipeline={1};bgt_cmd_gpu_pipeline(&cb,&pipeline);
    bgt_gpu_texture_t binding={0,3,1};bgt_cmd_gpu_texture(&cb,&binding);
    bgt_gpu_stencil_ref_t ref={tick&255};bgt_cmd_gpu_stencil_ref(&cb,&ref);
    bgt_gpu_draw_t draw={3,1,0,0};bgt_cmd_gpu_draw(&cb,&draw);bgt_cmd_gpu_pass_end(&cb);
    /* Replay of residual draws needs the START sample, not these later bytes. */
    pixel=0xff000000u|((tick*17u)&255u)|(((tick*31u)&255u)<<8)|(((tick*7u)&255u)<<16);
    if(tick%3==0){bgt_gpu_texture_delete_t del={3};bgt_cmd_gpu_texture_delete(&cb,&del);texture(3,1,1,0);}
    upload();
    bgt_gpu_blit_t blit={0};blit.source=1;blit.destination=0;
    blit.source_rect[2]=64;blit.source_rect[3]=64;blit.destination_rect[2]=64;blit.destination_rect[3]=64;blit.mask=1;
    blit.scissor[2]=64;blit.scissor[3]=64;
    bgt_cmd_gpu_blit(&cb,&blit);check(bgt_cmd_submit(&cb));hash=hash*33u+tick+io.buttons;
}
BGT_EXPORT(bgt_render) void bgt_render(void) {}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) {return hash;}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
