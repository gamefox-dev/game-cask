/* Helpers for specialized AMD64 emission. No unchecked guest pointers. SPDX-License-Identifier: MIT */
#ifndef X86_LIFT64_H
#define X86_LIFT64_H
#include "x86_retire.h"
#include "x86_sem64.h"
#include "x86_sse.h"
#include "x86_simd_fault.h"
#include "x86_atomic.h"
/* Cleared/consumed by the registry before any callback or suspension. Lifted register-local
 * frames return at generic and quantum boundaries rather than adding Asyncify stack frames. */
extern const x86_insn_t *x86_lift_pending;
extern uint32_t x86_lift_count;
extern unsigned x86_lift_reason;
void x86_lift_block(uint32_t count);
void x86_lift_thunk(void);
static inline int xl_contains(const uint32_t *entries, unsigned n, uint32_t pc) {
    unsigned lo = 0, hi = n;
    while (lo < hi) { unsigned m = (lo + hi) / 2; if (entries[m] < pc) lo = m + 1; else hi = m; }
    return lo < n && entries[lo] == pc;
}

/* Returning NULL sends generated code to its single spill/fault boundary. The slow operation there
 * retains the reference's diagnostic and partial cross-page-store behaviour. No host pointer is cached
 * across a call, memory growth, yield, exception or generic instruction. */
static __attribute__((noinline)) uint8_t *xl_pointer_full(uint64_t a, unsigned n, unsigned access) {
#ifdef X86_FLAT_GUEST
    if (!n || a >= X86_FLAT_BYTES || n > X86_FLAT_BYTES - a || !x86_pages[a >> 12] ||
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
static __attribute__((noinline,cold)) uint8_t *xl_pointer_slow(uint64_t a, unsigned n, unsigned access) {
    return xl_pointer_full(a, n, access);
}
/* The common operand needs one page lookup, not a call plus two endpoint lookups.
 * Keep the full-width range check: wasm bounds alone cannot detect unmapped guest holes,
 * and truncating a high guest pointer could alias a valid low mapping. */
static inline __attribute__((always_inline)) uint8_t *xl_pointer_access(uint64_t a, unsigned n, unsigned access) {
#ifdef X86_FLAT_GUEST
    if (__builtin_expect(a < X86_FLAT_BYTES && n && n <= X86_PAGE - (a & (X86_PAGE - 1u)) &&
            x86_pages[a >> 12] && !x86_protection[a >> 12], 1))
        return x86_flat + (uint32_t)a;
#endif
    return xl_pointer_slow(a, n, access);
}
/* Default operand/span sites also specialize their constant width/access. */
static inline __attribute__((always_inline)) uint8_t *xl_pointer_checked(uint64_t a, unsigned n, unsigned access) {
    return xl_pointer_access(a, n, access);
}
static inline uint8_t *xl_pointer(uint64_t a,unsigned n) { return xl_pointer_checked(a,n,3); }
static inline uint8_t *xl_pointer_fast(uint64_t a,unsigned n) { return xl_pointer_access(a,n,3); }
/* Only whole-block guards, behind !x86_protection_active. Spans are at most
 * one page long: endpoint mappings prove every covered page. The operands form
 * their own host addresses; no unused host pointer is returned. */
static inline __attribute__((always_inline)) int xl_span(uint64_t a, unsigned n) {
#ifdef X86_FLAT_GUEST
    return n && n <= X86_PAGE && a < X86_FLAT_BYTES && n <= X86_FLAT_BYTES - a &&
        x86_pages[a >> 12] && x86_pages[(a + n - 1) >> 12];
#else
    (void)a; (void)n; return 0;
#endif
}
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
/* Keep lifted parity inline; only AL contributes. The reference stays independent. */
static inline __attribute__((always_inline)) int xl_parity(uint32_t v) {
    return !__builtin_parity(v & 255u);
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
    if ((live & F_PF) && xl_parity((uint32_t)r)) f |= F_PF;
    *flags = (*flags & ~live) | f;
    return r;
}
/* Full-flag sites are constant-op/width call sites. Inline the wrapper so the
 * always-inline xl_alu can constant-fold its dispatch and flag masks; keep the
 * generated helper spelling for size-policy compatibility and diagnostics. */
static inline __attribute__((always_inline)) uint64_t xl_alu_full(int op, uint64_t a, uint64_t b, int n, uint32_t *flags) {
    return xl_alu(op, a, b, n, flags, F_CF | F_PF | F_AF | F_ZF | F_SF | F_OF);
}
/* Constant opcode/width shifts keep flags in the region local. The oversized
 * count and OF choices match the reference, including its deterministic choices
 * for architecturally undefined flags. Carry rotates retain the shared helper. */
static inline __attribute__((always_inline)) uint64_t xl_shift(int op, uint64_t a, uint32_t c, int n, uint32_t *flags) {
    unsigned bits = (unsigned)n * 8;
    uint64_t m = x64_mask(n), sign = 1ull << (bits - 1), r;
    uint32_t cf, of;
    a &= m; c &= n == 8 ? 63 : 31;
    if (!c) return a;
    if (op == XO_SHL || op == XO_SAL) {
        r = c >= bits ? 0 : (a << c) & m;
        cf = c <= bits && ((a >> (bits - c)) & 1);
        of = !!(r & sign) ^ cf;
    } else if (op == XO_SHR) {
        r = c >= bits ? 0 : a >> c;
        cf = c <= bits && ((a >> (c - 1)) & 1);
        of = !!(a & sign);
    } else {
        unsigned k = c >= bits ? bits - 1 : c;
        int64_t sa = (int64_t)x64_sext(a, n);
        r = (uint64_t)(sa >> k) & m;
        cf = (sa >> (k - 1)) & 1; of = 0;
    }
    *flags = (*flags & ~(F_CF | F_OF | F_ZF | F_SF | F_PF)) |
        (cf ? F_CF : 0) | (of ? F_OF : 0) | (!r ? F_ZF : 0) |
        ((r & sign) ? F_SF : 0) | (xl_parity((uint32_t)r) ? F_PF : 0);
    return r;
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
