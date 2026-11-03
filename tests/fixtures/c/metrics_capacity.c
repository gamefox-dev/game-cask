/* Original CC0: full supported import-slot census through the real JSON serializer.
 * Dependencies here are read-only metric providers, not profile behavior replacements. */
#include "../../../platforms/win32/w32_core.c"
/* Real allocator's zero-state accounting; no allocations are used by this serializer census. */
static void *x86_host_backing(uint32_t n){(void)n;return 0;}
uint64_t x86_host_limit(void){return X86_HOST_ARENA_BYTES;}
#include "../../../platforms/x86/x86_host.h"
x86_metrics_t x86_metrics;
x86_timing_t x86_timings[XP_CATEGORIES];
x86_census_t x86_census[X86_CENSUS_CAP];
uint64_t x86_census_generation,x86_census_window_start_clock;
uint64_t x86_census_dropped,x86_coverage_events,x86_coverage_crossings,x86_coverage_cache_hits;
double x86_profile_idle_us;
uint64_t x86_guest_instruction_clock(void){return 123;}
void x86_coverage_flush(void){}
uint64_t w32_gl_calls,w32_gl_draws,w32_gl_state_changes,w32_gl_pipelines,w32_gl_unimplemented,w32_gl_approximations;
const char *w32_gl_stubs_json(void){return "[]";}
/* Idle GL metric provider only; object behavior is exercised by x64-gl-capacity. */
const char *w32_gl_objects_json(void){return "{}";}
const char *w32_gl_approximations_json(void){return "[]";}
int w32_rp_enabled(void){return 0;}
static slot_t test_slots[W32_THUNK_SLOTS];
BGT_EXPORT(prepare) void prepare(uint32_t pathological) {
    slots=test_slots;nslots=W32_THUNK_SLOTS;
    for(unsigned i=0;i<nslots;i++){
        for(unsigned j=0;j<255;j++){slots[i].name[j]=pathological==1?1:pathological==2?(j&1?'"':'\\'):'x';slots[i].dll[j]=pathological==1?2:pathological==2?(j&1?'\\':'"'):'d';}
        slots[i].name[0]='a'+i%26;slots[i].name[1]='a'+i/26%26;slots[i].name[2]='a'+i/676%26;
        slots[i].hits=i+1;slots[i].timing_samples=1;slots[i].timing_us=i+5;
    }
}
BGT_EXPORT(metrics) uint32_t metrics(void){return (uint32_t)(uintptr_t)w32_metrics_json();}
