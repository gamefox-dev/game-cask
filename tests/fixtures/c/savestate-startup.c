/* CC0-1.0. Startup may import host services before bgt_init. */
#include "bgt.h"

static bgt_io_t io;
static volatile uint8_t probe[65536] __attribute__((aligned(65536)));

BGT_EXPORT(bgt_abi_version) uint32_t bgt_abi_version(void) { return BGT_ABI_VERSION; }
BGT_EXPORT(bgt_io) uint32_t bgt_io(void) {
    uint8_t flag;
    if (bgt_storage_read("boot", 4, &flag, 1) == 1) {
        probe[0] = flag;
        bgt_storage_write("startup-ran", 11, &flag, 1);
    }
    return (uint32_t)(uintptr_t)&io;
}
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width = 4; io.logical_height = 4; return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt; uint8_t flag = 0x51; bgt_storage_write("boot", 4, &flag, 1);
}
BGT_EXPORT(bgt_render) void bgt_render(void) {}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return probe[0]; }
