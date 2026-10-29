/* v0.2 fixture: a game whose update never returns normally, written like a legacy
 * "owns the machine" loop. Built with asyncify by tests/unit/yield.test.ts. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint32_t ticks, depth_seen;
static uint8_t async_buf[65536] __attribute__((aligned(8)));
static uint32_t cmd[256];
static bgt_cmdbuf_t cb;
BGT_EXPORT(bgt_async_buffer) uint32_t bgt_async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t bgt_async_buffer_size(void) { return sizeof async_buf; }

/* wait for the next frame deep inside a call chain, with locals on the shadow stack */
static uint32_t wait_frame(uint32_t depth) {
    volatile uint32_t pad[16];
    for (uint32_t i = 0; i < 16; i++) pad[i] = depth * 16 + i;
    if (depth) return wait_frame(depth - 1) + pad[3];
    bgt_yield();
    return pad[15];
}
static void legacy_main(void) {
    for (;;) {
        ticks++;
        if (ticks == 2) io.logical_width = 128; /* v0.2: runtime-changeable logical size */
        depth_seen = wait_frame(4);
    }
}
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p;
    io.logical_width = 64; io.logical_height = 64;
    bgt_cmd_init(&cb, cmd, sizeof cmd);
    return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;
    /* Runs once: later frames resume inside bgt_yield, so code here before the call is not re-run. */
    legacy_main(); /* never returns: suspends in bgt_yield each frame */
}
BGT_EXPORT(bgt_render) void bgt_render(void) {
    volatile uint32_t scratch[64]; /* uses the shadow stack while the update is suspended */
    for (uint32_t i = 0; i < 64; i++) scratch[i] = i;
    bgt_cmd_clear(&cb, BGT_RGBA(scratch[1], 0, 0, 255));
    bgt_cmd_submit(&cb);
}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return ticks * 1000u + depth_seen; }
