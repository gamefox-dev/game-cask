/* Exact completed-guest-instruction counters shared by lifted and runtime code.
 * No sampled profiling/renderer dependencies. SPDX-License-Identifier: MIT */
#ifndef X86_RETIRE_H
#define X86_RETIRE_H
#include "x86_arch.h"
/* Separate from sampled profiling: exact instruction retirement is never X.tsc.
 * Compiling accounting out erases both local debt and counter updates. */
#ifndef X86_ACCOUNTING_ENABLED
#define X86_ACCOUNTING_ENABLED 0
#endif
enum { XR_LIFTED, XR_GENERIC, XR_INTERPRETED, XR_KINDS };
typedef struct { uint64_t instructions[XR_KINDS]; } x86_retired_t;
extern x86_retired_t x86_retired, *x86_thread_retired;
static inline void x86_retire(unsigned kind, uint64_t n) {
#if X86_ACCOUNTING_ENABLED
    x86_retired.instructions[kind] += n;
    x86_thread_retired->instructions[kind] += n;
#else
    (void)kind; (void)n;
#endif
}
#if X86_ACCOUNTING_ENABLED
#define XR_ADD(local, n) ((local) += (n))
#else
#define XR_ADD(local, n) ((void)(local))
#endif
/* K51 owner census (BGT_OWNER_CENSUS=1, default OFF): exact retired guest instructions per lifted
 * function owner. Generated code names its owner once per function/region (XR_OWNER) and commits
 * lifted retirement through XR_LIFT. OFF: XR_OWNER is empty and XR_LIFT is exactly x86_retire. */
#ifndef X86_OWNER_CENSUS
#define X86_OWNER_CENSUS 0
#endif
#if X86_OWNER_CENSUS && !X86_ACCOUNTING_ENABLED
#error "X86_OWNER_CENSUS requires X86_ACCOUNTING_ENABLED (it attributes exact retirement)"
#endif
#if X86_OWNER_CENSUS
#define X86_OWNER_CENSUS_CAP 16384u   /* owner rows (open addressing, 3/4 load bound) */
#define X86_OWNER_CENSUS_TOP 32u      /* top-N rows kept per presented frame */
#define X86_OWNER_CENSUS_FRAMES 8u    /* ring of presented-frame tables */
#define X86_OWNER_UNOWNED 0xffffffffu /* interpreted code outside every analyzed owner range */
typedef struct { uint32_t owner; uint64_t instructions[XR_KINDS]; } x86_census_top_t;
typedef struct { uint64_t present, total, unattributed; uint32_t active, count; x86_census_top_t top[X86_OWNER_CENSUS_TOP]; } x86_census_frame_t;
void x86_census_add(uint32_t *slot, uint32_t owner, unsigned kind, uint64_t n);
void x86_census_present(uint64_t present);
uint32_t x86_census_rows(void);
uint64_t x86_census_unattributed(void);
uint32_t x86_census_cumulative(x86_census_top_t *top, uint32_t cap, uint64_t *total);
uint32_t x86_census_frame_count(void);
uint64_t x86_census_frames_dropped(void);
const x86_census_frame_t *x86_census_frame(uint32_t chronological);
#define XR_OWNER(address) static uint32_t xr_slot; const uint32_t xr_owner = (address); (void)xr_owner;
#define XR_LIFT(n) do { uint64_t xr_n = (uint64_t)(n); x86_retire(XR_LIFTED, xr_n); \
    if (xr_n) x86_census_add(&xr_slot, xr_owner, XR_LIFTED, xr_n); } while (0)
#else
#define XR_OWNER(address)
#define XR_LIFT(n) x86_retire(XR_LIFTED, (n))
#endif
#endif
