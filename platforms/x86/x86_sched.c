/* Cooperative contexts contain guest state only: no native C stack is retained.
 * Blocking thunks complete their guest return before requesting X86_SCHEDULE;
 * dispatch propagates that transfer to the outer loop. SPDX-License-Identifier: MIT */
#include "x86_sched.h"
x86_task_t x86_tasks[X86_THREADS];
uint32_t x86_current;
uint32_t x86_sched_target = X86_THREADS;
void x86_sched_init(void) {
    x86_current = 0;
    x86_tasks[0].live = x86_tasks[0].ready = 1;
    x86_tasks[0].cpu = X;
}
void x86_sched_save(void) { x86_tasks[x86_current].cpu = X; }
int x86_sched_next(void) {
    for (uint32_t n = 1; n <= X86_THREADS; n++) {
        uint32_t i = (x86_current + n) % X86_THREADS;
        if (x86_tasks[i].live && x86_tasks[i].ready &&
            (!x86_tasks[i].parked || i == x86_sched_target)) {
            x86_current = i;
            X = x86_tasks[i].cpu;
            X.transfer = 0;
            return 1;
        }
    }
    return 0;
}
