/* COM identity, owned references, profile class registry. SPDX-License-Identifier: MIT */
#include "w32_com.h"
#include "w32_audio.h"
#include "w32_thread.h" /* LANE-E/C */
#define E_POINTER 0x80004003u
#define E_NOINTERFACE 0x80004002u
const uint32_t w32_iid_enum[4] = {0xa95664d2, 0x4f359614, 0x8dde46a7, 0xe61736b6};
const uint32_t w32_iid_device[4] = {0xd666063f, 0x4e431587, 0x48b9f181, 0x3f3607e8};
const uint32_t w32_iid_audio[4] = {0x1cb9ad4c, 0x4c32dbfa, 0xf5c278b1, 0xb203a768};
const uint32_t w32_iid_render[4] = {0xf294acfc, 0x44833146, 0xdcadbfa7, 0xe260c2a7};
/* IAudioClock, IAudioClockAdjustment, IAudioStreamVolume, ISimpleAudioVolume (little-endian GUID words). */
const uint32_t w32_iid_clock[4] = {0xcd63314f, 0x4a1b3fba, 0x96ef2c81, 0xe7288735};
const uint32_t w32_iid_adjust[4] = {0xf6e4c0a0, 0x4fb846d9, 0xa35721be, 0x6c622bef};
const uint32_t w32_iid_streamvol[4] = {0x93014887, 0x4068242d, 0x5ecf158a, 0xe30fb993};
const uint32_t w32_iid_sessionvol[4] = {0x87ce5498, 0x44e568d6, 0xa46d1592, 0xd883f87e};
static const uint32_t iid_unknown[4] = {0, 0, 0x000000c0, 0x46000000};
static const uint32_t clsid_enum[4] = {0xbcde0395, 0x467ce52f, 0x57c43d8e, 0x2e699192};
static const uint32_t *const iids[WCOM_KINDS] = {0, w32_iid_enum, w32_iid_device, w32_iid_audio, w32_iid_render,
    w32_iid_clock, w32_iid_adjust, w32_iid_streamvol, w32_iid_sessionvol};
