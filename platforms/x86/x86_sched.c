/* Cooperative contexts contain guest state only: no native C stack is retained.
 * Blocking thunks complete their guest return before requesting X86_SCHEDULE;
 * dispatch propagates that transfer to the outer loop. SPDX-License-Identifier: MIT */
#include "x86_sched.h"
#include "bgt.h"
x86_account_t x86_accounts[X86_THREADS];
#if X86_ACCOUNTING_ENABLED && X86_PROFILE_ENABLED
static double account_wall[X86_THREADS], park_start;
static uint64_t account_virtual[X86_THREADS], observed_virtual;
static int account_parked;
static unsigned idle_state;
static void account_charge(uint32_t i, double now, uint64_t virtual_ms) {
    x86_account_t *a = &x86_accounts[i];
    if (!a->id) return;
    if (now >= account_wall[i]) a->wall_us[a->state] += now - account_wall[i];
    if (virtual_ms >= account_virtual[i]) a->virtual_ms[a->state] += virtual_ms - account_virtual[i];
    account_wall[i] = now; account_virtual[i] = virtual_ms;
}
void x86_account_observe(double now, uint64_t virtual_ms) {
    observed_virtual = virtual_ms;
    for (uint32_t i=0;i<X86_THREADS;i++) account_charge(i, now, virtual_ms);
    if (account_parked && now >= park_start) {
        x86_accounts[x86_current].parked_us += now - park_start; park_start = now;
    }
}
void x86_account_state(uint32_t i, unsigned state, uint64_t virtual_ms) {
    account_charge(i, bgt_time_us(), virtual_ms);
    x86_accounts[i].state = state; observed_virtual = virtual_ms;
}
void x86_account_idle(int begin, double now) {
    if (begin) {
        if (account_parked) return;
        account_charge(x86_current, now, observed_virtual);
        idle_state = x86_accounts[x86_current].state;
        if (idle_state == XA_RUNNING) x86_accounts[x86_current].state = XA_HOST_YIELD;
        account_parked = 1; park_start = now;
    } else if (account_parked) {
        x86_account_observe(now, observed_virtual);
        x86_accounts[x86_current].state = idle_state; account_parked = 0;
    }
}
void x86_account_abort(double now) {
    if (!__builtin_isfinite(now)) now=account_wall[x86_current];
    if (account_parked) x86_account_idle(0,now);
    account_charge(x86_current, now, observed_virtual);
    if(x86_accounts[x86_current].state==XA_RUNNING)x86_accounts[x86_current].state=XA_READY;
}
#endif
#if X86_ACCOUNTING_ENABLED
void x86_account_create(uint32_t i, uint32_t start, unsigned state, uint64_t virtual_ms) {
    x86_account_t *a=&x86_accounts[i];a->id=i+1;a->start_address=start;a->state=state;
#if X86_PROFILE_ENABLED
    account_wall[i]=bgt_time_us();account_virtual[i]=virtual_ms;
#endif
    (void)virtual_ms;
}
#endif
x86_task_t x86_tasks[X86_THREADS];
uint32_t x86_current;
uint32_t x86_sched_target = X86_THREADS;
/* LANE-K1: priority changes quantum share, never eligibility or instruction semantics. */
static int priorities[X86_THREADS];
static uint8_t credits[X86_THREADS];
int x86_sched_set_priority(uint32_t task, int priority) {
    if (task >= X86_THREADS || priority < -2 || priority > 2) return 0;
    priorities[task] = priority;
    /* Do not replenish credits here: repeated API calls must not starve other tasks. */
    return 1;
}
int x86_sched_get_priority(uint32_t task) { return task < X86_THREADS ? priorities[task] : 0; }
void x86_sched_init(void) {
    x86_current = 0;
#if X86_ACCOUNTING_ENABLED && X86_PROFILE_ENABLED
    x86_account_abort_hook = x86_account_abort;
#endif
#if X86_ACCOUNTING_ENABLED
    x86_accounts[0].retired = *x86_thread_retired;
    x86_thread_retired = &x86_accounts[0].retired;
#endif
    /* LANE-K1: equal default weights preserve the existing round-robin order. */
    for (uint32_t i=0; i<X86_THREADS; i++) { priorities[i]=0; credits[i]=3; }
    x86_tasks[0].live = x86_tasks[0].ready = 1;
    x86_tasks[0].cpu = X;
}
void x86_sched_save(void) {
    x86_tasks[x86_current].cpu = X;
#if X86_ACCOUNTING_ENABLED
    if(x86_accounts[x86_current].state==XA_RUNNING)x86_account_state(x86_current,XA_READY,observed_virtual);
#endif
}
int x86_sched_next(void) {
    /* LANE-K1: refill only after every eligible task has spent its credits. */
    int credited = 0;
    for (uint32_t i=0; i<X86_THREADS; i++)
        if (x86_tasks[i].live && x86_tasks[i].ready &&
            (!x86_tasks[i].parked || i == x86_sched_target) && credits[i]) credited=1;
    if (!credited) for (uint32_t i=0; i<X86_THREADS; i++) credits[i]=(uint8_t)(priorities[i]+3);
    for (uint32_t n = 1; n <= X86_THREADS; n++) {
        uint32_t i = (x86_current + n) % X86_THREADS;
        if (x86_tasks[i].live && x86_tasks[i].ready && credits[i] &&
            (!x86_tasks[i].parked || i == x86_sched_target)) {
            credits[i]--; /* LANE-K1 */
#if X86_ACCOUNTING_ENABLED && X86_PROFILE_ENABLED
            if (i != x86_current) x86_accounts[i].switches++;
#endif
#if X86_ACCOUNTING_ENABLED
            if(x86_accounts[i].state==XA_READY)x86_account_state(i,XA_RUNNING,observed_virtual);
#endif
            x86_current = i;
#if X86_ACCOUNTING_ENABLED
            x86_thread_retired = &x86_accounts[i].retired;
#endif
            X = x86_tasks[i].cpu;
            X.transfer = 0;
            return 1;
        }
    }
    return 0;
}
