/* LANE-K1: WSOCK32 is the Winsock 1 DLL facade over the process-wide Winsock state.
 * Names and stdcall arities live once in w32_ws2_32.c, including the legacy version negotiation.
 * SPDX-License-Identifier: MIT */
#include "w32_wsock32.h"
#include "w32_ws2_32.h"
const w32_api_t *w32_wsock32_find(const char *name) { return w32_winsock_find(name); }
