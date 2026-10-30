/* CC0: v0.2 lifecycle/command contract, deliberately exports the frozen v0.2 version. */
#include "bgt.h"
#include "bgt_cmd.h"
#undef BGT_ABI_VERSION
#define BGT_ABI_VERSION 0x000200u
BGT_DEFINE_IO(io)
static unsigned ticks;
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) { (void)p; io.logical_width=64;io.logical_height=64;return 0; }
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) { (void)dt;ticks++; }
BGT_EXPORT(bgt_render) void bgt_render(void) { uint32_t mem[64];bgt_cmdbuf_t c;bgt_cmd_init(&c,mem,sizeof mem);bgt_cmd_clear(&c,BGT_RGBA(1,2,3,255));bgt_cmd_submit(&c); }
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return ticks; }
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
