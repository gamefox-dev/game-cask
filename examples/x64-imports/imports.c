/* Original CC0-1.0. No engine or external program input. */
#include <windows.h>
#include <stdlib.h>
#include <string.h>
int _tls_index;
int iat_compare(const char *,const char *);
int tail_compare(const char *,const char *);
int reg_compare(const char *,const char *);
int saved_compare(const char *,const char *);
int patch_compare(const char *,const char *);
extern int (*__imp_strcmp)(const char *,const char *);
static int replacement(const char *a,const char *b) {(void)a;(void)b;return 73;}
static int order(const void *a,const void *b) {return *(const int *)a-*(const int *)b;}
static unsigned failures;
#define CHECK(x) do{if(!(x))failures++;}while(0)
void entry(void) {
    const char a[]={ 'a',(char)0xff,0 },b[]={ 'a',(char)0x80,0 };
    SetLastError(0x12345678);
    CHECK(iat_compare(a,b)==127);
    CHECK(tail_compare("same","same")==0);
    CHECK(reg_compare("a","z")==-25);
    CHECK(saved_compare("z","a")==25);
    CHECK(GetLastError()==0x12345678);
    CHECK(GetCurrentThreadId()==1);
    DWORD tls=TlsAlloc();
    CHECK(TlsSetValue(tls,(void *)(ULONG_PTR)0x12345678));
    SetLastError(99);CHECK(TlsGetValue(tls)==(void *)(ULONG_PTR)0x12345678);
    CHECK(GetLastError()==0);
    SetLastError(99);CHECK(TlsGetValue(64)==0);CHECK(GetLastError()==87);
    void *p=malloc(37);CHECK(p!=0);if(p){memset(p,0xab,37);free(p);}
    CHECK(TlsFree(tls));
    int values[4]={4,1,3,2};qsort(values,4,sizeof values[0],order);
    CHECK(values[0]==1&&values[1]==2&&values[2]==3&&values[3]==4);
    Sleep(1);Sleep(1); /* real suspension on the bound non-leaf path */
    /* IAT patching is legal only after obtaining write access. This deliberately
     * exercises protected-memory cold semantics too, not a writable-code shortcut. */
    DWORD old,ignored;
    CHECK(VirtualProtect(&__imp_strcmp,sizeof __imp_strcmp,PAGE_READWRITE,&old));
    int (*original)(const char *,const char *)=__imp_strcmp;
    __imp_strcmp=replacement;
    CHECK(patch_compare("a","a")==73);
    __imp_strcmp=original;
    CHECK(patch_compare("a","a")==0);
    CHECK(VirtualProtect(&__imp_strcmp,sizeof __imp_strcmp,old,&ignored));
    char message[80];wsprintfA(message,"imports failures=%u",failures);
    OutputDebugStringA(message);
    ExitProcess(failures?1:0);
}
