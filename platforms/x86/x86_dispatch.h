/* Exact opt-in dispatch observations, not guest execution accounting.
 * SPDX-License-Identifier: MIT */
#ifndef X86_DISPATCH_H
#define X86_DISPATCH_H
#include <stdint.h>
#ifndef X86_NATIVE_STATS
#define X86_NATIVE_STATS 0
#endif
/* Keep the K32 prefix/layout for existing fixture readers. Every new count is u64. */
#define X86_DISPATCH_PREFIX(F) F(driver_steps) F(calls) F(resumes) F(region_chains) F(indirect_hits) F(indirect_misses)
#define X86_DISPATCH_FIELDS(F) F(driver_entries) F(enter_attempts) F(resume_attempts) F(rechain_attempts) F(indirect_attempts) F(native_lookups) F(registry_lookups) F(registry_forced) F(registry_cache_positive) F(registry_cache_negative) F(registry_search_exact) F(registry_search_range) F(registry_search_miss) F(driver_imports) F(driver_thunks) F(leaf_continuations) F(admission_hits) F(admission_misses)
/* Region return reasons: exactly one on every normal generated R return. Faults
 * count separately before the checked fault path (not as normal returns). */
#define X86_DISPATCH_EXITS(F) F(form) F(guard) F(quantum) F(interior) F(call) F(ret) F(indirect) F(other) F(leaf_import) F(deferred_import) F(fast_unwind) F(region) F(fast_tail) F(memory_fault)
#define X86_DISPATCH_STOPS(F) F(transfer) F(pending) F(block) F(stop) F(unbounded) F(no_native)
#define X86_DISPATCH_REJECTS(F) F(null) F(depth) F(not_ready) F(return) F(registry)
#define XD_REJECT_ENUM(n) XD_REJECT_##n,
enum { X86_DISPATCH_REJECTS(XD_REJECT_ENUM) XD_REJECTS };
#undef XD_REJECT_ENUM
#define XD_ENUM(n) XD_##n,
enum { X86_DISPATCH_EXITS(XD_ENUM) XD_EXITS };
#undef XD_ENUM
#define XD_ENUM(n) XD_STOP_##n,
enum { X86_DISPATCH_STOPS(XD_ENUM) XD_STOPS };
#undef XD_ENUM
#define XD_FIELD(n) uint64_t n;
typedef struct {
    X86_DISPATCH_PREFIX(XD_FIELD)
    uint32_t peak_depth;
    X86_DISPATCH_FIELDS(XD_FIELD)
    uint64_t exits[XD_EXITS], stops[XD_STOPS];
    uint64_t enter_reject[XD_REJECTS], resume_reject[XD_REJECTS], rechain_reject[XD_REJECTS], indirect_reject[XD_REJECTS];
} x86_native_stats_t;
#undef XD_FIELD
extern x86_native_stats_t x86_native_stats;
#if X86_NATIVE_STATS
#define X86_DISPATCH_REJECT(kind,n) (x86_native_stats.kind##_reject[XD_REJECT_##n]++)
#define X86_DISPATCH_COUNT(n) (x86_native_stats.n++)
#define X86_NATIVE_EXIT(n) (x86_native_stats.exits[XD_##n]++)
#define X86_DRIVER_STOP(n) (x86_native_stats.stops[XD_STOP_##n]++)
#else
#define X86_DISPATCH_REJECT(kind,n) ((void)0)
#define X86_DISPATCH_COUNT(n) ((void)0)
#define X86_NATIVE_EXIT(n) ((void)0)
#define X86_DRIVER_STOP(n) ((void)0)
#endif
#endif
