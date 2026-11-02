/* Original CC0 flat native driver contracts: guest recursion, owner changes, callbacks, imports. */
#define MODE64 1
#include "coverage_accounting.c"
static unsigned steps, depth, peak;
static void native_a(uint32_t pc);
static void native_b(uint32_t pc);
static void native_a(uint32_t pc) {
    (void)pc;steps++;X.tsc++;X.frame_insns++;
    depth++;if(depth>peak)peak=depth;
    if(X.r[ECX]--) { x86_push(0x1001);X.eip=0x2000; }
    else X.eip=(uint32_t)x86_pop();
    depth--;
}
static void native_b(uint32_t pc) {
    (void)pc;steps++;X.tsc++;X.frame_insns++;
    depth++;if(depth>peak)peak=depth;
    x86_push(0x2001);X.eip=0x1000;
    depth--;
}
/* Separate native entries for call and return phases to avoid using host recursion. */
static void step_a(uint32_t pc) { if(pc==0x1001){steps++;X.tsc++;X.eip=(uint32_t)x86_pop();}else native_a(pc); }
static void step_b(uint32_t pc) { if(pc==0x2001){steps++;X.tsc++;X.eip=(uint32_t)x86_pop();}else native_b(pc); }
static void entry_a(void) { x86_run_native(step_a); }
static void entry_b(void) { x86_run_native(step_b); }
BGT_EXPORT(chain) unsigned chain(void) {
    static const x86_lifted_entry_t entries[]={{0x1000,entry_a,0x1002,step_a},{0x2000,entry_b,0x2002,step_b}};
    prepare();steps=depth=peak=0;X.r[ECX]=1000;x86_register_lifted(entries,2);
    x86_push(0xfffffff4u);x86_invoke(0x1000,0xfffffff4u);
    if(X.eip!=0xfffffff4u||X.r[ESP]!=0x8000||peak!=1||steps!=4001||x86_metrics.lifted_calls!=4001)return 1;
    /* A return PC that is itself native must stop before consuming the caller's RET. */
    prepare();steps=depth=peak=0;X.r[ECX]=0;x86_register_lifted(entries,2);
    x86_push(0x2001);x86_invoke(0x1000,0x2001);
    if(X.eip!=0x2001||X.r[ESP]!=0x8000||steps!=1||x86_metrics.lifted_calls!=1)return 2;
    return 0;
}
static unsigned callback_result, callback_return, thunks;
static int callback_thunk(uint32_t addr) {
    (void)addr;thunks++;
    uint64_t args[]={17}; callback_result=(unsigned)x86_callback64(0x4000,1,args);
    callback_return=X.eip;
    X.r[EAX]=99;X.eip=(uint32_t)x86_pop();return 0;
}
static void caller_step(uint32_t pc) {
    steps++;X.tsc++;
    if(pc==0x3000){x86_push(0x3001);X.eip=0x5000;}
    else X.eip=(uint32_t)x86_pop();
}
static void callback_step(uint32_t pc) {
    (void)pc;steps++;X.tsc++;X.r[EAX]=X.r[ECX]+25;X.eip=(uint32_t)x86_pop();
}
static void caller_entry(void){x86_run_native(caller_step);}
static void callback_entry(void){x86_run_native(callback_step);}
BGT_EXPORT(callback_chain) unsigned callback_chain(void) {
    static const x86_lifted_entry_t entries[]={{0x3000,caller_entry,0x3002,caller_step},{0x4000,callback_entry,0x4001,callback_step}};
    prepare();steps=thunks=callback_result=callback_return=0;x86_register_lifted(entries,2);
    x86_set_thunks(0x5000,0x5010,callback_thunk);x86_push(0xfffffff4u);x86_invoke(0x3000,0xfffffff4u);
    if(X.eip!=0xfffffff4u||X.r[ESP]!=0x8000||X.r[EAX]!=99||callback_result!=42||callback_return!=0x5000||thunks!=1||steps!=3)return 1;
    return 0;
}
