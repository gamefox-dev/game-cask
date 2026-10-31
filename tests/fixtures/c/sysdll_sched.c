/* LANE-K1 — CC0-1.0 native scheduler property test. */
#include "x86_sched.h"
x86_cpu_t X;
int main(void) {
    x86_sched_init();
    for(uint32_t i=0;i<3;i++){x86_tasks[i].live=x86_tasks[i].ready=1;x86_tasks[i].cpu.r[0]=i;}
    if(x86_sched_set_priority(64,0)||x86_sched_set_priority(0,3))return 1;
    x86_sched_set_priority(0,-2);x86_sched_set_priority(1,2);x86_sched_set_priority(2,0);
    if(x86_sched_get_priority(0)!=-2||x86_sched_get_priority(1)!=2)return 2;
    /* Finish the initial equal-credit round. */
    for(int n=0;n<9;n++)if(!x86_sched_next())return 3;
    uint32_t count[3]={0},last[3]={0};
    for(uint32_t n=1;n<=900;n++) {
        /* Repeated high-priority API calls must NOT refill consumed credits. */
        x86_sched_set_priority(1,2);
        if(!x86_sched_next())return 4;
        uint32_t i=x86_current;count[i]++;
        if(n-last[i]>5*X86_THREADS)return 5;
        last[i]=n;
        if(X.r[0]!=i)return 6;
    }
    if(count[0]!=100||count[1]!=500||count[2]!=300)return 7;
    x86_tasks[0].parked=1;x86_tasks[1].ready=0;
    for(int n=0;n<10;n++)if(!x86_sched_next()||x86_current!=2)return 8;
    x86_tasks[0].parked=0;x86_tasks[1].ready=1;
    for(int n=0;n<330;n++)if(!x86_sched_next())return 9;
    return 0;
}
