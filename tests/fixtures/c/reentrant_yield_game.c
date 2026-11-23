/* K65 fixture (CC0): bgt_update calls the log import; the test's log service calls back into the
 * exported reenter(), which calls bgt_yield: a suspension across a JS frame (import -> JS -> export). */
#include "bgt.h"
BGT_DEFINE_IO(io)
static uint32_t state;
static uint8_t async_buf[65536] __attribute__((aligned(8)));
BGT_EXPORT(bgt_async_buffer) uint32_t bgt_async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t bgt_async_buffer_size(void) { return sizeof async_buf; }
BGT_EXPORT(reenter) void reenter(void) { state += 10; bgt_yield(); state += 100; }
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) { (void)p; io.logical_width = 64; io.logical_height = 64; return BGT_OK; }
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) { (void)dt; state++; BGT_LOG_LITERAL(0, "reenter"); state += 1000; }
BGT_EXPORT(bgt_render) void bgt_render(void) {}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return state; }
