/* Original CC0-1.0: real mixed dispatcher, semantics and context scheduler.
 * Program bytes and generated lifts are supplied by retirement.test.ts. */
#include "wasi_offline.h" /* Real x87/libm is linked; no host WASI entropy. */
#define X86_COVERAGE_MODE 0
#if MODE64
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES (32ull<<20)
#endif
#include "../../../platforms/x86/x86_rt.c"
#include "../../../platforms/x86/x86_decode.c"
#include "../../../platforms/x86/x86_exec.c"
#include "../../../platforms/x86/x86_exec64.c"
#include "../../../platforms/x86/x86_simd.c"
#include "../../../platforms/x86/x86_x87.c"
#include "../../../platforms/x86/x86_sched.c"
extern const x86_lifted_entry_t x86_lifted_probe[];
extern const uint32_t x86_lifted_probe_count;
static unsigned stopped,parking;
static void cooperate(void) {
    if(parking){
        x86_account_observe(bgt_time_us(),0);x86_account_idle(1,bgt_time_us());
        x86_profile_idle_begin();bgt_yield();x86_profile_idle_end();
        x86_account_observe(bgt_time_us(),0);x86_account_idle(0,bgt_time_us());
    }
    if(stopped)X.transfer=X86_SCHEDULE;
}
BGT_EXPORT(retired) uint64_t retired(unsigned kind) {
    return kind<XR_KINDS?x86_retired.instructions[kind]:
        x86_retired.instructions[0]+x86_retired.instructions[1]+x86_retired.instructions[2];
}
BGT_EXPORT(thread_retired) uint64_t thread_retired(unsigned i) {
    x86_retired_t *r=&x86_accounts[i].retired;
    return r->instructions[0]+r->instructions[1]+r->instructions[2];
}
BGT_EXPORT(active_time) double active_time(void){x86_account_observe(bgt_time_us(),0);return x86_accounts[0].wall_us[XA_RUNNING];}
BGT_EXPORT(parked_time) double parked_time(void){x86_account_observe(bgt_time_us(),0);return x86_accounts[0].parked_us;}
BGT_EXPORT(clock) uint64_t clock_count(void){return X.tsc;}
BGT_EXPORT(set_reg) void set_reg(unsigned i,uint32_t n){X.r[i]=n;}
BGT_EXPORT(set_budget) void set_budget(unsigned n){X.frame_insns=n;}
BGT_EXPORT(pc) uint32_t pc(void){return X.eip;}
BGT_EXPORT(transfer) uint32_t transfer(void){return X.transfer;}
BGT_EXPORT(remaining) uint32_t remaining(void){return X.r[ECX];}
BGT_EXPORT(stop) void stop(unsigned yes,unsigned park){stopped=yes;parking=park;}
BGT_EXPORT(clear_transfer) void clear_transfer(void){X.transfer=0;stopped=parking=0;}
BGT_EXPORT(reset_census) void reset_census(void){x86_profile_reset();}
BGT_EXPORT(select_task) void select_task(unsigned i,unsigned pc) {
    x86_sched_save();
    for(unsigned j=0;j<X86_THREADS;j++)x86_tasks[j].ready=j==i;
    if(!x86_tasks[i].live) {
        x86_tasks[i].cpu=X;x86_tasks[i].cpu.eip=pc;
        x86_tasks[i].cpu.r[ESP]=0x8000+i*0x1000;
        x86_tasks[i].live=1;
        x86_account_create(i,pc,XA_READY,0);
    }
    if(!x86_sched_next())__builtin_trap();
}
BGT_EXPORT(prepare) void prepare(unsigned interpreted,unsigned entry) {
    x86_map(0x1001000,sizeof test_code);x86_map(0x1000,0x10000);
    __builtin_memcpy(x86_host(0x1001000),test_code,sizeof test_code);
    X.mode64=MODE64;X.eip=entry;X.r[ESP]=0x8000;X.flags=0x202;X.mxcsr=0x1f80;
    x86_set_scheduler(cooperate);x86_sched_init();x86_account_create(0,entry,XA_RUNNING,0);
    x86_force_interp=interpreted;
    if(!interpreted)x86_register_lifted(x86_lifted_probe,x86_lifted_probe_count);
}
BGT_EXPORT(run) void run(unsigned entry) {
    X.eip=entry;x86_push(0x4000);x86_invoke(entry,0x4000);
}
BGT_EXPORT(resume) void resume(void){X.transfer=0;x86_invoke(X.eip,0x4000);}
static uint8_t async_buf[1u<<20] __attribute__((aligned(16)));
BGT_DEFINE_IO(io)
BGT_EXPORT(bgt_async_buffer) uint32_t async_buffer(void){return (uint32_t)(uintptr_t)async_buf;}
BGT_EXPORT(bgt_async_buffer_size) uint32_t async_size(void){return sizeof async_buf;}
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p){(void)p;io.logical_width=io.logical_height=64;return BGT_OK;}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt){(void)dt;run(0x1001000);}
BGT_EXPORT(bgt_render) void bgt_render(void){}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void){}
