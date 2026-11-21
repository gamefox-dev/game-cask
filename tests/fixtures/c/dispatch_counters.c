/* Original CC0-1.0. Known-count production dispatcher and registry, ON/OFF. */
#include "native_fast_guards.c"
static uint32_t counted_result;
BGT_EXPORT(counted) unsigned counted(void) {
    prepare();__builtin_memset(&x86_native_stats,0,sizeof x86_native_stats);
    mode=0;x86_force_interp=0;x86_register_lifted(normal,2);
    invoke_root();invoke_root();
    counted_result=(uint32_t)X.r[EAX];
#if X86_NATIVE_STATS
#define CHECK(n,v) if(x86_native_stats.n!=(v))return __LINE__;
    CHECK(driver_entries,2) CHECK(driver_steps,2) CHECK(calls,2) CHECK(resumes,2)
    CHECK(enter_attempts,2) CHECK(resume_attempts,2) CHECK(native_lookups,4)
    CHECK(registry_lookups,6) CHECK(registry_search_exact,2) CHECK(registry_search_range,1)
    CHECK(registry_cache_positive,3) CHECK(registry_search_miss,0)
    if(x86_native_stats.stops[XD_STOP_stop]!=2)return __LINE__;
    /* Cold/warm negative, force-interpreter, and generation replacement. */
    x86_find_lifted(0x5000);x86_find_lifted(0x5000);
    x86_force_interp=1;x86_find_lifted(0x1000);x86_force_interp=0;
    x86_register_lifted(changed,2);x86_find_lifted(0x2000);
    CHECK(registry_lookups,10) CHECK(registry_search_exact,3)
    CHECK(registry_search_miss,1) CHECK(registry_cache_negative,1) CHECK(registry_forced,1)
#undef CHECK
#else
    static const x86_native_stats_t empty={0};
    if(__builtin_memcmp(&empty,&x86_native_stats,sizeof empty))return __LINE__;
#endif
    return 0;
}
BGT_EXPORT(answer) unsigned answer(void){return counted_result;}
BGT_EXPORT(dispatch_cpu) unsigned dispatch_cpu(void){return (unsigned)(uintptr_t)&X;}
BGT_EXPORT(dispatch_cpu_size) unsigned dispatch_cpu_size(void){return sizeof X;}
