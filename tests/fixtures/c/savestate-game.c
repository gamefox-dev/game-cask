/* CC0-1.0. Deterministic host-service checkpoint sensitivity fixture, no game files. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint32_t tick, hash = 2166136261u;
static int32_t file;
static uint8_t entropy[7];
static int16_t pcm[4096];
static uint32_t commands[128];
static bgt_cmdbuf_t cb;
static uint8_t async_buf[65536] __attribute__((aligned(8)));
BGT_EXPORT(bgt_async_buffer) uint32_t bgt_async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t bgt_async_buffer_size(void) { return sizeof async_buf; }
static void mix(uint32_t x) { hash = (hash ^ x) * 16777619u; }
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p; io.logical_width=64; io.logical_height=64;
    bgt_cmd_init(&cb,commands,sizeof commands);
    file=bgt_asset_open("state.bin",9);
    return file>0 ? BGT_OK : BGT_E_STATE;
}
static void update_one(void) {
    uint8_t byte=0; uint32_t saved=0;
    tick++;
    mix((uint32_t)bgt_asset_read(file,&byte,1)); mix(byte);
    if(tick%7==0) { mix((uint32_t)bgt_asset_close(file)); file=bgt_asset_open("state.bin",9); mix((uint32_t)file); }
    mix((uint32_t)bgt_random_bytes(entropy,sizeof entropy));
    for(uint32_t i=0;i<sizeof entropy;i++) mix(entropy[i]);
    mix((uint32_t)bgt_time_us()); mix((uint32_t)bgt_audio_queued());
    mix((uint32_t)bgt_audio_push(pcm,4096));
    mix((uint32_t)bgt_storage_read("counter",7,&saved,sizeof saved)); mix(saved);
    saved=hash; mix((uint32_t)bgt_storage_write("counter",7,&saved,sizeof saved));
    mix(io.buttons); mix(io.buttons_pressed); mix(io.buttons_released); mix(io.keys_pressed[0]); mix(io.pointer_buttons); mix(io.events);
    /* Grow after the checkpoint: restore must replace, not try to shrink, a live memory. */
    if(tick==5) mix((uint32_t)__builtin_wasm_memory_grow(0,1));
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;
#ifdef SUSPENDING
    volatile uint32_t local=123;
    for(;;) { update_one(); mix(local); local+=17; bgt_yield(); }
#else
    update_one();
#endif
}
BGT_EXPORT(bgt_render) void bgt_render(void) {
    bgt_cmd_clear(&cb,BGT_RGBA(hash&255,(hash>>8)&255,(hash>>16)&255,255)); bgt_cmd_submit(&cb);
}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return hash; }
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
