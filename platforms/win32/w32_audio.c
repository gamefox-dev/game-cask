/* Shared-mode WASAPI on the virtual clock. SPDX-License-Identifier: MIT */
#include "w32_audio.h"
#include "w32_thread.h" /* LANE-E/C: audio notifications use scheduler-owned events. */
/*
 * Shared-mode IAudioClient contract (K6c).  Everything below is derived from the documented Windows
 * semantics; values the documentation does not pin down are marked INFERRED and are listed in
 * docs/handoff/K6c.md.  The endpoint is one render device whose mix format is float32 stereo at the
 * sink rate.  Output is always the sink's int16 stereo; the client's own format, rate and volume are
 * applied while frames are drained on the virtual clock.
 */
#define E_INVALIDARG 0x80070057u
#define E_POINTER 0x80004003u
#define E_NOINTERFACE 0x80004002u
#define E_OUTOFMEMORY 0x8007000eu
#define NOT_INIT 0x88890001u
#define ALREADY_INIT 0x88890002u
#define UNSUPPORTED_FORMAT 0x88890008u
#define NOT_STOPPED 0x88890005u
#define BUFFER_TOO_LARGE 0x88890006u
#define OUT_OF_ORDER 0x88890007u
#define INVALID_SIZE 0x88890009u
#define EXCLUSIVE_NOT_ALLOWED 0x8889000eu
#define ENDPOINT_CREATE_FAILED 0x8889000fu
#define EVENTHANDLE_NOT_EXPECTED 0x88890011u
#define EVENTHANDLE_NOT_SET 0x88890014u
#define BUFFER_SIZE_ERROR 0x88890016u
#define NAUDIO 8u
#define NCHILD (WCOM_KINDS - WCOM_RENDER)
/* AUDCLNT_STREAMFLAGS_* and AUDCLNT_SESSIONFLAGS_*: every bit Windows defines for shared-mode Initialize. */
#define SF_CROSSPROCESS 0x10000u
#define SF_LOOPBACK 0x20000u
#define SF_EVENT 0x40000u
#define SF_NOPERSIST 0x80000u
#define SF_RATEADJUST 0x100000u
#define SF_SESSION_BITS 0x70000000u
#define SF_SRC_DEFAULT 0x08000000u
#define SF_AUTOCONVERT 0x80000000u
#define SF_VALID (SF_CROSSPROCESS | SF_LOOPBACK | SF_EVENT | SF_NOPERSIST | SF_RATEADJUST | SF_SESSION_BITS | \
                  SF_SRC_DEFAULT | SF_AUTOCONVERT)
