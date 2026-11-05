/* Original CC0-1.0. Tightened host policy after a native-site cache warmup. */
#define X86_COVERAGE_MODE 2
#include "native_fast_guards.c"
BGT_EXPORT(strict_fast) void strict_fast(unsigned kind){
 static const uint32_t allowed[]={0x1000,0x1001,0x2000};
 prepare();entered=0;x86_register_lifted(normal,2);x86_set_slice(allowed,3,0,0);
 native_limit=1;native_stop=0xfffffff4u;native_floor=0;X.eip=0x2000;
 x86_native_fn step=x86_native_indirect(&site,0x2000);if(!step)__builtin_trap();x86_native_drop();
 uint32_t p=x86_prepare_host_slice(1,0);if(!p)__builtin_trap();
 bgt_slice_policy_t *policy=(bgt_slice_policy_t *)(uintptr_t)p;
 *(uint32_t *)(uintptr_t)policy->entries_ptr=0x1000;
 if(kind==0){if(x86_native_enter(0x2000,target))target(0x2000);}
 if(kind==1){step=x86_native_indirect(&site,0x2000);if(step)step(0x2000);}
 if(kind==2){if(x86_native_rechain(target))target(0x2000);}
 if(kind==3){native_depth=1;if(x86_native_resume(0x2000,0,target))target(0x2000);}
}
BGT_EXPORT(native_steps) unsigned native_steps(void){return entered;}
