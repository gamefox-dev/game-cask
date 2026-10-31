/* Helpers for specialized AMD64 emission. No unchecked guest pointers. SPDX-License-Identifier: MIT */
#ifndef X86_LIFT64_H
#define X86_LIFT64_H
#include "x86_sem64.h"
/* Cleared/consumed by the registry before any callback or suspension. Lifted register-local
 * frames return at generic and quantum boundaries rather than adding Asyncify stack frames. */
extern const x86_insn_t *x86_lift_pending;
extern uint32_t x86_lift_count;
void x86_lift_block(uint32_t count);
static inline int xl_contains(const uint32_t *entries, unsigned n, uint32_t pc) {
    unsigned lo = 0, hi = n;
    while (lo < hi) { unsigned m = (lo + hi) / 2; if (entries[m] < pc) lo = m + 1; else hi = m; }
    return lo < n && entries[lo] == pc;
}

/* Returning NULL sends generated code to its single spill/fault boundary. The slow operation there
 * retains the reference's diagnostic and partial cross-page-store behaviour. No host pointer is cached
 * across a call, memory growth, yield, exception or generic instruction. */
static __attribute__((noinline)) uint8_t *xl_pointer_access(uint64_t a, unsigned n, unsigned access) {
#ifdef X86_FLAT_GUEST
    if (a + n < a || a + n > X86_FLAT_BYTES || !x86_pages[a >> 12] ||
        !x86_pages[(a + n - 1) >> 12]) return 0;
    /* Whole-block guards request read/write; operand guards request their actual access.
     * Validate every page for cross-page spans, including holes/protection in the middle. */
    if (((a>>12)!=((a+n-1)>>12) || x86_protection[a >> 12]) &&
        !x86_accessible((uint32_t)a,n,access)) return 0;
    return x86_flat + (uint32_t)a;
#else
    (void)a; (void)n; (void)access; return 0;
#endif
}
static inline uint8_t *xl_pointer(uint64_t a,unsigned n) { return xl_pointer_access(a,n,3); }
static inline __attribute__((always_inline)) uint64_t xl_load(const uint8_t *p, int n) {
    uint64_t v = 0;
    if (n == 8) __builtin_memcpy(&v, p, 8);
    else if (n == 4) { uint32_t x; __builtin_memcpy(&x, p, 4); v = x; }
    else if (n == 2) { uint16_t x; __builtin_memcpy(&x, p, 2); v = x; }
    else v = *p;
    return v;
}
static inline __attribute__((always_inline)) void xl_store(uint8_t *p, uint64_t v, int n) {
    if (n == 8) __builtin_memcpy(p, &v, 8);
    else if (n == 4) { uint32_t x = (uint32_t)v; __builtin_memcpy(p, &x, 4); }
    else if (n == 2) { uint16_t x = (uint16_t)v; __builtin_memcpy(p, &x, 2); }
    else *p = (uint8_t)v;
}
/* Constant op/size/live arguments let clang remove both dispatch and unobserved flag work. */
static inline __attribute__((always_inline)) uint64_t xl_alu(int op, uint64_t a, uint64_t b, int n,
        uint32_t *flags, uint32_t live) {
    uint64_t m = x64_mask(n), s = 1ull << (n * 8 - 1), r, c = *flags & F_CF;
    uint32_t f = 0;
    a &= m; b &= m;
    if (op == XO_ADD || op == XO_ADC) {
        uint64_t t = (a + b) & m;
        r = (t + (op == XO_ADC ? c : 0)) & m;
        if ((live & F_CF) && (t < a || r < t)) f |= F_CF;
        if ((live & F_OF) && ((a ^ r) & (b ^ r) & s)) f |= F_OF;
    } else if (op == XO_SUB || op == XO_CMP || op == XO_SBB) {
        uint64_t t = (b + (op == XO_SBB ? c : 0)) & m;
        r = (a - t) & m;
        if ((live & F_CF) && (a < t || t < b)) f |= F_CF;
        if ((live & F_OF) && ((a ^ b) & (a ^ r) & s)) f |= F_OF;
    } else r = op == XO_OR ? a | b : op == XO_XOR ? a ^ b : a & b;
    if ((live & F_AF) && ((a ^ b ^ r) & 16)) f |= F_AF;
    if ((live & F_ZF) && !r) f |= F_ZF;
    if ((live & F_SF) && (r & s)) f |= F_SF;
    if ((live & F_PF) && xs_parity((uint32_t)r)) f |= F_PF;
    *flags = (*flags & ~live) | f;
    return r;
}
static __attribute__((noinline)) uint64_t xl_alu_full(int op, uint64_t a, uint64_t b, int n, uint32_t *flags) {
    return xl_alu(op, a, b, n, flags, F_CF | F_PF | F_AF | F_ZF | F_SF | F_OF);
}
/* Keep wide overflow arithmetic out of every call site; wasm has no native i128 multiply. */
static __attribute__((noinline)) uint64_t xl_imul(uint64_t a, uint64_t b, int n, uint32_t *flags) {
    __int128 full = (__int128)(int64_t)x64_sext(a, n) * (int64_t)x64_sext(b, n);
    uint64_t r = (uint64_t)full & x64_mask(n);
    int ov = full != (__int128)(int64_t)x64_sext(r, n);
    *flags = (*flags & ~(F_CF | F_OF)) | (ov ? F_CF | F_OF : 0);
    return r;
}
static inline __attribute__((always_inline)) int xl_cond(unsigned cc, uint32_t f) {
    int cf = !!(f & F_CF), zf = !!(f & F_ZF), sf = !!(f & F_SF), of = !!(f & F_OF);
    switch (cc) {
    case 0: return of; case 1: return !of; case 2: return cf; case 3: return !cf;
    case 4: return zf; case 5: return !zf; case 6: return cf || zf; case 7: return !cf && !zf;
    case 8: return sf; case 9: return !sf; case 10: return !!(f & F_PF); case 11: return !(f & F_PF);
    case 12: return sf != of; case 13: return sf == of;
    case 14: return zf || sf != of; default: return !zf && sf == of;
    }
}
#endif