#define DEFAULT_PERIOD 100000       /* 10 ms engine period, REFERENCE_TIME */
#define MIN_PERIOD 30000            /* 3 ms */
#define DEFAULT_DURATION 1000000    /* 100 ms when the caller passes 0 */
#define MIN_RATE 8000u
#define MAX_RATE 192000u
typedef struct { uint32_t used, refs, guid[4], mute; float master; } session_t;
typedef struct {
    uint32_t used, initialized, running;
    uint32_t rate, nominal;       /* current playback rate (SetSampleRate) and the format's rate */
    uint32_t channels, bytes, flt; /* client format: channels, bytes per sample, IEEE float */
    uint32_t capacity, queued, head;
    uint32_t buffer, ring;        /* guest heap: client staging buffer, int16 stereo queue */
    uint32_t acquired, event, last_ms, remainder, phase, event_ms, flags;
    uint32_t have_prev, session;  /* session is 1-based */
    int32_t prev[2];
    uint64_t out_frames;
    float chan[2];
    uint32_t child[NCHILD];
} audio_t;
static audio_t clients[NAUDIO];
static session_t sessions[NAUDIO];
static audio_t *client(void) {
    w32_com_object_t *o = w32_com_object(ARG(0));
    return o && o->state && o->state <= NAUDIO ? &clients[o->state - 1] : 0;
}
static float argf(uint32_t n) {
    if (W32_64 && n < 4) return X.xmm[n].f32[0];
    union { uint32_t u; float f; } v = {ARG(n)}; return v.f;
}
static float rdf(uint32_t p) { union { uint32_t u; float f; } v = {x86_rd32(p)}; return v.f; }
static void wrf(uint32_t p, float f) { union { uint32_t u; float f; } v = {0}; v.f = f; x86_wr32(p, v.u); }
static int level_ok(float f) { return f >= 0.0f && f <= 1.0f; } /* false for NaN */
static uint32_t mix_rate(void) {
    uint32_t r = w32_io->audio_sample_rate;
    return r >= MIN_RATE && r <= MAX_RATE ? r : 48000u;
}
static session_t *session_of(audio_t *a) { return a->session ? &sessions[a->session - 1] : 0; }
void w32_audio_destroy(uint32_t state) {
    if (!state || state > NAUDIO) return;
    audio_t *a = &clients[state - 1];
    w32_heap_free(a->buffer); w32_heap_free(a->ring);
    session_t *s = session_of(a);
    if (s && !--s->refs) *s = (session_t){0};
    *a = (audio_t){0};
}
static int32_t lerp(int32_t p, int32_t c, uint32_t num, uint32_t den) {
    int64_t d = (int64_t)(c - p) * num, h = den / 2;
    return p + (int32_t)((d + (d < 0 ? -h : h)) / (int64_t)den);
}
static int16_t gain(int32_t v, float g) {
    if (g == 1.0f) return (int16_t)v;
    float x = (float)v * g;
    return (int16_t)(int32_t)(x >= 0 ? x + 0.5f : x - 0.5f);
}
static void pump_one(audio_t *a, uint32_t now, uint32_t out_rate) {
    uint64_t elapsed = (uint64_t)(now - a->last_ms) * a->rate + a->remainder;
    a->last_ms = now; a->remainder = (uint32_t)(elapsed % 1000);
    uint32_t n = (uint32_t)(elapsed / 1000);
    if (n > a->queued) n = a->queued;
    session_t *s = session_of(a);
    float master = s && !s->mute ? s->master : s ? 0.0f : 1.0f;
    float gl = master * a->chan[0], gr = master * a->chan[a->channels > 1 ? 1 : 0];
    int linear = (a->flags & SF_RATEADJUST) ||
        ((a->flags & (SF_SRC_DEFAULT | SF_AUTOCONVERT)) == (SF_SRC_DEFAULT | SF_AUTOCONVERT));
    /* Standalone SRC_DEFAULT_QUALITY is accepted but has no effect (INFERRED). */
    int16_t out[4096]; uint32_t count = 0;
    for (uint32_t f = 0; f < n; f++) {
        uint32_t p = a->ring + a->head * 4;
        int32_t cur[2] = {(int16_t)x86_rd16(p), (int16_t)x86_rd16(p + 2)};
        if (!a->have_prev) { a->prev[0] = cur[0]; a->prev[1] = cur[1]; a->have_prev = 1; }
        a->phase += out_rate;
        while (a->phase >= a->rate) {
            a->phase -= a->rate;
            /* The crossing lies `phase` out-rate units before the end of this source frame. */
            int32_t l = cur[0], r = cur[1];
            if (linear && a->phase) {
                l = lerp(a->prev[0], cur[0], out_rate - a->phase, out_rate);
                r = lerp(a->prev[1], cur[1], out_rate - a->phase, out_rate);
            }
            out[count++] = gain(l, gl); out[count++] = gain(r, gr);
            a->out_frames++;
            if (count == 4096) { bgt_audio_push_stereo(out, count / 2); count = 0; }
        }
        a->prev[0] = cur[0]; a->prev[1] = cur[1];
        a->head = (a->head + 1) % a->capacity;
    }
    if (count) bgt_audio_push_stereo(out, count / 2);
    a->queued -= n;
}
void w32_audio_pump(void) {
    uint32_t now = w32_now_ms(), out_rate = w32_io->audio_sample_rate;
    for (uint32_t i = 0; i < NAUDIO; i++) {
        audio_t *a = &clients[i];
        if (!a->used || !a->initialized || !a->running) continue;
        pump_one(a, now, out_rate);
        /* One signal per virtual pump; auto-reset events coalesce missed periods, as on Windows. */
        if (now - a->event_ms >= 10) {
            a->event_ms = now;
            w32_thread_signal_event(a->event);
        }
    }
}
static uint32_t unsupported(void) { return 0x80004001u; }
static uint32_t default_endpoint(void) {
    if (!ARG(3)) return E_POINTER;
    w32_wrptr(ARG(3), 0);
    if (ARG(1) != 0 || ARG(2) > 2) return E_INVALIDARG;
    uint32_t o = w32_com_new(WCOM_DEVICE, 0, 0);
    w32_wrptr(ARG(3), o); return o ? 0 : E_OUTOFMEMORY;
}
static uint32_t device_state(void) { if (!ARG(1)) return E_POINTER; x86_wr32(ARG(1), 1); return 0; }
static uint32_t activate(void) {
    if (!ARG(4)) return E_POINTER;
    w32_wrptr(ARG(4), 0);
    if (!w32_com_guid(ARG(1), w32_iid_audio)) return E_NOINTERFACE;
    for (uint32_t i = 0; i < NAUDIO; i++) if (!clients[i].used) {
        clients[i] = (audio_t){.used = 1};
        uint32_t o = w32_com_new(WCOM_AUDIO, i + 1, 0);
        if (!o) { clients[i].used = 0; return E_OUTOFMEMORY; }
        w32_wrptr(ARG(4), o); return 0;
    }
    return E_OUTOFMEMORY;
}
/* The shared-mode mix format: float32 stereo at the sink rate (WAVEFORMATEX, cbSize 0). */
static uint32_t make_mix(void) {
    uint32_t p = w32_heap_alloc(18, 1), r = mix_rate();
    if (!p) return 0;
    x86_wr16(p, 3); x86_wr16(p + 2, 2); x86_wr32(p + 4, r);
    x86_wr32(p + 8, r * 8); x86_wr16(p + 12, 8); x86_wr16(p + 14, 32);
    return p;
}
static uint32_t mixformat(void) {
    if (!ARG(1)) return E_POINTER;
    uint32_t p = make_mix();
    if (!p) return E_OUTOFMEMORY;
    w32_wrptr(ARG(1), p); return 0;
}
typedef struct { uint32_t rate, channels, bytes, flt; } fmt_t;
enum { F_OK, F_INVALID, F_UNKNOWN, F_UNCONVERTIBLE };
/* Validate a WAVEFORMATEX / WAVEFORMATEXTENSIBLE.  F_INVALID: malformed (E_INVALIDARG); F_UNKNOWN: a
 * tag or sub-format this engine has no decoder for; F_UNCONVERTIBLE: well formed but outside the
 * converter's range (more than two channels, odd sample size, rate outside 8-192 kHz). */
