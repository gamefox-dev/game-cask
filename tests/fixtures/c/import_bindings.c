/* Original CC0-1.0: production binding/runtime and nonlocal boundaries. */
#include "lift_dispatch.c"
static int leaf_hits,bound_hits;
static int test_leaf(void *opaque,uint64_t target) {
    leaf_hits++;X.r[EAX]=(uint64_t)(uintptr_t)opaque+target;X.eip=(uint32_t)x86_pop();return 1;
}
static void test_bound(void *opaque) {
    bound_hits++;X.r[EAX]=(uintptr_t)opaque;X.eip=(uint32_t)x86_pop();
    if((uintptr_t)opaque==9)X.transfer=X86_SCHEDULE;
}
static x86_import_site_t site={.iat=0x4000};
static void defer_step(uint32_t pc) {
    (void)pc;X.tsc++;X.eip=0x5000;
    if(!x86_defer_import(&site,0x5000))__builtin_trap();
}
BGT_EXPORT(bindings) unsigned bindings(void) {
    prepare();leaf_hits=bound_hits=0;
    x86_set_thunks(0x5000,0x5020,host_thunk);
    x86_bind_import(0x4000,0x5000,(void *)7,test_bound,test_leaf);
    /* Guard the actual operand, not a re-read slot: old cached register targets
     * still work after the guest patches its slot. High bits must never alias. */
    x86_wr64(0x4000,0x5010);x86_push(0x1234);X.eip=0x5000;
    if(!x86_try_import(&site,0x5000)||leaf_hits!=1||X.eip!=0x1234||X.r[EAX]!=0x5007)return 1;
    if(x86_try_import(&site,0x5010)||x86_try_import(&site,0x100005000ull)||leaf_hits!=1)return 2;
    if(x86_defer_import(&site,0x5010))return 3;
    /* A cold binding may suspend. Its token is consumed BEFORE entering C, so
     * callbacks/scheduling cannot replay an old API invocation. */
    x86_set_thunks(0x5000,0x5020,host_thunk);
    x86_bind_import(0x4000,0x5000,(void *)9,test_bound,0);
    if(x86_try_import(&site,0x5000))return 4;
    x86_push(0x1234);X.eip=0x2000;x86_run_native(defer_step);
    if(bound_hits!=1||X.transfer!=X86_SCHEDULE||X.eip!=0x1234||X.r[EAX]!=9)return 5;
    X.transfer=0;X.eip=0x5000;x86_push(0x1234);x86_lift_thunk();
    if(bound_hits!=1)return 6;
    /* Registration invalidates positive AND negative site caches. */
    static x86_import_site_t miss={.iat=0x4010};
    if(x86_try_import(&miss,0x5010))return 7;
    x86_set_thunks(0x5000,0x5020,host_thunk);
    x86_bind_import(0x4010,0x5010,(void *)11,test_bound,test_leaf);
    x86_push(0x1234);if(!x86_try_import(&miss,0x5010)||X.r[EAX]!=0x501b)return 8;
    return 0;
}
