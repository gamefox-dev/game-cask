/* AMD64 read/modify/write transactions for the cooperative single-worker guest.
 * SPDX-License-Identifier: MIT
 * No helper in a transaction may yield, call guest/host APIs, or grow guest memory.
 * The scheduler runs only before/after an instruction. Fences also prohibit compiler/host
 * reordering across LOCK (and implicit memory XCHG). This is NOT a shared-worker memory
 * implementation: parallel wasm workers would require a common lock for ALL guest accesses.
 */
#ifndef X86_ATOMIC_H
#define X86_ATOMIC_H
#include "x86_sem64.h"
static inline void xa_fence(void) { __atomic_thread_fence(__ATOMIC_SEQ_CST); }
/* Validate the entire write cycle, even for a failed compare. Never partially store,
 * change flags, or overwrite an address register before validation. CX16 requires 16B alignment. */
static inline uint32_t xa_check(uint64_t address, unsigned n) {
    uint32_t a = x86_address(address);
    if (n == 16 && (a & 15)) x86_fault("unaligned CMPXCHG16B", a);
#ifdef X86_FLAT_GUEST
    if (address >= X86_FLAT_BYTES || n > X86_FLAT_BYTES - address)
        x86_fault("unmapped flat guest memory", a);
#endif
    x86_check_access(a, n, 3);
    return a;
}
/* Capture EA once: source/result registers can also be the destination's base/index. */
static inline void xa_exec(const x86_insn_t *in) {
    const x86_opnd_t *a = &in->o[0], *b = &in->o[1];
    int n = a->size;
    uint64_t address = a->kind == XK_MEM ? x64_calc_ea(a) : 0;
    int bitop = in->op == XO_BTS || in->op == XO_BTR || in->op == XO_BTC;
    uint64_t bit = bitop ? x64_read(b) : 0;
    if (bitop && b->kind == XK_REG)
        address += (uint64_t)(((int64_t)x64_sext(bit,n) >> (n == 8 ? 6 : n == 4 ? 5 : 4)) * n);
    uint32_t p = a->kind == XK_MEM ? xa_check(address, (unsigned)n) : 0;
    xa_fence();
    if (in->op == XO_CMPXCHG_PAIR) {
        uint64_t lo = x86_rd64(p), hi = n == 16 ? x86_rd64(p + 8) : 0;
        uint64_t cmp = n == 16 ? X.r[EAX] : ((uint64_t)(uint32_t)X.r[EDX] << 32) | (uint32_t)X.r[EAX];
        int same = lo == cmp && (n != 16 || hi == X.r[EDX]);
        if (same) {
            x86_wr64(p, n == 16 ? X.r[EBX] : ((uint64_t)(uint32_t)X.r[ECX] << 32) | (uint32_t)X.r[EBX]);
            if (n == 16) x86_wr64(p + 8, X.r[ECX]);
        } else {
            /* Failed CMPXCHG is still a write cycle (to the same bytes). */
            x86_wr64(p, lo); if (n == 16) x86_wr64(p + 8, hi);
            X.r[EAX] = n == 16 ? lo : (uint32_t)lo;
            X.r[EDX] = n == 16 ? hi : (uint32_t)(lo >> 32);
        }
        xs_setf(F_ZF, same);
    } else {
        uint64_t old = a->kind == XK_MEM ? x64_load(p, n) : x64_read(a);
        uint64_t src = in->nops > 1 ? x64_read(b) : 0, result = old;
        if (bitop) {
            uint64_t mask = 1ull << (bit & (n * 8 - 1));
            xs_setf(F_CF, !!(old & mask));
            result = in->op == XO_BTS ? old | mask : in->op == XO_BTR ? old & ~mask : old ^ mask;
        } else if (in->op == XO_CMPXCHG) {
            x64_alu(XO_CMP, x64_reg(EAX, n), old, n);
            if (X.flags & F_ZF) result = src; else x64_set(EAX, n, old);
        } else if (in->op == XO_XADD) {
            result = x64_alu(XO_ADD, old, src, n); x64_write(b, old);
        } else if (in->op == XO_XCHG) { result = src; }
        else if (in->op == XO_NOT) result = ~old;
        else if (in->op == XO_NEG) result = x64_alu(XO_SUB, 0, old, n);
        else if (in->op == XO_INC || in->op == XO_DEC) {
            uint32_t cf = X.flags & F_CF;
            result = x64_alu(in->op == XO_INC ? XO_ADD : XO_SUB, old, 1, n);
            X.flags = (X.flags & ~F_CF) | cf;
        } else result = x64_alu(in->op, old, src, n);
        if (a->kind == XK_MEM) x64_store(p, result, n); else x64_write(a, result);
        if (in->op == XO_XCHG) x64_write(b, old);
    }
    xa_fence();
}
#endif
