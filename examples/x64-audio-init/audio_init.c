/* Original CC0-1.0 fixture: WASAPI shared-mode initialisation contracts. No recorded audio or assets.
 * Part A checks exact HRESULTs, capacities, COM identity and lifetime; part B renders five tone segments
 * whose sink frames the host test asserts (order and lengths below must match tests/unit/audio-init.test.ts). */
#define COBJMACROS
#include <initguid.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <string.h>

#ifndef AUDCLNT_STREAMFLAGS_RATEADJUST
#define AUDCLNT_STREAMFLAGS_RATEADJUST 0x00100000
#endif
#ifndef AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
#define AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM 0x80000000
#endif
#ifndef AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
#define AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY 0x08000000
#endif
#ifndef AUDCLNT_STREAMFLAGS_NOPERSIST
#define AUDCLNT_STREAMFLAGS_NOPERSIST 0x00080000
#endif
#ifndef AUDCLNT_STREAMFLAGS_CROSSPROCESS
#define AUDCLNT_STREAMFLAGS_CROSSPROCESS 0x00010000
#endif
#define EV AUDCLNT_STREAMFLAGS_EVENTCALLBACK
#define RA AUDCLNT_STREAMFLAGS_RATEADJUST
#define AC ((DWORD)AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM)
#define SQ AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
#define HNS_S 10000000LL
#define SHARED AUDCLNT_SHAREMODE_SHARED

static void fail(int n) {
    char t[] = "x64-audio-init FAIL 000";
    t[20] = (char)('0' + n / 100 % 10); t[21] = (char)('0' + n / 10 % 10); t[22] = (char)('0' + n % 10);
    OutputDebugStringA(t); ExitProcess((UINT)n);
}
#define EXPECT(c, n) do { if (!(c)) fail(n); } while (0)
#define HR(call, want, n) do { HRESULT h_ = (call); if (h_ != (HRESULT)(want)) fail(n); } while (0)
#define OK(call, n) HR(call, S_OK, n)

typedef struct { WAVEFORMATEXTENSIBLE w; } fmt_t;
static const GUID SUB_PCM = {1, 0, 0x10, {0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71}};
static const GUID SUB_FLT = {3, 0, 0x10, {0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71}};
static WAVEFORMATEX *mkfmt(fmt_t *f, int ext, WORD tag, WORD ch, DWORD rate, WORD bits) {
    memset(f, 0, sizeof *f);
    WAVEFORMATEX *w = &f->w.Format;
    w->wFormatTag = ext ? WAVE_FORMAT_EXTENSIBLE : tag; w->nChannels = ch; w->nSamplesPerSec = rate;
    w->wBitsPerSample = bits; w->nBlockAlign = (WORD)(ch * bits / 8); w->nAvgBytesPerSec = rate * w->nBlockAlign;
    if (ext) {
        w->cbSize = 22; f->w.Samples.wValidBitsPerSample = bits; f->w.dwChannelMask = ch == 2 ? 3 : 4;
        f->w.SubFormat = tag == WAVE_FORMAT_IEEE_FLOAT ? SUB_FLT : SUB_PCM;
    }
    return w;
}

static IMMDevice *device;
static IAudioClient *fresh(void) {
    IAudioClient *c;
    OK(IMMDevice_Activate(device, &IID_IAudioClient, CLSCTX_INPROC_SERVER, 0, (void **)&c), 1);
    return c;
}
static HRESULT init(IAudioClient *c, DWORD flags, LONGLONG dur, LONGLONG per, const WAVEFORMATEX *f) {
    return IAudioClient_Initialize(c, SHARED, flags, dur, per, f, 0);
}
static UINT32 capacity(IAudioClient *c) {
    UINT32 n = 0xdeadu;
    OK(IAudioClient_GetBufferSize(c, &n), 2);
    return n;
}

