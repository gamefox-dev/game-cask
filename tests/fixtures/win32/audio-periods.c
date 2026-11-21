/* Original CC0-1.0. K50 review regression (WASAPI events across clock snaps). An event-driven
 * shared-mode client writes exactly one engine period per event, as some games do. Interval-1
 * SwapBuffers snaps virtual time 16667 us, across one or two 10-ms engine periods; one event per
 * elapsed period keeps frames written per virtual second equal to the device rate. */
#define COBJMACROS
#include <initguid.h>
#include <windows.h>
#include <GL/gl.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <stdio.h>
static volatile LONG ready, stop, short_space;
static volatile LONG64 written;
static UINT32 period_frames, rate;
static IAudioClock *clock;
static void check(int ok) { if (!ok) { OutputDebugStringA("audio-periods FAIL"); ExitProcess(1); } }
static void hr(HRESULT result) { check(SUCCEEDED(result)); }
static DWORD WINAPI writer(void *unused) {
    (void)unused;
    IMMDeviceEnumerator *enumerator; IMMDevice *device; IAudioClient *client; IAudioRenderClient *render;
    WAVEFORMATEX *format; HANDLE event = CreateEventA(0, FALSE, FALSE, 0);
    hr(CoInitializeEx(0, COINIT_MULTITHREADED));
    hr(CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER, &IID_IMMDeviceEnumerator, (void **)&enumerator));
    hr(IMMDeviceEnumerator_GetDefaultAudioEndpoint(enumerator, eRender, eConsole, &device));
    hr(IMMDevice_Activate(device, &IID_IAudioClient, CLSCTX_INPROC_SERVER, 0, (void **)&client));
    hr(IAudioClient_GetMixFormat(client, &format));
    hr(IAudioClient_Initialize(client, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 1000000, 0, format, 0));
    hr(IAudioClient_SetEventHandle(client, event));
    hr(IAudioClient_GetService(client, &IID_IAudioRenderClient, (void **)&render));
    hr(IAudioClient_GetService(client, &IID_IAudioClock, (void **)&clock));
    REFERENCE_TIME period, minimum; hr(IAudioClient_GetDevicePeriod(client, &period, &minimum));
    rate = format->nSamplesPerSec; period_frames = (UINT32)(rate * period / 10000000);
    UINT32 capacity; hr(IAudioClient_GetBufferSize(client, &capacity));
    BYTE *data; /* Three periods of lead, then exactly one period per event. */
    hr(IAudioRenderClient_GetBuffer(render, 3 * period_frames, &data));
    hr(IAudioRenderClient_ReleaseBuffer(render, 3 * period_frames, AUDCLNT_BUFFERFLAGS_SILENT));
    hr(IAudioClient_Start(client)); InterlockedExchange(&ready, 1);
    while (!stop) {
        check(WaitForSingleObject(event, 100) == WAIT_OBJECT_0);
        if (stop) break;
        UINT32 padding; hr(IAudioClient_GetCurrentPadding(client, &padding));
        check(padding <= capacity);
        if (capacity - padding < period_frames) { InterlockedIncrement(&short_space); continue; }
        hr(IAudioRenderClient_GetBuffer(render, period_frames, &data));
        for (UINT32 i = 0; i < period_frames * format->nChannels; i++) ((float *)data)[i] = 0.25f;
        hr(IAudioRenderClient_ReleaseBuffer(render, period_frames, 0));
        InterlockedAdd64(&written, period_frames);
    }
    hr(IAudioClient_Stop(client));
    IAudioClock_Release(clock); IAudioRenderClient_Release(render); IAudioClient_Release(client);
    CoTaskMemFree(format); IMMDevice_Release(device); IMMDeviceEnumerator_Release(enumerator);
    CoUninitialize(); CloseHandle(event); return 0;
}
static void sample(LONGLONG *us, LONGLONG *frames, UINT64 *position) {
    Sleep(1); /* lets the writer consume every period already due */
    LARGE_INTEGER now, frequency; QueryPerformanceCounter(&now); QueryPerformanceFrequency(&frequency);
    *us = now.QuadPart * 1000000 / frequency.QuadPart; *frames = written;
    UINT64 qpc; hr(IAudioClock_GetPosition(clock, position, &qpc));
}
int main(void) {
    WNDCLASSA cls = {0}; cls.lpfnWndProc = DefWindowProcA; cls.lpszClassName = "AudioPeriods";
    RegisterClassA(&cls);
    HWND window = CreateWindowExA(0, cls.lpszClassName, "Audio", WS_VISIBLE | WS_POPUP, 0, 0, 160, 100, 0, 0, 0, 0);
    HDC dc = GetDC(window); PIXELFORMATDESCRIPTOR desc = {0}; desc.nSize = sizeof desc; desc.nVersion = 1;
    desc.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; desc.cColorBits = 32;
    check(SetPixelFormat(dc, ChoosePixelFormat(dc, &desc), &desc));
    HGLRC context = wglCreateContext(dc); check(context && wglMakeCurrent(dc, context));
    HANDLE thread = CreateThread(0, 0, writer, 0, 0, 0); check(thread != 0);
    while (!ready) Sleep(1);
    for (unsigned frame = 0; frame < 6; frame++) { glClear(GL_COLOR_BUFFER_BIT); check(SwapBuffers(dc)); }
    LONGLONG us0, frames0, us1, frames1; UINT64 pos0, pos1;
    sample(&us0, &frames0, &pos0);
    for (unsigned frame = 0; frame < 120; frame++) {
        glClearColor((float)(frame & 1), 0, 0, 1); glClear(GL_COLOR_BUFFER_BIT); check(SwapBuffers(dc));
    }
    sample(&us1, &frames1, &pos1);
    char text[200];
    snprintf(text, sizeof text, "audio-periods us=%lld written=%lld position=%llu rate=%u period=%u short=%ld",
        us1 - us0, frames1 - frames0, (unsigned long long)(pos1 - pos0), rate, period_frames, (long)short_space);
    OutputDebugStringA(text);
    InterlockedExchange(&stop, 1); check(WaitForSingleObject(thread, 1000) == WAIT_OBJECT_0);
    CloseHandle(thread); OutputDebugStringA("audio-periods PASS"); return 0;
}