static int parse_format(uint32_t p, fmt_t *f) {
    uint32_t tag = x86_rd16(p), ch = x86_rd16(p + 2), rate = x86_rd32(p + 4), avg = x86_rd32(p + 8);
    uint32_t align = x86_rd16(p + 12), bits = x86_rd16(p + 14), sub = tag;
    if (tag == 0xfffeu) {
        if (x86_rd16(p + 16) < 22) return F_INVALID;
        if (x86_rd16(p + 18) > bits) return F_INVALID; /* wValidBitsPerSample */
        /* SubFormat is {tag, 0000-0010-8000-00AA00389B71}. */
        if (x86_rd32(p + 28) != 0x00100000u || x86_rd32(p + 32) != 0xaa000080u ||
            x86_rd32(p + 36) != 0x719b3800u) return F_UNKNOWN;
        sub = x86_rd32(p + 24);
        if (sub == 3 && x86_rd16(p + 18) != bits) return F_INVALID;
        uint32_t mask = x86_rd32(p + 20), count = 0;
        for (uint32_t m = mask; m; m &= m - 1) count++;
        if (mask && ((mask & ~0x3ffffu) || count != ch)) return F_INVALID;
        /* The converter implements center mono (duplicated) and front-left/right stereo only. */
        if (mask && !((ch == 1 && mask == 4) || (ch == 2 && mask == 3))) return F_UNCONVERTIBLE;
    }
    if (sub != 1 && sub != 3) return F_UNKNOWN;
    if (!ch || !rate || !bits) return F_INVALID;
    if (bits & 7) return F_UNCONVERTIBLE;
    if (align != ch * (bits / 8) || (uint64_t)avg != (uint64_t)rate * align) return F_INVALID;
    if (ch > 2 || rate < MIN_RATE || rate > MAX_RATE) return F_UNCONVERTIBLE;
    if (sub == 3 ? bits != 32 : bits > 32) return F_UNCONVERTIBLE;
    f->rate = rate; f->channels = ch; f->bytes = bits / 8; f->flt = sub == 3;
    return F_OK;
}
static int is_mix_layout(const fmt_t *f) { return f->flt && f->channels == 2 && f->bytes == 4; }
static uint32_t isformat(void) {
    fmt_t f;
    if (!ARG(2)) return E_POINTER;
    if (ARG(1) > 1) return E_INVALIDARG;
    if (ARG(1) == 1) { /* exclusive: no hardware formats exist here */
        if (ARG(3)) return E_INVALIDARG;
        return UNSUPPORTED_FORMAT;
    }
    if (!ARG(3)) return E_POINTER;
    w32_wrptr(ARG(3), 0);
    int r = parse_format(ARG(2), &f);
    if (r == F_INVALID) return E_INVALIDARG;
    if (r == F_UNKNOWN) return UNSUPPORTED_FORMAT;
    if (r == F_OK && is_mix_layout(&f) && f.rate == mix_rate()) return 0;
    uint32_t mix = make_mix(); /* shared mode proposes the mix format as the closest match */
    if (!mix) return E_OUTOFMEMORY;
    w32_wrptr(ARG(3), mix); return 1; /* S_FALSE */
}
static uint32_t initialize(void) {
    audio_t *a = client();
    if (!a) return E_INVALIDARG;
    if (a->initialized) return ALREADY_INIT;
    /* i386 REFERENCE_TIME values consume two stack words each. */
    uint32_t mode = ARG(1), flags = ARG(2), fp = ARG(W32_64 ? 5 : 7), guid = ARG(W32_64 ? 6 : 8);
    int64_t duration = (int64_t)(W32_64 ? ARG64(3) : x86_rd64((uint32_t)X.r[ESP] + 16));
    int64_t period = (int64_t)(W32_64 ? ARG64(4) : x86_rd64((uint32_t)X.r[ESP] + 24));
    if (!fp) return E_POINTER;
    if (mode > 1 || (flags & ~SF_VALID)) return E_INVALIDARG;
    if (mode == 1) /* exclusive: LOOPBACK/CROSSPROCESS are invalid there; the endpoint offers no exclusive mode */
        return flags & (SF_LOOPBACK | SF_CROSSPROCESS) ? E_INVALIDARG : EXCLUSIVE_NOT_ALLOWED;
    if (period) return E_INVALIDARG; /* shared mode requires zero periodicity */
    fmt_t f;
    int r = parse_format(fp, &f);
    if (r == F_INVALID) return E_INVALIDARG;
    if (r != F_OK) return UNSUPPORTED_FORMAT;
    /* Non-mix formats need the engine converter (AUTOCONVERTPCM); RATEADJUST alone lets a mix-layout
     * (float32 stereo) stream run at another sample rate, which SetSampleRate can then change. */
    int mix = is_mix_layout(&f) && f.rate == mix_rate();
    int rate_only = is_mix_layout(&f) && (flags & SF_RATEADJUST);
    if (!mix && !rate_only && !(flags & SF_AUTOCONVERT)) return UNSUPPORTED_FORMAT;
    if (duration < 0) return BUFFER_SIZE_ERROR;
    if (flags & SF_LOOPBACK) return ENDPOINT_CREATE_FAILED; /* no capture/loopback path on this endpoint */
    if (!duration) duration = DEFAULT_DURATION;
    /* Split seconds from the fractional part: duration * rate can overflow even uint64_t for
     * a valid positive REFERENCE_TIME. UINT32 frame counts and guest byte lengths must both fit. */
    uint64_t frames = (uint64_t)(duration / 10000000) * f.rate +
        ((uint64_t)(duration % 10000000) * f.rate + 9999999) / 10000000;
    uint64_t floor_frames = ((uint64_t)DEFAULT_PERIOD * f.rate + 9999999) / 10000000; /* at least one period */
    if (frames < floor_frames) frames = floor_frames;
    uint32_t align = f.channels * f.bytes;
    if (frames > UINT32_MAX / align || frames > UINT32_MAX / 4u) return E_OUTOFMEMORY;
    uint32_t sess = 0;
    /* Streams naming the same session GUID (NULL = process default) share ISimpleAudioVolume state. */
    uint32_t g[4] = {0, 0, 0, 0};
    if (guid) for (uint32_t i = 0; i < 4; i++) g[i] = x86_rd32(guid + i * 4);
    for (uint32_t i = 0; i < NAUDIO && !sess; i++) if (sessions[i].used && sessions[i].guid[0] == g[0] &&
        sessions[i].guid[1] == g[1] && sessions[i].guid[2] == g[2] && sessions[i].guid[3] == g[3]) sess = i + 1;
    for (uint32_t i = 0; i < NAUDIO && !sess; i++) if (!sessions[i].used) {
        sessions[i] = (session_t){.used = 1, .guid = {g[0], g[1], g[2], g[3]}, .master = 1.0f};
        sess = i + 1;
    }
    if (!sess) return E_OUTOFMEMORY;
    uint32_t buffer = w32_heap_alloc((uint32_t)frames * align, 1);
    uint32_t ring = buffer ? w32_heap_alloc((uint32_t)frames * 4, 1) : 0;
    if (!ring) {
        w32_heap_free(buffer);
        if (!sessions[sess - 1].refs) sessions[sess - 1] = (session_t){0};
        return E_OUTOFMEMORY;
    }
    sessions[sess - 1].refs++;
    a->rate = a->nominal = f.rate; a->channels = f.channels; a->bytes = f.bytes; a->flt = f.flt;
    a->capacity = (uint32_t)frames; a->flags = flags; a->buffer = buffer; a->ring = ring; a->session = sess;
    a->chan[0] = a->chan[1] = 1.0f;
    a->initialized = 1; return 0;
}
static uint32_t buffer_size(void) {
    audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    x86_wr32(ARG(1), a->capacity); return 0;
}
static uint32_t padding(void) {
    w32_audio_pump(); audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    x86_wr32(ARG(1), a->queued); return 0;
}
static uint32_t start(void) {
    audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (a->running) return NOT_STOPPED;
    if ((a->flags & SF_EVENT) && !a->event) return EVENTHANDLE_NOT_SET;
    a->running = 1; a->last_ms = a->event_ms = w32_now_ms(); a->remainder = 0; return 0;
}
static uint32_t stop(void) { w32_audio_pump(); audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    a->running = 0; return 0;
}
static uint32_t reset(void) {
    audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (a->running || a->acquired) return NOT_STOPPED;
    a->queued = a->head = a->phase = a->remainder = a->have_prev = 0; a->out_frames = 0; return 0;
}
static uint32_t setevent(void) {
    audio_t *a = client();
    if (!a || !a->initialized) return NOT_INIT;
    if (!(a->flags & SF_EVENT)) return EVENTHANDLE_NOT_EXPECTED;
    if (!w32_thread_event_valid(ARG(1))) return E_INVALIDARG;
    a->event = ARG(1); return 0;
}
/* GetService: one child object per interface and client, so repeated requests share identity. */
static uint32_t service(void) {
    audio_t *a = client(); w32_com_object_t *o = w32_com_object(ARG(0));
    if (!ARG(1) || !ARG(2)) return E_POINTER;
    w32_wrptr(ARG(2), 0);
    if (!a || !a->initialized) return NOT_INIT;
    static const uint32_t *const ids[NCHILD] = {w32_iid_render, w32_iid_clock, w32_iid_adjust,
        w32_iid_streamvol, w32_iid_sessionvol};
    uint32_t kind = 0;
    for (uint32_t i = 0; i < NCHILD && !kind; i++) if (w32_com_guid(ARG(1), ids[i])) kind = WCOM_RENDER + i;
    if (!kind) return E_NOINTERFACE;
    if (kind == WCOM_ADJUST && !(a->flags & SF_RATEADJUST)) return E_INVALIDARG; /* INFERRED */
    uint32_t *slot = &a->child[kind - WCOM_RENDER];
    w32_com_object_t *c = *slot ? w32_com_object(*slot) : 0;
    if (c && c->kind == kind && c->state == o->state) { c->refs++; w32_wrptr(ARG(2), c->addr); return 0; }
    uint32_t r = w32_com_new(kind, o->state, o->addr);
    if (!r) return E_OUTOFMEMORY;
    *slot = r; w32_wrptr(ARG(2), r); return 0;
}
static uint32_t period(void) {
    if (ARG(1)) x86_wr64(ARG(1), DEFAULT_PERIOD);
    if (ARG(2)) x86_wr64(ARG(2), MIN_PERIOD);
    return 0;
}
/* Shared-mode latency is one engine period; the buffer is never shorter than that. */
static uint32_t latency(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    x86_wr64(ARG(1), DEFAULT_PERIOD); return 0;
}
static uint32_t getbuffer(void) {
    w32_audio_pump(); audio_t *a = client();
    if (!ARG(2)) return E_POINTER;
    w32_wrptr(ARG(2), 0);
    if (!a || !a->initialized) return NOT_INIT;
    if (a->acquired) return OUT_OF_ORDER;
    if (ARG(1) > a->capacity - a->queued) return BUFFER_TOO_LARGE;
    a->acquired = ARG(1);
    if (a->acquired) w32_wrptr(ARG(2), a->buffer);
    return 0;
}
/* One channel of one client frame to the sink's int16 domain (top-aligned for wider integers). */
static int32_t sample_to_16(const audio_t *a, uint32_t p) {
    if (a->flt) {
        float f = rdf(p);
        return f != f ? 0 : f >= 1 ? 32767 : f <= -1 ? -32768 : (int32_t)(f * 32768);
    }
    switch (a->bytes) {
    case 1: return ((int32_t)x86_rd8(p) - 128) * 256;
    case 2: return (int16_t)x86_rd16(p);
    case 3: return (int16_t)x86_rd16(p + 1);
    default: return (int16_t)(x86_rd32(p) >> 16);
    }
}
static uint32_t releasebuffer(void) {
    audio_t *a = client(); uint32_t n = ARG(1), flags = ARG(2);
    if (!a || !a->initialized) return NOT_INIT;
    if (!a->acquired && n) return OUT_OF_ORDER;
    if (n > a->acquired) return INVALID_SIZE;
    if (flags & ~2u) return E_INVALIDARG;
    uint32_t align = a->channels * a->bytes;
    for (uint32_t i = 0; i < n; i++) for (uint32_t c = 0; c < 2; c++) {
        int32_t v = 0;
        if (!(flags & 2)) v = sample_to_16(a, a->buffer + i * align + (c < a->channels ? c : 0) * a->bytes);
        x86_wr16(a->ring + (((a->head + a->queued + i) % a->capacity) * 2 + c) * 2, (uint32_t)v & 0xffffu);
    }
    a->queued += n; a->acquired = 0; return 0;
}
/* IAudioClock: position is device time in 1/GetFrequency units (the format's rate), counted from the
 * frames actually delivered to the sink, so it follows SetSampleRate changes and Reset (INFERRED). */
