/* Original CC0-1.0. Real decoder, dispatcher and semantics with explicit hand-clock
 * work before each semantic dispatch. No replaced guest instruction or OS API. */
#include <stdio.h>
#include "wasi_offline.h" /* Deterministic musl stack-cookie bytes, no host WASI. */
#define X86_COVERAGE_MODE 0
#if MODE64
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES 65536ull
#endif
#include "../../../platforms/x86/x86_rt.c"
#include "../../../platforms/x86/x86_decode.c"
void measured_64_body(const x86_insn_t *in);
#define x86_exec_insn measured_insn_body
#define x86_exec64 measured_64_body
#include "../../../platforms/x86/x86_exec.c"
#include "../../../platforms/x86/x86_exec64.c"
#undef x86_exec_insn
#undef x86_exec64
#include "../../../platforms/x86/x86_simd.c"
/* Unsupported use traps, not a success substitute. No x87 in this program. */
void x86_x87(const x86_insn_t *in) { (void)in;__builtin_trap(); }
static void work(unsigned us) { bgt_log(us,"work",4); }
void x86_exec_insn(const x86_insn_t *in) { work(10);measured_insn_body(in); }
void x86_exec64(const x86_insn_t *in) { work(10);measured_64_body(in); }
static unsigned calls,completed,quantum;
static void callback(void) { if(x86_callback(0x2000,0,0)!=42)__builtin_trap(); }
static void native(void) { work(100);callback();work(100);X.eip=(uint32_t)x86_pop(); }
static int thunk(uint32_t addr) {
    (void)addr;work(100);callback();
    x86_profile_idle_begin();bgt_yield();x86_profile_idle_end();
    work(100);X.eip=(uint32_t)x86_pop();return 0;
}
static void schedule(void) { work(100);X.transfer=X86_SCHEDULE; }
static const x86_lifted_entry_t lifted_entries[]={{0x3000,native,0x3001,0}};
static const x86_code_range_t ranges[]={{0x1000,0x1020,0},{0x2000,0x2006,1}};
static uint8_t async_buf[65536] __attribute__((aligned(8)));
BGT_DEFINE_IO(io)
BGT_EXPORT(bgt_async_buffer) uint32_t bgt_async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t bgt_async_buffer_size(void) { return sizeof async_buf; }
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p;X.mode64=MODE64;x86_map(0x1000,0x8000);
    /* NOP; CALL native; CALL API; NOP; RET. Callback: MOV EAX,42; RET. */
    const uint8_t main[]={0x90,0xe8,0xfa,0x1f,0,0,0xe8,0xf5,0x3f,0,0,0x90,0xc3};
    const uint8_t cb[]={0xb8,42,0,0,0,0xc3};
    for(unsigned i=0;i<sizeof main;i++)x86_wr8(0x1000+i,main[i]);
    for(unsigned i=0;i<sizeof cb;i++)x86_wr8(0x2000+i,cb[i]);
    const uint8_t loop[]={0xb9,0x88,0x13,0,0,0xff,0xc9,0x75,0xfc,0xc3};
    for(unsigned i=0;i<sizeof loop;i++)x86_wr8(0x4000+i,loop[i]);
    x86_wr8(0x6000,0xf3);x86_wr8(0x6001,0xaa);x86_wr8(0x6002,0xc3);
    x86_register_lifted(lifted_entries,1);x86_register_code_ranges(ranges,2,2);
    x86_set_thunks(0x5000,0x5010,thunk);x86_set_scheduler(schedule);
    io.logical_width=io.logical_height=64;return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;calls++;X.r[ESP]=0x8000;X.transfer=0;X.frame_insns=quantum;
    x86_push(0xfffffff4u);x86_invoke(0x1000,0xfffffff4u);completed++;
}
BGT_EXPORT(bgt_render) void bgt_render(void) {}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(total) double total(void) { return x86_interpreter_exclusive_us(); }
/* Test serializer of actual runtime outputs; production serializer capacity has its own fixture. */
BGT_EXPORT(bgt_metrics) uint32_t metrics(void) {
    static char json[256];snprintf(json,sizeof json,"{\"interpreter_timing_enabled\":%u,\"interpreter_exclusive_us\":%.0f,\"interp_insns\":%llu}",
        X86_PROFILE_ENABLED,x86_interpreter_exclusive_us(),(unsigned long long)x86_metrics.interp_insns);
    return (uint32_t)(uintptr_t)json;
}
BGT_EXPORT(bgt_interpreter_coverage) uint32_t observation(void) { return (uint32_t)(uintptr_t)x86_interpreter_coverage(); }
BGT_EXPORT(done) unsigned done(void) { return completed; }
BGT_EXPORT(started) unsigned started(void) { return calls; }
BGT_EXPORT(set_quantum) void set_quantum(unsigned n) { quantum=n; }
BGT_EXPORT(string_run) void string_run(unsigned budget,unsigned count) {
    X.r[ESP]=0x8000;X.r[ECX]=count;X.r[EDI]=0x7000;X.transfer=0;X.frame_insns=budget;
    x86_push(0xfffffff4u);x86_invoke(0x6000,0xfffffff4u);
}
BGT_EXPORT(long_run) void long_run(void) {
    X.r[ESP]=0x8000;X.frame_insns=0;X.transfer=0;
    x86_push(0xfffffff4u);x86_invoke(0x4000,0xfffffff4u);
}
/* Real explicit runtime fault after MOV/RET; not an externally injected wasm trap. */
BGT_EXPORT(fault_run) void fault_run(void) {
    X.r[ESP]=0x8000;X.frame_insns=0;X.transfer=0;
    x86_push(0xa000);x86_invoke(0x2000,0xfffffff4u);
}
BGT_EXPORT(remaining) unsigned remaining(void) { return X.r[ECX]; }
BGT_EXPORT(transfer) unsigned transfer(void) { return X.transfer; }
BGT_EXPORT(bgt_profile_reset) void reset(void) { x86_profile_reset(); }
BGT_EXPORT(insns) unsigned insns(void) { return x86_metrics.interp_insns; }
