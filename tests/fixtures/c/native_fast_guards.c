/* Original CC0-1.0. Production fast-call guards: registry replacement, cache/NX, stops. */
#define MODE64 1
#include "coverage_accounting.c"
static unsigned entered, replacement, mode;
static x86_native_site_t site;
static void target(uint32_t pc){(void)pc;entered++;X.tsc++;X.r[EAX]=7;X.eip=(uint32_t)x86_pop();}
static void alternate(uint32_t pc){(void)pc;replacement++;X.tsc++;X.r[EAX]=9;X.eip=(uint32_t)x86_pop();}
static void root(uint32_t pc){
 X.tsc++;
 if(pc!=0x1000){X.eip=(uint32_t)x86_pop();return;}
 x86_push(0x1001);X.eip=0x2000;
 uint64_t floor=X.r[ESP];
 if(mode==2)x86_protection[2]=2;
 if(mode==0){if(!x86_native_enter(X.eip,target))return;target(X.eip);}
 else {x86_native_fn step=x86_native_indirect(&site,X.eip);if(!step)return;step(X.eip);}
 if(!x86_native_resume(0x1001,floor,root))return;
 X.eip=(uint32_t)x86_pop();X.tsc++;
}
static void root_f(void){x86_run_native(root);}
static void target_f(void){x86_run_native(target);}
static void alternate_f(void){x86_run_native(alternate);}
static const x86_lifted_entry_t normal[]={{0x1000,root_f,0x1002,root},{0x2000,target_f,0x2001,target}};
static const x86_lifted_entry_t changed[]={{0x1000,root_f,0x1002,root},{0x2000,alternate_f,0x2001,alternate}};
static void invoke_root(void){X.r[ESP]=0x8000;x86_push(0xfffffff4u);x86_invoke(0x1000,0xfffffff4u);}
BGT_EXPORT(guards) unsigned guards(void){
 prepare();entered=replacement=mode=0;x86_register_lifted(normal,2);invoke_root();
 if(entered!=1||X.r[EAX]!=7)return 1;
 mode=1;invoke_root();invoke_root();if(entered!=3)return 2;
 x86_register_lifted(changed,2);invoke_root();if(replacement!=1||entered!=3||X.r[EAX]!=9)return 3;
 /* Expected symbol mismatch must not run the old direct body. */
 mode=0;invoke_root();if(replacement!=2||entered!=3)return 4;
 /* Full-width indirect operands are validated by the emitter, not truncated here.
  * NULL weak functions and absent native overrides are never accepted. */
 if(x86_native_enter(0x2000,0))return 5;
 x86_register_lifted(normal,2);return 0;
}
BGT_EXPORT(nx_fast) void nx_fast(void){prepare();mode=2;x86_register_lifted(normal,2);invoke_root();}
