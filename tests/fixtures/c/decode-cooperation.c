/* Original CC0-1.0. Two guest tasks collide in the REAL decode cache while the
 * real CRT heapsort retains its native callback frame. No game bytes/addresses.
 * The execution wrapper only places the instruction clock at a quantum edge;
 * decoding, instruction execution, CRT sorting and context switching are real. */
#define _GNU_SOURCE 1
#include "wasi_offline.h"
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES 65536ull
#define X86_COVERAGE_MODE 0
#define X86_PROFILE_ENABLED 0
#include "../../../platforms/x86/x86_rt.c"
#include "../../../platforms/x86/x86_decode.c"
void quantum_exec64(const x86_insn_t *in);
#define x86_exec64 quantum_exec64
#include "../../../platforms/x86/x86_exec64.c"
#undef x86_exec64
#include "../../../platforms/x86/x86_exec.c"
#include "../../../platforms/x86/x86_simd.c"
#include "../../../platforms/x86/x86_sched.c"
void x86_x87(const x86_insn_t *in) { (void)in;__builtin_trap(); }
#include "../../../platforms/win32/w32_crt_internal.h"
/* Only qsort and compare_guest are reachable; unrelated CRT routines are dead. */
#include "../../../platforms/win32/w32_crt_runtime.h"
static void flush_stdout(void) { __builtin_trap(); }
static void file_flush_all(void) { __builtin_trap(); }
uint32_t w32_misc_alloc(uint32_t n) { (void)n;__builtin_trap(); }
static unsigned strategy,offset,period,attempts,rotations,callbacks,completed,fail,park,rounds=1;
static uint32_t worker_pc=0x3001;
static void check(int yes,unsigned code) { if(!yes&&!fail)fail=code; }
/* Same LIFO parked-task discipline as w32_thread.c: never abandon a callback's
 * native C continuation, and restore exactly its guest context before returning. */
