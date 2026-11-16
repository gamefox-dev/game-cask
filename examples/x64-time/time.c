/* Original CC0-1.0. Source-built Win64 workload, not a game or a timing override.
 * Main: many instruction quanta per SwapBuffers. Worker: real WASAPI event loop.
 * A third thread exercises Sleep, QPC and timeGetTime concurrently. */
#define COBJMACROS
#include <initguid.h>
#include <windows.h>
#include <mmsystem.h>
#include <GL/gl.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <stdio.h>
static volatile LONG ready, stop, wakes, sleeps;
static volatile unsigned work_sink;
static void check(int ok) { if (!ok) { OutputDebugStringA("x64-time FAIL"); ExitProcess(1); } }
static void hr(HRESULT result) { check(SUCCEEDED(result)); }
static __declspec(noinline) unsigned work(unsigned n, unsigned x) {
    for (unsigned i=0; i<n; i++) x = (x * 1664525u + 1013904223u) ^ (x >> 13);
    return x;
}
static DWORD WINAPI mixer(void *unused) {
    (void)unused;
    IMMDeviceEnumerator *enumerator; IMMDevice *device;
    IAudioClient *client; IAudioRenderClient *render; WAVEFORMATEX *format;
    HANDLE event = CreateEventA(0, FALSE, FALSE, 0);
    hr(CoInitializeEx(0, COINIT_MULTITHREADED));
    hr(CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER,
        &IID_IMMDeviceEnumerator, (void **)&enumerator));
    hr(IMMDeviceEnumerator_GetDefaultAudioEndpoint(enumerator,eRender,eConsole,&device));
    hr(IMMDevice_Activate(device,&IID_IAudioClient,CLSCTX_INPROC_SERVER,0,(void **)&client));
    hr(IAudioClient_GetMixFormat(client,&format));
    hr(IAudioClient_Initialize(client,AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        1000000,0,format,0));
    hr(IAudioClient_SetEventHandle(client,event));
    hr(IAudioClient_GetService(client,&IID_IAudioRenderClient,(void **)&render));
    UINT32 capacity; hr(IAudioClient_GetBufferSize(client,&capacity));
    hr(IAudioClient_Start(client)); InterlockedExchange(&ready,1);
    while (!stop) {
        check(WaitForSingleObject(event,100)==WAIT_OBJECT_0);
        if (stop) break;
        UINT32 padding; BYTE *data;
        hr(IAudioClient_GetCurrentPadding(client,&padding));
        UINT32 count=capacity-padding;
        if (count) {
            hr(IAudioRenderClient_GetBuffer(render,count,&data));
            for (UINT32 i=0;i<count*format->nChannels;i++) ((float *)data)[i]=0.125f;
            hr(IAudioRenderClient_ReleaseBuffer(render,count,0));
        }
        work_sink=work(40000,work_sink); InterlockedIncrement(&wakes);
    }
    hr(IAudioClient_Stop(client));
    IAudioRenderClient_Release(render); IAudioClient_Release(client);
    CoTaskMemFree(format); IMMDevice_Release(device); IMMDeviceEnumerator_Release(enumerator);
    CoUninitialize(); CloseHandle(event); return 0;
}
static DWORD WINAPI sleeper(void *unused) {
    (void)unused; LARGE_INTEGER previous, now; QueryPerformanceCounter(&previous);
    DWORD tick=timeGetTime();
    while (!stop) {
        Sleep(10); QueryPerformanceCounter(&now); DWORD next=timeGetTime();
        check(now.QuadPart>=previous.QuadPart && (DWORD)(next-tick)>=10);
        previous=now; tick=next; InterlockedIncrement(&sleeps);
    }
    return 0;
}
int main(void) {
    WNDCLASSA cls={0}; cls.lpfnWndProc=DefWindowProcA; cls.lpszClassName="TimeFixture";
    RegisterClassA(&cls);
    HWND window=CreateWindowExA(0,cls.lpszClassName,"Time",WS_VISIBLE|WS_POPUP,0,0,160,100,0,0,0,0);
    HDC dc=GetDC(window); PIXELFORMATDESCRIPTOR desc={0}; desc.nSize=sizeof desc; desc.nVersion=1;
    desc.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER; desc.cColorBits=32;
    check(SetPixelFormat(dc,ChoosePixelFormat(dc,&desc),&desc));
    HGLRC context=wglCreateContext(dc); check(context && wglMakeCurrent(dc,context));
    HANDLE workers[2]={CreateThread(0,0,mixer,0,0,0),CreateThread(0,0,sleeper,0,0,0)};
    check(workers[0] && workers[1]); while (!ready) Sleep(1);
    for (unsigned frame=0;frame<10;frame++) {
        work_sink=work(4000000,frame+1);
        glClearColor((float)(frame&1),0.25f,0,1); glClear(GL_COLOR_BUFFER_BIT);
        LARGE_INTEGER now; QueryPerformanceCounter(&now);
        char text[200]; snprintf(text,sizeof text,"x64-time present=%u qpc=%lld tick=%lu wakes=%ld sleeps=%ld",
            frame,now.QuadPart,(unsigned long)timeGetTime(),(long)wakes,(long)sleeps);
        OutputDebugStringA(text); check(SwapBuffers(dc));
    }
    LARGE_INTEGER begin,now; QueryPerformanceCounter(&begin);
    do { QueryPerformanceCounter(&now); } while(now.QuadPart-begin.QuadPart<1000);
    char spin[96]; snprintf(spin,sizeof spin,"x64-time spin_us=%lld",now.QuadPart-begin.QuadPart);
    OutputDebugStringA(spin);
    typedef BOOL (WINAPI *SetInterval)(int);
    SetInterval set_interval=(SetInterval)wglGetProcAddress("wglSwapIntervalEXT");check(set_interval!=0);
    for(int interval=2;interval>=0;interval-=2) {
        check(set_interval(interval));
        for(unsigned frame=0;frame<3;frame++) {
            work_sink=work(10000,frame);
            char text[80];snprintf(text,sizeof text,"x64-time interval=%d present=%u",interval,frame);
            OutputDebugStringA(text);check(SwapBuffers(dc));
        }
    }
    /* A non-presenting CPU phase must reach the deterministic process cap. */
    work_sink=work(20000000,work_sink);OutputDebugStringA("x64-time cap PASS");
    InterlockedExchange(&stop,1); check(WaitForMultipleObjects(2,workers,TRUE,1000)==WAIT_OBJECT_0);
    CloseHandle(workers[0]); CloseHandle(workers[1]);
    OutputDebugStringA("x64-time PASS"); return 0;
}
