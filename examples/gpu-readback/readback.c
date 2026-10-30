/* Original CC0-1.0 GPU request conformance. No game/engine content. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint8_t async_buf[65536] __attribute__((aligned(16)));
static uint32_t cmdmem[1024], result[16], checks, submitted, immediate_pending;
static bgt_cmdbuf_t cb;
BGT_EXPORT(bgt_async_buffer) uint32_t bgt_async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t bgt_async_buffer_size(void) { return sizeof async_buf; }
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width=64; io.logical_height=64;
    bgt_gpu_limits_t limits;
    if (!bgt_gpu_limits(&limits,sizeof limits) && limits.byte_size==16 && limits.max_texture_dimension>=4096) checks|=1;
    if (io.caps & BGT_CAP_READBACK) checks|=2;
    bgt_cmd_init(&cb,cmdmem,sizeof cmdmem); bgt_cmd_target_create(&cb,10,4,4);
    return bgt_cmd_submit(&cb);
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;
    while (!submitted) bgt_yield();
    if (immediate_pending) checks|=4;
    while (bgt_request_status(77)==0) bgt_yield();
    if (bgt_request_status(77)==1 && bgt_request_read(77,result,sizeof result)==64) {
        int ok=1;
        for (int i=0;i<16;i++) if (result[i] != (i<8 ? BGT_RGBA(220,20,30,255) : BGT_RGBA(10,80,230,255))) ok=0;
        if (ok) checks|=8;
    }
    bgt_request_close(77);
    while (bgt_request_status(78)==0) bgt_yield();
    if (bgt_request_read(78,result,4)==4 && result[0]==BGT_RGBA(30,220,80,255)) checks|=16;
    bgt_request_close(78);
    for (;;) bgt_yield();
}
BGT_EXPORT(bgt_render) void bgt_render(void) {
    bgt_cmd_reset(&cb);
    if (!submitted) {
        bgt_cmd_target(&cb,10); bgt_cmd_clear(&cb,BGT_RGBA(10,80,230,255));
        bgt_cmd_blend(&cb,BGT_BLEND_OPAQUE); bgt_cmd_texture(&cb,0,BGT_FILTER_NEAREST);
        bgt_cmd_rect(&cb,0,0,4,2,BGT_RGBA(220,20,30,255));
        bgt_cmd_readback(&cb,77,10,0,0,4,4);
        /* Ordered after capture: it must NOT change the request's red/blue snapshot. */
        bgt_cmd_clear(&cb,BGT_RGBA(240,210,10,255));
        bgt_cmd_target(&cb,0); bgt_cmd_clear(&cb,BGT_RGBA(30,220,80,255));
        bgt_cmd_readback(&cb,78,0,20,20,1,1);
        submitted=1;
    } else bgt_cmd_clear(&cb,checks==31 ? BGT_RGBA(30,220,80,255) : BGT_RGBA(200,20,20,255));
    bgt_cmd_submit(&cb);
    if (submitted && !immediate_pending && bgt_request_status(77)==0) immediate_pending=1;
}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return checks; }
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
