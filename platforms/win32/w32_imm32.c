/* LANE-K1: no installed IME and no HIMC. NULL is a valid absent context, not a fabricated handle.
 * SPDX-License-Identifier: MIT */
#include "w32_imm32.h"
#include "w32_thread.h"
static int window(void) { int32_t x,y,w,h; return w32_user_client(ARG(0), &x,&y,&w,&h); }
static uint32_t context(void) {
    if (!window()) *w32_thread_error() = 1400;
    return 0;
}
static uint32_t associate(void) {
    if (!window()) { *w32_thread_error() = 1400; return 0; }
    if (ARG64(1)) *w32_thread_error() = 6;
    return 0;
}
static uint32_t release_context(void) {
    if (!window()) { *w32_thread_error() = 1400; return 0; }
    if (ARG64(1)) *w32_thread_error() = 6;
    return 0; /* no acquired context to release */
}
static uint32_t composition_window(void) { *w32_thread_error() = 6; return 0; }
#define API(n,a,f) {n,a,0,f}
const w32_api_t w32_api_imm32[] = {
    API("ImmGetContext",1,context), API("ImmAssociateContext",2,associate),
    API("ImmReleaseContext",2,release_context), API("ImmSetCompositionWindow",2,composition_window),
};
const uint32_t w32_api_imm32_n = sizeof w32_api_imm32 / sizeof w32_api_imm32[0];