/* ---- part A: contracts (no audible output) ---- */
static void part_formats(WAVEFORMATEX *mix) {
    IAudioClient *c = fresh();
    fmt_t f; WAVEFORMATEX *w, *closest = (WAVEFORMATEX *)1;
    EXPECT(mix->wFormatTag == WAVE_FORMAT_IEEE_FLOAT && mix->nChannels == 2 && mix->wBitsPerSample == 32 &&
        mix->nSamplesPerSec == 48000, 3);
    HR(IAudioClient_IsFormatSupported(c, SHARED, mix, &closest), S_OK, 4);
    EXPECT(closest == 0, 5);
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 2, 24000, 16);
    HR(IAudioClient_IsFormatSupported(c, SHARED, w, &closest), S_FALSE, 6); /* not the mix: engine proposes it */
    EXPECT(closest && closest->wFormatTag == WAVE_FORMAT_IEEE_FLOAT && closest->nSamplesPerSec == 48000 &&
        closest->nChannels == 2, 7);
    CoTaskMemFree(closest);
    HR(IAudioClient_IsFormatSupported(c, SHARED, w, 0), E_POINTER, 8);
    HR(IAudioClient_IsFormatSupported(c, SHARED, 0, &closest), E_POINTER, 9);
    HR(IAudioClient_IsFormatSupported(c, (AUDCLNT_SHAREMODE)2, w, &closest), E_INVALIDARG, 10);
    HR(IAudioClient_IsFormatSupported(c, AUDCLNT_SHAREMODE_EXCLUSIVE, w, &closest), E_INVALIDARG, 11);
    HR(IAudioClient_IsFormatSupported(c, AUDCLNT_SHAREMODE_EXCLUSIVE, w, 0), AUDCLNT_E_UNSUPPORTED_FORMAT, 12);
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 2, 24000, 16); w->nBlockAlign = 3;
    HR(IAudioClient_IsFormatSupported(c, SHARED, w, &closest), E_INVALIDARG, 13);
    w = mkfmt(&f, 0, 0x55, 2, 24000, 16);
    HR(IAudioClient_IsFormatSupported(c, SHARED, w, &closest), AUDCLNT_E_UNSUPPORTED_FORMAT, 14);
    IAudioClient_Release(c);
}

