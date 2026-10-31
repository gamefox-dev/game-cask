/* Original CC0-1.0: exercise the real wasm-to-host recording hook. */
#include "bgt.h"
BGT_DEFINE_IO(io)
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width=64; io.logical_height=64; return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) { (void)dt; }
BGT_EXPORT(bgt_render) void bgt_render(void) {}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(emit) void emit(uint32_t addr,uint32_t kind) { bgt_coverage_entry(addr,kind); }
BGT_EXPORT(fill) void fill(uint32_t count) {
    for(uint32_t i=0;i<count;i++)bgt_coverage_entry(i,2);
}
