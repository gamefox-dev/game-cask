/* Original CC0-1.0 Win32/CRT heap contracts; no game inputs or host APIs. */
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
unsigned _tls_index;
static unsigned checks,failures;
#define CHECK(x) do {checks++;if(!(x)){failures++;OutputDebugStringA("heap FAIL: " #x);}}while(0)
typedef void *(__cdecl *malloc_fn)(size_t);
typedef void *(__cdecl *calloc_fn)(size_t,size_t);
typedef void *(__cdecl *realloc_fn)(void *,size_t);
typedef void (__cdecl *free_fn)(void *);
typedef size_t (__cdecl *size_fn)(void *);
typedef int *(__cdecl *errno_fn)(void);
typedef void *(__cdecl *recalloc_fn)(void *,size_t,size_t);
typedef void *(__cdecl *aligned_fn)(size_t,size_t);
typedef void *(__cdecl *offset_fn)(size_t,size_t,size_t);
typedef void *(__cdecl *aligned_re_fn)(void *,size_t,size_t);
typedef void *(__cdecl *offset_re_fn)(void *,size_t,size_t,size_t);
typedef void *(__cdecl *aligned_rec_fn)(void *,size_t,size_t,size_t);
typedef void *(__cdecl *offset_rec_fn)(void *,size_t,size_t,size_t,size_t);
typedef size_t (__cdecl *aligned_size_fn)(void *,size_t,size_t);
static HANDLE heap_handles[255];
static void *ptrs[12000];
static unsigned lens[12000];
static unsigned char pattern(unsigned i,unsigned k){return (unsigned char)(i*19+k*7);}
static unsigned decimal(char *out,unsigned value) {
    char reversed[16];unsigned n=0;
    do {reversed[n++]=(char)('0'+value%10);value/=10;}while(value);
    for(unsigned i=0;i<n;i++)out[i]=reversed[n-i-1];return n;
}
static void summary(void) {
    char text[120];const char *prefix="heap checks=",*middle=" failures=";unsigned n=0;
    while(*prefix)text[n++]=*prefix++;
    n+=decimal(text+n,checks);while(*middle)text[n++]=*middle++;
    n+=decimal(text+n,failures);text[n]=0;OutputDebugStringA(text);
}
#ifdef _WIN64
#include <excpt.h>
static unsigned exception_seen,exception_case,nested_oom;
static void heap_catch(void);
static HANDLE exception_heap;
static unsigned char *exception_original;
#ifdef HEAP_EXHAUST
static void *exhausted_blocks[65536];
#endif
LONG heap_filter(EXCEPTION_POINTERS *ep,void *frame) {
    (void)frame;CHECK(ep->ExceptionRecord->ExceptionCode==0xc0000017u);
    CHECK(ep->ExceptionRecord->NumberParameters==0);exception_seen++;
    if(nested_oom==1){
        nested_oom=2;heap_catch();
        CHECK(ep->ExceptionRecord->ExceptionCode==0xc0000017u&&ep->ExceptionRecord->NumberParameters==0);
    }
    return EXCEPTION_EXECUTE_HANDLER;
}
LONG (*volatile heap_filter_ref)(EXCEPTION_POINTERS *,void *)=heap_filter;
EXCEPTION_DISPOSITION heap_specific_handler(EXCEPTION_RECORD *r,void *frame,CONTEXT *c,void *dispatch) {
    typedef EXCEPTION_DISPOSITION (*handler_fn)(EXCEPTION_RECORD *,void *,CONTEXT *,void *);
    handler_fn handler=(handler_fn)GetProcAddress(LoadLibraryA("msvcrt.dll"),"__C_specific_handler");
    return handler(r,frame,c,dispatch);
}
__attribute__((noinline,section(".text"))) static void heap_catch(void) {
    __asm__ __volatile__(".l_heap_begin:\n.seh_handler heap_specific_handler, @except\n"
        ".seh_handlerdata\n.long 1\n.rva .l_heap_begin, .l_heap_end, heap_filter, .l_heap_end\n.text\n");
    if(exception_case==4)HeapCreate(HEAP_GENERATE_EXCEPTIONS,(SIZE_T)-1,0);
    else if(exception_case==3)HeapReAlloc(exception_heap,0,exception_original,(SIZE_T)-1);
    else HeapAlloc(exception_heap,exception_case==1?HEAP_GENERATE_EXCEPTIONS:0,(SIZE_T)-1);
    OutputDebugStringA("heap FAIL: caught exception returned");
    __asm__ __volatile__("nop\n.l_heap_end: nop\n");
}
#endif
void entry(void) {
#if defined(_WIN64) && defined(HEAP_EXHAUST)
    exception_heap=GetProcessHeap();exception_original=HeapAlloc(exception_heap,0,64);CHECK(exception_original!=0);
    exception_original[0]=93;unsigned count=0;
    const unsigned chunks[]={1048576,65536,1024,16};
    for(unsigned i=0;i<4;i++)while(count<65536){
        void *p=HeapAlloc(exception_heap,0,chunks[i]);if(!p)break;exhausted_blocks[count++]=p;
    }
    CHECK(count<65536);CHECK(!HeapAlloc(exception_heap,0,16));
    exception_case=1;
#ifdef HEAP_NESTED
    nested_oom=1;
#endif
    heap_catch();CHECK(exception_seen==1&&exception_original[0]==93);
    for(unsigned i=0;i<count;i++)CHECK(HeapFree(exception_heap,0,exhausted_blocks[i]));
    CHECK(HeapFree(exception_heap,0,exception_original));
    OutputDebugStringA(failures?"heap exhaustion FAIL":"heap exhaustion PASS");ExitProcess(failures?1:0);
#endif
    uintptr_t heap_base=sizeof(void*)==8?0x04000000u:0x20000000u;
    unsigned char *reservation=VirtualAlloc((void *)(heap_base+65536),65536,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);
    CHECK(reservation==(void *)(heap_base+65536));
    if(!reservation)ExitProcess(2);
    for(unsigned i=0;i<65536;i+=4096)reservation[i]=0xe3;
    HANDLE process=GetProcessHeap(),a=HeapCreate(HEAP_NO_SERIALIZE,0,0),b=HeapCreate(0,0,0);
    CHECK(process==GetProcessHeap()&&a&&b&&a!=b&&a!=process);
    SetLastError(1234);CHECK(HeapAlloc((HANDLE)(uintptr_t)0x123,0,1)==0&&GetLastError()==6);
    CHECK(!HeapDestroy(process));CHECK(GetLastError()==6);
    CHECK(!HeapCreate(0,200,100)&&GetLastError()==87);
    CHECK(!HeapCreate(0x40000000,0,0)&&GetLastError()==50);
    SetLastError(4242);CHECK(!HeapCreate(0,0x40000000u,0)&&GetLastError()==8);
    HANDLE limited=HeapCreate(HEAP_NO_SERIALIZE,0,512);
    unsigned char *p=HeapAlloc(limited,HEAP_ZERO_MEMORY|HEAP_NO_SERIALIZE,61);
    CHECK(p&&((uintptr_t)p%(sizeof(void*)==8?16:8))==0&&HeapSize(limited,0,p)==61);
    if(!p)ExitProcess(2);
    for(unsigned i=0;i<61;i++)CHECK(p[i]==0);
    for(unsigned i=0;i<61;i++)p[i]=(unsigned char)(i+1);
    CHECK(HeapSize(a,0,p)==(SIZE_T)-1&&GetLastError()==87);
    CHECK(!HeapFree(a,0,p)&&GetLastError()==87);
    CHECK(!HeapReAlloc(a,0,p,123)&&GetLastError()==87);
    SetLastError(321);CHECK(!HeapAlloc(limited,0,500)&&GetLastError()==321);
    CHECK(!HeapAlloc(limited,0,(SIZE_T)-1)&&GetLastError()==321);
    CHECK(!HeapReAlloc(limited,0,p,(SIZE_T)-1)&&GetLastError()==321);
    CHECK(HeapSize(limited,0,p)==61&&p[60]==61);
    CHECK(HeapReAlloc(limited,HEAP_REALLOC_IN_PLACE_ONLY|HEAP_ZERO_MEMORY,p,30)==p);
    CHECK(HeapSize(limited,0,p)==30&&p[29]==30);
    CHECK(HeapReAlloc(limited,HEAP_REALLOC_IN_PLACE_ONLY|HEAP_ZERO_MEMORY,p,61)==p);
    for(unsigned i=30;i<61;i++)CHECK(p[i]==0);
    CHECK(HeapFree(limited,0,p));CHECK(!HeapFree(limited,0,p)&&GetLastError()==87);
    CHECK(HeapFree(limited,0,0));CHECK(HeapDestroy(limited));CHECK(!HeapDestroy(limited)&&GetLastError()==6);
    CHECK(!HeapAlloc(limited,0,1)&&GetLastError()==6);
    CHECK(!HeapAlloc(a,0x80000000u,1)&&GetLastError()==87);
    CHECK(!HeapFree(a,8,0)&&GetLastError()==87);
    CHECK(HeapSize(a,8,0)==(SIZE_T)-1&&GetLastError()==87);
    CHECK(!HeapReAlloc(a,0x80000000u,0,1)&&GetLastError()==87);
#ifdef _WIN64
    CHECK(!HeapAlloc((HANDLE)((uintptr_t)a+(1ull<<32)),0,1)&&GetLastError()==6);
    CHECK(!HeapAlloc(a,0,1ull<<32));
#endif
    CHECK(HeapSize(a,0,0)==(SIZE_T)-1&&GetLastError()==87);
    CHECK(!HeapReAlloc(a,0,0,17)&&GetLastError()==87);
    /* Three adjacent blocks: next-free growth, shrink reuse and both-side coalescing. */
    p=HeapAlloc(a,0,200);unsigned char *q=HeapAlloc(b,0,200),*r=HeapAlloc(a,0,200),*guard=HeapAlloc(a,0,200);
    CHECK(p&&q&&r&&guard);for(unsigned i=0;i<200;i++)p[i]=91;
    CHECK(!HeapReAlloc(a,HEAP_REALLOC_IN_PLACE_ONLY,p,350));CHECK(HeapSize(a,0,p)==200);
    CHECK(HeapFree(b,0,q));CHECK(HeapReAlloc(a,HEAP_REALLOC_IN_PLACE_ONLY|HEAP_ZERO_MEMORY,p,350)==p);
    for(unsigned i=0;i<350;i++)CHECK(p[i]==(i<200?91:0));
    CHECK(HeapReAlloc(a,0,p,30)==p&&HeapSize(a,0,p)==30);
    CHECK(HeapFree(a,0,r));CHECK(HeapFree(a,0,p));
    p=HeapAlloc(b,0,600);CHECK(p&&p<guard);CHECK(HeapFree(b,0,p));CHECK(HeapFree(a,0,guard));
    /* Moved realloc must preserve the old bytes and initialize just the new range. */
    p=HeapAlloc(a,0,64);q=HeapAlloc(a,0,64);for(unsigned i=0;i<64;i++)p[i]=37;
    r=HeapReAlloc(a,HEAP_ZERO_MEMORY,p,4000);CHECK(r&&r!=p&&HeapSize(a,0,r)==4000);
    for(unsigned i=0;i<4000;i++)CHECK(r[i]==(i<64?37:0));
    CHECK(HeapFree(a,0,q));CHECK(HeapFree(a,0,r));
    HANDLE exceptional=HeapCreate(HEAP_GENERATE_EXCEPTIONS,0,1024);
    CHECK(exceptional!=0);p=HeapAlloc(exceptional,0,12);CHECK(p!=0);
    CHECK(HeapReAlloc(exceptional,HEAP_GENERATE_EXCEPTIONS,p,24)!=0);CHECK(HeapDestroy(exceptional));
    p=HeapAlloc(a,HEAP_GENERATE_EXCEPTIONS,0);CHECK(p&&HeapSize(a,0,p)==0);CHECK(HeapFree(a,0,p));
#ifdef _WIN64
    for(exception_case=1;exception_case<=4;exception_case++){
        exception_heap=HeapCreate(exception_case==1?0:HEAP_GENERATE_EXCEPTIONS,0,1024);
        exception_original=HeapAlloc(exception_heap,0,64);CHECK(exception_original!=0);exception_original[0]=93;
        heap_catch();CHECK(exception_seen==exception_case);
        CHECK(HeapSize(exception_heap,0,exception_original)==64&&exception_original[0]==93);
        CHECK(HeapDestroy(exception_heap));
    }
#endif
    HMODULE crt=LoadLibraryA("msvcrt.dll");
#define LOAD(type,var,name) type var=(type)GetProcAddress(crt,name);CHECK(var!=0)
    LOAD(malloc_fn,alloc,"malloc");LOAD(calloc_fn,zalloc,"calloc");LOAD(realloc_fn,resize,"realloc");
    LOAD(free_fn,release,"free");LOAD(size_fn,msize,"_msize");LOAD(errno_fn,err,"_errno");LOAD(recalloc_fn,rezero,"_recalloc");
    LOAD(aligned_fn,align,"_aligned_malloc");LOAD(free_fn,alignfree,"_aligned_free");LOAD(aligned_size_fn,alignsize,"_aligned_msize");
    LOAD(aligned_re_fn,alignre,"_aligned_realloc");LOAD(aligned_rec_fn,alignrec,"_aligned_recalloc");
    LOAD(offset_fn,offset,"_aligned_offset_malloc");LOAD(offset_re_fn,offsetre,"_aligned_offset_realloc");LOAD(offset_rec_fn,offsetrec,"_aligned_offset_recalloc");
    p=alloc(31);CHECK(p&&msize(p)==31&&HeapSize(process,0,p)==31);for(unsigned i=0;i<31;i++)p[i]=73;
    *err()=0;CHECK(!alloc((SIZE_T)-1)&&*err()==12);CHECK(!zalloc((SIZE_T)-1,2)&&*err()==12);
    CHECK(!resize(p,(SIZE_T)-1)&&*err()==12&&msize(p)==31&&p[30]==73);
    r=rezero(p,100,3);CHECK(r&&msize(r)==300);
    for(unsigned i=0;i<300;i++)CHECK(r[i]==(i<31?73:0));
    CHECK(!rezero(r,(SIZE_T)-1,2)&&*err()==12&&msize(r)==300);
    p=rezero(r,13,1);CHECK(p&&msize(p)==13);CHECK(resize(p,0)==0);
    p=resize(0,0);CHECK(p==0);p=alloc(0);CHECK(p&&msize(p)==0);release(p);release(0);
    p=zalloc(7,19);CHECK(p&&msize(p)==133);for(unsigned i=0;i<133;i++)CHECK(p[i]==0);release(p);
    CHECK(msize(0)==(SIZE_T)-1&&*err()==22);
    for(unsigned al=1;al<=4096;al*=2){
        p=align(37,al);CHECK(p&&((uintptr_t)p%al)==0&&alignsize(p,al,0)==37);
        for(unsigned i=0;i<37;i++)p[i]=117;
        q=alignre(p,67,al);CHECK(q&&alignsize(q,al,0)==67);for(unsigned i=0;i<37;i++)CHECK(q[i]==117);
        r=alignrec(q,139,1,al);CHECK(r&&alignsize(r,al,0)==139);
        for(unsigned i=0;i<37;i++)CHECK(r[i]==117);for(unsigned i=67;i<139;i++)CHECK(r[i]==0);
        CHECK(!alignre(r,(SIZE_T)-1,al)&&*err()==12&&r[0]==117);
        CHECK(!alignre(r,100,3)&&*err()==22&&r[0]==117);
        CHECK(alignsize(r,3,0)==(SIZE_T)-1&&*err()==22);alignfree(r);
        p=offset(43,al,3);CHECK(p&&(((uintptr_t)p+3)%al)==0&&alignsize(p,al,3)==43);
        for(unsigned i=0;i<43;i++)p[i]=39;
        q=offsetre(p,81,al,3);CHECK(q&&alignsize(q,al,3)==81);for(unsigned i=0;i<43;i++)CHECK(q[i]==39);
        r=offsetrec(q,113,1,al,3);CHECK(r&&alignsize(r,al,3)==113);
        for(unsigned i=0;i<43;i++)CHECK(r[i]==39);for(unsigned i=81;i<113;i++)CHECK(r[i]==0);alignfree(r);
    }
    CHECK(!align(10,3)&&*err()==22);CHECK(!align(10,0)&&*err()==22);CHECK(!offset(10,16,10)&&*err()==22);
    CHECK(alignsize(0,16,0)==(SIZE_T)-1&&*err()==22);alignfree(0);
    p=alignrec(0,7,5,64);CHECK(p&&alignsize(p,64,0)==35);for(unsigned i=0;i<35;i++)CHECK(p[i]==0);
    CHECK(alignrec(p,0,3,64)==0);CHECK(!rezero(0,0,4));
    for(unsigned i=0;i<12000;i++){
        unsigned n=17+(i*31)%700;p=alloc(n);CHECK(p!=0);lens[i]=n;
        if(!p)ExitProcess(3);
        for(unsigned k=0;k<n;k++)p[k]=pattern(i,k);
        ptrs[i]=p;
        if(i%3==0){r=resize(p,n+91);CHECK(r&&msize(r)==n+91);for(unsigned k=0;k<n;k++)CHECK(r[k]==pattern(i,k));ptrs[i]=r;lens[i]+=91;}
        if(i>10&&i%4==0){release(ptrs[i-7]);ptrs[i-7]=0;}
    }
    for(unsigned i=0;i<12000;i++)if(ptrs[i]){CHECK(msize(ptrs[i])==lens[i]);CHECK(((uintptr_t)ptrs[i]%(sizeof(void*)==8?16:8))==0);release(ptrs[i]);}
    for(unsigned i=0;i<65536;i+=4096)CHECK(reservation[i]==0xe3);
    CHECK(VirtualFree(reservation,0,MEM_RELEASE));
    p=alloc(100000);CHECK(p&&msize(p)==100000);release(p);
    HANDLE stale=0;
    for(unsigned i=0;i<400;i++){
        HANDLE h=HeapCreate(0,0,64);CHECK(h&&h!=stale);
        if(stale)CHECK(!HeapAlloc(stale,0,1)&&GetLastError()==6);
        CHECK(HeapDestroy(h));stale=h;
    }
    unsigned live_heaps=0;
    while(live_heaps<255){HANDLE h=HeapCreate(0,0,0);if(!h)break;heap_handles[live_heaps++]=h;}
    CHECK(live_heaps==253&&GetLastError()==8);
    for(unsigned i=0;i<live_heaps;i++)CHECK(HeapDestroy(heap_handles[i]));
    /* Destroy reclaims live blocks, invalidates ownership, and does not touch other heaps. */
    p=HeapAlloc(a,0,47);q=HeapAlloc(b,0,59);q[0]=127;
    CHECK(HeapDestroy(a));CHECK(HeapSize(a,0,p)==(SIZE_T)-1&&GetLastError()==6);
    CHECK(HeapSize(b,0,q)==59&&q[0]==127);CHECK(HeapDestroy(b));
    summary();ExitProcess(failures?1:0);
}
