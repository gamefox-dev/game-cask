/* Deterministic single-core guest context scheduling. SPDX-License-Identifier: MIT */
#ifndef X86_SCHED_H
#define X86_SCHED_H
#include "x86.h"
#define X86_THREADS 64u
#define X86_SCHEDULE 2
#define X86_THREAD_RETURN 0xffffffe0u
enum { XA_INACTIVE, XA_RUNNING, XA_READY, XA_SLEEP, XA_OBJECT, XA_IO,
       XA_SUSPENDED, XA_HOST_YIELD, XA_EXITED, XA_STATES };
typedef struct {
    x86_retired_t retired;
    uint32_t id, start_address, state, reserved;
    uint64_t switches, sleep_requested_ms, object_requested_ms, infinite_waits;
    double wall_us[XA_STATES], parked_us;
    uint64_t virtual_ms[XA_STATES];
} x86_account_t;
extern x86_account_t x86_accounts[X86_THREADS];
#if X86_ACCOUNTING_ENABLED && X86_PROFILE_ENABLED
void x86_account_state(uint32_t task, unsigned state, uint64_t virtual_ms);
void x86_account_observe(double now_us, uint64_t virtual_ms);
void x86_account_idle(int begin, double now_us);
void x86_account_abort(double now_us);
#else
#if X86_ACCOUNTING_ENABLED
#define x86_account_state(task,next_state,virtual_ms) (x86_accounts[(task)].state=(next_state))
#else
#define x86_account_state(task,state,virtual_ms) ((void)0)
#endif
#define x86_account_observe(now_us,virtual_ms) ((void)0)
#define x86_account_idle(begin,now_us) ((void)0)
#define x86_account_abort(now_us) ((void)0)
#endif
#if X86_ACCOUNTING_ENABLED
void x86_account_create(uint32_t task, uint32_t start, unsigned state, uint64_t virtual_ms);
#else
#define x86_account_create(task,start,state,virtual_ms) ((void)0)
#endif
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
