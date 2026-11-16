/* Original CC0-1.0. Real diagnostics serializer + presentation ring. */
#include "metrics_capacity.c"
x86_native_stats_t x86_native_stats;
BGT_EXPORT(dispatch_precision) unsigned dispatch_precision(void) {
#if X86_NATIVE_STATS
    uint64_t huge=UINT64_C(9007199254740993);
    guest_present.count=huge-1;
    for(unsigned n=0;n<66;n++) {
        x86_native_stats.driver_steps=huge+n;
        x86_native_stats.exits[XD_quantum]=UINT64_MAX;
        w32_guest_present(n&1);
    }
#endif
    return (unsigned)(uintptr_t)w32_metrics_json();
}
