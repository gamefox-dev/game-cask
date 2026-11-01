/* Original CC0 Windows-contract fixture. Standard MinGW -O2 CRT startup, no custom entry. */
#include <windows.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <wchar.h>
#include <stdarg.h>
#include <stdlib.h>
#include <errno.h>
#include <time.h>
typedef uint64_t (*api_fn)(uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t);
static unsigned checks,failures;
static uint64_t invoke(const char *dll,const char *name,uint64_t a,uint64_t b,uint64_t c,uint64_t d,uint64_t e,uint64_t f) {
    api_fn fn=(api_fn)(void *)GetProcAddress(LoadLibraryA(dll),name);
    if(!fn){printf("missing %s!%s\n",dll,name);failures++;return 0xdeadbeef;}
    return fn(a,b,c,d,e,f);
}
#define U(x) ((uint64_t)(uintptr_t)(x))
#define K(n,a,b,c,d,e,f) invoke("kernel32.dll",n,U(a),U(b),U(c),U(d),U(e),U(f))
#define C(n,a,b,c,d,e,f) invoke("msvcrt.dll",n,U(a),U(b),U(c),U(d),U(e),U(f))
#define S(n,a,b,c,d,e,f) invoke("shell32.dll",n,U(a),U(b),U(c),U(d),U(e),U(f))
#define W(n,a,b,c,d,e,f) invoke("user32.dll",n,U(a),U(b),U(c),U(d),U(e),U(f))
#define M(n,a,b,c,d,e,f) invoke("winmm.dll",n,U(a),U(b),U(c),U(d),U(e),U(f))
#define CHECK(n,x) do{int ok=!!(x);checks++;if(!ok)failures++;printf("contract %s %s\n",n,ok?"PASS":"FAIL");}while(0)
static int32_t neg(uint64_t v){return (int32_t)v;}
static void check_vformat(char *buf,size_t cap,const char *fmt,...) {
    va_list ap;va_start(ap,fmt);
    CHECK("_vscprintf",C("_vscprintf",fmt,ap,0,0,0,0)==5);
    CHECK("_vsnprintf_s",neg(C("_vsnprintf_s",buf,cap,(size_t)-1,fmt,ap,0))==-1 && !strcmp(buf,"abcd"));
    va_end(ap);
}
static unsigned worker_ran;
static void __cdecl worker(void *arg){worker_ran=(unsigned)(uintptr_t)arg;}
static volatile unsigned lock_entered,wait_stage;
static HANDLE wait_gate;
static DWORD WINAPI lock_worker(void *arg){(void)arg;C("_lock",2,0,0,0,0,0);lock_entered=1;C("_unlock",2,0,0,0,0,0);return 0;}
static DWORD WINAPI wait_worker(void *arg){(void)arg;wait_stage=1;Sleep(32);wait_stage=2;WaitForSingleObject(wait_gate,INFINITE);wait_stage=3;return 47;}
static unsigned monitor_count;
static unsigned termination_called;
static void termination(unsigned abnormal,uintptr_t frame){if(abnormal==1&&frame==0x1122334455667788ull)termination_called++;}
static int filter_continue(uintptr_t *ep,uintptr_t frame){return ep[0]&&ep[1]&&frame==0x1122334455667788ull?-1:0;}
static BOOL CALLBACK monitor(HMONITOR h,HDC dc,LPRECT rect,LPARAM data){(void)h;(void)dc;monitor_count++;return rect->right>0&&data==0x1122334455667788ull;}
static void should_not_run(void){fprintf(stderr,"BAD_EXIT_HANDLER\n");}
static unsigned mouse_hover,mouse_leave;
static LRESULT CALLBACK window_proc(HWND h,UINT msg,WPARAM wp,LPARAM lp){
    if(msg==WM_MOUSEMOVE){TRACKMOUSEEVENT t={sizeof t,TME_HOVER|TME_LEAVE,h,20};TrackMouseEvent(&t);}
    if(msg==WM_MOUSEHOVER){mouse_hover++;puts("tracking hover");}
    if(msg==WM_MOUSELEAVE){mouse_leave++;puts("tracking leave");}
    return DefWindowProcA(h,msg,wp,lp);
}
int main(void) {
    char bytes[1024]={0};wchar_t wide[1024]={0};DWORD old=0xbadbad,flags=0;
    uint64_t dispatch[10]={0};unsigned record[40]={0},scopes[5]={1,0,0xffffffffu,0,0};
    unsigned context[320]={0};dispatch[0]=0x100;dispatch[7]=U(scopes);
    CHECK("__C_specific_handler-search",K("__C_specific_handler",record,0,context,dispatch,0,0)==1);
    scopes[3]=(unsigned)U(filter_continue);scopes[4]=0x200;
    CHECK("__C_specific_handler-filter",K("__C_specific_handler",record,0x1122334455667788ull,context,dispatch,0,0)==0);
    record[1]=2;scopes[3]=(unsigned)U(termination);scopes[4]=0;
    CHECK("__C_specific_handler-finally",K("__C_specific_handler",record,0x1122334455667788ull,context,dispatch,0,0)==1&&termination_called==1&&((unsigned *)dispatch)[18]==1);
    unsigned char *page=VirtualAlloc(0,8192,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
    MEMORY_BASIC_INFORMATION mbi;
    CHECK("VirtualQuery",VirtualQuery(page,&mbi,sizeof mbi)==sizeof mbi && mbi.State==MEM_COMMIT && mbi.Protect==PAGE_READWRITE && mbi.RegionSize>=8192);
    CHECK("VirtualQuery-free",VirtualQuery((void *)0x10000,&mbi,sizeof mbi)==sizeof mbi && mbi.State==MEM_FREE && mbi.Protect==0);
    CHECK("VirtualQuery-short",!VirtualQuery(page,&mbi,4) && GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("VirtualProtect",VirtualProtect(page+4095,2,PAGE_READWRITE,&old)&&old==PAGE_READWRITE);
    old=0xbadbad;
    page[0]=37;
    CHECK("VirtualProtect-readonly",VirtualProtect(page,4096,PAGE_READONLY,&old)&&old==PAGE_READWRITE);
    CHECK("VirtualProtect-legal-load",*(volatile unsigned char *)page==37&&memcmp(page,"%",1)==0);
    CHECK("VirtualQuery-protection-split",VirtualQuery(page,&mbi,sizeof mbi)==sizeof mbi&&mbi.Protect==PAGE_READONLY&&mbi.RegionSize==4096&&mbi.AllocationBase==page);
    CHECK("VirtualProtect-noaccess",VirtualProtect(page,4096,PAGE_NOACCESS,&old)&&old==PAGE_READONLY);
    CHECK("VirtualProtect-restore",VirtualProtect(page,4096,PAGE_READWRITE,&old)&&old==PAGE_NOACCESS);
    CHECK("VirtualProtect-guard",!VirtualProtect(page,4096,PAGE_READWRITE|PAGE_GUARD,&old)&&GetLastError()==ERROR_NOT_SUPPORTED);
    CHECK("VirtualAlloc-page-rounded",VirtualQuery(page+8192,&mbi,sizeof mbi)==sizeof mbi&&mbi.State==MEM_FREE);
    void *readonly_page=VirtualAlloc(0,4096,MEM_COMMIT|MEM_RESERVE,PAGE_READONLY);
    CHECK("VirtualQuery-allocation-protection",readonly_page&&VirtualQuery(readonly_page,&mbi,sizeof mbi)==sizeof mbi&&mbi.AllocationProtect==PAGE_READONLY);
    CHECK("VirtualFree-release",VirtualFree(readonly_page,0,MEM_RELEASE)&&VirtualQuery(readonly_page,&mbi,sizeof mbi)==sizeof mbi&&mbi.State==MEM_FREE);
    CHECK("VirtualProtect-hole",!VirtualProtect((void *)0x10000,4096,PAGE_READWRITE,&old)&&GetLastError()==ERROR_INVALID_ADDRESS);
    CHECK("VirtualProtect-invalid",!VirtualProtect(page,0,PAGE_READWRITE,&old)&&GetLastError()==ERROR_INVALID_PARAMETER);
    CHECK("GetCurrentDirectoryW",K("GetCurrentDirectoryW",0,0,0,0,0,0)==8 && K("GetCurrentDirectoryW",1024,wide,0,0,0,0)==7 && !wcscmp(wide,L"C:\\GAME"));
    CHECK("SetCurrentDirectoryW",K("SetCurrentDirectoryW",L".",0,0,0,0,0)==1 && !K("SetCurrentDirectoryW",L"missing",0,0,0,0,0) && GetLastError()==3);
    CHECK("SetEnvironmentVariableW",K("SetEnvironmentVariableW",L"BGT_TEST",L"value",0,0,0,0)==1);
    CHECK("GetEnvironmentVariableW",K("GetEnvironmentVariableW",L"bgt_test",wide,1024,0,0,0)==5&&!wcscmp(wide,L"value"));
    CHECK("environment-size",K("GetEnvironmentVariableW",L"BGT_TEST",wide,1,0,0,0)==6);
    CHECK("environment-delete",K("SetEnvironmentVariableW",L"BGT_TEST",0,0,0,0,0)&&!K("GetEnvironmentVariableW",L"BGT_TEST",wide,1024,0,0,0)&&GetLastError()==203);
    K("SetEnvironmentVariableW",L"BGT_TEST",L"recreated",0,0,0,0);void *env_allocation=malloc(32);memset(env_allocation,0xaa,32);
    CHECK("environment-recreate",K("GetEnvironmentVariableW",L"BGT_TEST",wide,1024,0,0,0)==9&&!wcscmp(wide,L"recreated"));free(env_allocation);
    CHECK("GetLogicalDrives",K("GetLogicalDrives",0,0,0,0,0,0)==4);
    CHECK("GetUserDefaultUILanguage",K("GetUserDefaultUILanguage",0,0,0,0,0,0)==0x409);
    CHECK("IsDBCSLeadByteEx",!K("IsDBCSLeadByteEx",1252,0x81,0,0,0,0));
    CHECK("LCIDToLocaleName",K("LCIDToLocaleName",0x409,wide,1024,0,0,0)==6&&!wcscmp(wide,L"en-US"));
    CHECK("GetLocaleInfoEx",K("GetLocaleInfoEx",L"en-US",0xe,wide,1024,0,0)==2&&wide[0]=='.');
    CHECK("GetSystemPowerStatus",K("GetSystemPowerStatus",bytes,0,0,0,0,0)&&((unsigned char *)bytes)[2]==255);
    CHECK("GetTimeZoneInformation",K("GetTimeZoneInformation",bytes,0,0,0,0,0)==0&&!wcscmp((wchar_t *)(bytes+4),L"UTC"));
    SYSTEMTIME st={2001,10,0,25,0,0,0,0};uint64_t ft=0;
    CHECK("SystemTimeToFileTime",K("SystemTimeToFileTime",&st,&ft,0,0,0,0)&&ft==(11644473600ull+1003968000ull)*10000000);
    st.wMonth=13;CHECK("SystemTime-invalid",!K("SystemTimeToFileTime",&st,&ft,0,0,0,0)&&GetLastError()==87);
    CHECK("GetTickCount64",K("GetTickCount64",0,0,0,0,0,0)>=GetTickCount());
    const char *console[]={"AttachConsole","GetConsoleScreenBufferInfo","SetConsoleCtrlHandler","SetConsoleMode","SetConsoleTextAttribute"};
    for(unsigned i=0;i<sizeof console/sizeof *console;i++)CHECK(console[i],!K(console[i],0,bytes,0,0,0,0)&&GetLastError()==6);
    const char *readonly[]={"ReplaceFileW","GetTempFileNameW"};
    for(unsigned i=0;i<sizeof readonly/sizeof *readonly;i++)CHECK(readonly[i],!K(readonly[i],L"file",0,0,0,0,0)&&GetLastError()==5);
    const char *unavailable[]={"CreatePipe","CreateProcessW","GetDiskFreeSpaceExA","GetVolumeInformationW","AddVectoredExceptionHandler"};
    for(unsigned i=0;i<sizeof unavailable/sizeof *unavailable;i++)CHECK(unavailable[i],!K(unavailable[i],0,bytes,0,0,0,0)&&GetLastError()==50);
    CHECK("RemoveVectoredExceptionHandler",!K("RemoveVectoredExceptionHandler",123,0,0,0,0,0));
    CHECK("OpenProcess",!K("OpenProcess",0,0,123,0,0,0)&&GetLastError()==87);
    CHECK("GetExitCodeProcess",K("GetExitCodeProcess",(HANDLE)-1,&flags,0,0,0,0)&&flags==STILL_ACTIVE);
    CHECK("GetProcessAffinityMask",K("GetProcessAffinityMask",(HANDLE)-1,&ft,page,0,0,0)&&ft==1&&*(uint64_t *)page==1);
    CHECK("SetProcessAffinityMask",K("SetProcessAffinityMask",(HANDLE)-1,1,0,0,0,0)&&!K("SetProcessAffinityMask",(HANDLE)-1,2,0,0,0,0));
    CHECK("SetPriorityClass",K("SetPriorityClass",(HANDLE)-1,NORMAL_PRIORITY_CLASS,0,0,0,0)&&!K("SetPriorityClass",(HANDLE)-1,HIGH_PRIORITY_CLASS,0,0,0,0));
    CHECK("FormatMessageW",K("FormatMessageW",FORMAT_MESSAGE_FROM_SYSTEM,0,5,0,wide,1024)>0&&wcsstr(wide,L"Access"));
    CHECK("FormatMessage-allocate",K("FormatMessageW",FORMAT_MESSAGE_FROM_SYSTEM|FORMAT_MESSAGE_ALLOCATE_BUFFER,0,87,0,&ft,0)>0&&ft&&LocalFree((void *)(uintptr_t)ft)==0);
    HANDLE self=CreateFileW(L"contracts.exe",GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,0,0);
    CHECK("GetHandleInformation",K("GetHandleInformation",self,&flags,0,0,0,0)&&flags==0);
    CHECK("SetHandleInformation",SetHandleInformation(self,HANDLE_FLAG_INHERIT,HANDLE_FLAG_INHERIT)&&GetHandleInformation(self,&flags)&&flags==HANDLE_FLAG_INHERIT);
    HANDLE kernelAlias=0;
    CHECK("DuplicateHandle",DuplicateHandle(GetCurrentProcess(),self,GetCurrentProcess(),&kernelAlias,0,FALSE,DUPLICATE_SAME_ACCESS)&&kernelAlias!=self&&CloseHandle(self)&&GetFileSize(kernelAlias,0)>0&&CloseHandle(kernelAlias));
    WIN32_FIND_DATAW fd;HANDLE find=(HANDLE)(uintptr_t)K("FindFirstFileW",L"contracts.exe",&fd,0,0,0,0);
    CHECK("FindFirstFileW",find!=INVALID_HANDLE_VALUE&&fd.nFileSizeLow>0&&!wcscmp(fd.cFileName,L"contracts.exe"));
    CHECK("FindNextFileW",!K("FindNextFileW",find,&fd,0,0,0,0)&&GetLastError()==18);
    CHECK("FindClose",K("FindClose",find,0,0,0,0,0)&&!K("FindClose",find,0,0,0,0,0)&&GetLastError()==6);
    find=(HANDLE)(uintptr_t)K("FindFirstFileExW",L"contracts.exe",FindExInfoBasic,&fd,FindExSearchNameMatch,0,0);
    CHECK("FindFirstFileExW",find!=INVALID_HANDLE_VALUE);K("FindClose",find,0,0,0,0,0);
    CHECK("CreateDirectoryW",K("CreateDirectoryW",L"writable",0,0,0,0,0)&&!K("CreateDirectoryW",L"writable",0,0,0,0,0)&&GetLastError()==183);
    CHECK("DeleteFileW",!K("DeleteFileW",L"does-not-exist",0,0,0,0,0)&&GetLastError()==2);
    find=(HANDLE)(uintptr_t)K("FindFirstFileW",L"*.EXE",&fd,0,0,0,0);
    CHECK("Find-wildcard",find!=INVALID_HANDLE_VALUE&&!wcscmp(fd.cFileName,L"contracts.exe"));K("FindClose",find,0,0,0,0,0);
    find=(HANDLE)(uintptr_t)K("FindFirstFileW",L"nested/*.*",&fd,0,0,0,0);unsigned enumerated=0;
    if(find!=INVALID_HANDLE_VALUE){do{enumerated++;}while(K("FindNextFileW",find,&fd,0,0,0,0));K("FindClose",find,0,0,0,0,0);}
    CHECK("Find-shipped-directory",enumerated==4); /* ".", ".." and the two shipped files: non-root directories list dot entries as on Windows */
    find=(HANDLE)(uintptr_t)K("FindFirstFileW",L"streamed.?xt",&fd,0,0,0,0);
    CHECK("Find-streamed-file",find!=INVALID_HANDLE_VALUE&&fd.nFileSizeLow>0);K("FindClose",find,0,0,0,0,0);
    find=(HANDLE)(uintptr_t)K("FindFirstFileW",L"writable",&fd,0,0,0,0);
    CHECK("Find-created-directory",find!=INVALID_HANDLE_VALUE&&(fd.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY));K("FindClose",find,0,0,0,0,0);
    CHECK("GetCurrentHwProfileA",!invoke("advapi32.dll","GetCurrentHwProfileA",U(bytes),0,0,0,0,0)&&GetLastError()==50);
    CHECK("GetThreadPriority",neg(K("GetThreadPriority",(HANDLE)-2,0,0,0,0,0))==0);
    CHECK("SetThreadPriority",K("SetThreadPriority",(HANDLE)-2,2,0,0,0,0)&&neg(K("GetThreadPriority",(HANDLE)-2,0,0,0,0,0))==2);
    CHECK("SetThreadPriority-invalid",!K("SetThreadPriority",(HANDLE)-2,3,0,0,0,0)&&GetLastError()==87&&neg(K("GetThreadPriority",(HANDLE)-2,0,0,0,0,0))==2);
    CHECK("SetThreadPriority-reset",K("SetThreadPriority",(HANDLE)-2,0,0,0,0,0));
    CHECK("GetThreadContext",!K("GetThreadContext",(HANDLE)-2,page,0,0,0,0)&&GetLastError()==50);
    CHECK("SetThreadContext",!K("SetThreadContext",(HANDLE)-2,page,0,0,0,0)&&GetLastError()==50);
    CHECK("SuspendThread",neg(K("SuspendThread",123,0,0,0,0,0))==-1&&GetLastError()==6);
    C("_lock",2,0,0,0,0,0);C("_lock",2,0,0,0,0,0);
    HANDLE locker=CreateThread(0,0,lock_worker,0,0,0);Sleep(1);
    CHECK("_lock",lock_entered==0);C("_unlock",2,0,0,0,0,0);Sleep(1);
    CHECK("_lock-recursive",lock_entered==0);C("_unlock",2,0,0,0,0,0);
    CHECK("_unlock",WaitForSingleObject(locker,INFINITE)==WAIT_OBJECT_0&&lock_entered==1);CloseHandle(locker);
    wait_gate=CreateEventA(0,FALSE,FALSE,0);HANDLE waiter=CreateThread(0,0,wait_worker,0,CREATE_SUSPENDED,0);
    CHECK("SuspendThread-nested",SuspendThread(waiter)==1&&ResumeThread(waiter)==2&&wait_stage==0&&ResumeThread(waiter)==1);
    Sleep(1);CHECK("SuspendThread-sleep",wait_stage==1&&SuspendThread(waiter)==0);Sleep(64);
    CHECK("SuspendThread-timeout",wait_stage==1&&ResumeThread(waiter)==1);Sleep(1);
    CHECK("SuspendThread-event",wait_stage==2&&SuspendThread(waiter)==0&&ResumeThread(waiter)==1);Sleep(1);
    CHECK("ResumeThread-preserves-wait",wait_stage==2);SetEvent(wait_gate);
    CHECK("SuspendThread-complete",WaitForSingleObject(waiter,INFINITE)==WAIT_OBJECT_0&&wait_stage==3);CloseHandle(waiter);CloseHandle(wait_gate);
    uintptr_t thread=(uintptr_t)C("_beginthread",worker,0,47,0,0,0);
    for(unsigned i=0;i<10&&!worker_ran;i++)Sleep(1);
    CHECK("_beginthread",thread&&thread!=(uintptr_t)-1&&worker_ran==47);
    uint64_t iob=C("__iob_func",0,0,0,0,0,0);
    CHECK("__iob_func",iob&&*(int *)(uintptr_t)(iob+48+28)==1&&*(int *)(uintptr_t)(iob+96+28)==2);
    CHECK("__lconv_init",C("__lconv_init",0,0,0,0,0,0)==0);
    FILE *file=(FILE *)(uintptr_t)C("_wfsopen",L"scratch",L"w+b",0x40,0,0,0);
    CHECK("_wfsopen",file!=0);
    CHECK("_wfsopen-deny-rejected",C("_wfsopen",L"scratch",L"r",0x10,0,0,0)==0&&errno==13);
    int desc=neg(C("_fileno",file,0,0,0,0,0));CHECK("_fileno",desc>=3);
    FILE *alias=(FILE *)(uintptr_t)C("_fdopen",desc,"r+b",0,0,0,0);
    CHECK("_fdopen",alias&&alias!=file&&C("_fileno",alias,0,0,0,0,0)==(unsigned)desc);
    CHECK("_write",C("_write",desc,"abc",3,0,0,0)==3);
    find=(HANDLE)(uintptr_t)K("FindFirstFileW",L"scrat*",&fd,0,0,0,0);
    CHECK("Find-created-file",find!=INVALID_HANDLE_VALUE&&fd.nFileSizeLow==3);K("FindClose",find,0,0,0,0,0);
    CHECK("descriptor-invalid",C("_read",999,bytes,1,0,0,0)==UINT64_MAX&&C("_write",999,bytes,1,0,0,0)==UINT64_MAX&&C("_filelengthi64",999,0,0,0,0,0)==UINT64_MAX);
    CHECK("_filelengthi64",C("_filelengthi64",desc,0,0,0,0,0)==3);
    CHECK("_lseeki64",C("_lseeki64",desc,0,0,0,0,0)==0);
    CHECK("_read",C("_read",desc,bytes,3,0,0,0)==3&&!memcmp(bytes,"abc",3));
    CHECK("_fdopen-shared-position",ftell(alias)==3);
    CHECK("_fdopen-pushback",ungetc('Z',alias)=='Z'&&fgetc(alias)=='Z'&&ftell(alias)==3);
    CHECK("FILE-eof",fgetc(alias)==EOF&&feof(alias)&&(*(unsigned *)((char *)alias+24)&0x10));
    CHECK("_fstat64",C("_fstat64",desc,bytes,0,0,0,0)==0&&*(uint64_t *)(bytes+24)==3);
    CHECK("_wstat64",C("_wstat64",L"scratch",bytes,0,0,0,0)==0&&*(uint64_t *)(bytes+24)==3);
    CHECK("_get_osfhandle",C("_get_osfhandle",1,0,0,0,0,0)==(uintptr_t)GetStdHandle(STD_OUTPUT_HANDLE)&&C("_get_osfhandle",desc,0,0,0,0,0)==UINT64_MAX);
    CHECK("_getpid",C("_getpid",0,0,0,0,0,0)==GetCurrentProcessId());
    CHECK("_close",C("_close",desc,0,0,0,0,0)==0&&C("_close",desc,0,0,0,0,0)==UINT64_MAX);
    CHECK("_fdopen-owner-closed",fgetc(alias)==EOF);
    CHECK("_wrename",C("_wrename",L"scratch",L"renamed",0,0,0,0)==0);
    CHECK("_wunlink",C("_wunlink",L"renamed",0,0,0,0,0)==0);
    CHECK("_wchdir",C("_wchdir",L".",0,0,0,0,0)==0&&neg(C("_wchdir",L"missing",0,0,0,0,0))==-1);
    CHECK("_wrmdir",neg(C("_wrmdir",L"C:\\GAME",0,0,0,0,0))==-1);
    file=fopen("again","w+");FILE *reopened=0;
    CHECK("freopen_s",C("freopen_s",&reopened,"again","r",file,0,0)==0&&reopened==file);fclose(file);
    CHECK("remove",C("remove","again",0,0,0,0,0)==0);
    file=fopen("alias-reopen","w+");desc=neg(C("_fileno",file,0,0,0,0,0));
    alias=(FILE *)(uintptr_t)C("_fdopen",desc,"r+b",0,0,0,0);
    CHECK("freopen-failure",C("freopen_s",&reopened,"missing-reopen","r",file,0,0)==2&&!reopened);
    file=fopen("new-backend","w+");fputs("x",file);rewind(file);
    CHECK("freopen-invalidates-alias",fgetc(alias)==EOF);fclose(file);

    CHECK("strcpy_s",C("strcpy_s",bytes,4,"abc",0,0,0)==0&&!strcmp(bytes,"abc")&&C("strcpy_s",bytes,2,"abc",0,0,0)==34&&bytes[0]==0);
    CHECK("wcscpy_s",C("wcscpy_s",wide,4,L"abc",0,0,0)==0&&!wcscmp(wide,L"abc"));
    CHECK("_memicmp",C("_memicmp","aBc","AbC",3,0,0,0)==0);
    CHECK("_ultoa",C("_ultoa",0xffffffffu,bytes,16,0,0,0)==U(bytes)&&!strcmp(bytes,"ffffffff"));
    CHECK("_scprintf",C("_scprintf","%s %d","abc",7,0,0,0)==5);check_vformat(bytes,5,"%s","abcde");
    struct tm tm={0};tm.tm_year=101;tm.tm_mon=9;tm.tm_mday=25;
    CHECK("wcsftime",C("wcsftime",wide,1024,L"%Y-%m-%d",&tm,0,0)==10&&!wcscmp(wide,L"2001-10-25"));
    CHECK("wcsftime-unicode",C("wcsftime",wide,1024,L"\u00e9\U0001f600",&tm,0,0)==3&&wide[0]==0xe9&&wide[1]==0xd83d&&wide[2]==0xde00&&wide[3]==0);
    file=tmpfile();CHECK("putwc",C("putwc",'Q',file,0,0,0,0)=='Q');rewind(file);CHECK("getwc",C("getwc",file,0,0,0,0,0)=='Q');fclose(file);
    file=tmpfile();CHECK("fwprintf",C("fwprintf",file,L"%ls %d",L"wide",7,0,0)==6);rewind(file);memset(bytes,0,sizeof bytes);CHECK("fwprintf-bytes",fread(bytes,1,12,file)==12&&!memcmp(bytes,"w\0i\0d\0e\0 \0" "7\0",12));fclose(file);
    errno=2;C("perror","fixture",0,0,0,0,0);CHECK("perror",1);
    unsigned argc=0;wchar_t **argv=(wchar_t **)(uintptr_t)S("CommandLineToArgvW",L"app \"a b\" c\\\\\"d",&argc,0,0,0,0);
    CHECK("CommandLineToArgvW",argv&&argc==3&&!wcscmp(argv[1],L"a b"));LocalFree(argv);
    CHECK("ShellExecuteW",S("ShellExecuteW",0,L"open",L"missing",0,0,0)==31);
    ft=1;CHECK("SHGetKnownFolderPath",(uint32_t)S("SHGetKnownFolderPath",bytes,0,0,&ft,0,0)==0x80070002u&&ft==0);
    CHECK("SHFileOperationW",S("SHFileOperationW",bytes,0,0,0,0,0)==0x78);
    S("DragAcceptFiles",0,1,0,0,0,0);CHECK("DragAcceptFiles",1);
    CHECK("DragQueryFileW",!S("DragQueryFileW",0,0,wide,1024,0,0)&&GetLastError()==6);
    CHECK("CreatePolygonRgn",!invoke("gdi32.dll","CreatePolygonRgn",U(page),3,1,0,0,0));
    CHECK("midiInGetNumDevs",M("midiInGetNumDevs",0,0,0,0,0,0)==0);
    ft=123;CHECK("midiInOpen",M("midiInOpen",&ft,0,0,0,0,0)==2&&ft==0);
    CHECK("midiInGetDevCapsA",M("midiInGetDevCapsA",0,bytes,sizeof bytes,0,0,0)==2);
    const char *midi[]={"midiInClose","midiInStart","midiInStop","midiInGetID"};for(unsigned i=0;i<4;i++)CHECK(midi[i],M(midi[i],0,0,0,0,0,0)==5);
    CHECK("midiInGetErrorTextA",M("midiInGetErrorTextA",5,bytes,sizeof bytes,0,0,0)==0&&strstr(bytes,"invalid"));
    CHECK("timeBeginPeriod",M("timeBeginPeriod",1,0,0,0,0,0)==0&&M("timeBeginPeriod",0,0,0,0,0,0)==97);
    CHECK("timeEndPeriod",M("timeEndPeriod",1,0,0,0,0,0)==0&&M("timeEndPeriod",1,0,0,0,0,0)==97);
    WNDCLASSA wc={0};wc.lpfnWndProc=window_proc;wc.hInstance=GetModuleHandleA(0);wc.lpszClassName="contracts";RegisterClassA(&wc);
    HWND wnd=CreateWindowExA(0,"contracts","contracts",WS_VISIBLE,0,0,320,200,0,0,GetModuleHandleA(0),0);
    CHECK("GetKeyboardLayout",W("GetKeyboardLayout",0,0,0,0,0,0)==0x04090409);
    CHECK("GetKeyboardLayoutList",W("GetKeyboardLayoutList",1,&ft,0,0,0,0)==1&&ft==0x04090409);
    CHECK("GetKeyboardLayoutNameA",W("GetKeyboardLayoutNameA",bytes,0,0,0,0,0)&&!strcmp(bytes,"00000409"));
    CHECK("ActivateKeyboardLayout",W("ActivateKeyboardLayout",1,0,0,0,0,0)==0x04090409&&!W("ActivateKeyboardLayout",123,0,0,0,0,0));
    CHECK("AllowSetForegroundWindow",W("AllowSetForegroundWindow",1,0,0,0,0,0)&&!W("AllowSetForegroundWindow",123,0,0,0,0,0));
    CHECK("GetMessageExtraInfo",W("GetMessageExtraInfo",0,0,0,0,0,0)==0);
    uint64_t mon=W("MonitorFromWindow",wnd,0,0,0,0,0);CHECK("MonitorFromWindow",mon!=0);
    CHECK("MonitorFromPoint",W("MonitorFromPoint",0,0,0,0,0,0)==mon&&!W("MonitorFromPoint",UINT64_MAX,0,0,0,0,0));
    *(uint32_t *)bytes=104;CHECK("GetMonitorInfoW",W("GetMonitorInfoW",mon,bytes,0,0,0,0)&&*(uint32_t *)(bytes+36)==1&&!wcscmp((wchar_t *)(bytes+40),L"\\\\.\\DISPLAY1"));
    CHECK("EnumDisplayMonitors",W("EnumDisplayMonitors",0,0,monitor,0x1122334455667788ull,0,0)&&monitor_count==1);
    DEVMODEW dm={0};dm.dmSize=sizeof dm;CHECK("EnumDisplaySettingsW",W("EnumDisplaySettingsW",0,ENUM_CURRENT_SETTINGS,&dm,0,0,0)&&dm.dmPelsWidth==320&&dm.dmPelsHeight==200);
    CHECK("MapVirtualKeyA",W("MapVirtualKeyA",'A',0,0,0,0,0)==30);
    CHECK("MapVirtualKeyExA",W("MapVirtualKeyExA",30,1,0x04090409,0,0,0)=='A');
    CHECK("OpenClipboard",W("OpenClipboard",wnd,0,0,0,0,0));CHECK("EmptyClipboard",W("EmptyClipboard",0,0,0,0,0,0));
    HGLOBAL text=GlobalAlloc(GMEM_MOVEABLE,16);strcpy((char *)GlobalLock(text),"hello");GlobalUnlock(text);
    CHECK("SetClipboardData",W("SetClipboardData",CF_TEXT,text,0,0,0,0)==U(text));CHECK("IsClipboardFormatAvailable",W("IsClipboardFormatAvailable",CF_TEXT,0,0,0,0,0));
    CHECK("GetClipboardData",W("GetClipboardData",CF_TEXT,0,0,0,0,0)==U(text));CHECK("CloseClipboard",W("CloseClipboard",0,0,0,0,0,0)&&!W("CloseClipboard",0,0,0,0,0,0)&&GetLastError()==1418);
    const char *ui[]={"RegisterTouchWindow","CreateIconFromResource","FlashWindowEx","SetWindowRgn"};for(unsigned i=0;i<4;i++)CHECK(ui[i],!W(ui[i],wnd,0,0,0,0,0)&&GetLastError()==50);
    TRACKMOUSEEVENT track={sizeof track,TME_HOVER,wnd,20};
    CHECK("TrackMouseEvent",W("TrackMouseEvent",&track,0,0,0,0,0));
    track.dwFlags=TME_QUERY;CHECK("TrackMouseEvent-query",W("TrackMouseEvent",&track,0,0,0,0,0)&&track.dwFlags==TME_HOVER&&track.dwHoverTime==20);
    track.dwFlags=TME_CANCEL|TME_HOVER;CHECK("TrackMouseEvent-cancel",W("TrackMouseEvent",&track,0,0,0,0,0));
    unsigned char maskbits[8]={0};
    HBITMAP mask=(HBITMAP)(uintptr_t)invoke("gdi32.dll","CreateBitmap",2,2,1,1,U(maskbits),0);
    HBITMAP color=(HBITMAP)(uintptr_t)invoke("gdi32.dll","CreateBitmap",2,2,1,32,U(bytes),0);
    ICONINFO iconinfo={TRUE,123,456,mask,color};
    HICON icon=(HICON)(uintptr_t)W("CreateIconIndirect",&iconinfo,0,0,0,0,0);
    invoke("gdi32.dll","DeleteObject",U(mask),0,0,0,0,0);invoke("gdi32.dll","DeleteObject",U(color),0,0,0,0,0);
    ICONINFO copy={0};CHECK("CreateIconIndirect",icon&&W("GetIconInfo",icon,&copy,0,0,0,0)&&copy.fIcon&&copy.xHotspot==1&&copy.yHotspot==1&&copy.hbmMask&&copy.hbmColor);
    BITMAP bitmap;CHECK("icon-independent-bitmaps",invoke("gdi32.dll","GetObjectA",U(copy.hbmColor),sizeof bitmap,U(&bitmap),0,0,0)==sizeof bitmap&&bitmap.bmWidth==2&&bitmap.bmHeight==2);
    invoke("gdi32.dll","DeleteObject",U(copy.hbmMask),0,0,0,0,0);invoke("gdi32.dll","DeleteObject",U(copy.hbmColor),0,0,0,0,0);
    CHECK("DestroyIcon",W("DestroyIcon",icon,0,0,0,0,0)&&!W("DestroyIcon",icon,0,0,0,0,0)&&GetLastError()==6);
    CHECK("GetTouchInputInfo",!W("GetTouchInputInfo",0,1,bytes,40,0,0)&&GetLastError()==6);
    CHECK("CloseTouchInputHandle",!W("CloseTouchInputHandle",0,0,0,0,0,0)&&GetLastError()==6);
    unsigned count=0;CHECK("GetRawInputDeviceList-size",W("GetRawInputDeviceList",0,&count,16,0,0,0)==0&&count==2);
    CHECK("GetRawInputDeviceList",W("GetRawInputDeviceList",bytes,&count,16,0,0,0)==2&&*(uint64_t *)bytes==1&&*(uint64_t *)(bytes+16)==2);
    count=sizeof bytes;CHECK("GetRawInputDeviceInfoA",W("GetRawInputDeviceInfoA",1,RIDI_DEVICENAME,bytes,&count,0,0)>0&&strstr(bytes,"Mouse"));
    count=32;*(unsigned *)bytes=32;CHECK("raw-info-struct",W("GetRawInputDeviceInfoA",2,RIDI_DEVICEINFO,bytes,&count,0,0)==32&&*(unsigned *)(bytes+4)==1);
    CHECK("raw-info-invalid",neg(W("GetRawInputDeviceInfoA",123,RIDI_DEVICENAME,bytes,&count,0,0))==-1&&GetLastError()==6);
    puts("tracking ready");
    for(unsigned frame=0;frame<60;frame++){MSG msg;while(PeekMessageA(&msg,0,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageA(&msg);}Sleep(16);}
    printf("tracking totals hover=%u leave=%u\n",mouse_hover,mouse_leave);
    int redirected=C("freopen_s",&reopened,"redirected","w+",stdout,0,0)==0&&reopened==stdout;
    fputs("redirected bytes",stdout);puts("plus puts");rewind(stdout);memset(bytes,0,sizeof bytes);fread(bytes,1,26,stdout);
    redirected=redirected&&!strcmp(bytes,"redirected bytesplus puts\n");
    fprintf(stderr,"contract freopen-stdout-bytes %s\n",redirected?"PASS":"FAIL");checks++;if(!redirected)failures++;
    fprintf(stderr,"contracts totals checks=%u failures=%u\n",checks,failures);fflush(stderr);
    atexit(should_not_run);C("_amsg_exit",8,0,0,0,0,0);fprintf(stderr,"BAD_FATAL_RETURN\n");return failures?1:0;
}
