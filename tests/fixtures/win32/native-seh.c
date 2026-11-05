/* Original CC0-1.0. Successful AMD64 table SEH; explicit i386 missing-dispatch boundary. */
#include <windows.h>
#include <excpt.h>
unsigned _tls_index;
/* Retain a base relocation for the normal Win64 loader/rebase contract. */
static void *volatile relocation_anchor=(void *)&relocation_anchor;
#ifdef _WIN64
volatile ULONG_PTR seh_expected_sp;
volatile unsigned seh_bad_return,seh_landed;
static unsigned filtered,searched,unwound;
static int valid_record(EXCEPTION_RECORD *r) {
 return r->ExceptionCode==0xe0420032u && r->NumberParameters==2 &&
  r->ExceptionInformation[0]==0x1122334455667788ull &&
  r->ExceptionInformation[1]==0x8877665544332211ull;
}
LONG seh_filter(EXCEPTION_POINTERS *ep,void *frame) {
 if(!valid_record(ep->ExceptionRecord) || (ULONG_PTR)frame!=seh_expected_sp ||
    searched!=1 || unwound || seh_landed || seh_bad_return)seh_bad_return=5;
 filtered++;
 return EXCEPTION_EXECUTE_HANDLER;
}
EXCEPTION_DISPOSITION seh_observer(EXCEPTION_RECORD *r,void *frame,CONTEXT *c,void *dispatch) {
 (void)frame;(void)c;(void)dispatch;
 if(!valid_record(r) || seh_bad_return || seh_landed)seh_bad_return=6;
 if(r->ExceptionFlags&EXCEPTION_UNWINDING){unwound++;if(filtered!=1)seh_bad_return=7;}
 else searched++;
 return ExceptionContinueSearch;
}
EXCEPTION_DISPOSITION seh_specific(EXCEPTION_RECORD *r,void *frame,CONTEXT *c,void *dispatch) {
 typedef EXCEPTION_DISPOSITION (*handler_fn)(EXCEPTION_RECORD *,void *,CONTEXT *,void *);
 handler_fn fn=(handler_fn)GetProcAddress(LoadLibraryA("msvcrt.dll"),"__C_specific_handler");
 return fn(r,frame,c,dispatch);
}
/* RVA-only EH metadata is not a code-pointer seed. Retain ordinary DIR64 pointers
 * so all three leaf handlers are genuinely lifted rather than silently interpreted. */
static void *volatile handler_refs[]={(void *)seh_filter,(void *)seh_observer,(void *)seh_specific};
extern void seh_catch(void);
void entry(void) {
 (void)relocation_anchor;
 (void)handler_refs[0];(void)handler_refs[1];(void)handler_refs[2];
 OutputDebugStringA("SEH before");
 seh_catch();
 unsigned ok=filtered==1 && searched==1 && unwound==1 && seh_landed==1 && !seh_bad_return;
 OutputDebugStringA(ok?"SEH PASS filtered=1 searched=1 unwound=1 landed=1":"SEH FAIL");
 ExitProcess(ok?0:1);
}
#else
/* Installing a real frame does not imply that the kit can dispatch to it. */
static EXCEPTION_DISPOSITION __cdecl frame_handler(EXCEPTION_RECORD *r,void *frame,CONTEXT *c,void *dispatch) {
 (void)r;(void)frame;(void)c;(void)dispatch;
 OutputDebugStringA("SEH FAIL unsupported handler executed");
 return ExceptionContinueSearch;
}
void entry(void) {
 (void)relocation_anchor;
 struct {void *previous;void *handler;} frame;
 __asm__ __volatile__("movl %%fs:0,%0":"=r"(frame.previous));
 frame.handler=(void *)frame_handler;
 __asm__ __volatile__("movl %0,%%fs:0"::"r"(&frame):"memory");
 OutputDebugStringA("SEH i386 frame installed");
 RaiseException(0xe0420032u,0,0,0);
 OutputDebugStringA("SEH FAIL unsupported raise returned");
 ExitProcess(1);
}
#endif