static void schedule(void) {
    uint32_t task=x86_current,target=x86_sched_target;
    uint32_t stop=native_stop,floor=native_floor;int limit=native_limit;
    check(task==0&&X.callback_depth==1,10);
    rotations++;
    x86_tasks[task].parked=1;x86_sched_target=task;
    x86_sched_save();
    x86_cpu_t *w=&x86_tasks[1].cpu;
    __builtin_memset(w,0,sizeof *w);w->mode64=1;w->r[ESP]=0x9000-8;
    w->r[R8]=0x6000;w->xmm[0].u32[0]=0x3f800000;w->eip=worker_pc;
    x86_wr64((uint32_t)w->r[ESP],X86_THREAD_RETURN);
    x86_tasks[1].live=x86_tasks[1].ready=1;
    check(x86_sched_next()&&x86_current==1,11);
    x86_invoke(X.eip,X86_THREAD_RETURN);
    check(X.eip==X86_THREAD_RETURN&&X.r[ESP]==0x9000,12);
    check(x86_rd32(0x601c)==0x3f800000,13);
    x86_tasks[1].live=x86_tasks[1].ready=0;
    check(x86_sched_next()&&x86_current==task,14);
    x86_tasks[task].parked=0;x86_sched_target=target;
    check(native_stop==stop&&native_floor==floor&&native_limit==limit,15);
    /* Also retain the complete wasm C stack across a real host suspension. */
    if(park){x86_profile_idle_begin();bgt_yield();x86_profile_idle_end();}
}
void x86_exec64(const x86_insn_t *in) {
    if(x86_current==0&&X.callback_depth&&in->addr==0x1000+offset) {
        if((attempts++%period)==0)X.frame_insns=2000000;
    }
    quantum_exec64(in);
}
static void comparator_step(uint32_t pc) {
    (void)pc;x86_lift_reason=XE_QUANTUM;x86_lift_count=7;
}
static void comparator_entry(void) { x86_run_native(comparator_step); }
/* A native return continuation must not be consumed beneath the callback. */
static unsigned premature;
static void continuation_step(uint32_t pc) { (void)pc;premature++;X.eip=(uint32_t)x86_pop();X.tsc++; }
static void continuation_entry(void) { x86_run_native(continuation_step); }
static int thunk(uint32_t pc) {
    (void)pc;callbacks++;
    uint64_t regs[16];x86_vec_t xmm[16];
    __builtin_memcpy(regs,X.r,sizeof regs);__builtin_memcpy(xmm,X.xmm,sizeof xmm);
    uint32_t sp=(uint32_t)X.r[ESP],ip=X.eip;
    c_qsort();
    check(!X.transfer&&X.callback_depth==0,20);
    check(X.eip==ip&&X.r[ESP]==sp,21);
    check(!__builtin_memcmp(regs,X.r,sizeof regs)&&!__builtin_memcmp(xmm,X.xmm,sizeof xmm),22);
    X.eip=(uint32_t)x86_pop();return 0;
}
static const uint32_t values[]={0xffffffff,7,0,3,0x80000000,7,1,99,2,42,0,0x7fffffff};
static const uint32_t sorted[]={0,0,1,2,3,7,7,42,99,0x7fffffff,0x80000000,0xffffffff};
BGT_DEFINE_IO(io)
static uint8_t async_buf[131072] __attribute__((aligned(8)));
BGT_EXPORT(bgt_async_buffer) uint32_t async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t async_size(void) { return sizeof async_buf; }
BGT_EXPORT(configure) void configure(unsigned mode,unsigned at,unsigned every,unsigned suspend,unsigned repeat) {
    strategy=mode;offset=at;period=every;park=suspend;rounds=repeat;
}
BGT_EXPORT(bgt_init) int32_t init(uint32_t arg) {
    (void)arg;io.logical_width=io.logical_height=64;period=1;
    X.mode64=1;x86_map(0x1000,0x9000);
    /* unsigned 32-bit comparator: load, cmp, mov -1, seta, movzx, cmovb, ret */
    const uint8_t cmp[]={0x8b,0x02,0x39,0x01,0xba,0xff,0xff,0xff,0xff,0x0f,0x97,0xc0,0x0f,0xb6,0xc0,0x0f,0x42,0xc2,0xc3};
    for(unsigned i=0;i<sizeof cmp;i++)x86_wr8(0x1000+i,cmp[i]);
    /* All seven possible comparator entries collide with a worker store followed
     * by RET. The test chooses the matching worker address before execution. */
    x86_wr8(0x4000,0xc3);
    x86_set_thunks(0x5000,0x5010,thunk);x86_set_scheduler(schedule);
    return BGT_OK;
}
BGT_EXPORT(bgt_update) void update(uint32_t dt) {
    (void)dt;if(completed)return;
    static const x86_lifted_entry_t entries[]={
        {0x1000,comparator_entry,0x1013,comparator_step},
        {0xfffffff0,continuation_entry,0xfffffff1,continuation_step}};
    x86_register_lifted(entries,2);x86_force_interp=strategy==0;
    worker_pc=(0x1000+offset)^0x2001;
    check(((worker_pc^(worker_pc>>13))&8191)==(((0x1000+offset)^((0x1000+offset)>>13))&8191),1);
    const uint8_t worker[]={0xf3,0x41,0x0f,0x11,0x40,0x1c,0xc3};
    for(unsigned i=0;i<sizeof worker;i++)x86_wr8(worker_pc+i,worker[i]);
    for(unsigned r=0;r<rounds;r++) {
        __builtin_memset(&X,0,sizeof X);X.mode64=1;X.r[ESP]=0x8000;
        X.r[EBX]=0xfedcba9876543210ull;X.r[R12]=0x8877665544332211ull;
        for(unsigned i=0;i<16;i++)for(unsigned j=0;j<4;j++)X.xmm[i].u32[j]=i*100+j;
        for(unsigned i=0;i<sizeof values/4;i++)x86_wr32(0x7000+i*4,values[i]);
        X.r[ECX]=0x7000;X.r[EDX]=sizeof values/4;X.r[R8]=4;X.r[R9]=0x1000;
        x86_sched_init();x86_push(0x4000);x86_invoke(0x5000,0x4000);
        check(X.eip==0x4000&&X.r[ESP]==0x8000&&!X.transfer,23);
        check(!premature,24);
        for(unsigned i=0;i<sizeof sorted/4;i++)check(x86_rd32(0x7000+i*4)==sorted[i],30+i);
    }
    check(rotations>0&&callbacks==rounds,2);completed=1;
}
BGT_EXPORT(bgt_render) void render(void) {}
BGT_EXPORT(bgt_shutdown) void shutdown(void) {}
BGT_EXPORT(result) unsigned result(void) { return fail; }
BGT_EXPORT(done) unsigned done(void) { return completed; }
BGT_EXPORT(switches) unsigned switches(void) { return rotations; }
BGT_EXPORT(bgt_state_hash) uint32_t hash(void) {
    uint32_t h=0;for(unsigned i=0;i<sizeof sorted/4;i++)h=h*31+x86_rd32(0x7000+i*4);return h;
}
