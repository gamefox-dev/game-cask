/* CC0-1.0 reference encodings for the shared AMD64 semantics, no Windows executable content. */
#define X86_WIDE_CPU 1
#include "../../../platforms/x86/x86.h"
#include "bgt.h"
x86_cpu_t X;
uint8_t *x86_pages[1u<<20];
static uint8_t ram[65536],code[32];
uint32_t x86_address(uint64_t a){if(a>65535)__builtin_trap();return (uint32_t)a;}
void x86_fault(const char *m,uint32_t a){(void)m;(void)a;__builtin_trap();}
uint32_t x86_rd8_slow(uint32_t a){x86_fault("read",a);}
uint32_t x86_rd16_slow(uint32_t a){return x86_rd8(a)|(x86_rd8(a+1)<<8);}
uint32_t x86_rd32_slow(uint32_t a){return x86_rd16(a)|(x86_rd16(a+2)<<16);}
void x86_wr8_slow(uint32_t a,uint32_t v){(void)v;x86_fault("write",a);}
void x86_wr16_slow(uint32_t a,uint32_t v){x86_wr8(a,v);x86_wr8(a+1,v>>8);}
void x86_wr32_slow(uint32_t a,uint32_t v){x86_wr16(a,v);x86_wr16(a+2,v>>16);}
#include "../../../platforms/x86/x86_decode.c"
#include "../../../platforms/x86/x86_exec64.c"
#include "../../../platforms/x86/x86_simd.c"
BGT_EXPORT(reset) void reset(void){__builtin_memset(&X,0,sizeof X);__builtin_memset(ram,0,sizeof ram);for(int i=0;i<16;i++)x86_pages[i]=ram+i*4096;X.mode64=1;X.mxcsr=0x1f80;}
BGT_EXPORT(cpu) uint32_t cpu(void){return (uint32_t)(uintptr_t)&X;}
BGT_EXPORT(regs) uint32_t regs(void){return (uint32_t)(uintptr_t)X.r;}
BGT_EXPORT(vectors) uint32_t vectors(void){return (uint32_t)(uintptr_t)X.xmm;}
BGT_EXPORT(bytes) uint32_t bytes(void){return (uint32_t)(uintptr_t)code;}
BGT_EXPORT(memory_bytes) uint32_t memory_bytes(void){return (uint32_t)(uintptr_t)ram;}
BGT_EXPORT(flags) uint32_t flags(void){return X.flags;}
BGT_EXPORT(set_flags) void set_flags(uint32_t f){X.flags=f;}
BGT_EXPORT(run) uint32_t run(uint32_t n){x86_insn_t in;uint32_t len=(uint32_t)x86_decode_mode(code,n,0x1000,1,&in);if(!len)return 0;x86_exec64(&in);return len;}
