/* CC0: synthetic decoder/lifter execution and architectural state assertions. */
#define X86_WIDE_CPU 1
#include "../../../platforms/x86/x86_lift64.h"
#include "bgt.h"
x86_cpu_t X;
x86_metrics_t x86_metrics;
uint8_t *x86_pages[1u<<20];
/* K2/K3 integration: paged semantic helpers share protection metadata too. */
uint8_t x86_protection[1u<<20];
int x86_protection_active;
static uint8_t ram[65536];
/* The AMD64 emitter references its arena on guarded fast paths. In this small
 * paged harness guards deoptimize to checked semantic accesses. */
static uint8_t *x86_flat=ram;
#include "wasi_offline.h"
const x86_insn_t *x86_lift_pending;
uint32_t x86_lift_count;
void x86_fault(const char *m,uint32_t p){(void)m;(void)p;__builtin_trap();}
uint32_t x86_address(uint64_t a){if(a>0xffffffffu)__builtin_trap();return (uint32_t)a;}
void x86_cooperate(void){__builtin_trap();}
uint32_t x86_rd8_slow(uint32_t a){x86_fault("read",a);}
uint32_t x86_rd16_slow(uint32_t a){return x86_rd8(a)|(x86_rd8(a+1)<<8);}
uint32_t x86_rd32_slow(uint32_t a){return x86_rd16(a)|(x86_rd16(a+2)<<16);}
void x86_wr8_slow(uint32_t a,uint32_t v){(void)v;x86_fault("write",a);}
void x86_wr16_slow(uint32_t a,uint32_t v){x86_wr8(a,v);x86_wr8(a+1,v>>8);}
void x86_wr32_slow(uint32_t a,uint32_t v){x86_wr16(a,v);x86_wr16(a+2,v>>16);}
#include "../../../platforms/x86/x86_decode.c"
#include "../../../platforms/x86/x86_exec.c"
#include "../../../platforms/x86/x86_exec64.c"
#include "../../../platforms/x86/x86_x87.c"
#include "../../../platforms/x86/x86_simd.c"
#include "../../../platforms/x86/x86_sched.c"
void x86_exec_one(const x86_insn_t *in){if(X.mode64)x86_exec64(in);else x86_exec_insn(in);}
void x86_continue(uint32_t a,uint32_t b){(void)a;(void)b;__builtin_trap();}
static void reference(void){
    unsigned off=X.eip-0x1001000;
    x86_insn_t in;if(off>=sizeof test_code||!x86_decode_mode(test_code+off,sizeof test_code-off,X.eip,X.mode64,&in))__builtin_trap();
    x86_exec_one(&in);
}
void x86_lift_block(uint32_t n){while(n--)reference();}
BGT_EXPORT(ram) uint32_t memory_addr(void){return (uint32_t)(uintptr_t)ram;}
BGT_EXPORT(reset) void reset(unsigned wide){
    __builtin_memset(&X,0,sizeof X);__builtin_memset(ram,0,sizeof ram);
    for(unsigned i=0;i<16;i++)x86_pages[i]=ram+4096*i;
    X.mode64=wide;X.eip=0x1001000;X.r[ESP]=0xf000;
}
/* Actual scheduler CPU copies must isolate FPU stack/tags/control and status. */
BGT_EXPORT(threads) unsigned thread_state(void){
    fp_init();fp_push(fp_from_int(19));FPU.control=0x77f;x86_sched_init();
    x86_tasks[1].live=x86_tasks[1].ready=1;__builtin_memset(&x86_tasks[1].cpu,0,sizeof X);
    x86_sched_save();if(!x86_sched_next())return 1;
    fp_init();fp_push(fp_from_int(-7));FPU.control=0xb7f;x86_sched_save();
    if(!x86_sched_next()||fp_compare(fp_get(0),fp_from_int(19),0)||FPU.control!=0x77f)return 2;
    if(!x86_sched_next()||fp_compare(fp_get(0),fp_from_int(-7),0)||FPU.control!=0xb7f)return 3;
    return 0;
}
