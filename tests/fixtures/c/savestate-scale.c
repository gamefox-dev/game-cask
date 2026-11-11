/* CC0-1.0 synthetic 1 GiB memory + 400 MiB native GPU buffers. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
static uint32_t commands[64],tick,hash=1,allocated;
static bgt_cmdbuf_t cb;
static unsigned char upload[4*1024*1024];
static uint32_t base;
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p){
 (void)p;io.logical_width=16;io.logical_height=16;bgt_cmd_init(&cb,commands,sizeof commands);
 base=__builtin_wasm_memory_size(0)*65536u;
 if(__builtin_wasm_memory_grow(0,16384)==(unsigned long)-1)return -1;
 for(uint32_t i=0;i<16384;i++)*((volatile unsigned char *)(uintptr_t)(base+i*65536u))=(unsigned char)(i%255+1);
 for(uint32_t i=0;i<sizeof upload;i++)upload[i]=(unsigned char)((i*17u+(i>>8))&255);
 return 0;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt){
 (void)dt;tick++;
 if(allocated<100){bgt_gpu_buffer_create_t b={allocated+1,1,sizeof upload,(uint32_t)(uintptr_t)upload,sizeof upload};bgt_cmd_gpu_buffer_create(&cb,&b);allocated++;}
 else {uint32_t word=tick*0x1234567u;bgt_gpu_buffer_update_t u={tick%100+1,(tick*4096u)%(sizeof upload-4),(uint32_t)(uintptr_t)&word,4};bgt_cmd_gpu_buffer_update(&cb,&u);}
 bgt_cmd_clear(&cb,0xff000000u|(tick*193u));
 int32_t code=bgt_cmd_submit(&cb);if(code<0)bgt_abort(code,"scale submit",12);
 *((volatile unsigned char *)(uintptr_t)(base+(tick%16384)*65536u))^=(unsigned char)tick;
 hash=hash*33u+tick;
}
BGT_EXPORT(bgt_render) void bgt_render(void){}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void){}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void){return hash;}
