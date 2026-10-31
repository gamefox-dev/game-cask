/* LANE-K1: validate full guest pointers before narrowing to the bounded flat window.
 * SPDX-License-Identifier: MIT */
#ifndef W32_SYSDLL_H
#define W32_SYSDLL_H
#include "w32_int.h"
static inline int w32_sys_span(uint64_t p, uint32_t n) {
    return p && p <= UINT32_MAX && (!n || x86_mapped((uint32_t)p,n));
}
static inline int w32_sys_string(uint64_t p, int wide, uint32_t limit) {
    if(!p || p>UINT32_MAX)return 0;
    for(uint32_t i=0;i<limit;i++) {
        uint64_t q=p+(uint64_t)i*(wide?2:1);
        if(!w32_sys_span(q,wide?2:1))return 0;
        if(wide?!x86_rd16((uint32_t)q):!x86_rd8((uint32_t)q))return 1;
    }
    return 0;
}
#endif
