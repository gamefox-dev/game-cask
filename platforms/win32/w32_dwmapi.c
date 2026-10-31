/* LANE-K1: no desktop compositor in BGT. SPDX-License-Identifier: MIT */
#include "w32_dwmapi.h"
static uint32_t composition(void) {
    if (!ARG(0)) return 0x80070057u;
    x86_wr32(ARG(0), 0); return 0;
}
static uint32_t blur(void) {
    int32_t x,y,w,h;
    if (!w32_user_client(ARG(0), &x,&y,&w,&h)) return 0x80070006u;
    if (!ARG(1)) return 0x80070057u;
    return 0x80263001u; /* DWM_E_COMPOSITIONDISABLED */
}
static uint32_t flush(void) { return 0x80263001u; }
#define API(n,a,f) {n,a,0,f}
const w32_api_t w32_api_dwmapi[] = {
    API("DwmIsCompositionEnabled",1,composition), API("DwmEnableBlurBehindWindow",2,blur),
    API("DwmFlush",0,flush),
};
const uint32_t w32_api_dwmapi_n = sizeof w32_api_dwmapi / sizeof w32_api_dwmapi[0];