static uint32_t clock_freq(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    x86_wr64(ARG(1), a->nominal); return 0;
}
static uint32_t clock_pos(void) {
    w32_audio_pump(); audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    uint32_t out_rate = w32_io->audio_sample_rate;
    x86_wr64(ARG(1), out_rate ? a->out_frames * a->nominal / out_rate : a->out_frames);
    if (ARG(2)) x86_wr64(ARG(2), w32_now_ms64() * 10000u); /* 100 ns units */
    return 0;
}
static uint32_t clock_chars(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    x86_wr32(ARG(1), 1); return 0; /* AUDIOCLOCK_CHARACTERISTIC_FIXED_FREQ */
}
/* IAudioClockAdjustment::SetSampleRate: consume the client's frames at a new rate from now on. */
static uint32_t adjust_rate(void) {
    audio_t *a = client(); float hz = argf(1);
    if (!a || !a->initialized) return NOT_INIT;
    if (!(hz >= (float)MIN_RATE && hz <= (float)MAX_RATE)) return E_INVALIDARG;
    uint32_t rate = (uint32_t)(hz + 0.5f);
    if (a->running) pump_one(a, w32_now_ms(), w32_io->audio_sample_rate); /* settle at the old rate */
    a->phase = (uint32_t)((uint64_t)a->phase * rate / a->rate);
    a->rate = rate; return 0;
}
/* IAudioStreamVolume: one level per client channel, applied when frames reach the sink. */
static uint32_t svol_count(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    x86_wr32(ARG(1), a->channels); return 0;
}
static uint32_t svol_set(void) {
    audio_t *a = client(); float v = argf(2);
    if (!a || !a->initialized) return NOT_INIT;
    if (ARG(1) >= a->channels || !level_ok(v)) return E_INVALIDARG;
    a->chan[ARG(1)] = v; return 0;
}
static uint32_t svol_get(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(2)) return E_POINTER;
    if (ARG(1) >= a->channels) return E_INVALIDARG;
    wrf(ARG(2), a->chan[ARG(1)]); return 0;
}
static uint32_t svol_set_all(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(2)) return E_POINTER;
    if (ARG(1) != a->channels) return E_INVALIDARG;
    for (uint32_t i = 0; i < a->channels; i++) if (!level_ok(rdf(ARG(2) + i * 4))) return E_INVALIDARG;
    for (uint32_t i = 0; i < a->channels; i++) a->chan[i] = rdf(ARG(2) + i * 4);
    return 0;
}
static uint32_t svol_get_all(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(2)) return E_POINTER;
    if (ARG(1) != a->channels) return E_INVALIDARG;
    for (uint32_t i = 0; i < a->channels; i++) wrf(ARG(2) + i * 4, a->chan[i]);
    return 0;
}
/* ISimpleAudioVolume: session-wide master level and mute, shared by streams with the same session GUID. */
static uint32_t pvol_set(void) {
    audio_t *a = client(); float v = argf(1);
    if (!a || !a->initialized) return NOT_INIT;
    if (!level_ok(v)) return E_INVALIDARG;
    session_of(a)->master = v; return 0;
}
static uint32_t pvol_get(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    wrf(ARG(1), session_of(a)->master); return 0;
}
static uint32_t pvol_setmute(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    session_of(a)->mute = ARG(1) != 0; return 0;
}
static uint32_t pvol_getmute(void) {
    audio_t *a = client(); if (!a || !a->initialized) return NOT_INIT;
    if (!ARG(1)) return E_POINTER;
    x86_wr32(ARG(1), session_of(a)->mute); return 0;
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
    API("BgtAudioClockFreq", 2, clock_freq), API("BgtAudioClockPos", 3, clock_pos),
    API("BgtAudioClockChars", 2, clock_chars), API("BgtAudioAdjustRate", 2, adjust_rate),
    API("BgtAudioSVolCount", 2, svol_count), API("BgtAudioSVolSet", 3, svol_set),
    API("BgtAudioSVolGet", 3, svol_get), API("BgtAudioSVolSetAll", 3, svol_set_all),
    API("BgtAudioSVolGetAll", 3, svol_get_all), API("BgtAudioPVolSet", 3, pvol_set),
    API("BgtAudioPVolGet", 2, pvol_get), API("BgtAudioPVolSetMute", 3, pvol_setmute),
    API("BgtAudioPVolGetMute", 2, pvol_getmute),
};
const uint32_t w32_api_audio_n = sizeof w32_api_audio / sizeof w32_api_audio[0];
uint32_t w32_audio_method(uint32_t kind, uint32_t slot, uint32_t *nargs) {
    const char *name = "BgtAudioUnsupported2";
    if (kind == WCOM_ENUM && slot == 3) name = "BgtAudioUnsupported4";
    if ((kind == WCOM_ENUM && slot == 5) || (kind == WCOM_DEVICE && slot == 4))
        name = "BgtAudioUnsupported3";
    if (kind == WCOM_ENUM && slot == 4) name = "BgtAudioEndpoint";
    if (kind == WCOM_ENUM && slot == 6) name = "BgtComRegisterNotify";
    if (kind == WCOM_ENUM && slot == 7) name = "BgtComUnregisterNotify";
    if (kind == WCOM_DEVICE && slot == 3) name = "BgtAudioActivate";
    if (kind == WCOM_DEVICE && slot == 6) name = "BgtAudioState";
    if (kind == WCOM_AUDIO) {
        static const char *const methods[] = {"BgtAudioInit", "BgtAudioSize", "BgtAudioLatency",
            "BgtAudioPadding", "BgtAudioFormat", "BgtAudioMix", "BgtAudioPeriod", "BgtAudioStart",
            "BgtAudioStop", "BgtAudioReset", "BgtAudioEvent", "BgtAudioService"};
        if (slot >= 3 && slot <= 14) name = methods[slot - 3];
    }
    if (kind == WCOM_RENDER) name = slot == 3 ? "BgtAudioGet" : "BgtAudioRelease";
    if (kind == WCOM_CLOCK && slot >= 3 && slot <= 5) {
        static const char *const m[] = {"BgtAudioClockFreq", "BgtAudioClockPos", "BgtAudioClockChars"};
        name = m[slot - 3];
    }
    if (kind == WCOM_ADJUST && slot == 3) name = "BgtAudioAdjustRate";
    if (kind == WCOM_STREAMVOL && slot >= 3 && slot <= 7) {
        static const char *const m[] = {"BgtAudioSVolCount", "BgtAudioSVolSet", "BgtAudioSVolGet",
            "BgtAudioSVolSetAll", "BgtAudioSVolGetAll"};
        name = m[slot - 3];
    }
    if (kind == WCOM_SESSIONVOL && slot >= 3 && slot <= 6) {
        static const char *const m[] = {"BgtAudioPVolSet", "BgtAudioPVolGet", "BgtAudioPVolSetMute",
            "BgtAudioPVolGetMute"};
        name = m[slot - 3];
    }
    *nargs = 0;
    return w32_thunk_for("ole32.dll", name);
}
