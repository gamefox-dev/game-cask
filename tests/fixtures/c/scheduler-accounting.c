/* Original CC0-1.0. Controls call real profile APIs/scheduler and real interpreter.
 * No timing, OS, retirement or presentation provider is replaced. */
#include "w32_int.h"
#include "w32_thread.h"
#include "x86_sched.h"
BGT_EXPORT(account_setup) void account_setup(void) {
    w32_thread_init();
    if(!x86_map(0x1000,4096))__builtin_trap();
    /* MOV EAX,1; ADD EAX,2; RET: exactly three guest instructions. */
    const uint8_t code[]={0xb8,1,0,0,0,0x83,0xc0,2,0xc3};
    for(unsigned i=0;i<sizeof code;i++)x86_wr8(0x1000+i,code[i]);
}
BGT_EXPORT(account_api) uint64_t account_api(unsigned op,uint32_t a,uint32_t b) {
    static const char *const names[]={"CreateThread","Sleep","CreateEventA","WaitForSingleObject","SetEvent","SuspendThread","ResumeThread","SwitchToThread"};
    uint64_t args[6]={a,b,0,0,0,0};
    if(op==0){args[0]=0;args[1]=0;args[2]=0x1000;args[3]=0;args[4]=a;}
    if(op==2){args[0]=0;args[1]=1;args[2]=0;}
    if(op>=8)__builtin_trap();
    if(W32_64){X.r[ECX]=args[0];X.r[EDX]=args[1];X.r[R8]=args[2];X.r[R9]=args[3];
        for(unsigned i=4;i<6;i++)w32_wrptr((uint32_t)X.r[ESP]+40+8*(i-4),args[i]);}
    else for(unsigned i=0;i<6;i++)x86_wr32((uint32_t)X.r[ESP]+4+4*i,(uint32_t)args[i]);
    return w32_thread_api(names[op]);
}
BGT_EXPORT(account_schedule) uint32_t account_schedule(void){w32_thread_schedule();return x86_current+1;}
BGT_EXPORT(account_work) void account_work(void){
    X.transfer=0;x86_push(0x2000);x86_invoke(0x1000,0x2000);
}
BGT_EXPORT(account_fault) void account_fault(void){
    /* NOP retires; MOV EAX,[RAX] faults before retirement. */
    x86_wr8(0x1100,0x90);x86_wr8(0x1101,0x8b);x86_wr8(0x1102,0x00);
    X.r[EAX]=0x3000000;X.transfer=0;x86_push(0x2000);x86_invoke(0x1100,0x2000);
}
BGT_EXPORT(account_io) void account_io(int begin){w32_thread_io_wait(begin);}
BGT_EXPORT(account_present) void account_present(void){w32_guest_present(1);}
BGT_EXPORT(account_exit) void account_exit(void){w32_thread_return(7);}
BGT_EXPORT(account_idle) void account_idle(int begin){
    x86_account_observe(bgt_time_us(),w32_now_ms64());
    x86_account_idle(begin,bgt_time_us());
    if(begin)x86_profile_idle_begin();else x86_profile_idle_end();
}
BGT_EXPORT(account_tick) void account_tick(uint32_t frame){w32_io->frame=frame;}
