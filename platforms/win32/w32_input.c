/* XInput and snapshot-derived keyboard/mouse Raw Input. SPDX-License-Identifier: MIT */
#include "w32_input.h"
static uint32_t packet[4];
static bgt_gamepad_t previous[4];
static int pad(uint32_t index, bgt_gamepad_t *p) {
    if (index >= 4) return 0;
    if (bgt_input_gamepad(index, p, sizeof *p) || !p->connected) {
        __builtin_memset(&previous[index], 0, sizeof previous[index]);
        return 0;
    }
    if (__builtin_memcmp(p, &previous[index], sizeof *p)) { previous[index] = *p; packet[index]++; }
    return 1;
}
static void putpad(uint32_t p, const bgt_gamepad_t *g) {
    static const uint16_t map[16] = {0x1000, 0x2000, 0x4000, 0x8000, 0x100, 0x200, 0, 0,
        0x20, 0x10, 0x40, 0x80, 1, 2, 4, 8};
    uint32_t buttons = 0;
    for (uint32_t i = 0; i < 16; i++) if (g->buttons & (1u << i)) buttons |= map[i];
    x86_wr16(p, buttons); x86_wr8(p + 2, g->triggers[0] >> 8); x86_wr8(p + 3, g->triggers[1] >> 8);
    for (uint32_t i = 0; i < 4; i++) x86_wr16(p + 4 + i * 2,
        (uint16_t)((i & 1) ? -g->axes[i] : g->axes[i]));
}
static uint32_t getstate(void) {
    bgt_gamepad_t g;
    if (!ARG(1)) return 87;
    if (!pad(ARG(0), &g)) return 1167;
    x86_wr32(ARG(1), packet[ARG(0)]); putpad(ARG(1) + 4, &g); return 0;
}
static uint32_t setstate(void) {
    bgt_gamepad_t g;
    if (!ARG(1)) return 87;
    if (!pad(ARG(0), &g)) return 1167;
    bgt_input_gamepad_rumble(ARG(0), x86_rd16(ARG(1)), x86_rd16(ARG(1) + 2));
    return 0;
}
static uint32_t capabilities(void) {
    bgt_gamepad_t g;
    if (!ARG(2) || (ARG(1) & ~1u)) return 87;
    if (!pad(ARG(0), &g)) return 1167;
    uint32_t p = ARG(2);
    for (uint32_t i = 0; i < 20; i++) x86_wr8(p + i, 0);
    x86_wr8(p, 1); x86_wr8(p + 1, 1); x86_wr16(p + 4, 0xf3ff);
    x86_wr8(p + 6, 255); x86_wr8(p + 7, 255);
    for (uint32_t i = 0; i < 4; i++) x86_wr16(p + 8 + i * 2, 0x7fff);
    return 0;
}
static struct { uint32_t hwnd, flags; } registration[2];
static uint32_t prevkeys[8], prevbuttons;
static int32_t prevx = -1, prevy = -1;
static struct { uint32_t handle, size; uint8_t bytes[48]; } raw[256];
static uint32_t sequence;
static uint32_t raw_header(void) { return W32_64 ? 24 : 16; }
static uint32_t register_raw(void) {
    uint32_t size = W32_64 ? 16 : 12;
    if (!ARG(0) || ARG(2) != size || ARG(1) > 64) return 0;
    for (uint32_t i = 0; i < ARG(1); i++) {
        uint32_t p = ARG(0) + i * size, usage = x86_rd16(p + 2), flags = x86_rd32(p + 4);
        if (x86_rd16(p) != 1 || (usage != 2 && usage != 6) || (flags & ~0x100u & ~1u)) return 0;
        uint32_t h = (uint32_t)w32_rdptr(p + 8);
        if ((flags & 1) && h) return 0;
    }
    for (uint32_t i = 0; i < ARG(1); i++) {
        uint32_t p = ARG(0) + i * size, k = x86_rd16(p + 2) == 6;
        registration[k].flags = x86_rd32(p + 4);
        registration[k].hwnd = registration[k].flags & 1 ? 0 : (uint32_t)w32_rdptr(p + 8);
        if (!registration[k].hwnd && !(registration[k].flags & 1))
            registration[k].hwnd = w32_user_main_hwnd();
    }
    return 1;
}
static uint32_t begin_raw(uint32_t kind) {
    uint32_t id = ++sequence, slot = id % 256;
    raw[slot].handle = 0x10000000u + id;
    raw[slot].size = raw_header() + (kind ? 16 : 24);
    __builtin_memset(raw[slot].bytes, 0, sizeof raw[slot].bytes);
    uint32_t type = kind, size = raw[slot].size;
    __builtin_memcpy(raw[slot].bytes, &type, 4);
    __builtin_memcpy(raw[slot].bytes + 4, &size, 4);
    raw[slot].bytes[8] = (uint8_t)(kind + 1); /* stable pseudo device */
    return slot;
}
static void raw16(uint32_t slot, uint32_t off, uint16_t value) {
    __builtin_memcpy(raw[slot].bytes + raw_header() + off, &value, 2);
}
static void raw32(uint32_t slot, uint32_t off, uint32_t value) {
    __builtin_memcpy(raw[slot].bytes + raw_header() + off, &value, 4);
}
void w32_input_pump(void) {
    bgt_io_t *io = w32_io;
    for (uint32_t k = 0; k < 256; k++) {
        uint32_t now = (io->keys[k >> 5] >> (k & 31)) & 1u;
        uint32_t was = (prevkeys[k >> 5] >> (k & 31)) & 1u, vk = w32_input_vk(k);
        if (vk && now != was && registration[1].hwnd) {
            uint32_t s = begin_raw(1);
            /* USB does not carry a PC set-1 make code: emit known mappings, zero when unavailable. */
            static const uint8_t letters[26] = {30,48,46,32,18,33,34,35,23,36,37,38,50,
                49,24,25,16,19,31,20,22,47,17,45,21,44};
            raw16(s, 0, k >= 4 && k <= 29 ? letters[k - 4] : 0);
            raw16(s, 2, now ? 0 : 1); raw16(s, 6, vk); raw32(s, 8, now ? 0x100 : 0x101);
            w32_input_post(registration[1].hwnd, 0xff, 0, raw[s].handle);
        }
    }
    __builtin_memcpy(prevkeys, io->keys, sizeof prevkeys);
    uint32_t b = io->pointer_buttons;
    if (registration[0].hwnd && (io->pointer_x != prevx || io->pointer_y != prevy || b != prevbuttons)) {
        uint32_t s = begin_raw(0), flags = 0;
        const uint32_t browser[3] = {1, 2, 4};
        for (uint32_t i = 0; i < 3; i++) {
            if ((b & browser[i]) && !(prevbuttons & browser[i])) flags |= 1u << (i * 2);
            if (!(b & browser[i]) && (prevbuttons & browser[i])) flags |= 2u << (i * 2);
        }
        raw16(s, 4, flags); raw32(s, 8, b);
        raw32(s, 12, prevx == -1 ? 0 : (uint32_t)(io->pointer_x - prevx));
        raw32(s, 16, prevy == -1 ? 0 : (uint32_t)(io->pointer_y - prevy));
        w32_input_post(registration[0].hwnd, 0xff, 0, raw[s].handle);
    }
    prevx = io->pointer_x; prevy = io->pointer_y; prevbuttons = b;
}
static uint32_t getraw(void) {
    uint32_t h = ARG(0), cmd = ARG(1), dst = ARG(2), sizep = ARG(3);
    if (!h || !sizep || ARG(4) != raw_header() || (cmd != 0x10000003u && cmd != 0x10000005u)) return 0xffffffffu;
    uint32_t s = (h - 0x10000000u) % 256;
    if (raw[s].handle != h) return 0xffffffffu;
    uint32_t n = cmd == 0x10000005u ? raw_header() : raw[s].size;
    if (!dst) { x86_wr32(sizep, n); return 0; }
    if (x86_rd32(sizep) < n) { x86_wr32(sizep, n); return 0xffffffffu; }
    for (uint32_t i = 0; i < n; i++) x86_wr8(dst + i, raw[s].bytes[i]);
    return n;
}
#define API(n, a, f) {n, a, 0, f}
const w32_api_t w32_api_input[] = {
    API("XInputGetState", 2, getstate), API("XInputSetState", 2, setstate),
    API("XInputGetCapabilities", 3, capabilities), API("RegisterRawInputDevices", 3, register_raw),
    API("GetRawInputData", 5, getraw),
};
const uint32_t w32_api_input_n = sizeof w32_api_input / sizeof w32_api_input[0];
