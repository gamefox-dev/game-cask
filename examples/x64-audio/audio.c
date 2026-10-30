/* Original CC0-1.0 fixture: no recorded audio or external assets. */
#define COBJMACROS
#include <initguid.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <propvarutil.h>
typedef HRESULT (WINAPI *init_prop_fn)(PCWSTR, PROPVARIANT *);
static void check(HRESULT hr) {
    if (FAILED(hr)) {
        char text[] = "x64-audio FAIL hr=00000000";
        for (int i = 0; i < 8; i++) text[18 + i] = "0123456789abcdef"[((unsigned)hr >> (28 - i * 4)) & 15];
        OutputDebugStringA(text); ExitProcess(1);
    }
}
/* Integration regression: audio must wake scheduler-owned events on a different guest thread. */
static DWORD WINAPI audio_waiter(void *event) {
    void *missing = (void *)1;
    if (CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER,
        &IID_IMMDeviceEnumerator, &missing) != CO_E_NOTINITIALIZED || missing) return 2;
    /* Main uses MTA: a fresh worker may independently nest STA initialization. */
    if (CoInitializeEx(0, COINIT_APARTMENTTHREADED) != S_OK || CoInitialize(0) != S_FALSE ||
        CoInitializeEx(0, COINIT_MULTITHREADED) != RPC_E_CHANGED_MODE) return 3;
    SetLastError(0x51a1u);
    if (WaitForSingleObject((HANDLE)event, 100) != WAIT_OBJECT_0 || GetLastError() != 0x51a1u)
        return 1;
    CoUninitialize(); CoUninitialize();
    missing = (void *)1;
    if (CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER,
        &IID_IMMDeviceEnumerator, &missing) != CO_E_NOTINITIALIZED || missing) return 4;
    return 0xa11du;
}
int main(void) {
    IMMDeviceEnumerator *enumerator;
    IMMDevice *device;
    IAudioClient *client;
    IAudioRenderClient *render;
    WAVEFORMATEX *format;
    UINT32 capacity, padding;
    HANDLE event = CreateEventW(0, FALSE, FALSE, 0);
    check(CoInitializeEx(0, COINIT_MULTITHREADED));
    if (CoInitializeEx(0, COINIT_MULTITHREADED) != S_FALSE) ExitProcess(2);
    if (CoInitializeEx(0, COINIT_APARTMENTTHREADED) != RPC_E_CHANGED_MODE) ExitProcess(3);
    PROPVARIANT prop;
    init_prop_fn initprop = (init_prop_fn)GetProcAddress(LoadLibraryA("propsys.dll"),
        "InitPropVariantFromString");
    if (!initprop) ExitProcess(7);
    check(initprop(L"owned string", &prop));
    PROPVARIANT copied;
    check(PropVariantCopy(&copied, &prop));
    if (copied.pwszVal == prop.pwszVal || copied.pwszVal[0] != L'o') ExitProcess(16);
    check(PropVariantClear(&prop));
    if (copied.pwszVal[0] != L'o') ExitProcess(17);
    check(PropVariantClear(&copied));
    if (prop.vt || copied.vt) ExitProcess(18);
    void *missing = (void *)1;
    if (CoCreateInstance(&IID_IAudioRenderClient, 0, CLSCTX_INPROC_SERVER,
        &IID_IUnknown, &missing) != REGDB_E_CLASSNOTREG || missing) ExitProcess(8);
    check(CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER,
        &IID_IMMDeviceEnumerator, (void **)&enumerator));
    IUnknown *identity;
    check(IMMDeviceEnumerator_QueryInterface(enumerator, &IID_IUnknown, (void **)&identity));
    if ((void *)identity != (void *)enumerator) ExitProcess(4);
    IUnknown_Release(identity);
    missing = (void *)1;
    if (IMMDeviceEnumerator_QueryInterface(enumerator, &IID_IAudioRenderClient, &missing) != E_NOINTERFACE
        || missing) ExitProcess(9);
    check(IMMDeviceEnumerator_GetDefaultAudioEndpoint(enumerator, eRender, eConsole, &device));
    check(IMMDevice_Activate(device, &IID_IAudioClient, CLSCTX_INPROC_SERVER, 0, (void **)&client));
    check(IAudioClient_GetMixFormat(client, &format));
    for (int pass = 0; pass < 2; pass++) {
        if (pass) {
            check(IMMDevice_Activate(device, &IID_IAudioClient, CLSCTX_INPROC_SERVER, 0, (void **)&client));
            format->wFormatTag = WAVE_FORMAT_PCM; format->nSamplesPerSec = 24000;
            format->wBitsPerSample = 16; format->nBlockAlign = 4; format->nAvgBytesPerSec = 96000;
        }
        if (IAudioClient_GetBufferSize(client, &capacity) != AUDCLNT_E_NOT_INITIALIZED) ExitProcess(10);
        check(IAudioClient_Initialize(client, AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 1000000, 0, format, 0));
        if (IAudioClient_Start(client) != AUDCLNT_E_EVENTHANDLE_NOT_SET) ExitProcess(11);
        check(IAudioClient_GetBufferSize(client, &capacity));
        if (capacity != format->nSamplesPerSec / 10) ExitProcess(12);
        check(IAudioClient_SetEventHandle(client, event));
        check(IAudioClient_GetService(client, &IID_IAudioRenderClient, (void **)&render));
        BYTE *bad = (BYTE *)1;
        if (IAudioRenderClient_GetBuffer(render, capacity + 1, &bad) != AUDCLNT_E_BUFFER_TOO_LARGE || bad)
            ExitProcess(13);
        UINT32 written = 0, target = format->nSamplesPerSec / 2;
        int running = 0;
        while (written < target) {
            check(IAudioClient_GetCurrentPadding(client, &padding));
            UINT32 n = capacity - padding;
            if (n > target - written) n = target - written;
            if (n) {
                BYTE *data;
                check(IAudioRenderClient_GetBuffer(render, n, &data));
                if (IAudioRenderClient_GetBuffer(render, 1, &bad) != AUDCLNT_E_OUT_OF_ORDER) ExitProcess(14);
                if (IAudioRenderClient_ReleaseBuffer(render, n + 1, 0) != AUDCLNT_E_INVALID_SIZE) ExitProcess(15);
                for (UINT32 i = 0; i < n; i++) {
                    /* 1kHz square tone: exactly half full scale, opposite phase per channel. */
                    int positive = ((written + i) / (format->nSamplesPerSec / 2000)) % 2 == 0;
                    if (!pass) {
                        ((float *)data)[i * 2] = positive ? 0.5f : -0.5f;
                        ((float *)data)[i * 2 + 1] = positive ? -0.25f : 0.25f;
                    } else {
                        ((short *)data)[i * 2] = positive ? 16384 : -16384;
                        ((short *)data)[i * 2 + 1] = positive ? -8192 : 8192;
                    }
                }
                check(IAudioRenderClient_ReleaseBuffer(render, n, 0)); written += n;
            }
            if (!running) {
                DWORD code;
                HANDLE worker = CreateThread(0, 0, audio_waiter, event, 0, 0);
                if (!worker) ExitProcess(19);
                check(IAudioClient_Start(client)); running = 1;
                if (WaitForSingleObject(worker, 100) != WAIT_OBJECT_0 ||
                    !GetExitCodeThread(worker, &code) || code != 0xa11du) ExitProcess(20);
                CloseHandle(worker);
                OutputDebugStringA("x64-audio worker event PASS");
            } else if (WaitForSingleObject(event, 100) != WAIT_OBJECT_0) ExitProcess(5);
        }
        do {
            check(IAudioClient_GetCurrentPadding(client, &padding));
            if (padding) WaitForSingleObject(event, 100);
        } while (padding);
        check(IAudioClient_Stop(client));
        check(IAudioClient_Reset(client));
        IAudioRenderClient_Release(render); IAudioClient_Release(client);
    }
    CoTaskMemFree(format);
    IMMDevice_Release(device); IMMDeviceEnumerator_Release(enumerator);
    CloseHandle(event); CoUninitialize(); CoUninitialize();
    OutputDebugStringA("x64-audio PASS float32=24000 int16=12000 stereo 1000Hz duration=1000ms");
    for (;;) Sleep(16);
}
