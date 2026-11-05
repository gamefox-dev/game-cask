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
#endif
