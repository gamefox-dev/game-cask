/* Original CC0 lifecycle boundaries for the JSPI host. */
#include "bgt.h"
BGT_DEFINE_IO(io)
#ifndef MODE
#define MODE 0
#endif
static uint32_t counter;
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width=64; io.logical_height=64;
#if MODE == 3
    bgt_yield();
#endif
    return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt; counter++;
#if MODE == 1 || MODE == 2
    bgt_yield();
    counter++;
#endif
#if MODE == 2
    __builtin_trap();
#endif
}
BGT_EXPORT(bgt_render) void bgt_render(void) {
#if MODE == 4
    bgt_yield();
#endif
}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) {return counter;}
