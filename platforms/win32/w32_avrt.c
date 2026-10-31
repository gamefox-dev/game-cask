/* LANE-K1: MMCSS registrations are per guest thread. Cooperative scheduling remains bounded.
 * SPDX-License-Identifier: MIT */
#include "w32_avrt.h"
#include "w32_thread.h"
static struct { uint32_t handle, task; int priority; } tasks[X86_THREADS];
static uint32_t sequence;
static uint32_t fail(uint32_t e) { *w32_thread_error() = e; return 0; }
static uint32_t set_task(void) {
    char name[128];
    if (!ARG(0) || !ARG(1)) return fail(87);
    w32_gstr(ARG(0), 0, name, sizeof name);
    static const char *names[] = {"Audio", "Capture", "Distribution", "Games", "Playback", "Pro Audio", "Window Manager"};
    uint32_t i;
    for (i = 0; i < sizeof names / sizeof names[0]; i++) if (w32_streqi(name, names[i])) break;
    if (i == sizeof names / sizeof names[0]) return fail(1550); /* ERROR_INVALID_TASK_NAME */
    if (tasks[x86_current].handle) return fail(1552); /* ERROR_THREAD_ALREADY_IN_TASK */
    uint32_t task = i + 1;
    if (x86_rd32(ARG(1)) && x86_rd32(ARG(1)) != task) return fail(1551);
    tasks[x86_current].handle = 0x35000000u + ++sequence;
    tasks[x86_current].task = task; tasks[x86_current].priority = 0;
    x86_wr32(ARG(1), task); return tasks[x86_current].handle;
}
static uint32_t priority(void) {
    if (!tasks[x86_current].handle || ARG64(0) != tasks[x86_current].handle) return fail(6);
    int p = (int32_t)ARG(1);
    if (p < -2 || p > 2) return fail(87);
    tasks[x86_current].priority = p;
    x86_sched_set_priority(x86_current, p); return 1;
}
static uint32_t revert(void) {
    if (!tasks[x86_current].handle || ARG64(0) != tasks[x86_current].handle) return fail(6);
    tasks[x86_current].handle = 0;
    x86_sched_set_priority(x86_current, 0); return 1;
}
#define API(n,a,f) {n,a,0,f}
const w32_api_t w32_api_avrt[] = {
    API("AvSetMmThreadCharacteristicsA",2,set_task), API("AvSetMmThreadPriority",2,priority),
    API("AvRevertMmThreadCharacteristics",1,revert),
};
const uint32_t w32_api_avrt_n = sizeof w32_api_avrt / sizeof w32_api_avrt[0];
