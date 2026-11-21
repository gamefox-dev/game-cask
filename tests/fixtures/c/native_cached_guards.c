/* Original CC0-1.0. Warm certificates may replace ONLY immutable exact-PC facts. */
#ifndef X86_NATIVE_STATS
#define X86_NATIVE_STATS 1
#endif
#include "native_fast_guards.c"
static x86_native_admission_t admission;
static int admit(unsigned kind,uint32_t pc,x86_native_fn fn) {
    X.eip=pc;
    if(kind==0)return x86_native_enter_cached(&admission,pc,fn);
    if(kind==1){native_depth=1;return x86_native_resume_cached(&admission,pc,0x7000,fn);}
    __builtin_trap();
}
static void init_cached(void) {
    prepare();x86_force_interp=0;x86_protection[1]=x86_protection[2]=0;
    x86_register_lifted(normal,2);native_limit=1;native_depth=0;
    native_stop=0xfffffff4;native_floor=0;X.r[ESP]=0x8000;X.eip=0x2000;
    __builtin_memset(&admission,0,sizeof admission);
    __builtin_memset(&x86_native_stats,0,sizeof x86_native_stats);
}
BGT_EXPORT(cached_guards) unsigned cached_guards(unsigned kind) {
    init_cached();
    if(!admit(kind,0x2000,target))return 1;if(kind==0)x86_native_drop();
    if(!admit(kind,0x2000,target))return 2;if(kind==0)x86_native_drop();
    if(x86_native_stats.native_lookups!=1||x86_native_stats.admission_hits!=1)return 3;
    /* Equal native body does not imply equal exact PC or replaceable expected. */
    if(admit(kind,0x2001,target))return 4;
    if(admit(kind,0x2000,alternate))return 5;
    x86_force_interp=1;if(admit(kind,0x2000,target))return 6;x86_force_interp=0;
    X.transfer=1;if(admit(kind,0x2000,target))return 7;X.transfer=0;
    x86_lift_count=1;if(admit(kind,0x2000,target))return 8;x86_lift_count=0;
    x86_insn_t pending={0};x86_lift_pending=&pending;
    if(admit(kind,0x2000,target))return 9;x86_lift_pending=0;
    x86_import_binding_t imported={0};pending_import=&imported;
    if(admit(kind,0x2000,target))return 10;pending_import=0;
    native_stop=0x2000;if(admit(kind,0x2000,target))return 11;native_stop=0xfffffff4;
    native_limit=0;if(admit(kind,0x2000,target))return 12;native_limit=1;
    if(kind==0){native_depth=32;if(admit(kind,0x2000,target))return 13;native_depth=0;}
    if(kind==1){
        native_depth=1;X.eip=0x1000;
        if(x86_native_resume_cached(&admission,0x2000,0x7000,target))return 14;
        native_depth=1;X.eip=0x2000;X.r[ESP]=UINT64_C(0x100008000);
        if(x86_native_resume_cached(&admission,0x2000,UINT64_C(0x100008000),target))return 15;
        native_depth=1;X.r[ESP]=UINT64_C(0x100008001);
        if(!x86_native_resume_cached(&admission,0x2000,UINT64_C(0x100008000),target))return 16;
        X.r[ESP]=0x8000;
    }
    x86_register_lifted(changed,2);if(admit(kind,0x2000,target))return 17;
    if(!admit(kind,0x2000,alternate))return 18;if(kind==0)x86_native_drop();
    static const x86_lifted_entry_t override[]={{0x2000,alternate_f,0x2001,0}};
    x86_register_lifted(override,1);if(admit(kind,0x2000,alternate))return 19;
    return 0;
}
BGT_EXPORT(cached_nx) void cached_nx(unsigned kind) {
    init_cached();if(!admit(kind,0x2000,target))__builtin_trap();if(kind==0)x86_native_drop();
    x86_protection[2]=2;(void)admit(kind,0x2000,target);
}
BGT_EXPORT(cached_strict) void cached_strict(unsigned kind) {
    static const uint32_t allowed[]={0x1000,0x1001,0x2000};
    init_cached();x86_set_slice(allowed,3,0,0);
    if(!admit(kind,0x2000,target))__builtin_trap();if(kind==0)x86_native_drop();
    uint32_t p=x86_prepare_host_slice(1,0);if(!p)__builtin_trap();
    bgt_slice_policy_t *policy=(bgt_slice_policy_t *)(uintptr_t)p;
    *(uint32_t *)(uintptr_t)policy->entries_ptr=0x1000;
    if(admit(kind,0x2000,target))target(0x2000);
}
