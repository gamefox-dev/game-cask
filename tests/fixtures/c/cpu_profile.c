/* Original CC0 census/timing contract fixture. No guest or captured code. */
#include "../../../platforms/x86/x86_rt.c"
BGT_EXPORT(census) uint32_t census(uint32_t address,uint32_t reason,uint32_t instructions) {
    uint32_t bucket=x86_profile_exit(address,reason);
    for(uint32_t i=0;i<instructions;i++)x86_profile_instruction(bucket);
    return bucket;
}
BGT_EXPORT(count) uint32_t count(uint32_t bucket) {return (uint32_t)x86_census[bucket-1].count;}
BGT_EXPORT(instructions) uint32_t instructions(uint32_t bucket) {return (uint32_t)x86_census[bucket-1].instructions;}
BGT_EXPORT(dropped) uint32_t dropped(void) {return (uint32_t)x86_census_dropped;}
BGT_EXPORT(timing) double timing(uint32_t count) {
    for(uint32_t i=0;i<count;i++){double start=x86_profile_begin(XP_GENERIC);x86_profile_end(XP_GENERIC,start);}
    return x86_timings[XP_GENERIC].sample_us;
}
BGT_EXPORT(samples) uint32_t samples(void) {return (uint32_t)x86_timings[XP_GENERIC].samples;}
BGT_EXPORT(idle_start) void idle_begin(void) {x86_profile_idle_begin();}
BGT_EXPORT(idle_end) void idle_end(void) {x86_profile_idle_end();}
BGT_EXPORT(clock) double clock(void) {return x86_profile_clock();}
