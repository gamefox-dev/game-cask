/* Original CC0-1.0. Compiler-emitted TLS plus CRT callbacks; real setjmp/longjmp imports. */
#include <windows.h>
#include <setjmp.h>
#include <stdint.h>
static __thread uint64_t tls_value=0x1234567800000042ull;
static __thread uint64_t zero_value;
static volatile int callbacks;
static jmp_buf env;
unsigned test_unwind(void);
static void NTAPI tls_callback(PVOID module,DWORD why,PVOID reserved){(void)module;(void)reserved;if(why==DLL_PROCESS_ATTACH){callbacks+=zero_value==0?1:100;zero_value=0x123456789abcull;tls_value+=7;}}
PIMAGE_TLS_CALLBACK callback_slot __attribute__((section(".CRT$XLC"),used))=tls_callback;
__declspec(noinline) static void jump_across(void){tls_value+=9;longjmp(env,23);}
int main(void){
    int n=setjmp(env);if(!n)jump_across();
    uint64_t teb,peb;__asm__ volatile("movq %%gs:0x30,%0":"=r"(teb));__asm__ volatile("movq %%gs:0x60,%0":"=r"(peb));
    int os_ok=teb!=0 && peb!=0 && *(uint64_t *)(uintptr_t)(peb+0x10)==(uintptr_t)GetModuleHandleW(0);
    int ok=os_ok && n==23 && callbacks==1 && tls_value==0x1234567800000052ull && zero_value==0x123456789abcull && test_unwind()==31;
    DWORD slot=TlsAlloc();TlsSetValue(slot,(PVOID)(uintptr_t)0x123456789abcdef0ull);ok=ok && TlsGetValue(slot)==(PVOID)(uintptr_t)0x123456789abcdef0ull;TlsFree(slot);
    char line[96];wsprintfA(line,"x64-tls %s callbacks=%d jump=%d",ok?"PASS":"FAIL",(int)callbacks,n);OutputDebugStringA(line);
    for(;;)Sleep(5);
}
