/* Deterministic single-core guest context scheduling. SPDX-License-Identifier: MIT */
#ifndef X86_SCHED_H
#define X86_SCHED_H
#include "x86.h"
#define X86_THREADS 64u
#define X86_SCHEDULE 2
#define X86_THREAD_RETURN 0xffffffe0u
typedef struct {
    x86_cpu_t cpu;
    int live, ready, parked;
} x86_task_t;
extern x86_task_t x86_tasks[X86_THREADS];
extern uint32_t x86_current;
/* Only the innermost parked native continuation may be selected. */
extern uint32_t x86_sched_target;
void x86_sched_init(void);
void x86_sched_save(void);
/* LANE-K1: bounded weighted round robin. Weights 1..5 for priorities -2..2.
 * Each ready task gets a turn within at most 5*X86_THREADS selections. */
int x86_sched_set_priority(uint32_t task, int priority);
int x86_sched_get_priority(uint32_t task);
/* Round robin within a credit round, starting strictly after current. Returns 0 if no runnable task. */
int x86_sched_next(void);
#endif
