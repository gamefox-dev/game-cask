/* Original CC0-1.0. Mutate the active registry between admission and resume. */
#include "native_fast_guards.c"
BGT_EXPORT(growth) unsigned growth(void) {
 prepare();x86_register_lifted(normal,2);native_limit=1;X.eip=0x2000;X.r[ESP]=0x8000;
 /* Warm both the exact-PC cache and a four-target site. */
 if(!x86_native_enter(0x2000,target))return 1;x86_native_drop();
 if(x86_native_indirect(&site,0x2000)!=target)return 2;x86_native_drop();
 static const x86_lifted_entry_t grown[]={
  {0x1000,root_f,0x1002,root},{0x2000,alternate_f,0x2001,0},{0x3000,target_f,0x3001,target}};
 x86_register_lifted(grown,3);
 if(x86_find_lifted(0x2000)!=alternate_f)return 3;
 if(x86_native_enter(0x2000,target)||x86_native_indirect(&site,0x2000))return 4;
 if(!x86_native_enter(0x3000,target))return 5;x86_native_drop();
 /* Admit caller, install an override mid-frame, then attempt its continuation. */
 X.eip=0x1000;if(!x86_native_enter(0x1000,root))return 6;
 static const x86_lifted_entry_t overridden[]={
  {0x1000,alternate_f,0x1002,0},{0x2000,target_f,0x2001,target},{0x3000,target_f,0x3001,target}};
 x86_register_lifted(overridden,3);X.eip=0x1001;
 if(x86_native_resume(0x1001,0x7000,root))return 7;
 if(native_depth)return 8;
 /* Re-enable original registry, warm an interior PC and change force policy. */
 x86_register_lifted(normal,2);if(x86_find_lifted(0x1001)!=root_f)return 9;
 x86_force_interp=1;if(x86_find_lifted(0x1001)||x86_native_enter(0x1001,root))return 10;
 x86_force_interp=0;return 0;
}
BGT_EXPORT(nx_resume) void nx_resume(void) {
 prepare();x86_register_lifted(normal,2);native_limit=1;X.eip=0x1000;X.r[ESP]=0x8000;
 if(!x86_native_enter(0x1001,root))__builtin_trap();
 x86_protection[1]=2;X.eip=0x1001;(void)x86_native_resume(0x1001,0x7000,root);
}
