/* Original CC0-1.0: hand-checked UNWIND_INFO structures test the OS contract independently of the oracle. */
#include <windows.h>
#include <stdint.h>
static unsigned char code[32],info[64];
static uint64_t stack[32];
static RUNTIME_FUNCTION function;
static CONTEXT context;
static void init(void){for(unsigned i=0;i<sizeof code;i++)code[i]=0x90;for(unsigned i=0;i<sizeof info;i++)info[i]=0;for(unsigned i=0;i<32;i++)stack[i]=0;context=(CONTEXT){0};function.BeginAddress=0;function.EndAddress=sizeof code;function.UnwindData=(DWORD)((uintptr_t)info-(uintptr_t)code);context.Rsp=(DWORD64)(uintptr_t)stack;}
static void unwind(unsigned pc){PVOID data=0;DWORD64 frame=0;RtlVirtualUnwind(UNW_FLAG_NHANDLER,(DWORD64)(uintptr_t)code,(DWORD64)(uintptr_t)code+pc,&function,&context,&data,&frame,0);}
unsigned test_unwind(void){unsigned bits=0;
 init();info[0]=1;info[1]=4;info[2]=2;info[4]=4;info[5]=0x32;info[6]=1;info[7]=0x30;stack[4]=0x123456789abcdef0ull;stack[5]=0x1234;unwind(8);
 if(context.Rbx==0x123456789abcdef0ull && context.Rsp==(uintptr_t)(stack+6)&&context.Rip==0x1234)bits|=1;
 init();info[0]=1;info[1]=4;info[2]=2;info[4]=4;info[5]=0x32;info[6]=1;info[7]=0x30;stack[0]=0xaabbccdd;stack[1]=0x1234;unwind(2);
 if(context.Rbx==0xaabbccdd && context.Rsp==(uintptr_t)(stack+2)&&context.Rip==0x1234)bits|=2;
 init();info[0]=1;info[1]=1;info[2]=2;info[4]=1;info[5]=0x01;info[6]=8;stack[8]=0x5678;unwind(8);
 if(context.Rsp==(uintptr_t)(stack+9)&&context.Rip==0x5678)bits|=4;
 init();info[0]=1;info[1]=1;info[2]=2;info[4]=1;info[5]=0x68;info[6]=1;stack[0]=0x1234;stack[2]=0x1122334455667788ull;stack[3]=0x8877665544332211ull;unwind(8);
 if(context.Xmm6.Low==0x1122334455667788ull&&(uint64_t)context.Xmm6.High==0x8877665544332211ull&&context.Rip==0x1234)bits|=8;
 init();info[0]=1;info[1]=4;info[2]=2;info[4]=4;info[5]=0x32;info[6]=1;info[7]=0x30;code[8]=0x48;code[9]=0x83;code[10]=0xc4;code[11]=32;code[12]=0x5b;code[13]=0xc3;stack[4]=0x7788;stack[5]=0x1234;unwind(8);
 if(context.Rbx==0x7788&&context.Rsp==(uintptr_t)(stack+6)&&context.Rip==0x1234)bits|=16;
 return bits;
}
