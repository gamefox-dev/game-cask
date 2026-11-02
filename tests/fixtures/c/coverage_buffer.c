/* Original CC0 bounded coverage transport fixture, with real host imports. */
#include "bgt.h"
#include "../../../platforms/x86/x86.h"
#include "../../../platforms/x86/x86_coverage.h"
static uint32_t arena[256];
void *x86_alloc(uint32_t n) {return n<=sizeof arena?arena:0;}
BGT_EXPORT(host_policy) uint32_t host_policy(uint32_t entries,uint32_t ranges) {return x86_prepare_host_slice(entries,ranges);}
BGT_EXPORT(emit) void emit(uint32_t address,uint32_t kind) {x86_coverage_entry(address,kind);}
BGT_EXPORT(lifted) void lifted(uint32_t address) {x86_coverage_lifted(address,1);}
BGT_EXPORT(flush) void flush(void) {x86_coverage_flush();}
BGT_EXPORT(first_entry) uint32_t first_entry(void) {return x86_slice_first_entry();}
BGT_EXPORT(hits) uint32_t hits(void) {return (uint32_t)x86_coverage_cache_hits;}
BGT_EXPORT(configure) void configure(void) {
    static const uint32_t entries[]={500};
    static const x86_code_range_t ranges[]={{100,110,0},{200,210,1}};
    x86_set_slice(entries,1,ranges,2);
}
