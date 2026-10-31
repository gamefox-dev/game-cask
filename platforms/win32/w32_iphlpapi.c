/* LANE-K1: isolated machine with no IP adapters/routes (including no virtual loopback service).
 * Empty adapter lists return ERROR_NO_DATA, not a successful invented adapter.
 * SPDX-License-Identifier: MIT */
#include "w32_iphlpapi.h"
static uint32_t adapters(void) {
    if (ARG(0) != 0 && ARG(0) != 2 && ARG(0) != 23) return 87;
    if (ARG64(2) || !ARG(4)) return 87;
    x86_wr32(ARG(4), 0); return 232;
}
static uint32_t best(void) {
    if (!ARG(0) || !ARG(1)) return 87;
    uint32_t family = x86_rd16(ARG(0));
    if (family != 2 && family != 23) return 10047;
    return 1231; /* ERROR_NETWORK_UNREACHABLE; output untouched */
}
#define API(n,a,f) {n,a,0,f}
const w32_api_t w32_api_iphlpapi[] = { API("GetAdaptersAddresses",5,adapters), API("GetBestInterfaceEx",2,best) };
const uint32_t w32_api_iphlpapi_n = sizeof w32_api_iphlpapi / sizeof w32_api_iphlpapi[0];
