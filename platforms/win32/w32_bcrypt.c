/* LANE-K1: system RNG only; entropy is never taken from the simulation PRNG.
 * SPDX-License-Identifier: MIT */
#include "w32_bcrypt.h"
static uint32_t genrandom(void) {
    uint64_t provider = ARG64(0), dst = ARG64(1);
    uint32_t n = ARG(2), flags = ARG(3);
    if (flags & ~3u) return 0xc000000du; /* STATUS_INVALID_PARAMETER; entropy-in-buffer is ignored on Win8+ */
    if ((flags & 2u) ? provider != 0 : provider != 0x81u) return 0xc0000008u;
    if (dst > UINT32_MAX || (!dst && n) || (n && !x86_mapped((uint32_t)dst, n))) return 0xc000000du;
    uint8_t bytes[256];
    for (uint32_t off = 0; off < n;) {
        uint32_t count = n - off < sizeof bytes ? n - off : sizeof bytes;
        if (bgt_random_bytes(bytes, count)) return 0xc00000bbu; /* no entropy provider */
        for (uint32_t i = 0; i < count; i++) x86_wr8((uint32_t)dst + off + i, bytes[i]);
        off += count;
    }
    return 0;
}
#define API(n,a,f) {n,a,0,f}
const w32_api_t w32_api_bcrypt[] = { API("BCryptGenRandom",4,genrandom) };
const uint32_t w32_api_bcrypt_n = sizeof w32_api_bcrypt / sizeof w32_api_bcrypt[0];
