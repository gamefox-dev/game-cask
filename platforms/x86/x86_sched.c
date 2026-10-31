/* Cooperative contexts contain guest state only: no native C stack is retained.
 * Blocking thunks complete their guest return before requesting X86_SCHEDULE;
 * dispatch propagates that transfer to the outer loop. SPDX-License-Identifier: MIT */
#include "x86_sched.h"
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
    /* LANE-K1: equal default weights preserve the existing round-robin order. */
    for (uint32_t i=0; i<X86_THREADS; i++) { priorities[i]=0; credits[i]=3; }
    x86_tasks[0].live = x86_tasks[0].ready = 1;
    x86_tasks[0].cpu = X;
}
void x86_sched_save(void) { x86_tasks[x86_current].cpu = X; }
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
            x86_current = i;
            X = x86_tasks[i].cpu;
            X.transfer = 0;
            return 1;
        }
    }
    return 0;
}
