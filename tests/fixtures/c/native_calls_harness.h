/* Original CC0-1.0. Real runtime and emitted code; complete CPU/RAM snapshots. */
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES 65536ull
#define X86_PROFILE_ENABLED 0
#define X86_COVERAGE_MODE 0
#include "../../../platforms/x86/x86_rt.c"
#include "../../../platforms/x86/x86_decode.c"
#include "../../../platforms/x86/x86_exec.c"
#include "../../../platforms/x86/x86_exec64.c"
#include "../../../platforms/x86/x86_simd.c"
void x86_x87(const x86_insn_t *in){(void)in;__builtin_trap();}
static void schedule(void){X.transfer=X86_SCHEDULE;}
BGT_DEFINE_IO(io)
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p){(void)p;io.logical_width=64;io.logical_height=64;return BGT_OK;}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt){(void)dt;}
BGT_EXPORT(bgt_render) void bgt_render(void){}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void){}
BGT_EXPORT(cpu) unsigned cpu(void){return (unsigned)(uintptr_t)&X;}
BGT_EXPORT(cpu_size) unsigned cpu_size(void){return sizeof X;}
BGT_EXPORT(ram) unsigned ram(void){return (unsigned)(uintptr_t)x86_flat;}
BGT_EXPORT(stats) unsigned stats(void){return (unsigned)(uintptr_t)&x86_native_stats;}
BGT_EXPORT(interpretation) unsigned interpretation(void){return x86_metrics.interp_insns;}
BGT_EXPORT(generic) unsigned generic(void){return x86_metrics.generic_insn_execs;}
BGT_EXPORT(set_reg) void set_reg(unsigned i,uint64_t v){X.r[i]=v;}
BGT_EXPORT(prepare) void prepare(unsigned interpreted,unsigned pc,unsigned budget){
 __builtin_memset(&X,0,sizeof X);__builtin_memset(&x86_metrics,0,sizeof x86_metrics);__builtin_memset(&x86_native_stats,0,sizeof x86_native_stats);
 x86_map(0x1000,0x9000);__builtin_memset(x86_flat+0x1000,0,0x9000);__builtin_memcpy(x86_flat+0x2000,test_code,sizeof test_code);
 X.mode64=1;X.eip=pc;X.r[4]=0x9000;X.mxcsr=0x1f80;X.frame_insns=budget;X.flags=0x202;
 x86_force_interp=interpreted;x86_lift_pending=0;x86_lift_count=0;x86_set_scheduler(schedule);
 x86_register_lifted(x86_lifted_probe,x86_lifted_probe_count);x86_push(0xfffffff4u);
}
BGT_EXPORT(execute) void execute(void){x86_invoke(X.eip,0xfffffff4u);}
BGT_EXPORT(resume) void resume(void){X.transfer=0;x86_invoke(X.eip,0xfffffff4u);}
