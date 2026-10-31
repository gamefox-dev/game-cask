/* LANE-K1 — shared Winsock 1/2 namespace. SPDX-License-Identifier: MIT */
#ifndef W32_WS2_32_H
#define W32_WS2_32_H
#include "w32_int.h"
extern const w32_api_t w32_api_ws2_32[];
extern const uint32_t w32_api_ws2_32_n;
const w32_api_t *w32_winsock_find(const char *name);
#endif
