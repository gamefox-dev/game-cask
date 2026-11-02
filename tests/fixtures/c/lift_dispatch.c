/* Original CC0-1.0 registry/cache and spilled thunk contracts through the actual runtime. */
#define MODE64 1
#include "coverage_accounting.c"
static void first(void) {}
static void second(void) {}
static int calls;
static int host_thunk(uint32_t address) {
    calls++;
    if (address == 0x5010) { X.transfer = X86_SCHEDULE; return 0; }
    X.r[EAX] = X.r[ECX] + X.r[EDX] + X.r[R8] + X.r[R9] + x86_rd64((uint32_t)X.r[ESP] + 40);
    X.eip = (uint32_t)x86_pop();
    return 0;
}
BGT_EXPORT(cache) uint32_t cache(void) {
    static const x86_lifted_entry_t a[]={{0x1000,first,0x1100,0},{0x2000,second,0x2100,0}};
    static const x86_lifted_entry_t b[]={{0x1000,second,0x1001,0}};
    prepare(); x86_register_lifted(a,2);
    for(unsigned repeat=0;repeat<3;repeat++) {
        for(unsigned p=0x0fff;p<=0x2100;p++) {
            x86_lifted_fn expected=p>=0x1000&&p<0x1100?first:p>=0x2000&&p<0x2100?second:0;
            if(x86_find_lifted(p)!=expected)return 1;
            if(x86_find_lifted(p)!=expected)return 2;
        }
    }
    x86_force_interp=1;if(x86_find_lifted(0x1000))return 3;x86_force_interp=0;
    x86_register_lifted(b,1);
    if(x86_find_lifted(0x1000)!=second||x86_find_lifted(0x1001))return 4;
    x86_register_lifted(a,2);
    if(x86_find_lifted(0x1001)!=first)return 5;
    return 0;
}
BGT_EXPORT(nx) void nx(void) {
    static const x86_lifted_entry_t a[]={{0x1000,first,0x1100,0}};
    prepare();x86_register_lifted(a,1);(void)x86_find_lifted(0x1000);
    x86_protection[1]=2; // cached entry must still check execute permission
    (void)x86_find_lifted(0x1000);
}
BGT_EXPORT(thunk) uint32_t thunk(void) {
    prepare();calls=0;x86_lift_pending=0;x86_lift_count=0;x86_set_thunks(0x5000,0x5020,host_thunk);
    X.r[ECX]=11;X.r[EDX]=22;X.r[R8]=33;X.r[R9]=44;
    x86_push(0x1234);x86_wr64((uint32_t)X.r[ESP]+40,55);X.eip=0x5000;
    x86_lift_thunk();
    if(calls!=1||X.r[EAX]!=165||X.eip!=0x1234||X.r[ESP]!=0x8000||x86_metrics.thunk_dispatches!=1)return 1;
    X.eip=0x5000;X.transfer=X86_SCHEDULE;x86_lift_thunk();if(calls!=1)return 2;
    X.transfer=0;x86_lift_count=1;x86_lift_thunk();if(calls!=1)return 3;
    x86_lift_count=0;x86_insn_t pending={0};x86_lift_pending=&pending;x86_lift_thunk();if(calls!=1)return 4;
    x86_lift_pending=0;X.eip=0x1234;x86_lift_thunk();if(calls!=1)return 5;
    X.eip=0x5010;x86_lift_thunk();if(calls!=2||X.transfer!=X86_SCHEDULE)return 6;
    return 0;
}
