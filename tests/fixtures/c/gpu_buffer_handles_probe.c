/* Original CC0-1.0. ABI negotiation, no GL profile. */
#include "bgt.h"
#ifndef PROBE_VERSION
#define PROBE_VERSION BGT_ABI_VERSION
#endif
static bgt_io_t io;
BGT_EXPORT(bgt_io) uint32_t bgt_io(void){return (uint32_t)(uintptr_t)&io;}
BGT_EXPORT(bgt_abi_version) uint32_t bgt_abi_version(void){return PROBE_VERSION;}
static uint32_t output[4];
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p){
 (void)p;io.logical_width=io.logical_height=64;
 output[0]=io.caps;output[1]=io.arg0?(uint32_t)bgt_gpu_buffer_handles():0xdeadbeefu;
 output[2]=BGT_CAP_GPU_BUFFER_HANDLES;return 0;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt){(void)dt;output[3]=(uint32_t)bgt_gpu_buffer_handles();}
BGT_EXPORT(bgt_render) void bgt_render(void){}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void){}
BGT_EXPORT(bgt_debug_peek) uint32_t bgt_debug_peek(uint32_t addr,uint32_t len){(void)len;return (uint32_t)(uintptr_t)output+addr;}
