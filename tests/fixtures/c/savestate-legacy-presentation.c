/* SPDX-License-Identifier: CC0-1.0. Exercise native live cuts with only legacy commands. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint32_t commands[64], tick;
static bgt_cmdbuf_t cb;
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width=io.logical_height=4;
    bgt_cmd_init(&cb,commands,sizeof commands); return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) { (void)dt; ++tick; }
BGT_EXPORT(bgt_render) void bgt_render(void) {
    if(tick==1) {
        bgt_cmd_target_create(&cb,1,1,1); /* dev.41 replayed this frame to capture the target */
        bgt_cmd_clear(&cb,BGT_RGBA(0,0,255,255));
    } else if(tick==2) {
        bgt_cmd_rect(&cb,0,0,2,4,BGT_RGBA(255,0,0,255));
    } else return;
    if(bgt_cmd_submit(&cb)<0) bgt_abort(-1,"render",6);
}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
