/* SPDX-License-Identifier: CC0-1.0. Overlap streamed requests across every frame. */
#include "bgt.h"
BGT_DEFINE_IO(io)
static int32_t file, ids[2];
static uint32_t frame;
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width=io.logical_height=4;
    file=bgt_asset_open("test.bin",8);
    return file<0?file:BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;
    unsigned slot=frame&1;
    if(ids[slot]>0)bgt_request_close(ids[slot]);
    ids[slot]=bgt_asset_range_request(file,frame++,0,1);
    if(ids[slot]<0)bgt_abort(ids[slot],"range request",13);
}
BGT_EXPORT(bgt_render) void bgt_render(void){}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void){}
