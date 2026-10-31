/* Original CC0-1.0; LANE-K1. Normal MinGW startup, no overrides or host Windows execution. */
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#define DIRECTINPUT_VERSION 0x0800
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <avrt.h>
#include <bcrypt.h>
#include <dinput.h>
#include <dwmapi.h>
#include <imm.h>
#include <iphlpapi.h>
#include <shlwapi.h>
#include <stdint.h>
#include <string.h>
/* Older MinGW headers omit these published Windows constants. */
#ifndef BCRYPT_RNG_ALG_HANDLE
#define BCRYPT_RNG_ALG_HANDLE ((BCRYPT_ALG_HANDLE)(uintptr_t)0x81)
#endif
#ifndef DWM_E_COMPOSITIONDISABLED
#define DWM_E_COMPOSITIONDISABLED ((HRESULT)0x80263001)
#endif
static void check(int ok,const char *name) {
    char text[192]; wsprintfA(text,"sysdlls %s %s",ok?"PASS":"FAIL",name); OutputDebugStringA(text);
    if(!ok)ExitProcess(77);
}
#define CHECK(x,n) check(!!(x),n)
static HWND window;
static LRESULT CALLBACK proc(HWND w,UINT m,WPARAM p,LPARAM l) {return DefWindowProcA(w,m,p,l);}
static DWORD WINAPI avrt_wrong_thread(void *p) {return !AvSetMmThreadPriority((HANDLE)p,AVRT_PRIORITY_HIGH)&&GetLastError()==ERROR_INVALID_HANDLE;}
static void avrt(void) {
    DWORD index=0;
    CHECK(!AvSetMmThreadCharacteristicsA("MissingTask",&index)&&GetLastError()==ERROR_INVALID_TASK_NAME,"avrt-name");
    CHECK(!AvSetMmThreadCharacteristicsA("Games",0)&&GetLastError()==ERROR_INVALID_PARAMETER,"avrt-pointer");
    index=999;CHECK(!AvSetMmThreadCharacteristicsA("Games",&index)&&GetLastError()==ERROR_INVALID_TASK_INDEX,"avrt-index");
    index=0;HANDLE h=AvSetMmThreadCharacteristicsA("Games",&index);
    CHECK(h&&index,"avrt-task");
    CHECK(!AvSetMmThreadCharacteristicsA("Games",&index)&&GetLastError()==ERROR_THREAD_ALREADY_IN_TASK,"avrt-duplicate");
    CHECK(AvSetMmThreadPriority(h,AVRT_PRIORITY_CRITICAL),"avrt-priority");
    CHECK(!AvSetMmThreadPriority(h,(AVRT_PRIORITY)3)&&GetLastError()==ERROR_INVALID_PARAMETER,"avrt-priority-invalid");
    HANDLE t=CreateThread(0,0,avrt_wrong_thread,h,0,0);DWORD code=0;
    WaitForSingleObject(t,INFINITE);GetExitCodeThread(t,&code);CloseHandle(t);
    CHECK(code==1,"avrt-thread-owner");
    CHECK(AvRevertMmThreadCharacteristics(h),"avrt-revert");
    CHECK(!AvSetMmThreadPriority(h,AVRT_PRIORITY_NORMAL)&&GetLastError()==ERROR_INVALID_HANDLE,"avrt-stale");
}
static void rng(void) {
    unsigned char a[64]={0},b[64]={0};
    CHECK(BCryptGenRandom(0,a,sizeof a,BCRYPT_USE_SYSTEM_PREFERRED_RNG)==0,"rng-system");
    CHECK(BCryptGenRandom(BCRYPT_RNG_ALG_HANDLE,b,sizeof b,0)==0&&memcmp(a,b,sizeof a),"rng-pseudo-handle");
    CHECK(BCryptGenRandom(0,0,0,2)==0,"rng-empty");
    CHECK(BCryptGenRandom(0,0,1,2)==(LONG)0xc000000d,"rng-null");
    CHECK(BCryptGenRandom(0,a,sizeof a,4)==(LONG)0xc000000d,"rng-flags");
    CHECK(BCryptGenRandom((void*)0x777,a,sizeof a,0)==(LONG)0xc0000008,"rng-provider");
    CHECK(BCryptGenRandom(0,a,sizeof a,0)==(LONG)0xc0000008,"rng-no-provider");
    CHECK(BCryptGenRandom(0,(void*)(uintptr_t)0x100000000ull,1,2)==(LONG)0xc000000d,"rng-wide-pointer");
    CHECK(BCryptGenRandom(0,(void*)(uintptr_t)0x3ffffffe,4,2)==(LONG)0xc000000d,"rng-span");
    CHECK(BCryptGenRandom(0,a,sizeof a,3)==0,"rng-entropy-flag");
}
static void desktop(void) {
    BOOL enabled=123;
    CHECK(DwmIsCompositionEnabled(&enabled)==S_OK&&!enabled,"dwm-composition");
    CHECK(FAILED(DwmIsCompositionEnabled(0)),"dwm-pointer");
    DWM_BLURBEHIND blur={0};blur.dwFlags=DWM_BB_ENABLE;blur.fEnable=1;
    CHECK(DwmEnableBlurBehindWindow(window,&blur)==DWM_E_COMPOSITIONDISABLED,"dwm-blur");
    CHECK(DwmFlush()==DWM_E_COMPOSITIONDISABLED,"dwm-flush");
    CHECK(FAILED(DwmEnableBlurBehindWindow(0,&blur)),"dwm-window");
    CHECK(!ImmGetContext(window),"ime-absent");
    CHECK(!ImmAssociateContext(window,0),"ime-disassociate");
    CHECK(!ImmAssociateContext(window,(HIMC)123)&&GetLastError()==ERROR_INVALID_HANDLE,"ime-invalid-context");
    CHECK(!ImmReleaseContext(window,0),"ime-release");
    COMPOSITIONFORM form={0};CHECK(!ImmSetCompositionWindow(0,&form),"ime-composition");
    CHECK(!ImmGetContext(0)&&GetLastError()==ERROR_INVALID_WINDOW_HANDLE,"ime-window");
    ULONG size=999;CHECK(GetAdaptersAddresses(AF_UNSPEC,0,0,0,&size)==ERROR_NO_DATA&&size==0,"ip-adapters");
    size=999;char buffer[512];memset(buffer,0xa5,sizeof buffer);
    CHECK(GetAdaptersAddresses(AF_INET,0,0,(void*)buffer,&size)==ERROR_NO_DATA&&(unsigned char)buffer[0]==0xa5,"ip-empty-list");
    CHECK(GetAdaptersAddresses(999,0,0,0,&size)==ERROR_INVALID_PARAMETER,"ip-family");
    CHECK(GetAdaptersAddresses(0,0,0,0,0)==ERROR_INVALID_PARAMETER,"ip-size-pointer");
    struct sockaddr_in addr={0};addr.sin_family=AF_INET;DWORD index=999;
    CHECK(GetBestInterfaceEx((void*)&addr,&index)==ERROR_NETWORK_UNREACHABLE&&index==999,"ip-route");
    addr.sin_family=999;CHECK(GetBestInterfaceEx((void*)&addr,&index)==WSAEAFNOSUPPORT,"ip-route-family");
    WCHAR path[512];GetModuleFileNameW(0,path,512);
    CHECK(PathFileExistsW(path),"path-self");
    CHECK(!PathFileExistsW(L"C:\\game\\missing-file.bin")&&!PathFileExistsW(0),"path-missing");
}
static int enum_count;
static BOOL CALLBACK enum_devices(const DIDEVICEINSTANCEW *p,void *ctx) {
    CHECK(ctx==(void*)0x12345678&&p->dwSize==sizeof *p&&p->tszInstanceName[0],"di-callback");
    enum_count++;return DIENUM_CONTINUE;
}
static LPDIRECTINPUT8W di;
static LPDIRECTINPUTDEVICE8W keyboard,mouse,pad;
static const GUID pad_guid={0x6f1d2b70,0xd5a0,0x11cf,{0xbf,0xc7,0x44,0x45,0x53,0x54,0,0}};
static void directinput(void) {
    void *p=(void*)1;
    CHECK(DirectInput8Create(GetModuleHandleA(0),0x700,&IID_IDirectInput8W,&p,0)==DIERR_OLDDIRECTINPUTVERSION&&!p,"di-version");
    CHECK(DirectInput8Create(GetModuleHandleA(0),0x800,&IID_IDirectInput8W,(void**)&di,0)==S_OK&&di,"di-create");
    LPDIRECTINPUT8A ansi;CHECK(DirectInput8Create(GetModuleHandleA(0),0x800,&IID_IDirectInput8A,(void**)&ansi,0)==S_OK,"di-ansi");
    CHECK(IDirectInput8_AddRef(ansi)==2&&IDirectInput8_Release(ansi)==1&&IDirectInput8_Release(ansi)==0,"di-release");
    CHECK(IDirectInput8_QueryInterface(di,&IID_IUnknown,&p)==S_OK&&p==(void*)di,"di-identity");
    CHECK(IDirectInput8_Release((LPDIRECTINPUT8W)p)==1,"di-refcount");
    GUID bad={1};p=(void*)1;
    CHECK(IDirectInput8_QueryInterface(di,&bad,&p)==E_NOINTERFACE&&!p,"di-interface");
    CHECK(IDirectInput8_EnumDevices(di,DI8DEVCLASS_ALL,enum_devices,(void*)0x12345678,DIEDFL_ATTACHEDONLY)==S_OK&&enum_count>=2,"di-enumerate");
    CHECK(IDirectInput8_CreateDevice(di,&GUID_SysKeyboard,&keyboard,0)==S_OK,"di-keyboard");
    CHECK(IDirectInput8_CreateDevice(di,&GUID_SysMouse,&mouse,0)==S_OK,"di-mouse");
    LPDIRECTINPUTDEVICE8W absent=(void*)1;
    CHECK(IDirectInput8_CreateDevice(di,&pad_guid,&absent,0)==DIERR_DEVICENOTREG&&!absent,"di-pad-absent");
    CHECK(IDirectInputDevice8_QueryInterface(keyboard,&IID_IDirectInputDevice8W,&p)==S_OK&&p==(void*)keyboard,"di-device-identity");
    IDirectInputDevice8_Release((LPDIRECTINPUTDEVICE8W)p);
    DIDEVCAPS caps={.dwSize=sizeof caps};
    CHECK(IDirectInputDevice8_GetCapabilities(keyboard,&caps)==S_OK&&caps.dwButtons==256,"di-caps");
    DIDEVICEINSTANCEW info={.dwSize=sizeof info};
    CHECK(IDirectInputDevice8_GetDeviceInfo(mouse,&info)==S_OK&&IsEqualGUID(&info.guidInstance,&GUID_SysMouse),"di-info");
    CHECK(IDirectInputDevice8_SetCooperativeLevel(keyboard,window,DISCL_NONEXCLUSIVE|DISCL_FOREGROUND)==S_OK,"di-cooperative");
    CHECK(IDirectInputDevice8_SetCooperativeLevel(keyboard,window,DISCL_EXCLUSIVE|DISCL_FOREGROUND)==E_ACCESSDENIED,"di-exclusive");
    CHECK(IDirectInputDevice8_SetDataFormat(keyboard,&c_dfDIKeyboard)==S_OK&&IDirectInputDevice8_SetDataFormat(mouse,&c_dfDIMouse)==S_OK,"di-format");
    BYTE keys[256];CHECK(IDirectInputDevice8_GetDeviceState(keyboard,sizeof keys,keys)==DIERR_NOTACQUIRED,"di-not-acquired");
    CHECK(IDirectInputDevice8_Acquire(keyboard)==S_OK&&IDirectInputDevice8_Acquire(mouse)==S_OK,"di-acquire");
    CHECK(IDirectInputDevice8_Acquire(keyboard)==S_FALSE,"di-acquire-again");
    CHECK(IDirectInputDevice8_GetDeviceState(keyboard,1,keys)==DIERR_INVALIDPARAM,"di-state-size");
    CHECK(IDirectInputDevice8_SetDataFormat(keyboard,&c_dfDIKeyboard)==DIERR_ACQUIRED,"di-format-acquired");
    CHECK(IDirectInputDevice8_Poll(keyboard)==S_OK,"di-poll");
    CHECK(IDirectInputDevice8_RunControlPanel(keyboard,window,0)==E_NOTIMPL,"di-unsupported");
    CHECK(IDirectInput8_GetDeviceStatus(di,&GUID_SysKeyboard)==S_OK,"di-status");
    CHECK(IDirectInputDevice8_Unacquire(mouse)==S_OK&&IDirectInputDevice8_Unacquire(mouse)==S_FALSE&&IDirectInputDevice8_Acquire(mouse)==S_OK,"di-unacquire");
}
static volatile LONG socket_worker_done;
static DWORD WINAPI socket_worker(void *unused) {
    (void)unused;
    SOCKET s=socket(AF_INET,SOCK_DGRAM,0);struct sockaddr_in a={0};a.sin_family=AF_INET;
    char b;int ok=bind(s,(void*)&a,sizeof a)==0;
    for(int i=0;i<32;i++){ok=ok&&recv(s,&b,1,0)==SOCKET_ERROR&&WSAGetLastError()==WSAENETDOWN;Sleep(0);}
    closesocket(s);socket_worker_done=1;return ok;
}
static void networking(void) {
    CHECK(socket(AF_INET,SOCK_STREAM,0)==INVALID_SOCKET&&WSAGetLastError()==WSANOTINITIALISED,"wsa-not-started");
    WSADATA data;memset(&data,0xa5,sizeof data);
    CHECK(WSAStartup(0,&data)==WSAVERNOTSUPPORTED,"wsa-version-reject");
    CHECK(WSAStartup(MAKEWORD(1,1),&data)==0&&data.wVersion==MAKEWORD(1,1)&&data.wHighVersion==MAKEWORD(2,2)&&data.szDescription[0],"wsa-v1-layout");
    CHECK(WSAStartup(MAKEWORD(2,2),&data)==0&&data.wVersion==MAKEWORD(2,2),"wsa-v2-layout");
    CHECK(WSACleanup()==0,"wsa-nesting");
    CHECK(socket(999,SOCK_STREAM,0)==INVALID_SOCKET&&WSAGetLastError()==WSAEAFNOSUPPORT,"socket-family");
    CHECK(socket(AF_INET,999,0)==INVALID_SOCKET&&WSAGetLastError()==WSAESOCKTNOSUPPORT,"socket-type");
    SOCKET s=socket(AF_INET,SOCK_STREAM,0);CHECK(s!=INVALID_SOCKET,"socket-handle");
    CHECK(htons(0x1234)==0x3412&&ntohs(0xabcd)==0xcdab&&htonl(0x12345678)==0x78563412&&ntohl(0x87654321)==0x21436587,"socket-byte-order");
    CHECK(inet_addr("127.0.0.1")==0x0100007f&&inet_addr("127.1")==0x0100007f&&inet_addr("0x7f000001")==0x0100007f&&inet_addr("garbage")==INADDR_NONE,"socket-inet-addr");
    struct sockaddr_in addr={0};addr.sin_family=AF_INET;addr.sin_port=htons(23456);addr.sin_addr.s_addr=inet_addr("192.0.2.1");
    CHECK(connect(s,(void*)&addr,sizeof addr)==SOCKET_ERROR&&WSAGetLastError()==WSAENETUNREACH,"socket-connect");
    CHECK(WSAConnect(s,(void*)&addr,sizeof addr,0,0,0,0)==SOCKET_ERROR&&WSAGetLastError()==WSAENETUNREACH,"socket-wsaconnect");
    CHECK(bind(s,(void*)&addr,sizeof addr)==SOCKET_ERROR&&WSAGetLastError()==WSAEADDRNOTAVAIL,"socket-bind-nonlocal");
    addr.sin_addr.s_addr=0;addr.sin_port=0;
    CHECK(bind(s,(void*)&addr,sizeof addr)==0,"socket-bind");
    int length=sizeof addr;CHECK(getsockname(s,(void*)&addr,&length)==0&&length==sizeof addr&&addr.sin_port,"socket-name");
    CHECK(listen(s,1)==0,"socket-listen");
    u_long nonblock=1;CHECK(ioctlsocket(s,FIONBIO,&nonblock)==0,"socket-nonblocking");
    CHECK(accept(s,0,0)==INVALID_SOCKET&&WSAGetLastError()==WSAEWOULDBLOCK,"socket-accept");
    int yes=1;CHECK(setsockopt(s,SOL_SOCKET,SO_KEEPALIVE,(void*)&yes,sizeof yes)==0,"socket-option");
    CHECK(send(s,"x",1,0)==SOCKET_ERROR&&WSAGetLastError()==WSAENOTCONN,"socket-send");
    char b[64];CHECK(recv(s,b,sizeof b,0)==SOCKET_ERROR&&WSAGetLastError()==WSAENOTCONN,"socket-recv");
    CHECK(sendto(s,"x",1,0,(void*)&addr,sizeof addr)==SOCKET_ERROR&&WSAGetLastError()==WSAENETUNREACH,"socket-sendto");
    CHECK(recvfrom(s,b,sizeof b,0,0,0)==SOCKET_ERROR&&WSAGetLastError()==WSAENOTCONN,"socket-recvfrom");
    fd_set f;FD_ZERO(&f);FD_SET(s,&f);CHECK(__WSAFDIsSet(s,&f),"socket-fdset");
    struct timeval tv={0,0};CHECK(select(0,&f,0,0,&tv)==0&&f.fd_count==0,"socket-select");
    CHECK(closesocket(s)==0&&closesocket(s)==SOCKET_ERROR&&WSAGetLastError()==WSAENOTSOCK,"socket-close");
    SOCKET d=socket(AF_INET,SOCK_DGRAM,0);addr.sin_port=0;CHECK(bind(d,(void*)&addr,sizeof addr)==0,"socket-datagram-bind");
    CHECK(recv(d,b,sizeof b,0)==SOCKET_ERROR&&WSAGetLastError()==WSAENETDOWN,"socket-offline-blocking");
    CHECK(ioctlsocket(d,FIONBIO,&nonblock)==0&&recv(d,b,sizeof b,0)==SOCKET_ERROR&&WSAGetLastError()==WSAEWOULDBLOCK,"socket-datagram-nonblocking");
    closesocket(d);
    struct in6_addr v6;CHECK(inet_pton(AF_INET6,"2001:db8::1",&v6)==1&&v6.s6_addr[0]==0x20&&v6.s6_addr[15]==1,"socket-ipv6");
    memset(b,0x55,sizeof b);CHECK(inet_pton(AF_INET,"1.2.3.999",b)==0&&b[0]==0x55,"socket-invalid-address");
    struct addrinfo hints={0},*result=0;hints.ai_family=AF_INET;hints.ai_socktype=SOCK_STREAM;hints.ai_flags=AI_NUMERICHOST;
    CHECK(getaddrinfo("192.0.2.1","443",&hints,&result)==0&&result&&result->ai_family==AF_INET&&result->ai_addrlen==16&&((struct sockaddr_in*)result->ai_addr)->sin_port==htons(443),"socket-addrinfo");
    char host[64],service[16];
    CHECK(getnameinfo(result->ai_addr,(socklen_t)result->ai_addrlen,host,sizeof host,service,sizeof service,NI_NUMERICHOST|NI_NUMERICSERV)==0&&!strcmp(host,"192.0.2.1")&&!strcmp(service,"443"),"socket-nameinfo");
    freeaddrinfo(result);CHECK(1,"socket-freeaddr");
    result=(void*)1;CHECK(getaddrinfo("offline.invalid","80",&hints,&result)==WSAHOST_NOT_FOUND&&!result,"socket-no-dns");
    HANDLE worker=CreateThread(0,0,socket_worker,0,0,0);DWORD code=0;
    CHECK(WaitForSingleObject(worker,1000)==WAIT_OBJECT_0&&GetExitCodeThread(worker,&code)&&code&&socket_worker_done,"socket-cooperative-worker");CloseHandle(worker);
    CHECK(WSACleanup()==0&&WSACleanup()==SOCKET_ERROR&&WSAGetLastError()==WSANOTINITIALISED,"wsa-cleanup");
}
int main(void) {
    WNDCLASSA cls={0};cls.lpfnWndProc=proc;cls.lpszClassName="SystemDllFixture";RegisterClassA(&cls);
    window=CreateWindowExA(0,cls.lpszClassName,"System DLLs",WS_VISIBLE|WS_POPUP,0,0,320,160,0,0,0,0);
    avrt();rng();desktop();directinput();networking();
    OutputDebugStringA("sysdlls READY");
    for(;;) {
        MSG msg;while(PeekMessageA(&msg,0,0,0,PM_REMOVE))DispatchMessageA(&msg);
        if(!pad) {
            HRESULT hr=IDirectInput8_CreateDevice(di,&pad_guid,&pad,0);
            if(hr==S_OK)CHECK(IDirectInputDevice8_SetDataFormat(pad,&c_dfDIJoystick)==S_OK&&IDirectInputDevice8_Acquire(pad)==S_OK,"di-pad-acquire");
            else CHECK(hr==DIERR_DEVICENOTREG,"di-pad-discovery");
        }
        if(pad) {
            DIJOYSTATE j;HRESULT hr=IDirectInputDevice8_GetDeviceState(pad,sizeof j,&j);
            if(hr==S_OK) {char t[128];wsprintfA(t,"sysdlls pad x=%ld y=%ld button=%u",j.lX,j.lY,j.rgbButtons[0]);OutputDebugStringA(t);}
            else CHECK(hr==DIERR_INPUTLOST,"di-pad-disconnect");
        }
        BYTE keys[256];DIMOUSESTATE m;
        CHECK(IDirectInputDevice8_GetDeviceState(keyboard,sizeof keys,keys)==S_OK,"di-live-keyboard");
        CHECK(IDirectInputDevice8_GetDeviceState(mouse,sizeof m,&m)==S_OK,"di-live-mouse");
        char text[128];wsprintfA(text,"sysdlls input key=%u mouse=%ld,%ld button=%u",keys[DIK_K],m.lX,m.lY,m.rgbButtons[0]);OutputDebugStringA(text);
        HDC dc=GetDC(window);RECT r={0,0,320,160};HBRUSH brush=CreateSolidBrush(keys[DIK_K]?RGB(0,220,0):RGB(0,60,0));FillRect(dc,&r,brush);DeleteObject(brush);ReleaseDC(window,dc);
        Sleep(16);
    }
}
