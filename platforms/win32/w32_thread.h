/* Cooperative Win32 threading bridge. SPDX-License-Identifier: MIT */
#ifndef W32_THREAD_H
#define W32_THREAD_H
#include "x86_sched.h"
const w32_api_t *w32_thread_find(const char *name);
uint64_t w32_thread_api(const char *name);
void w32_thread_init(void);
void w32_thread_schedule(void);
void w32_thread_return(uint32_t code);
void w32_thread_quantum(void);
void w32_thread_yield(void);
int w32_thread_pending(void);
int w32_thread_deferred_result(void);
void w32_trace_result(uint64_t result);
uint32_t *w32_thread_error(void);
#endif
