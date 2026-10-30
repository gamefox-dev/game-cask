/* Shared-mode WASAPI on the virtual clock. SPDX-License-Identifier: MIT */
#include "w32_audio.h"
#define E_INVALIDARG 0x80070057u
#define NOT_INIT 0x88890001u
#define CAPACITY 19200u
#define NAUDIO 8u
typedef struct {
    uint32_t used, initialized, running, rate, bits, floating, capacity, queued, head;
    uint32_t buffer, acquired, event, last_ms, remainder, phase, event_ms, flags;
    int16_t pcm[CAPACITY * 2];
} audio_t;
static audio_t clients[NAUDIO];
/* Main-thread fallback events. A scheduler can replace this adapter without changing COM/audio state. */
static struct { uint32_t used, manual, signaled; } events[64];
#define EVENT_BASE 0x000b0000u
static uint32_t event_create(void) {
    for (uint32_t i = 1; i < 64; i++) if (!events[i].used) {
        events[i].used = 1; events[i].manual = !!ARG(1); events[i].signaled = !!ARG(2);
        return EVENT_BASE + i;
    }
    return 0;
}
static uint32_t event_set(void) {
    uint32_t i = ARG(0) - EVENT_BASE;
    if (!i || i >= 64 || !events[i].used) return 0;
    events[i].signaled = 1; return 1;
}
static uint32_t event_reset(void) {
    uint32_t i = ARG(0) - EVENT_BASE;
    if (!i || i >= 64 || !events[i].used) return 0;
    events[i].signaled = 0; return 1;
}
int w32_audio_close_event(uint32_t h) {
    uint32_t i = h - EVENT_BASE;
    if (!i || i >= 64 || !events[i].used) return 0;
    events[i].used = 0; return 1;
}
void w32_audio_signal_event(uint32_t h) {
    uint32_t i = h - EVENT_BASE;
    if (i && i < 64 && events[i].used) events[i].signaled = 1;
}
static uint32_t event_wait(void) {
    uint32_t i = ARG(0) - EVENT_BASE, timeout = ARG(1), start = w32_now_ms();
    if (!i || i >= 64 || !events[i].used) return 0xffffffffu;
    for (;;) {
        w32_audio_pump();
        if (events[i].signaled) {
            if (!events[i].manual) events[i].signaled = 0;
            return 0;
        }
        if (timeout != 0xffffffffu && w32_now_ms() - start >= timeout) return 258;
        w32_wait_frame();
    }
}
static audio_t *client(void) {
    w32_com_object_t *o = w32_com_object(ARG(0));
    return o && o->state && o->state <= NAUDIO ? &clients[o->state - 1] : 0;
}
void w32_audio_destroy(uint32_t state) {
    if (!state || state > NAUDIO) return;
    audio_t *a = &clients[state - 1];
    w32_heap_free(a->buffer); a->used = 0;
}
void w32_audio_pump(void) {
    uint32_t now = w32_now_ms(), out_rate = w32_io->audio_sample_rate;
    for (uint32_t i = 0; i < NAUDIO; i++) {
        audio_t *a = &clients[i];
        if (!a->used || !a->running) continue;
        uint64_t elapsed = (uint64_t)(now - a->last_ms) * a->rate + a->remainder;
        a->last_ms = now; a->remainder = elapsed % 1000;
        uint32_t n = (uint32_t)(elapsed / 1000);
        if (n > a->queued) n = a->queued;
        int16_t out[4096]; uint32_t count = 0;
        for (uint32_t f = 0; f < n; f++) {
            uint32_t p = a->head * 2;
            a->phase += out_rate;
            while (a->phase >= a->rate) {
                a->phase -= a->rate;
                out[count++] = a->pcm[p]; out[count++] = a->pcm[p + 1];
                if (count == 4096) { bgt_audio_push_stereo(out, count / 2); count = 0; }
            }
            a->head = (a->head + 1) % CAPACITY;
        }
        if (count) bgt_audio_push_stereo(out, count / 2);
        a->queued -= n;
        /* One signal per virtual pump; auto-reset events coalesce missed periods, as on Windows. */
        if (now - a->event_ms >= 10) {
            a->event_ms = now;
            w32_audio_signal_event(a->event);
        }
    }
}
static uint32_t unsupported(void) { return 0x80004001u; }
static uint32_t default_endpoint(void) {
    if (!ARG(3)) return 0x80004003u;
    w32_wrptr(ARG(3), 0);
    if (ARG(1) != 0 || ARG(2) > 2) return E_INVALIDARG;
    uint32_t o = w32_com_new(WCOM_DEVICE, 0, 0);
    w32_wrptr(ARG(3), o); return o ? 0 : 0x8007000eu;
}
static uint32_t device_state(void) { if (!ARG(1)) return 0x80004003u; x86_wr32(ARG(1), 1); return 0; }
static uint32_t activate(void) {
    if (!ARG(4)) return 0x80004003u;
    w32_wrptr(ARG(4), 0);
    if (!w32_com_guid(ARG(1), w32_iid_audio)) return 0x80004002u;
    for (uint32_t i = 0; i < NAUDIO; i++) if (!clients[i].used) {
        clients[i] = (audio_t){.used = 1};
        uint32_t o = w32_com_new(WCOM_AUDIO, i + 1, 0);
        if (!o) { clients[i].used = 0; return 0x8007000eu; }
        w32_wrptr(ARG(4), o); return 0;
    }
    return 0x8007000eu;
}
static uint32_t mixformat(void) {
    if (!ARG(1)) return 0x80004003u;
    uint32_t p = w32_heap_alloc(18, 1);
    if (!p) return 0x8007000eu;
    x86_wr16(p, 3); x86_wr16(p + 2, 2); x86_wr32(p + 4, 48000);
    x86_wr32(p + 8, 384000); x86_wr16(p + 12, 8); x86_wr16(p + 14, 32);
    w32_wrptr(ARG(1), p); return 0;
}
static int format(uint32_t p, uint32_t *floating, uint32_t *bits, uint32_t *rate) {
    if (!p || x86_rd16(p + 2) != 2) return 0;
    uint32_t tag = x86_rd16(p), b = x86_rd16(p + 14), r = x86_rd32(p + 4);
    if (!((tag == 3 && b == 32) || (tag == 1 && b == 16)) || r < 8000 || r > 192000) return 0;
    if (x86_rd16(p + 12) != b / 4 || x86_rd32(p + 8) != r * (b / 4)) return 0;
    *floating = tag == 3; *bits = b; *rate = r; return 1;
}
static uint32_t isformat(void) {
    uint32_t f, b, r;
    if (ARG(3)) w32_wrptr(ARG(3), 0);
    return ARG(1) == 0 && format(ARG(2), &f, &b, &r) ? 0 : 0x88890008u;
}
static uint32_t initialize(void) {
    audio_t *a = client();
    if (!a) return E_INVALIDARG;
    if (a->initialized) return 0x88890002u;
    /* i386 REFERENCE_TIME values consume two stack words each. */
    uint32_t fmt = ARG(W32_64 ? 5 : 7);
    if (ARG(1) || !format(fmt, &a->floating, &a->bits, &a->rate)) return 0x88890008u;
    if (ARG(2) & ~0x880c0000u) return E_INVALIDARG;
    uint64_t duration = W32_64 ? ARG64(3) : x86_rd64((uint32_t)X.r[ESP] + 16);
    uint64_t period = W32_64 ? ARG64(4) : x86_rd64((uint32_t)X.r[ESP] + 24);
    if (period) return E_INVALIDARG; /* shared mode requires zero periodicity */
    if (!duration) duration = 1000000;
    if (duration > 10000000) return 0x88890016u;
    uint64_t frames = (duration * a->rate + 9999999) / 10000000;
    if (frames > CAPACITY) return 0x88890016u;
    a->capacity = (uint32_t)frames;
    if (a->capacity < a->rate / 100) a->capacity = a->rate / 100;
    a->flags = ARG(2);
    a->buffer = w32_heap_alloc(a->capacity * 2 * (a->bits / 8), 1);
    if (!a->buffer) return 0x8007000eu;
    a->initialized = 1; return 0;
}
static uint32_t buffer_size(void) {
    audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return 0x80004003u;
    x86_wr32(ARG(1), a->capacity); return 0;
}
static uint32_t padding(void) {
    w32_audio_pump(); audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return 0x80004003u;
    x86_wr32(ARG(1), a->queued); return 0;
}
static uint32_t start(void) {
    audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (a->running) return 0x88890005u;
    if ((a->flags & 0x40000u) && !a->event) return 0x88890014u;
    a->running = 1; a->last_ms = a->event_ms = w32_now_ms(); a->remainder = 0; return 0;
}
static uint32_t stop(void) { w32_audio_pump(); audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    a->running = 0; return 0;
}
static uint32_t reset(void) {
    audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (a->running || a->acquired) return 0x88890005u;
    a->queued = a->head = a->phase = a->remainder = 0; return 0;
}
static uint32_t setevent(void) {
    audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (!(a->flags & 0x40000u)) return 0x88890011u;
    uint32_t i = ARG(1) - EVENT_BASE;
    if (!i || i >= 64 || !events[i].used) return E_INVALIDARG;
    a->event = ARG(1); return 0;
}
static uint32_t service(void) {
    audio_t *a = client(); w32_com_object_t *o = w32_com_object(ARG(0));
    if (!ARG(2)) return 0x80004003u;
    w32_wrptr(ARG(2), 0);
    if (!a || !a->initialized) return NOT_INIT;
    if (!w32_com_guid(ARG(1), w32_iid_render)) return 0x80004002u;
    uint32_t r = w32_com_new(WCOM_RENDER, o->state, o->addr);
    w32_wrptr(ARG(2), r); return r ? 0 : 0x8007000eu;
}
static uint32_t period(void) {
    if (ARG(1)) x86_wr64(ARG(1), 100000);
    if (ARG(2)) x86_wr64(ARG(2), 30000);
    return 0;
}
static uint32_t latency(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return 0x80004003u;
    x86_wr64(ARG(1), 100000); return 0;
}
static uint32_t getbuffer(void) {
    w32_audio_pump(); audio_t *a = client();
    if (!ARG(2)) return 0x80004003u;
    w32_wrptr(ARG(2), 0);
    if (!a || !a->initialized) return NOT_INIT;
    if (a->acquired) return 0x88890007u;
    if (ARG(1) > a->capacity - a->queued) return 0x88890006u;
    a->acquired = ARG(1);
    if (a->acquired) w32_wrptr(ARG(2), a->buffer);
    return 0;
}
static uint32_t releasebuffer(void) {
    audio_t *a = client(); uint32_t n = ARG(1), flags = ARG(2);
    if (!a || !a->initialized) return NOT_INIT;
    if (!a->acquired && n) return 0x88890007u;
    if (n > a->acquired) return 0x88890009u;
    if (flags & ~2u) return E_INVALIDARG;
    for (uint32_t i = 0; i < n; i++) for (uint32_t c = 0; c < 2; c++) {
        int32_t v = 0; uint32_t p = a->buffer + (i * 2 + c) * (a->bits / 8);
        if (!(flags & 2)) {
            if (a->floating) {
                union { uint32_t u; float f; } f = {x86_rd32(p)};
                v = f.f != f.f ? 0 : f.f >= 1 ? 32767 : f.f <= -1 ? -32768 : (int32_t)(f.f * 32768);
            } else v = (int16_t)x86_rd16(p);
        }
        a->pcm[((a->head + a->queued + i) % CAPACITY) * 2 + c] = (int16_t)v;
    }
    a->queued += n; a->acquired = 0; return 0;
}
#define API(n, a, f) {n, a, 0, f}
const w32_api_t w32_api_audio[] = {
    API("BgtAudioUnsupported2", 2, unsupported), API("BgtAudioUnsupported3", 3, unsupported),
    API("BgtAudioUnsupported4", 4, unsupported), API("BgtAudioEndpoint", 4, default_endpoint),
    API("BgtAudioActivate", 5, activate), API("BgtAudioState", 2, device_state),
    API("BgtAudioMix", 2, mixformat), API("BgtAudioFormat", 4, isformat),
    API("BgtAudioInit", W32_64 ? 7 : 9, initialize), API("BgtAudioSize", 2, buffer_size),
    API("BgtAudioPadding", 2, padding), API("BgtAudioStart", 1, start), API("BgtAudioStop", 1, stop),
    API("BgtAudioReset", 1, reset), API("BgtAudioEvent", 2, setevent), API("BgtAudioService", 3, service),
    API("BgtAudioPeriod", 3, period), API("BgtAudioLatency", 2, latency),
    API("BgtAudioGet", 3, getbuffer), API("BgtAudioRelease", 3, releasebuffer),
    API("CreateEventA", 4, event_create), API("CreateEventW", 4, event_create),
    API("SetEvent", 1, event_set), API("ResetEvent", 1, event_reset), API("WaitForSingleObject", 2, event_wait),
};
const uint32_t w32_api_audio_n = sizeof w32_api_audio / sizeof w32_api_audio[0];
uint32_t w32_audio_method(uint32_t kind, uint32_t slot, uint32_t *nargs) {
    const char *name = "BgtAudioUnsupported2";
    if (kind == WCOM_ENUM && slot == 3) name = "BgtAudioUnsupported4";
    if ((kind == WCOM_ENUM && slot == 5) || (kind == WCOM_DEVICE && slot == 4))
        name = "BgtAudioUnsupported3";
    if (kind == WCOM_ENUM && slot == 4) name = "BgtAudioEndpoint";
    if (kind == WCOM_DEVICE && slot == 3) name = "BgtAudioActivate";
    if (kind == WCOM_DEVICE && slot == 6) name = "BgtAudioState";
    if (kind == WCOM_AUDIO) {
        static const char *const methods[] = {"BgtAudioInit", "BgtAudioSize", "BgtAudioLatency",
            "BgtAudioPadding", "BgtAudioFormat", "BgtAudioMix", "BgtAudioPeriod", "BgtAudioStart",
            "BgtAudioStop", "BgtAudioReset", "BgtAudioEvent", "BgtAudioService"};
        if (slot >= 3 && slot <= 14) name = methods[slot - 3];
    }
    if (kind == WCOM_RENDER) name = slot == 3 ? "BgtAudioGet" : "BgtAudioRelease";
    *nargs = 0;
    return w32_thunk_for("ole32.dll", name);
}