static w32_com_object_t objects[64];
static uint32_t tables[WCOM_KINDS];
/* LANE-E/C: CoInitialize nesting and mode belong to the calling guest thread. */
static struct { uint32_t depth, flags; } apartments[X86_THREADS];
#define apartment (apartments[x86_current].depth)
#define apartment_flags (apartments[x86_current].flags)
int w32_com_guid(uint32_t p, const uint32_t words[4]) {
    if (!p) return 0;
    for (uint32_t i = 0; i < 4; i++) if (x86_rd32(p + i * 4) != words[i]) return 0;
    return 1;
}
w32_com_object_t *w32_com_object(uint32_t addr) {
    for (uint32_t i = 0; i < 64; i++) if (objects[i].addr == addr && objects[i].refs) return &objects[i];
    return 0;
}
uint32_t w32_com_release(uint32_t addr) {
    w32_com_object_t *o = w32_com_object(addr);
    if (!o) return 0;
    if (--o->refs) return o->refs;
    if (o->kind == WCOM_AUDIO) w32_audio_destroy(o->state);
    uint32_t parent = o->parent;
    w32_heap_free(o->addr);
    o->addr = 0;
    if (parent) w32_com_release(parent);
    return 0;
}
static uint32_t query(void) {
    w32_com_object_t *o = w32_com_object(ARG(0));
    if (!ARG(2)) return E_POINTER;
    w32_wrptr(ARG(2), 0);
    if (!o || (!w32_com_guid(ARG(1), iid_unknown) && !w32_com_guid(ARG(1), iids[o->kind])))
        return E_NOINTERFACE;
    o->refs++;
    w32_wrptr(ARG(2), o->addr);
    return 0;
}
static uint32_t addref(void) {
    w32_com_object_t *o = w32_com_object(ARG(0));
    return o ? ++o->refs : 0;
}
static uint32_t release(void) { return w32_com_release(ARG(0)); }
uint32_t w32_com_new(uint32_t kind, uint32_t state, uint32_t parent) {
    if (kind < 1 || kind >= WCOM_KINDS) return 0;
    for (uint32_t i = 0; i < 64; i++) if (!objects[i].refs) {
        if (!tables[kind]) {
            static const uint32_t slots[WCOM_KINDS] = {0, 8, 7, 15, 5, 6, 4, 8, 7};
            uint32_t count = slots[kind];
            tables[kind] = w32_misc_alloc(count * w32_ptr_size());
            for (uint32_t s = 0; s < count; s++) {
                uint32_t nargs = 0, thunk;
                if (s < 3) thunk = w32_thunk_for("ole32.dll", s == 0 ? "BgtComQuery" :
                    s == 1 ? "BgtComAddRef" : "BgtComRelease");
                else thunk = w32_audio_method(kind, s, &nargs);
                w32_wrptr(tables[kind] + s * w32_ptr_size(), thunk);
            }
        }
        uint32_t addr = w32_heap_alloc(w32_ptr_size(), 1);
        if (!addr) return 0;
        w32_wrptr(addr, tables[kind]);
        objects[i] = (w32_com_object_t){addr, 1, kind, state, parent};
        w32_com_object_t *p = w32_com_object(parent);
        if (p) p->refs++;
        return addr;
    }
    return 0;
}
static uint32_t coinit(void) {
    uint32_t flags = ARG(1);
    if (ARG(0) || (flags & ~14u)) return 0x80070057u;
    if (apartment && ((flags ^ apartment_flags) & 2u)) return 0x80010106u;
    apartment_flags = flags;
    return apartment++ ? 1 : 0;
}
static uint32_t coinit_sta(void) {
    if (ARG(0)) return 0x80070057u;
    if (apartment && !(apartment_flags & 2)) return 0x80010106u;
    apartment_flags = 2;
    return apartment++ ? 1 : 0;
}
static uint32_t couninit(void) { if (apartment) apartment--; return 0; }
static uint32_t cocreate(void) {
    if (!ARG(4)) return E_POINTER;
    w32_wrptr(ARG(4), 0);
    if (!apartment) return 0x800401f0u;
    if (ARG(1)) return 0x80040110u; /* no aggregation */
    /* Registry entries pair a class GUID with its constructor kind and default interface. */
    static const struct { const uint32_t *clsid; uint32_t kind; } registry[] = {{clsid_enum, WCOM_ENUM}};
    for (uint32_t i = 0; i < sizeof registry / sizeof registry[0]; i++) {
        if (!w32_com_guid(ARG(0), registry[i].clsid)) continue;
        uint32_t kind = registry[i].kind;
        if (!(ARG(2) & 1)) return 0x80040154u;
        if (!w32_com_guid(ARG(3), iids[kind]) && !w32_com_guid(ARG(3), iid_unknown)) return E_NOINTERFACE;
        uint32_t o = w32_com_new(kind, 0, 0);
        w32_wrptr(ARG(4), o);
        return o ? 0 : 0x8007000eu;
    }
    return 0x80040154u;
}
static uint32_t taskalloc(void) { return w32_heap_alloc(ARG(0), 0); }
static uint32_t taskfree(void) { w32_heap_free(ARG(0)); return 0; }
static uint32_t taskrealloc(void) { return w32_heap_realloc(ARG(0), ARG(1)); }
static uint32_t propclear(void) {
    uint32_t p = ARG(0);
    if (!p) return E_POINTER;
    uint32_t vt = x86_rd16(p);
    if (vt == 30 || vt == 31 || vt == 72) w32_heap_free((uint32_t)w32_rdptr(p + 8));
    else if (vt == 13) w32_com_release((uint32_t)w32_rdptr(p + 8));
    else if (vt > 23 && vt != 64) return 0x80070057u;
    else if (vt == 8 || vt == 9 || vt == 12 || vt == 15) return 0x80070057u;
    for (uint32_t i = 0; i < (W32_64 ? 24u : 16u); i++) x86_wr8(p + i, 0);
    return 0;
}
static uint32_t propcopy(void) {
    uint32_t dst = ARG(0), src = ARG(1);
    if (!dst || !src) return E_POINTER;
    if (dst == src) return 0;
    uint32_t vt = x86_rd16(src), value = (uint32_t)w32_rdptr(src + 8), copy = 0;
    if (vt == 30 || vt == 31 || vt == 72) {
        uint32_t bytes = 16;
        if (vt != 72 && value) {
            uint32_t step = vt == 31 ? 2 : 1; bytes = step;
            while (bytes < 65536 && (step == 2 ? x86_rd16(value + bytes - step) :
                x86_rd8(value + bytes - step))) bytes += step;
            if (bytes >= 65536) return 0x80070057u;
        }
        if (value) {
            copy = w32_heap_alloc(bytes, 0);
            if (!copy) return 0x8007000eu;
            for (uint32_t i = 0; i < bytes; i++) x86_wr8(copy + i, x86_rd8(value + i));
        }
    } else if (vt == 13) {
        w32_com_object_t *o = w32_com_object(value);
        if (value && !o) return 0x80070057u;
        if (o) o->refs++;
        copy = value;
    } else if ((vt > 23 && vt != 64) || vt == 8 || vt == 9 || vt == 12 || vt == 15)
        return 0x80070057u;
    for (uint32_t i = 0; i < (W32_64 ? 24u : 16u); i++) x86_wr8(dst + i, x86_rd8(src + i));
    if (vt == 30 || vt == 31 || vt == 72 || vt == 13) w32_wrptr(dst + 8, copy);
    return 0;
}
static uint32_t propinit(void) {
    if (!ARG(0) || !ARG(1)) return E_POINTER;
    uint32_t p = ARG(1), len = 0;
    while (x86_rd16(ARG(0) + len * 2) && len < 32767) len++;
    uint32_t s = w32_heap_alloc((len + 1) * 2, 0);
    if (!s) return 0x8007000eu;
    for (uint32_t i = 0; i <= len; i++) x86_wr16(s + i * 2, x86_rd16(ARG(0) + i * 2));
    for (uint32_t i = 0; i < (W32_64 ? 24u : 16u); i++) x86_wr8(p + i, 0);
    x86_wr16(p, 31); w32_wrptr(p + 8, s);
    return 0;
}
#define API(n, a, f) {n, a, 0, f}
const w32_api_t w32_api_com[] = {
    API("BgtComQuery", 3, query), API("BgtComAddRef", 1, addref), API("BgtComRelease", 1, release),
    API("CoInitialize", 1, coinit_sta), API("CoInitializeEx", 2, coinit), API("CoUninitialize", 0, couninit),
    API("CoCreateInstance", 5, cocreate), API("CoTaskMemAlloc", 1, taskalloc),
    API("CoTaskMemRealloc", 2, taskrealloc), API("CoTaskMemFree", 1, taskfree),
    API("PropVariantClear", 1, propclear), API("PropVariantCopy", 2, propcopy),
    API("InitPropVariantFromString", 2, propinit),
};
const uint32_t w32_api_com_n = sizeof w32_api_com / sizeof w32_api_com[0];
