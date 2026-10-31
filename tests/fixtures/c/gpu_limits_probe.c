#include "bgt.h"
BGT_DEFINE_IO(io)
static uint32_t output[28];
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p;
    io.logical_width = io.logical_height = 64;
    for (uint32_t i = 0; i < 28; i++) output[i] = 0xdeadbeefu;
    bgt_gpu_limits_t *dst = io.arg0 ? (bgt_gpu_limits_t *)(uintptr_t)io.arg0 : (bgt_gpu_limits_t *)output;
    output[24] = (uint32_t)bgt_gpu_limits(dst, io.arg1);
    output[25] = io.caps;
    return 0;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) { (void)dt; }
BGT_EXPORT(bgt_render) void bgt_render(void) {}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(bgt_debug_peek) uint32_t bgt_debug_peek(uint32_t addr, uint32_t len) {
    (void)len;
    return (uint32_t)(uintptr_t)output + addr;
}
