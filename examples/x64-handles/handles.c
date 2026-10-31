/* Original CC0 fixture: normal MinGW CRT; Windows contracts, no host PE execution. */
#include <windows.h>
#include <stdio.h>
#include <stdint.h>
#ifndef _WIN64
/* i386 companion uses the profile's baseline entry contract, not an unimplemented i386 UCRT. */
unsigned _tls_index;
#define printf(...) do { char line[256]; int n=wsprintfA(line,__VA_ARGS__); if(n>0&&line[n-1]=='\n')line[n-1]=0; OutputDebugStringA(line); } while(0)
#endif
static unsigned checks, failures;
static HANDLE held[1100];
#define CHECK(n,c) do { checks++; if(!(c)){ failures++; printf("handle FAIL %s error=%lu\n",n,GetLastError()); } } while(0)
static HANDLE dup(HANDLE h,DWORD access,BOOL inherit,DWORD options) {
    HANDLE out=0;
    CHECK("DuplicateHandle",DuplicateHandle(GetCurrentProcess(),h,GetCurrentProcess(),&out,access,inherit,options));
    CHECK("owned distinct handle",out && out!=h && out!=GetCurrentThread() && out!=GetCurrentProcess());
    return out;
}
static void __cdecl auto_worker(void *arg) { WaitForSingleObject((HANDLE)arg,INFINITE); }
static DWORD WINAPI worker(void *arg) {
    HANDLE mine=dup(GetCurrentThread(),0,FALSE,DUPLICATE_SAME_ACCESS);
    CHECK("worker pseudo is worker",GetThreadId(mine)==GetCurrentThreadId());
    CHECK("primary alias stays primary",GetThreadId((HANDLE)arg)!=GetCurrentThreadId());
    CHECK("worker priority alias",SetThreadPriority(mine,THREAD_PRIORITY_ABOVE_NORMAL)&&GetThreadPriority(GetCurrentThread())==THREAD_PRIORITY_ABOVE_NORMAL);
    CHECK("worker close",CloseHandle(mine));
    return 73;
}
int main(void) {
    /* Exact CRT startup pattern: process(-1), thread(-2), process(-1), SAME_ACCESS, then priority. */
    HANDLE current=0,process=GetCurrentProcess();
    CHECK("startup duplicate pseudo",DuplicateHandle(process,GetCurrentThread(),GetCurrentProcess(),&current,0,FALSE,DUPLICATE_SAME_ACCESS));
    CHECK("startup GetThreadPriority",GetThreadPriority(current)==THREAD_PRIORITY_NORMAL);
    DWORD tls=TlsAlloc();CHECK("startup TlsSetValue",tls!=TLS_OUT_OF_INDEXES&&TlsSetValue(tls,current)&&TlsGetValue(tls)==current&&TlsFree(tls));
    DWORD flags=99,code=0;
    CHECK("current ID",GetThreadId(current)==GetCurrentThreadId()&&GetThreadId(GetCurrentThread())==GetCurrentThreadId());
    CHECK("current exit",GetExitCodeThread(current,&code)&&code==STILL_ACTIVE);
    CHECK("current wait",WaitForSingleObject(current,0)==WAIT_TIMEOUT);
    CHECK("pseudo wait",WaitForSingleObject(GetCurrentThread(),0)==WAIT_TIMEOUT);
    HANDLE alias=dup(current,0,TRUE,DUPLICATE_SAME_ACCESS);
    CHECK("inherit",GetHandleInformation(alias,&flags)&&flags==HANDLE_FLAG_INHERIT);
    CHECK("source flags independent",GetHandleInformation(current,&flags)&&flags==0);
    CHECK("protect close",SetHandleInformation(alias,HANDLE_FLAG_PROTECT_FROM_CLOSE,HANDLE_FLAG_PROTECT_FROM_CLOSE)&&!CloseHandle(alias)&&GetLastError()==ERROR_ACCESS_DENIED);
    HANDLE unprotected=dup(alias,0,FALSE,DUPLICATE_SAME_ACCESS);
    CHECK("duplicate flags not copied",GetHandleInformation(unprotected,&flags)&&flags==0&&CloseHandle(unprotected));
    CHECK("clear flags",SetHandleInformation(alias,3,0)&&GetHandleInformation(alias,&flags)&&flags==0);
    CHECK("close source",CloseHandle(current)&&GetThreadId(alias)==GetCurrentThreadId());
    CHECK("closed invalid",!GetExitCodeThread(current,&code)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("double close",!CloseHandle(current)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("pseudo not owned",!CloseHandle(GetCurrentThread())&&GetLastError()==ERROR_INVALID_HANDLE);
    current=alias;
    HANDLE limited=dup(current,THREAD_QUERY_LIMITED_INFORMATION,FALSE,0);
    CHECK("limited query",GetThreadId(limited)==GetCurrentThreadId()&&GetExitCodeThread(limited,&code)&&code==STILL_ACTIVE);
    CHECK("limited set denied",!SetThreadPriority(limited,1)&&GetLastError()==ERROR_ACCESS_DENIED);
    CHECK("limited wait denied",WaitForSingleObject(limited,0)==WAIT_FAILED&&GetLastError()==ERROR_ACCESS_DENIED);
    CHECK("limited close",CloseHandle(limited));
    HANDLE none=dup(current,0,FALSE,0);
    CHECK("zero rights query denied",GetThreadPriority(none)==THREAD_PRIORITY_ERROR_RETURN&&GetLastError()==ERROR_ACCESS_DENIED);
    CHECK("zero rights ID denied",!GetThreadId(none)&&GetLastError()==ERROR_ACCESS_DENIED);CloseHandle(none);
    HANDLE max=dup(current,MAXIMUM_ALLOWED,FALSE,0);CHECK("maximum access",GetThreadPriority(max)==THREAD_PRIORITY_NORMAL&&CloseHandle(max));
    max=dup(current,0xffffffffu,FALSE,DUPLICATE_SAME_ACCESS);CHECK("same access ignores desired",GetThreadPriority(max)==THREAD_PRIORITY_NORMAL&&CloseHandle(max));
    HANDLE opened=OpenThread(THREAD_QUERY_INFORMATION|SYNCHRONIZE,TRUE,GetCurrentThreadId());
    CHECK("OpenThread ID not handle",opened&&opened!=current&&GetThreadId(opened)==GetCurrentThreadId());CloseHandle(opened);
    CHECK("OpenThread invalid ID",!OpenThread(THREAD_ALL_ACCESS,FALSE,0)&&GetLastError()==ERROR_INVALID_PARAMETER);
    HANDLE proc=dup(process,0,FALSE,DUPLICATE_SAME_ACCESS);
    CHECK("process ID",GetProcessId(proc)==GetCurrentProcessId()&&GetProcessId(process)==GetCurrentProcessId());
    CHECK("process active",GetExitCodeProcess(proc,&code)&&code==STILL_ACTIVE);
    CHECK("process wait",WaitForSingleObject(proc,0)==WAIT_TIMEOUT);
    ULONG_PTR pm=0,sm=0;
    CHECK("process affinity",GetProcessAffinityMask(proc,&pm,&sm)&&pm==1&&sm==1&&SetProcessAffinityMask(proc,1));
    CHECK("process class",SetPriorityClass(proc,NORMAL_PRIORITY_CLASS));
    opened=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,GetCurrentProcessId());
    CHECK("OpenProcess current",opened&&GetExitCodeProcess(opened,&code)&&code==STILL_ACTIVE&&GetProcessId(opened)==GetCurrentProcessId());
    CHECK("limited process affinity query",GetProcessAffinityMask(opened,&pm,&sm)&&pm==1&&sm==1);
    CHECK("limited process affinity set denied",!SetProcessAffinityMask(opened,1)&&GetLastError()==ERROR_ACCESS_DENIED);
    CHECK("process DUP right denied",!DuplicateHandle(opened,current,process,&none,0,FALSE,DUPLICATE_SAME_ACCESS)&&GetLastError()==ERROR_ACCESS_DENIED);
    CHECK("terminate access denied",!TerminateProcess(opened,99)&&GetLastError()==ERROR_ACCESS_DENIED);
    CHECK("terminate invalid",!TerminateProcess(current,99)&&GetLastError()==ERROR_INVALID_HANDLE);
    CloseHandle(opened);
    CHECK("wrong process kind",!GetProcessId(current)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("wrong thread kind",!GetThreadId(proc)&&GetLastError()==ERROR_INVALID_HANDLE);
    /* Churn must neither consume scheduler slots nor leak bounded handle capacity. */
    for(unsigned i=0;i<2048;i++){HANDLE h=dup(GetCurrentThread(),0,FALSE,DUPLICATE_SAME_ACCESS);CHECK("alias churn close",CloseHandle(h));}
    for(unsigned i=0;i<70;i++)CHECK("failed thread creation keeps slots",!CreateThread(0,0x1000001,worker,current,0,0)&&GetLastError()==ERROR_NOT_ENOUGH_MEMORY);
    DWORD tid=0;HANDLE th=CreateThread(0,0,worker,current,CREATE_SUSPENDED,&tid);
    CHECK("real thread ID",th&&tid!=GetCurrentThreadId()&&GetThreadId(th)==tid);
    HANDLE th2=dup(th,0,FALSE,DUPLICATE_SAME_ACCESS);
    CHECK("close created thread",CloseHandle(th));
    CHECK("resume alias",ResumeThread(th2)==1);
    HANDLE ready=CreateEventA(0,TRUE,TRUE,0);
    HANDLE mix[3]={proc,th2,ready};
    CHECK("mixed wait-any",WaitForMultipleObjects(3,mix,FALSE,INFINITE)==WAIT_OBJECT_0+2);
    CHECK("join alias",WaitForSingleObject(th2,INFINITE)==WAIT_OBJECT_0&&GetExitCodeThread(th2,&code)&&code==73);
    opened=OpenThread(THREAD_QUERY_INFORMATION,FALSE,tid);
    CHECK("OpenThread terminated retained",opened&&GetExitCodeThread(opened,&code)&&code==73);CloseHandle(opened);
    HANDLE joined[2]={th2,ready};CHECK("mixed wait-all",WaitForMultipleObjects(2,joined,TRUE,0)==WAIT_OBJECT_0);
    CloseHandle(th2);CloseHandle(ready);
    CHECK("terminated final close removes ID",!OpenThread(THREAD_QUERY_INFORMATION,FALSE,tid)&&GetLastError()==ERROR_INVALID_PARAMETER);
    HANDLE gate=CreateEventA(0,TRUE,FALSE,0);
    typedef uintptr_t (__cdecl *begin_fn)(void (__cdecl *)(void *),unsigned,void *);
    begin_fn begin=(begin_fn)GetProcAddress(LoadLibraryA("msvcrt.dll"),"_beginthread");
    HANDLE autoOriginal=(HANDLE)begin(auto_worker,0,gate);
    HANDLE autoAlias=dup(autoOriginal,0,FALSE,2);DWORD autoId=GetThreadId(autoAlias);
    CHECK("auto original close",CloseHandle(autoOriginal));
    HANDLE recycled=OpenThread(THREAD_ALL_ACCESS,FALSE,autoId);
    CHECK("auto reopened ID",recycled&&GetThreadId(recycled)==autoId);
    CHECK("auto worker completes",SetEvent(gate)&&WaitForSingleObject(autoAlias,INFINITE)==WAIT_OBJECT_0);
    CHECK("auto-close ignores recycled handle",GetExitCodeThread(recycled,&code)&&code==0);
    CloseHandle(autoAlias);CloseHandle(recycled);CloseHandle(gate);
    SECURITY_ATTRIBUTES sa={sizeof sa,0,TRUE};
    HANDLE event=CreateEventA(&sa,FALSE,FALSE,0);alias=dup(event,0,FALSE,DUPLICATE_SAME_ACCESS);
    CHECK("create inherit",GetHandleInformation(event,&flags)&&flags==1);
    CHECK("wrong semaphore kind",!ReleaseSemaphore(alias,1,0)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("event alias sharing",SetEvent(alias)&&WaitForSingleObject(event,0)==WAIT_OBJECT_0&&WaitForSingleObject(alias,0)==WAIT_TIMEOUT);
    CHECK("event source close",CloseHandle(event)&&SetEvent(alias)&&WaitForSingleObject(alias,0)==WAIT_OBJECT_0);CloseHandle(alias);
    HANDLE mutex=CreateMutexA(0,TRUE,0);alias=dup(mutex,0,FALSE,DUPLICATE_SAME_ACCESS);
    CHECK("mutex alias recursion",WaitForSingleObject(alias,0)==WAIT_OBJECT_0&&CloseHandle(mutex)&&ReleaseMutex(alias)&&ReleaseMutex(alias));CloseHandle(alias);
    HANDLE sem=CreateSemaphoreA(0,1,2,0);alias=dup(sem,0,FALSE,DUPLICATE_SAME_ACCESS);
    CHECK("semaphore shared count",WaitForSingleObject(alias,0)==WAIT_OBJECT_0&&WaitForSingleObject(sem,0)==WAIT_TIMEOUT);
    CHECK("semaphore zero release",!ReleaseSemaphore(alias,0,0)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("semaphore negative release",!ReleaseSemaphore(alias,-1,0)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("wrong mutex kind",!ReleaseMutex(alias)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("semaphore bad output",!ReleaseSemaphore(alias,1,(LONG *)(uintptr_t)1)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("semaphore failure retains count",WaitForSingleObject(sem,0)==WAIT_TIMEOUT);
#ifdef _WIN64
    LONG previous=123;CHECK("semaphore full width output",!ReleaseSemaphore(alias,1,(LONG *)((uintptr_t)&previous|0x100000000ull))&&GetLastError()==ERROR_INVALID_PARAMETER&&previous==123);
#endif
    CHECK("semaphore source close",CloseHandle(sem)&&ReleaseSemaphore(alias,1,0)&&WaitForSingleObject(alias,0)==WAIT_OBJECT_0);CloseHandle(alias);
    HANDLE file=CreateFileA("handles.exe",GENERIC_READ,FILE_SHARE_READ,&sa,OPEN_EXISTING,0,0);
    CHECK("file open",file!=INVALID_HANDLE_VALUE);
    alias=dup(file,0,FALSE,DUPLICATE_SAME_ACCESS);
    char a=0,b=0;DWORD got=0;LARGE_INTEGER zero,pos;zero.QuadPart=0;
    CHECK("file read",ReadFile(file,&a,1,&got,0)&&got==1&&a=='M');
    CHECK("file shared position",ReadFile(alias,&b,1,&got,0)&&got==1&&b=='Z');
    CHECK("file seek shared",SetFilePointerEx(file,zero,&pos,FILE_CURRENT)&&pos.QuadPart==2);
    CHECK("file full width rejects",!GetFileSizeEx((HANDLE)((uintptr_t)file+(sizeof(void *)==8?0x100000000ull:0x10000ull)),&pos)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("file close original",CloseHandle(file)&&GetFileSize(alias,0)>0);
    HANDLE noRead=dup(alias,0,FALSE,0);
    got=123;CHECK("file access denied",!ReadFile(noRead,&b,1,&got,0)&&GetLastError()==ERROR_ACCESS_DENIED&&got==0);
    CHECK("file seek denied",!SetFilePointerEx(noRead,zero,&pos,FILE_BEGIN)&&GetLastError()==ERROR_ACCESS_DENIED);
    CHECK("legacy file seek denied",SetFilePointer(noRead,0,0,FILE_BEGIN)==INVALID_SET_FILE_POINTER&&GetLastError()==ERROR_ACCESS_DENIED);
    CHECK("denied seek preserves shared cursor",SetFilePointerEx(alias,zero,&pos,FILE_CURRENT)&&pos.QuadPart==2);
    CHECK("metadata rights denied",!GetFileSizeEx(noRead,&pos)&&GetLastError()==ERROR_ACCESS_DENIED);CloseHandle(noRead);
    HANDLE moved=dup(alias,0,TRUE,DUPLICATE_SAME_ACCESS|DUPLICATE_CLOSE_SOURCE);
    CHECK("move invalidates source",!GetHandleInformation(alias,&flags)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("move retains object",GetFileSize(moved,0)>0&&CloseHandle(moved));
    HANDLE out=0;
    void *page=VirtualAlloc(0,4096,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);DWORD oldProtect=0;
    CHECK("output page protect",page&&VirtualProtect(page,4096,PAGE_READONLY,&oldProtect));
    CHECK("readonly output",!DuplicateHandle(process,current,process,(HANDLE *)page,0,FALSE,2)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("readonly exit output",!GetExitCodeThread(current,(DWORD *)page)&&GetLastError()==ERROR_INVALID_PARAMETER);
    file=CreateFileA("handles.exe",GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,0,0);
    CHECK("readonly file size output",!GetFileSizeEx(file,(LARGE_INTEGER *)page)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("readonly seek output",!SetFilePointerEx(file,zero,(LARGE_INTEGER *)page,FILE_CURRENT)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("release output page",VirtualFree(page,0,MEM_RELEASE));
    CHECK("invalid options",!DuplicateHandle(process,current,process,&out,0,0,4)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("invalid source",!DuplicateHandle(process,(HANDLE)12345,process,&out,0,0,2)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("invalid process",!DuplicateHandle(current,current,process,&out,0,0,2)&&GetLastError()==ERROR_INVALID_HANDLE);
    alias=dup(current,0,FALSE,2);
    CHECK("failure closes source",!DuplicateHandle(process,alias,process,(HANDLE *)(uintptr_t)1,0,0,3)&&GetLastError()==ERROR_INVALID_PARAMETER&&!GetHandleInformation(alias,&flags));
    alias=dup(current,0,FALSE,2);
    CHECK("close-only null target",DuplicateHandle(process,alias,0,0,0,FALSE,DUPLICATE_CLOSE_SOURCE)&&!GetThreadId(alias)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("bad output",!GetExitCodeThread(current,0)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("bad handle info output",!GetHandleInformation(current,0)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("bad flags",!SetHandleInformation(current,4,4)&&GetLastError()==ERROR_INVALID_PARAMETER);
#ifdef _WIN64
    HANDLE high=(HANDLE)((uintptr_t)current|0x100000000ull);
    CHECK("full width source",!DuplicateHandle(process,high,process,&out,0,0,2)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width process",!DuplicateHandle((HANDLE)0xffffffffu,current,process,&out,0,0,2)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width pseudo thread",GetThreadPriority((HANDLE)0xfffffffeu)==THREAD_PRIORITY_ERROR_RETURN&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width close",!CloseHandle(high)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width query",!GetExitCodeThread(high,&code)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width thread ID",!GetThreadId(high)&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width resume",ResumeThread(high)==(DWORD)-1&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width suspend",SuspendThread(high)==(DWORD)-1&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width set priority",!SetThreadPriority(high,0)&&GetLastError()==ERROR_INVALID_HANDLE);
    HANDLE badwait[2]={proc,high};CHECK("full width wait",WaitForMultipleObjects(2,badwait,FALSE,0)==WAIT_FAILED&&GetLastError()==ERROR_INVALID_HANDLE);
    CHECK("full width output",!DuplicateHandle(process,current,process,(HANDLE *)((uintptr_t)&out|0x100000000ull),0,0,2)&&GetLastError()==ERROR_INVALID_PARAMETER);
    pos.QuadPart=123;CHECK("full width file size output",!GetFileSizeEx(file,(LARGE_INTEGER *)((uintptr_t)&pos|0x100000000ull))&&pos.QuadPart==123);
    CHECK("full width seek output",!SetFilePointerEx(file,zero,(LARGE_INTEGER *)((uintptr_t)&pos|0x100000000ull),FILE_BEGIN)&&pos.QuadPart==123);
    b='x';got=123;CHECK("full width file buffer",!ReadFile(file,(void *)((uintptr_t)&b|0x100000000ull),1,&got,0)&&b=='x'&&got==0);
    got=123;CHECK("full width file count",!ReadFile(file,&b,1,(DWORD *)((uintptr_t)&got|0x100000000ull),0)&&got==123);
    CHECK("full width overlapped",!ReadFile(file,&b,1,&got,(OVERLAPPED *)0x100000000ull)&&GetLastError()==ERROR_INVALID_PARAMETER);
#endif
    CloseHandle(file);
    HKEY key=0;DWORD value=1234,bytes=4,type=0;
    CHECK("registry create",RegCreateKeyExA(HKEY_CURRENT_USER,"Software\\GameCask\\Handles",0,0,0,KEY_ALL_ACCESS,0,&key,0)==ERROR_SUCCESS);
    CHECK("registry write",RegSetValueExA(key,"value",0,REG_DWORD,(const BYTE *)&value,4)==ERROR_SUCCESS);
    alias=dup((HANDLE)key,0,FALSE,DUPLICATE_SAME_ACCESS);
    CHECK("registry close source",RegCloseKey(key)==ERROR_SUCCESS&&RegCloseKey(key)==ERROR_INVALID_HANDLE);
    value=0;CHECK("registry alias identity",RegQueryValueExA((HKEY)alias,"value",0,&type,(BYTE *)&value,&bytes)==ERROR_SUCCESS&&type==REG_DWORD&&value==1234);
    CHECK("registry nonwaitable",WaitForSingleObject(alias,0)==WAIT_FAILED);
    CHECK("registry CloseHandle exception",CloseHandle(alias)&&RegQueryValueExA((HKEY)alias,"value",0,&type,(BYTE *)&value,&bytes)==ERROR_SUCCESS);
    limited=dup(alias,KEY_QUERY_VALUE,FALSE,0);
    CHECK("registry restricted write",RegSetValueExA((HKEY)limited,"value",0,REG_DWORD,(BYTE *)&value,4)==ERROR_ACCESS_DENIED);
    CHECK("registry close aliases",RegCloseKey((HKEY)alias)==ERROR_SUCCESS&&RegCloseKey((HKEY)limited)==ERROR_SUCCESS);
    CHECK("invalid standard handle selector",GetStdHandle(0)==INVALID_HANDLE_VALUE&&GetLastError()==ERROR_INVALID_PARAMETER);
    HANDLE console=dup(GetStdHandle(STD_OUTPUT_HANDLE),0,FALSE,2);
    CHECK("console write alias",WriteFile(console,"",0,&got,0));
    limited=dup(console,0,FALSE,0);got=123;
    CHECK("console access failure count",!WriteFile(limited,"x",1,&got,0)&&GetLastError()==ERROR_ACCESS_DENIED&&got==0);CloseHandle(limited);
    char binary[300];for(unsigned i=0;i<300;i++)binary[i]='A';binary[127]=0;binary[299]='Z';
    CHECK("console binary output",WriteFile(console,binary,300,&got,0)&&got==300&&CloseHandle(console));
    for(unsigned i=0;i<2048;i++){
        HANDLE f=CreateFileA("handles.exe",GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,0,0);
        CHECK("file slots reclaimed",f!=INVALID_HANDLE_VALUE&&GetFileSize(f,0)>0&&CloseHandle(f));
    }
    HANDLE toClose=dup(current,0,FALSE,2);unsigned exhausted=0,count=0;
    while(count<1100){
        if(!DuplicateHandle(process,current,process,&held[count],0,FALSE,2)){exhausted=GetLastError();break;}
        count++;
    }
    CHECK("bounded table truthful failure",exhausted==ERROR_NOT_ENOUGH_MEMORY&&GetThreadId(current)==GetCurrentThreadId());
    CHECK("allocation failure closes source",!DuplicateHandle(process,toClose,process,&out,0,FALSE,3)&&GetLastError()==ERROR_NOT_ENOUGH_MEMORY&&!GetThreadId(toClose));
    while(count)CHECK("capacity release",CloseHandle(held[--count]));
    alias=dup(current,0,FALSE,2);CHECK("capacity restored",CloseHandle(alias));
    CloseHandle(current);
    printf("handles checks=%u failures=%u %s\n",checks,failures,failures?"FAIL":"PASS");
    TerminateProcess(proc,failures?1:0);
    OutputDebugStringA("handle FAIL self termination returned");
    return 1;
}
#ifndef _WIN64
void entry(void) { ExitProcess((UINT)main()); }
#endif
