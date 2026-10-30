/* Original CC0-1.0. Compiler-provided C++ exception runtime is linked by Zig, not replaced. */
#include <windows.h>
static volatile int destroyed,order,started;
struct Startup {Startup(){started=91;}};
static Startup startup;
struct Guard { int id; explicit Guard(int i):id(i){} ~Guard(){destroyed++;order=order*10+id;} };
struct Base { virtual int value(int)=0; virtual ~Base(){} };
struct Derived:Base { int value(int n) override {return n*7+3;} };
__declspec(noinline) static void deep(int n){Guard three(3);if(n)throw n;}
__declspec(noinline) static void middle(int n){Guard two(2);deep(n);}
static Base *volatile object;
int main(){
 CONTEXT context;RtlCaptureContext(&context);DWORD64 image=0,frame=0;PVOID data=0;
 PRUNTIME_FUNCTION function=RtlLookupFunctionEntry(context.Rip,&image,0);DWORD64 before=context.Rsp;
 if(function)RtlVirtualUnwind(UNW_FLAG_NHANDLER,image,context.Rip,function,&context,&data,&frame,0);
 int unwind_ok=function && image<0x100000000ull && context.Rsp>before && context.Rip!=0;
 Derived d;object=&d;int v=object->value(5),caught=0;
 try {Guard one(1);middle(v);}catch(int n){caught=n;}
 int ok=started==91 && unwind_ok && caught==38 && destroyed==3 && order==321;
 char line[120];wsprintfA(line,"x64-cpp %s caught=%d destructors=%d order=%d",ok?"PASS":"FAIL",caught,(int)destroyed,(int)order);OutputDebugStringA(line);
 destroyed=0;order=0;int recaught=0;
 try {try {Guard four(4);deep(6);}catch(int){Guard five(5);throw;}}catch(int n){recaught=n;}
 wsprintfA(line,"x64-cpp rethrow=%s caught=%d destructors=%d order=%d",recaught==6&&destroyed==3&&order==345?"PASS":"FAIL",recaught,(int)destroyed,(int)order);OutputDebugStringA(line);
 for(;;)Sleep(5);
}