static void part_init_errors(WAVEFORMATEX *mix) {
    IAudioClient *c = fresh();
    fmt_t f; WAVEFORMATEX *w;
    HR(init(c, 0, 0, 0, 0), E_POINTER, 20);
    HR(IAudioClient_Initialize(c, (AUDCLNT_SHAREMODE)2, 0, 0, 0, mix, 0), E_INVALIDARG, 21);
    HR(init(c, 0x1, 0, 0, mix), E_INVALIDARG, 22);          /* unknown stream flag bits */
    HR(init(c, 0x2, 0, 0, mix), E_INVALIDARG, 23);
    HR(IAudioClient_Initialize(c, AUDCLNT_SHAREMODE_EXCLUSIVE, 0, 0, 0, mix, 0), AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED, 24);
    HR(IAudioClient_Initialize(c, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_LOOPBACK, 0, 0, mix, 0),
        E_INVALIDARG, 25);
    HR(IAudioClient_Initialize(c, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_CROSSPROCESS, 0, 0, mix, 0),
        E_INVALIDARG, 26);
    HR(init(c, 0, 0, 1, mix), E_INVALIDARG, 27);            /* shared mode: periodicity must be 0 */
    HR(init(c, EV, 0, 100000, mix), E_INVALIDARG, 28);
    HR(init(c, 0, -1, 0, mix), AUDCLNT_E_BUFFER_SIZE_ERROR, 29);
    /* Huge durations must not wrap the intermediate duration*rate or the guest allocation size. */
    HR(init(c, 0, 0x7fffffffffffffffLL, 0, mix), E_OUTOFMEMORY, 30);
    HR(init(c, 0, 20000 * HNS_S, 0, mix), E_OUTOFMEMORY, 300); /* frames fit; stereo float bytes do not */
    /* This size is representable, but exceeds the actual guest heap: fail allocation, not arithmetic. */
    HR(init(c, 0, 5000 * HNS_S, 0, mix), E_OUTOFMEMORY, 301);
    HR(init(c, AUDCLNT_STREAMFLAGS_LOOPBACK, 0, 0, mix), AUDCLNT_E_ENDPOINT_CREATE_FAILED, 31);
    w = mkfmt(&f, 0, WAVE_FORMAT_IEEE_FLOAT, 2, 44100, 32);
    HR(init(c, 0, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 32);   /* rate differs: needs RATEADJUST/AUTOCONVERT */
    HR(init(c, EV, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 33);
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 2, 24000, 16);
    HR(init(c, RA, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 34);  /* RATEADJUST does not convert sample format */
    HR(init(c, 0, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 35);
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 6, 48000, 16);
    HR(init(c, AC, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 36);  /* well formed, but beyond the stereo converter */
    w = mkfmt(&f, 0, 0x55, 2, 48000, 16);
    HR(init(c, AC, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 37);
    w = mkfmt(&f, 1, WAVE_FORMAT_PCM, 2, 48000, 16); w->cbSize = 0;
    HR(init(c, AC, 0, 0, w), E_INVALIDARG, 38);                  /* EXTENSIBLE needs cbSize >= 22 */
    w = mkfmt(&f, 1, WAVE_FORMAT_PCM, 2, 48000, 16); f.w.Samples.wValidBitsPerSample = 17;
    HR(init(c, AC, 0, 0, w), E_INVALIDARG, 39);
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 2, 48000, 16); w->nChannels = 0;
    HR(init(c, AC, 0, 0, w), E_INVALIDARG, 40);
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 2, 48000, 16); w->nAvgBytesPerSec += 1;
    HR(init(c, AC, 0, 0, w), E_INVALIDARG, 41);
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 2, 4000, 16);
    HR(init(c, AC, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 42);  /* below the converter's rate range */
    w = mkfmt(&f, 1, WAVE_FORMAT_IEEE_FLOAT, 2, 48000, 32); f.w.Samples.wValidBitsPerSample = 24;
    HR(init(c, AC, 0, 0, w), E_INVALIDARG, 302);
    w = mkfmt(&f, 1, WAVE_FORMAT_PCM, 2, 48000, 16); f.w.dwChannelMask = 4; /* one speaker for stereo */
    HR(init(c, AC, 0, 0, w), E_INVALIDARG, 303);
    f.w.dwChannelMask = 0x80000001u; /* reserved speaker bit */
    HR(init(c, AC, 0, 0, w), E_INVALIDARG, 304);
    f.w.dwChannelMask = 0x30; /* rear stereo: well formed, but not a supported converter layout */
    HR(init(c, AC, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 305);
    w = mkfmt(&f, 1, WAVE_FORMAT_PCM, 2, 48000, 16); f.w.SubFormat.Data1 = 0x55;
    HR(init(c, AC, 0, 0, w), AUDCLNT_E_UNSUPPORTED_FORMAT, 306);
    /* None of the failures initialised or poisoned the client, including the allocation failure. */
    UINT32 n; void *p = (void *)1;
    HR(IAudioClient_GetBufferSize(c, &n), AUDCLNT_E_NOT_INITIALIZED, 43);
    HR(IAudioClient_GetService(c, &IID_IAudioRenderClient, &p), AUDCLNT_E_NOT_INITIALIZED, 44);
    EXPECT(p == 0, 45);
    OK(init(c, 0, 0, 0, mix), 46);
    HR(init(c, 0, 0, 0, mix), AUDCLNT_E_ALREADY_INITIALIZED, 47);
    IAudioClient_Release(c);
}

static void part_capacity(WAVEFORMATEX *mix) {
    IAudioClient *c; fmt_t f; WAVEFORMATEX *w; REFERENCE_TIME def, min, lat;
    /* Game-style stream: mix layout at a different rate with only RATEADJUST and a one-second buffer. */
    w = mkfmt(&f, 0, WAVE_FORMAT_IEEE_FLOAT, 2, 44100, 32);
    c = fresh(); OK(init(c, RA | EV, HNS_S, 0, w), 50);
    EXPECT(capacity(c) == 44100, 51);
    IAudioClient_Release(c);
    c = fresh(); OK(init(c, RA, HNS_S, 0, mix), 52);                 /* RATEADJUST at the mix rate itself */
    EXPECT(capacity(c) == 48000, 53);
    OK(IAudioClient_GetDevicePeriod(c, &def, &min), 54);
    OK(IAudioClient_GetStreamLatency(c, &lat), 55);
    EXPECT(def == 100000 && min == 30000 && min <= def, 56);
    EXPECT(lat == def && lat <= (REFERENCE_TIME)capacity(c) * HNS_S / 48000, 57);
    IAudioClient_Release(c);
    c = fresh(); OK(init(c, 0, 0, 0, mix), 58);                      /* zero: default 100 ms */
    EXPECT(capacity(c) == 4800, 59);
    IAudioClient_Release(c);
    c = fresh(); OK(init(c, 0, 1, 0, mix), 60);                      /* tiny: never below one engine period */
    EXPECT(capacity(c) == 480, 61);
    OK(IAudioClient_GetDevicePeriod(c, &def, 0), 62);
    EXPECT((REFERENCE_TIME)capacity(c) * HNS_S / 48000 >= def, 63);
    IAudioClient_Release(c);
    c = fresh(); OK(init(c, 0, 12345678, 0, mix), 64);               /* rounds up to whole frames */
    EXPECT(capacity(c) == 59260, 65);
    IAudioClient_Release(c);
    c = fresh(); OK(init(c, 0, 11 * HNS_S, 0, mix), 66);             /* no arbitrary ten-second ceiling */
    EXPECT(capacity(c) == 528000, 67);
    IAudioClient_Release(c);
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 2, 24000, 16);
    c = fresh(); OK(init(c, AC, 3 * HNS_S, 0, w), 68);
    EXPECT(capacity(c) == 72000, 69);
    IAudioClient_Release(c);
    c = fresh();                                                       /* other valid flags are accepted */
    OK(init(c, AUDCLNT_STREAMFLAGS_CROSSPROCESS | AUDCLNT_STREAMFLAGS_NOPERSIST | 0x70000000u, 0, 0, mix), 70);
    IAudioClient_Release(c);
    c = fresh(); OK(init(c, SQ, 0, 0, mix), 307); /* standalone quality hint accepted (INFERRED no-op) */
    IAudioClient_Release(c);
    w = mkfmt(&f, 1, WAVE_FORMAT_IEEE_FLOAT, 2, 48000, 32); f.w.dwChannelMask = 0;
    c = fresh(); OK(init(c, 0, 0, 0, w), 308); /* unspecified EXTENSIBLE mask is legal */
    IAudioClient_Release(c);
}

static void part_services(WAVEFORMATEX *mix) {
    IAudioClient *c = fresh();
    void *p = (void *)1;
    HR(IAudioClient_GetService(c, &IID_IAudioClock, &p), AUDCLNT_E_NOT_INITIALIZED, 80);
    OK(init(c, 0, 0, 0, mix), 81);                                    /* no RATEADJUST */
    HR(IAudioClient_GetService(c, &IID_IAudioClockAdjustment, &p), E_INVALIDARG, 82);
    EXPECT(p == 0, 83);
    HR(IAudioClient_GetService(c, &IID_IAudioCaptureClient, &p), E_NOINTERFACE, 84);
    HR(IAudioClient_GetService(c, &IID_IAudioClock, 0), E_POINTER, 85);
    IUnknown *clk, *clk2;
    OK(IAudioClient_GetService(c, &IID_IAudioClock, (void **)&clk), 86);
    OK(IAudioClient_GetService(c, &IID_IAudioClock, (void **)&clk2), 87);
    EXPECT(clk == clk2, 88);                                          /* one child object per interface */
    EXPECT(IUnknown_Release(clk2) == 1 && IUnknown_AddRef(clk) == 2 && IUnknown_Release(clk) == 1, 89);
    IUnknown *same; void *bad = (void *)1;
    OK(IUnknown_QueryInterface(clk, &IID_IUnknown, (void **)&same), 90);
    EXPECT(same == clk && IUnknown_Release(same) == 1, 91);
    HR(IUnknown_QueryInterface(clk, &IID_IAudioClient, &bad), E_NOINTERFACE, 92);
    EXPECT(bad == 0, 93);
    HR(IAudioClient_QueryInterface(c, &IID_IAudioClock, &bad), E_NOINTERFACE, 94); /* only via GetService */
    /* Releasing the client while a service lives keeps its state: the child owns the client. */
    IAudioRenderClient *r; BYTE *data;
    OK(IAudioClient_GetService(c, &IID_IAudioRenderClient, (void **)&r), 95);
    IAudioClient_Release(c);
    UINT64 freq = 0, pos = 1, qpc = 0; DWORD ch = 0;
    OK(IAudioClock_GetFrequency((IAudioClock *)clk, &freq), 96);
    EXPECT(freq == 48000, 97);
    OK(IAudioClock_GetPosition((IAudioClock *)clk, &pos, &qpc), 98);
    EXPECT(pos == 0, 99);
    OK(IAudioClock_GetCharacteristics((IAudioClock *)clk, &ch), 100);
    EXPECT(ch == 1, 101);
    HR(IAudioClock_GetPosition((IAudioClock *)clk, 0, 0), E_POINTER, 102);
    OK(IAudioRenderClient_GetBuffer(r, 480, &data), 103);
    OK(IAudioRenderClient_ReleaseBuffer(r, 480, AUDCLNT_BUFFERFLAGS_SILENT), 104);
    IAudioRenderClient_Release(r);
    EXPECT(IUnknown_Release(clk) == 0, 105);
    /* Leak check: state, rings and sessions must be freed when the last reference goes (8 slots). */
    for (int i = 0; i < 24; i++) {
        IAudioClient *x = fresh();
        IUnknown *a, *b, *d, *e, *g;
        OK(init(x, RA | EV, HNS_S, 0, mix), 106);
        OK(IAudioClient_GetService(x, &IID_IAudioClock, (void **)&a), 107);
        OK(IAudioClient_GetService(x, &IID_IAudioClockAdjustment, (void **)&b), 108);
        OK(IAudioClient_GetService(x, &IID_IAudioStreamVolume, (void **)&d), 109);
        OK(IAudioClient_GetService(x, &IID_ISimpleAudioVolume, (void **)&e), 110);
        OK(IAudioClient_GetService(x, &IID_IAudioRenderClient, (void **)&g), 111);
        if (i & 1) { IAudioClient_Release(x); IUnknown_Release(g); IUnknown_Release(a); IUnknown_Release(e);
            IUnknown_Release(d); IUnknown_Release(b); }
        else { IUnknown_Release(a); IUnknown_Release(b); IUnknown_Release(d); IUnknown_Release(e);
            IUnknown_Release(g); IAudioClient_Release(x); }
    }
}

/* ---- part B: audible segments ---- */
typedef struct { WORD ch, bytes; int flt; DWORD half; int levelL, levelR; } tone_t;
static void put(BYTE *p, const tone_t *t, int level) {
    if (t->flt) *(float *)p = (float)level / 32768.0f;
    else if (t->bytes == 1) *p = (BYTE)(128 + (level >> 8));
    else if (t->bytes == 2) *(short *)p = (short)level;
    else if (t->bytes == 3) { p[0] = 0; p[1] = (BYTE)(level & 255); p[2] = (BYTE)((level >> 8) & 255); }
    else *(int *)p = level * 65536;
}
/* 1 kHz-style square wave: left +level when `positive`, right opposite polarity. */
static void fill(BYTE *d, UINT32 n, UINT32 first, const tone_t *t) {
    for (UINT32 i = 0; i < n; i++) {
        int pos = ((first + i) / t->half) % 2 == 0;
        BYTE *f = d + (size_t)i * t->ch * t->bytes;
        put(f, t, pos ? t->levelL : -t->levelL);
        if (t->ch > 1) put(f + t->bytes, t, pos ? -t->levelR : t->levelR);
    }
}
static void wait_pump(HANDLE ev) { if (ev) WaitForSingleObject(ev, 100); else Sleep(5); }
/* Write `total` frames, start on the first buffer, and wait until the sink has consumed them all. */
static void render(IAudioClient *c, IAudioRenderClient *r, HANDLE ev, const tone_t *t, UINT32 total, int start) {
    UINT32 cap = capacity(c), written = 0, pad;
    while (written < total) {
        OK(IAudioClient_GetCurrentPadding(c, &pad), 120);
        UINT32 n = cap - pad;
        if (n > total - written) n = total - written;
        if (n) {
            BYTE *data;
            OK(IAudioRenderClient_GetBuffer(r, n, &data), 121);
            fill(data, n, written, t);
            OK(IAudioRenderClient_ReleaseBuffer(r, n, 0), 122);
            written += n;
        }
        if (start) { OK(IAudioClient_Start(c), 123); start = 0; }
        else wait_pump(ev);
    }
    do { OK(IAudioClient_GetCurrentPadding(c, &pad), 124); if (pad) wait_pump(ev); } while (pad);
}
static void log_seg(int n) {
    char t[] = "x64-audio-init segment 0 done"; t[23] = (char)('0' + n); OutputDebugStringA(t);
}
static void expect_pos(IUnknown *clock, UINT64 want, int code) {
    UINT64 pos = ~0ull;
    OK(IAudioClock_GetPosition((IAudioClock *)clock, &pos, 0), code);
    EXPECT(pos == want, code + 1);
}

static DWORD WINAPI audio_init_main(void *unused) {
    (void)unused;
    IMMDeviceEnumerator *en; WAVEFORMATEX *mix; fmt_t f; WAVEFORMATEX *w;
    OK(CoInitializeEx(0, COINIT_MULTITHREADED), 140);
    OK(CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER, &IID_IMMDeviceEnumerator, (void **)&en), 141);
    OK(IMMDeviceEnumerator_GetDefaultAudioEndpoint(en, eRender, eConsole, &device), 142);
    { IAudioClient *c = fresh(); OK(IAudioClient_GetMixFormat(c, &mix), 143); IAudioClient_Release(c); }
    part_formats(mix); part_init_errors(mix); part_capacity(mix); part_services(mix);
    OutputDebugStringA("x64-audio-init contracts PASS");

    HANDLE ev = CreateEventW(0, FALSE, FALSE, 0);
    IAudioClient *c; IAudioRenderClient *r; IUnknown *clock, *adj, *sv, *pv;
    float vols[2], v; BOOL mute;

    /* Segment 1: mix-layout float32 at 44100 Hz (the target's request) with RATEADJUST, one-second buffer,
     * per-channel stream volume. 4410 source frames at 44100 -> 4800 sink frames. */
    w = mkfmt(&f, 0, WAVE_FORMAT_IEEE_FLOAT, 2, 44100, 32);
    c = fresh();
    OK(init(c, RA | EV, HNS_S, 0, w), 150);
    EXPECT(capacity(c) == 44100, 151);
    OK(IAudioClient_SetEventHandle(c, ev), 152);
    OK(IAudioClient_GetService(c, &IID_IAudioRenderClient, (void **)&r), 153);
    OK(IAudioClient_GetService(c, &IID_IAudioStreamVolume, (void **)&sv), 154);
    UINT32 count = 0;
    OK(IAudioStreamVolume_GetChannelCount((IAudioStreamVolume *)sv, &count), 155);
    EXPECT(count == 2, 156);
    OK(IAudioStreamVolume_SetChannelVolume((IAudioStreamVolume *)sv, 1, 0.5f), 157);
    HR(IAudioStreamVolume_SetChannelVolume((IAudioStreamVolume *)sv, 2, 0.5f), E_INVALIDARG, 158);
    HR(IAudioStreamVolume_SetChannelVolume((IAudioStreamVolume *)sv, 0, 1.5f), E_INVALIDARG, 159);
    HR(IAudioStreamVolume_SetChannelVolume((IAudioStreamVolume *)sv, 0, -0.1f), E_INVALIDARG, 160);
    OK(IAudioStreamVolume_GetAllVolumes((IAudioStreamVolume *)sv, 2, vols), 161);
    EXPECT(vols[0] == 1.0f && vols[1] == 0.5f, 162);
    HR(IAudioStreamVolume_GetAllVolumes((IAudioStreamVolume *)sv, 3, vols), E_INVALIDARG, 163);
    OK(IAudioStreamVolume_GetChannelVolume((IAudioStreamVolume *)sv, 1, &v), 164);
    EXPECT(v == 0.5f, 165);
    tone_t t1 = {2, 4, 1, 22, 16384, 8192};          /* 44100/(2*22) ~ 1002 Hz */
    render(c, r, ev, &t1, 4410, 1);
    OK(IAudioClient_Stop(c), 166); OK(IAudioClient_Reset(c), 167);
    IUnknown_Release(sv); IAudioRenderClient_Release(r); IAudioClient_Release(c);
    log_seg(1);

    /* Segment 2: int16 stereo 24 kHz, AUTOCONVERTPCM|RATEADJUST, SetSampleRate changes mid-stream.
     * 3000 frames at 24 kHz (-> 6000 sink), at 48 kHz (-> 3000), at 12 kHz (-> 12000). */
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 2, 24000, 16);
    c = fresh();
    OK(init(c, AC | RA | EV, HNS_S, 0, w), 170);
    EXPECT(capacity(c) == 24000, 171);
    OK(IAudioClient_SetEventHandle(c, ev), 172);
    OK(IAudioClient_GetService(c, &IID_IAudioRenderClient, (void **)&r), 173);
    OK(IAudioClient_GetService(c, &IID_IAudioClock, (void **)&clock), 174);
    OK(IAudioClient_GetService(c, &IID_IAudioClockAdjustment, (void **)&adj), 175);
    IAudioClockAdjustment *ca = (IAudioClockAdjustment *)adj;
    HR(IAudioClockAdjustment_SetSampleRate(ca, 0.0f), E_INVALIDARG, 176);
    HR(IAudioClockAdjustment_SetSampleRate(ca, 7999.0f), E_INVALIDARG, 177);
    HR(IAudioClockAdjustment_SetSampleRate(ca, 1.0e9f), E_INVALIDARG, 178);
    volatile float zero = 0.0f;
    HR(IAudioClockAdjustment_SetSampleRate(ca, zero / zero), E_INVALIDARG, 179);
    tone_t t2 = {2, 2, 0, 24, 16384, 8192};
    render(c, r, ev, &t2, 3000, 1);
    expect_pos(clock, 3000, 180);                    /* 6000 sink frames at the 24 kHz position scale */
    OK(IAudioClockAdjustment_SetSampleRate(ca, 48000.0f), 182);
    render(c, r, ev, &t2, 3000, 0);
    expect_pos(clock, 4500, 183);                    /* + 3000 sink frames = 1500 position units */
    OK(IAudioClockAdjustment_SetSampleRate(ca, 12000.0f), 185);
    render(c, r, ev, &t2, 3000, 0);
    expect_pos(clock, 10500, 186);                   /* + 12000 sink frames = 6000 position units */
    OK(IAudioClient_Stop(c), 188);
    OK(IAudioClient_Reset(c), 189);
    expect_pos(clock, 0, 190);                       /* Reset restarts the stream position */
    IUnknown_Release(adj); IUnknown_Release(clock); IAudioRenderClient_Release(r); IAudioClient_Release(c);
    log_seg(2);

    /* Segment 3: mono int16 44100 Hz, AUTOCONVERTPCM|SRC_DEFAULT_QUALITY, default (zero) duration.
     * 4410 frames -> 4800 sink frames, mono duplicated to both channels, linear interpolation. */
    w = mkfmt(&f, 0, WAVE_FORMAT_PCM, 1, 44100, 16);
    c = fresh();
    OK(init(c, AC | SQ | EV, 0, 0, w), 200);
    EXPECT(capacity(c) == 4410, 201);
    OK(IAudioClient_SetEventHandle(c, ev), 202);
    OK(IAudioClient_GetService(c, &IID_IAudioRenderClient, (void **)&r), 203);
    OK(IAudioClient_GetService(c, &IID_IAudioStreamVolume, (void **)&sv), 204);
    OK(IAudioStreamVolume_GetChannelCount((IAudioStreamVolume *)sv, &count), 205);
    EXPECT(count == 1, 206);
    HR(IAudioStreamVolume_SetChannelVolume((IAudioStreamVolume *)sv, 1, 1.0f), E_INVALIDARG, 207);
    vols[0] = vols[1] = 1.0f;
    HR(IAudioStreamVolume_SetAllVolumes((IAudioStreamVolume *)sv, 2, vols), E_INVALIDARG, 208);
    HR(IAudioStreamVolume_SetAllVolumes((IAudioStreamVolume *)sv, 1, 0), E_POINTER, 209);
    OK(IAudioStreamVolume_SetAllVolumes((IAudioStreamVolume *)sv, 1, vols), 210);
    tone_t t3 = {1, 2, 0, 49, 20000, 0};             /* 44100/98 = 450 Hz */
    render(c, r, ev, &t3, 4410, 1);
    OK(IAudioClient_Stop(c), 211);
    IUnknown_Release(sv); IAudioRenderClient_Release(r); IAudioClient_Release(c);
    log_seg(3);

    /* Segment 4: WAVEFORMATEXTENSIBLE 24-bit PCM stereo 48 kHz via AUTOCONVERTPCM, polling (no event). */
    w = mkfmt(&f, 1, WAVE_FORMAT_PCM, 2, 48000, 24);
    c = fresh();
    OK(init(c, AC, 0, 0, w), 220);
    EXPECT(capacity(c) == 4800, 221);
    HR(IAudioClient_SetEventHandle(c, ev), AUDCLNT_E_EVENTHANDLE_NOT_EXPECTED, 222);
    OK(IAudioClient_GetService(c, &IID_IAudioRenderClient, (void **)&r), 223);
    tone_t t4 = {2, 3, 0, 24, 16384, 8192};
    render(c, r, 0, &t4, 2400, 1);
    OK(IAudioClient_Stop(c), 224);
    IAudioRenderClient_Release(r); IAudioClient_Release(c);
    log_seg(4);

    /* Segment 5: EXTENSIBLE float32 (the mix layout, no converter flag) under session volume:
     * master 0.5, then muted, then restored. Two clients share the default session. */
    w = mkfmt(&f, 1, WAVE_FORMAT_IEEE_FLOAT, 2, 48000, 32);
    c = fresh();
    OK(init(c, EV, 0, 0, w), 230);
    OK(IAudioClient_SetEventHandle(c, ev), 231);
    OK(IAudioClient_GetService(c, &IID_IAudioRenderClient, (void **)&r), 232);
    OK(IAudioClient_GetService(c, &IID_ISimpleAudioVolume, (void **)&pv), 233);
    ISimpleAudioVolume *sav = (ISimpleAudioVolume *)pv;
    IAudioClient *other = fresh(); IUnknown *opv;
    OK(init(other, 0, 0, 0, mix), 234);
    OK(IAudioClient_GetService(other, &IID_ISimpleAudioVolume, (void **)&opv), 235);
    OK(ISimpleAudioVolume_GetMasterVolume(sav, &v), 236);
    EXPECT(v == 1.0f, 237);
    HR(ISimpleAudioVolume_SetMasterVolume(sav, 1.5f, 0), E_INVALIDARG, 238);
    HR(ISimpleAudioVolume_SetMasterVolume(sav, -1.0f, 0), E_INVALIDARG, 239);
    HR(ISimpleAudioVolume_GetMasterVolume(sav, 0), E_POINTER, 240);
    OK(ISimpleAudioVolume_SetMasterVolume(sav, 0.5f, 0), 241);
    OK(ISimpleAudioVolume_GetMasterVolume((ISimpleAudioVolume *)opv, &v), 242);
    EXPECT(v == 0.5f, 243);                          /* same (default) session */
    tone_t t5 = {2, 4, 1, 24, 16384, 8192};
    render(c, r, ev, &t5, 2400, 1);
    OK(ISimpleAudioVolume_SetMute(sav, (BOOL)0x100, 0), 244); /* BOOL: every nonzero value is true */
    OK(ISimpleAudioVolume_GetMute((ISimpleAudioVolume *)opv, &mute), 245);
    EXPECT(mute, 246);
    render(c, r, ev, &t5, 2400, 0);
    OK(ISimpleAudioVolume_SetMute(sav, FALSE, 0), 247);
    OK(ISimpleAudioVolume_SetMasterVolume(sav, 1.0f, 0), 248);
    render(c, r, ev, &t5, 2400, 0);
    OK(IAudioClient_Stop(c), 249);
    IUnknown_Release(opv); IAudioClient_Release(other);
    IUnknown_Release(pv); IAudioRenderClient_Release(r); IAudioClient_Release(c);
    log_seg(5);

    CoTaskMemFree(mix);
    IMMDevice_Release(device); IMMDeviceEnumerator_Release(en);
    CloseHandle(ev); CoUninitialize();
    OutputDebugStringA("x64-audio-init PASS sinkframes=40200");
    return 0xa1d10u;
}

int main(void) {
    HANDLE thread = CreateThread(0, 0, audio_init_main, 0, 0, 0);
    if (!thread) ExitProcess(250);
    if (WaitForSingleObject(thread, 5000) != WAIT_OBJECT_0) ExitProcess(251);
    DWORD code;
    if (!GetExitCodeThread(thread, &code) || code != 0xa1d10u) ExitProcess(252);
    CloseHandle(thread);
    OutputDebugStringA("x64-audio-init audio thread joined PASS");
    for (;;) Sleep(16);
}
