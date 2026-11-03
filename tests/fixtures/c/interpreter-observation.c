/* Original CC0-1.0. Actual runtime recorder and nested exclusion paths. */
#define X86_INTERPRETER_CAP 8u
#include "../../../platforms/x86/x86_rt.c"
static void nested_work(void) { for(unsigned i=0;i<1000;i++)bgt_time_us(); }
BGT_EXPORT(exclusive) double exclusive(void) {
    double excluded=0;exclusive_span=&excluded;
    double start=x86_profile_clock();x86_set_scheduler(nested_work);x86_cooperate();
    double elapsed=x86_profile_clock()-start;exclusive_span=0;
    return elapsed-excluded;
}
BGT_EXPORT(inclusive) double inclusive(void) {double start=x86_profile_clock();nested_work();return x86_profile_clock()-start;}
BGT_EXPORT(record) void record(uint32_t address) {
    static const x86_code_range_t range={0x1000,0x2000,0};
    static const uint32_t owners[]={0x1000};code_owner_addresses=owners;
    interpreted_count(address,1,&range);
}
BGT_EXPORT(snapshot) uint32_t snapshot(void) {return (uint32_t)(uintptr_t)x86_interpreter_coverage();}
BGT_EXPORT(reset) void reset(void) {x86_profile_reset();}
