/* Original CC0-1.0: hand-timed real timing/native/scheduler/idle hooks.
 * log's level is a deterministic work duration in the fixture host, not a game. */
#include "../../../platforms/x86/x86_rt.c"
static void work(unsigned us) { bgt_log(us,"work",4); }
static void inner(unsigned us) {
    int active=interpreter_span_set(1);work(us);interpreter_span_set(active);
}
static void native(void) { work(100);inner(7);work(100); }
static void schedule(void) { work(100);inner(3); }
BGT_EXPORT(run) void run(void) {
    interpreter_span_set(1);work(10);
    profiled_native(native);work(20);
    x86_set_scheduler(schedule);x86_cooperate();work(5);
    x86_profile_idle_begin();bgt_yield();x86_profile_idle_end();
    work(11);interpreter_span_set(0);
}
BGT_EXPORT(total) double total(void) { return x86_interpreter_exclusive_us(); }
BGT_EXPORT(reset) void reset(void) { x86_profile_reset(); }
/* Measure a timer-only sampled dispatch: its instrumentation cost is paid only
 * at samples, yet the old estimate scales it to every call. */
BGT_EXPORT(bias) double bias(unsigned n) {
    for(unsigned i=0;i<n;i++){
        double start=x86_profile_begin(XP_INTERPRETER);
        if(start>=0)x86_interpreter_exclusive_sample_us+=x86_profile_clock()-start;
        x86_profile_end(XP_INTERPRETER,start);
    }
    return x86_interpreter_exclusive_sample_us*(double)x86_timings[XP_INTERPRETER].calls/(double)x86_timings[XP_INTERPRETER].samples;
}
BGT_EXPORT(timer) double timer(unsigned n) { double t=0;while(n--)t=bgt_time_us();return t; }
BGT_EXPORT(transitions) void transitions(unsigned n) { while(n--){interpreter_span_set(1);interpreter_span_set(0);} }
BGT_EXPORT(no_timer) unsigned no_timer(unsigned n) { unsigned t=1;while(n--)t=t*1664525u+1013904223u;return t; }
/* Static storage, disjoint from the C/Asyncify stacks. */
static uint32_t async_storage[16384];
BGT_EXPORT(buffer) uint32_t buffer(void) { return (uint32_t)(uintptr_t)async_storage; }
BGT_EXPORT(prepare) void prepare(void) { async_storage[0]=(uint32_t)(uintptr_t)&async_storage[2];async_storage[1]=(uint32_t)(uintptr_t)&async_storage[16384]; }
