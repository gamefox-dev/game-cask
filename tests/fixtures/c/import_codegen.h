/* Original CC0-1.0. Real runtime + generated import steps, full CPU/RAM oracle. */
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES 0x20000ull
#define X86_PROFILE_ENABLED 0
#include "../../../platforms/x86/x86_rt.c"
#include "../../../platforms/x86/x86_decode.c"
#include "../../../platforms/x86/x86_exec.c"
#include "../../../platforms/x86/x86_exec64.c"
#include "../../../platforms/x86/x86_simd.c"
void x86_x87(const x86_insn_t *in){(void)in;__builtin_trap();}
static void import_effect(void) {
    uint64_t result=X.r[ECX]+X.r[EDX]+X.r[R8]+X.r[R9]+x86_rd64((uint32_t)X.r[ESP]+40);
    const unsigned regs[]={ECX,EDX,R8,R9};
    for(unsigned i=0;i<4;i++)x86_wr64((uint32_t)X.r[ESP]+8+8*i,X.r[regs[i]]);
    X.r[EAX]=result;X.r[ECX]=101;X.r[EDX]=102;X.r[R8]=108;X.r[R9]=109;X.r[R10]=110;X.r[R11]=111;
    X.flags^=0x8d5;X.xmm[0].u64[0]=123;X.xmm[0].u64[1]=456;
    X.eip=(uint32_t)x86_pop();
}
static int test_thunk(uint32_t address){(void)address;import_effect();return 0;}
static void test_bound(void *opaque){(void)opaque;import_effect();}
static int test_leaf(void *opaque,uint64_t target){(void)opaque;(void)target;import_effect();return 1;}
BGT_DEFINE_IO(io)
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p){(void)p;io.logical_width=64;io.logical_height=64;return BGT_OK;}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt){(void)dt;}
BGT_EXPORT(bgt_render) void bgt_render(void){}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void){}
BGT_EXPORT(cpu) uint32_t cpu(void){return (uint32_t)(uintptr_t)&X;}
BGT_EXPORT(cpu_size) uint32_t cpu_size(void){return sizeof X;}
BGT_EXPORT(ram) uint32_t ram(void){return (uint32_t)(uintptr_t)(x86_flat+0x10000);}
BGT_EXPORT(direct) uint64_t direct(void){return x86_metrics.direct_import_calls;}
BGT_EXPORT(leaf) uint64_t leaf(void){return x86_metrics.leaf_import_calls;}
BGT_EXPORT(thunks) uint64_t thunks(void){return x86_metrics.thunk_dispatches;}
