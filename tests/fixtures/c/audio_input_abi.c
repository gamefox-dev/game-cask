/* SPDX-License-Identifier: CC0-1.0 — hostile bounds and additive ABI conformance. */
#include "bgt.h"
static bgt_io_t io;
static bgt_gamepad_t pad;
static int16_t stereo[] = {1200, -800, 400, -200};
BGT_EXPORT(bgt_abi_version) uint32_t version(void) { return BGT_ABI_VERSION; }
BGT_EXPORT(bgt_io) bgt_io_t *getio(void) { return &io; }
BGT_EXPORT(bgt_shutdown) void shutdown(void) {}
BGT_EXPORT(bgt_init) int32_t init(void) { io.logical_width = io.logical_height = 1; return 0; }
BGT_EXPORT(bgt_update) void update(uint32_t dt) {
    (void)dt;
    int ok = bgt_input_gamepad(4, &pad, sizeof pad) == BGT_E_INVALID;
    ok &= bgt_input_gamepad(0, &pad, 19) == BGT_E_INVALID;
    ok &= bgt_input_gamepad(0, (bgt_gamepad_t *)0xfffffff8u, 20) == BGT_E_BOUNDS;
    ok &= bgt_audio_push_stereo((int16_t *)0xfffffff8u, 4) == BGT_E_BOUNDS;
    ok &= bgt_audio_push_stereo(stereo, 0xffffffffu) == BGT_E_BOUNDS;
    ok &= bgt_input_gamepad(0, &pad, 20) == 0 && pad.connected && pad.buttons == 5;
    ok &= pad.axes[0] == 16384 && pad.axes[1] == -32767 && pad.triggers[0] == 65535;
    ok &= bgt_input_gamepad(1, &pad, 20) == 0 && !pad.connected && !pad.buttons;
    ok &= bgt_input_gamepad_rumble(0, 12345, 23456) == 0;
    ok &= bgt_input_gamepad_rumble(1, 0, 0) == BGT_E_NOT_FOUND;
    ok &= bgt_input_gamepad_rumble(4, 0, 0) == BGT_E_INVALID;
    ok &= bgt_audio_push_stereo(stereo, 2) == 1; /* sink partial acceptance, frames not sample count */
    bgt_log(BGT_LOG_INFO, ok ? "abi-ok" : "abi-FAIL", ok ? 6 : 8);
}
BGT_EXPORT(bgt_render) void render(void) {}
