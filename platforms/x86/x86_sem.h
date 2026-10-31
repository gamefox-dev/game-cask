/*
 * Instruction semantics shared by the interpreter and lifted code (one source of truth, so the
 * differential oracle tests control-flow lifting rather than two semantic implementations).
 * Generic IA-32 integer behaviour per the Intel SDM. Harvested from the first Solitaire trial's
 * interpreter and generalised.
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef X86_SEM_H
#define X86_SEM_H

#include "x86.h"

static const uint32_t X86_MASK[5] = {0, 0xffu, 0xffffu, 0, 0xffffffffu};
static const uint32_t X86_SIGN[5] = {0, 0x80u, 0x8000u, 0, 0x80000000u};

static inline uint32_t xs_sext(uint32_t v, int sz) {
    return sz == 1 ? (uint32_t)(int32_t)(int8_t)v : sz == 2 ? (uint32_t)(int32_t)(int16_t)v : v;
}
static inline uint32_t xs_getreg(int r, int sz) {
    if (sz == 4) return X.r[r];
    if (sz == 2) return X.r[r] & 0xffffu;
    return r < 4 ? X.r[r] & 0xffu : (X.r[r - 4] >> 8) & 0xffu;
}
static inline void xs_setreg(int r, int sz, uint32_t v) {
    if (sz == 4) X.r[r] = v;
    else if (sz == 2) X.r[r] = (X.r[r] & 0xffff0000u) | (v & 0xffffu);
    else if (r < 4) X.r[r] = (X.r[r] & 0xffffff00u) | (v & 0xffu);
    else X.r[r - 4] = (X.r[r - 4] & 0xffff00ffu) | ((v & 0xffu) << 8);
}
static inline uint32_t xs_rdn(uint32_t a, int sz) { return sz == 4 ? x86_rd32(a) : sz == 2 ? x86_rd16(a) : x86_rd8(a); }
static inline void xs_wrn(uint32_t a, uint32_t v, int sz) { if (sz == 4) x86_wr32(a, v); else if (sz == 2) x86_wr16(a, v); else x86_wr8(a, v); }

static inline uint32_t xs_ea(const x86_opnd_t *o) {
    uint32_t a = (uint32_t)o->disp;
    if (o->base != X86_NOREG) a += X.r[o->base];
    if (o->index != X86_NOREG) a += X.r[o->index] << o->scale;
    if (o->seg_fs) a += X.fs_base;
    return a;
}
static inline uint32_t xs_read(const x86_opnd_t *o) {
    if (o->kind == XK_REG) return xs_getreg(o->reg, o->size);
    if (o->kind == XK_IMM) return o->imm & X86_MASK[o->size];
    return xs_rdn(xs_ea(o), o->size);
}
static inline void xs_write(const x86_opnd_t *o, uint32_t v) {
    if (o->kind == XK_REG) xs_setreg(o->reg, o->size, v);
    else xs_wrn(xs_ea(o), v, o->size);
}

static inline int xs_parity(uint32_t v) { v &= 0xffu; v ^= v >> 4; v ^= v >> 2; v ^= v >> 1; return !(v & 1u); }
static inline void xs_setf(uint32_t f, int on) { if (on) X.flags |= f; else X.flags &= ~f; }
static inline void xs_szp(uint32_t r, int sz) {
    r &= X86_MASK[sz];
    X.flags &= ~(F_ZF | F_SF | F_PF);
    if (!r) X.flags |= F_ZF;
    if (r & X86_SIGN[sz]) X.flags |= F_SF;
    if (xs_parity(r)) X.flags |= F_PF;
}

/* op: XO_ADD..XO_CMP */
static inline uint32_t xs_alu(int op, uint32_t a, uint32_t b, int sz) {
    uint32_t m = X86_MASK[sz], s = X86_SIGN[sz], r = 0, c = X.flags & F_CF;
    a &= m; b &= m;
    switch (op) {
    case XO_ADD: r = (a + b) & m; xs_setf(F_CF, r < a); xs_setf(F_OF, (a ^ r) & (b ^ r) & s); break;
    case XO_ADC: { uint64_t t = (uint64_t)a + b + c; r = (uint32_t)t & m; xs_setf(F_CF, t > m); xs_setf(F_OF, (a ^ r) & (b ^ r) & s); break; }
    case XO_SBB: { uint64_t bb = (uint64_t)b + c; r = (uint32_t)(a - bb) & m; xs_setf(F_CF, (uint64_t)a < bb); xs_setf(F_OF, (a ^ b) & (a ^ r) & s); break; }
    case XO_SUB: case XO_CMP: r = (a - b) & m; xs_setf(F_CF, a < b); xs_setf(F_OF, (a ^ b) & (a ^ r) & s); break;
    case XO_OR: r = a | b; X.flags &= ~(F_CF | F_OF); break;
    case XO_AND: r = a & b; X.flags &= ~(F_CF | F_OF); break;
    case XO_XOR: r = a ^ b; X.flags &= ~(F_CF | F_OF); break;
    default: break;
    }
    xs_setf(F_AF, (a ^ b ^ r) & 0x10u);
    xs_szp(r, sz);
    return r;
}

/* op: XO_ROL..XO_SAR */
static inline uint32_t xs_shift(int op, uint32_t a, uint32_t cnt, int sz) {
    int bits = sz * 8;
    uint32_t m = X86_MASK[sz], s = X86_SIGN[sz];
    a &= m;
    cnt &= 31u;
    if (!cnt) return a;
    uint32_t r = a;
    switch (op) {
    case XO_ROL: { uint32_t k = cnt % (uint32_t)bits; r = k ? ((a << k) | (a >> (bits - (int)k))) & m : a; xs_setf(F_CF, r & 1u); xs_setf(F_OF, ((r & s) != 0) ^ (r & 1u)); return r; }
    case XO_ROR: { uint32_t k = cnt % (uint32_t)bits; r = k ? ((a >> k) | (a << (bits - (int)k))) & m : a; xs_setf(F_CF, (r & s) != 0); xs_setf(F_OF, ((r ^ (r << 1)) & s) != 0); return r; }
    case XO_RCL: for (uint32_t i = 0; i < cnt; i++) { uint32_t cf = (r & s) != 0; r = ((r << 1) | (X.flags & F_CF)) & m; xs_setf(F_CF, (int)cf); } xs_setf(F_OF, ((r & s) != 0) ^ ((X.flags & F_CF) != 0)); return r;
    case XO_RCR: for (uint32_t i = 0; i < cnt; i++) { uint32_t cf = r & 1u; r = (r >> 1) | ((X.flags & F_CF) ? s : 0); xs_setf(F_CF, (int)cf); } xs_setf(F_OF, ((r ^ (r << 1)) & s) != 0); return r;
    case XO_SHL: case XO_SAL: r = cnt >= (uint32_t)bits ? 0 : (a << cnt) & m; xs_setf(F_CF, cnt <= (uint32_t)bits && ((a >> (bits - (int)cnt)) & 1u)); xs_setf(F_OF, ((r & s) != 0) ^ ((X.flags & F_CF) != 0)); break;
    case XO_SHR: r = cnt >= (uint32_t)bits ? 0 : a >> cnt; xs_setf(F_CF, cnt <= (uint32_t)bits && ((a >> (cnt - 1)) & 1u)); xs_setf(F_OF, (a & s) != 0); break;
    case XO_SAR: { int32_t sa = (int32_t)xs_sext(a, sz); uint32_t k = cnt > (uint32_t)bits - 1 ? (uint32_t)bits - 1 : cnt; r = (uint32_t)(sa >> k) & m; xs_setf(F_CF, (sa >> (k - (cnt > k ? 0 : 1))) & 1); X.flags &= ~F_OF; break; }
    default: break;
    }
    xs_szp(r, sz);
    return r;
}

static inline int xs_cond(int cc) {
    uint32_t f = X.flags;
    int cf = !!(f & F_CF), zf = !!(f & F_ZF), sf = !!(f & F_SF), of = !!(f & F_OF), pf = !!(f & F_PF), r;
    switch (cc >> 1) {
    case 0: r = of; break;
    case 1: r = cf; break;
    case 2: r = zf; break;
    case 3: r = cf || zf; break;
    case 4: r = sf; break;
    case 5: r = pf; break;
    case 6: r = sf != of; break;
    default: r = zf || (sf != of); break;
    }
    return (cc & 1) ? !r : r;
}

static inline void xs_imul_flags(int64_t full, uint32_t trunc, int sz) {
    int64_t back = (int64_t)(int32_t)xs_sext(trunc & X86_MASK[sz], sz);
    int ov = back != full;
    xs_setf(F_CF, ov); xs_setf(F_OF, ov);
    xs_szp(trunc, sz);
}

/* MUL/IMUL1/DIV/IDIV with implicit EAX/EDX; returns 0 or a fault message */
static inline const char *xs_muldiv(int op, uint32_t v, int sz) {
    uint32_t mk = X86_MASK[sz];
    v &= mk;
    if (op == XO_MUL || op == XO_IMUL1) {
        int sg = op == XO_IMUL1;
        if (sz == 1) {
            uint32_t al = X.r[EAX] & 0xffu;
            uint32_t r = !sg ? al * v : (uint32_t)((int32_t)(int8_t)al * (int32_t)(int8_t)v);
            xs_setreg(EAX, 2, r);
            int ov = !sg ? (r & 0xff00u) != 0 : (int32_t)(int16_t)r != (int32_t)(int8_t)r;
            xs_setf(F_CF, ov); xs_setf(F_OF, ov);
        } else if (sz == 2) {
            uint32_t ax = X.r[EAX] & 0xffffu;
            uint32_t r = !sg ? ax * v : (uint32_t)((int32_t)(int16_t)ax * (int32_t)(int16_t)v);
            xs_setreg(EAX, 2, r); xs_setreg(EDX, 2, r >> 16);
            int ov = !sg ? (r >> 16) != 0 : (int32_t)(int16_t)r != (int32_t)r;
            xs_setf(F_CF, ov); xs_setf(F_OF, ov);
        } else {
            uint64_t r = !sg ? (uint64_t)X.r[EAX] * v : (uint64_t)((int64_t)(int32_t)X.r[EAX] * (int64_t)(int32_t)v);
            X.r[EAX] = (uint32_t)r; X.r[EDX] = (uint32_t)(r >> 32);
            int ov = !sg ? X.r[EDX] != 0 : (int64_t)r != (int64_t)(int32_t)(uint32_t)r;
            xs_setf(F_CF, ov); xs_setf(F_OF, ov);
        }
        return 0;
    }
    if (!v) return "divide by zero";
    if (sz == 4) {
        uint64_t n = ((uint64_t)X.r[EDX] << 32) | X.r[EAX];
        if (op == XO_DIV) {
            uint64_t q = n / v;
            if (q > 0xffffffffu) return "divide overflow";
            X.r[EAX] = (uint32_t)q; X.r[EDX] = (uint32_t)(n % v);
        } else {
            int64_t sn = (int64_t)n, d = (int32_t)v;
            if (d == -1 && sn == (int64_t)0x8000000000000000ull) return "divide overflow";
            int64_t q = sn / d;
            if (q > 0x7fffffff || q < -0x7fffffff - 1) return "divide overflow";
            X.r[EAX] = (uint32_t)q; X.r[EDX] = (uint32_t)(sn % d);
        }
    } else if (sz == 2) {
        uint32_t n = ((X.r[EDX] & 0xffffu) << 16) | (X.r[EAX] & 0xffffu);
        if (op == XO_DIV) { uint32_t q = n / v; if (q > 0xffffu) return "divide overflow"; xs_setreg(EAX, 2, q); xs_setreg(EDX, 2, n % v); }
        else { int32_t sn = (int32_t)n, d = (int16_t)v, q = sn / d; if (q > 32767 || q < -32768) return "divide overflow"; xs_setreg(EAX, 2, (uint32_t)q); xs_setreg(EDX, 2, (uint32_t)(sn % d)); }
    } else {
        uint32_t n = X.r[EAX] & 0xffffu;
        if (op == XO_DIV) { uint32_t q = n / v; if (q > 0xffu) return "divide overflow"; xs_setreg(EAX, 1, q); xs_setreg(4, 1, n % v); }
        else { int32_t sn = (int16_t)n, d = (int8_t)v, q = sn / d; if (q > 127 || q < -128) return "divide overflow"; xs_setreg(EAX, 1, (uint32_t)q); xs_setreg(4, 1, (uint32_t)(sn % d)); }
    }
    return 0;
}

/* LANE-K5a: implicit operands shared by both widths and both execution modes.
 * Address size selects the index/count aliases, NOT the element width. */
static inline uint64_t xs_string_mask(int asz) {
    return asz == 2 ? UINT16_MAX : asz == 4 ? UINT32_MAX : UINT64_MAX;
}
static inline void xs_string_advance(int reg, int asz, int delta) {
    uint64_t mask = xs_string_mask(asz), value = (X.r[reg] + delta) & mask;
    X.r[reg] = asz == 2 ? (X.r[reg] & ~mask) | value : value;
}
static inline uint32_t xs_string_address(int reg, int asz, int seg) {
    uint64_t address = X.r[reg] & xs_string_mask(asz);
    address += seg == 1 ? X.fs_base : seg == 2 ? X.gs_base : 0;
    return X.mode64 ? x86_address(address) : (uint32_t)address;
}
static inline uint64_t xs_string_load(uint32_t address, int sz) {
    return sz == 8 ? x86_rd64(address) : xs_rdn(address, sz);
}
static inline void xs_string(int op, int sz, int rep, int asz,
                             uint32_t addr, uint32_t next, int seg) {
    int source = op == XO_MOVS || op == XO_LODS || op == XO_CMPS;
    int dest = op == XO_MOVS || op == XO_STOS || op == XO_CMPS || op == XO_SCAS;
    int compare = op == XO_CMPS || op == XO_SCAS;
    int delta = (X.flags & F_DF) ? -sz : sz;
    uint64_t mask = sz == 8 ? UINT64_MAX : (1ull << (sz * 8)) - 1;
    uint32_t initial_flags = X.flags, completed_flags = X.flags;
    /* A fault or quantum transfer must identify the string, not its successor.
     * No operand (even an address) is evaluated for a zero repeat count. */
    X.eip = addr;
    while (!rep || (X.r[ECX] & xs_string_mask(asz))) {
        if (++X.frame_insns > 2000000u) {
#if defined(X86_WIDE_CPU) && !defined(X86_FLAT_GUEST)
            /* Standalone semantic probes do not install a runtime scheduler. */
            x86_fault("string instruction budget exhausted", addr);
#else
            /* Interrupt/quantum state observes the last completed comparison,
             * unlike the special pre-instruction EFLAGS rollback on a fault. */
            X.flags = completed_flags;
            x86_cooperate();
            if (X.transfer) return;
            initial_flags = X.flags; /* resumed instruction's fault baseline */
#endif
        }
        uint32_t si = 0, di = 0;
        if (source) { si = xs_string_address(ESI, asz, seg); x86_check_access(si, sz, 1); }
        if (dest) {
            di = xs_string_address(EDI, asz, 0); /* ES, never the source segment override. */
            x86_check_access(di, sz, op == XO_MOVS || op == XO_STOS ? 2 : 1);
        }
        uint64_t value = source ? xs_string_load(si, sz) : X.r[EAX] & mask;
        uint32_t result_flags = initial_flags;
        if (compare) {
            uint64_t rhs = xs_string_load(di, sz), result = (value - rhs) & mask;
            /* CMP flags, including the qword form; do not publish them until
             * completion. REPE/REPNE faults restore pre-instruction EFLAGS. */
            uint64_t sign = 1ull << (sz * 8 - 1);
            xs_setf(F_CF, value < rhs); xs_setf(F_OF, !!((value ^ rhs) & (value ^ result) & sign));
            xs_setf(F_AF, !!((value ^ rhs ^ result) & 16)); xs_setf(F_ZF, result == 0);
            xs_setf(F_SF, !!(result & sign)); xs_setf(F_PF, xs_parity((uint32_t)result));
            result_flags = completed_flags = X.flags;
            X.flags = initial_flags;
        } else if (op == XO_LODS) {
            X.r[EAX] = sz >= 4 ? value : (X.r[EAX] & ~mask) | value;
        } else if (sz == 8) x86_wr64(di, value);
        else xs_wrn(di, (uint32_t)value, sz);
        /* Commit only a completed iteration. Unused registers are never written. */
        if (source) xs_string_advance(ESI, asz, delta);
        if (dest) xs_string_advance(EDI, asz, delta);
        if (rep) xs_string_advance(ECX, asz, -1);
        if (!rep || !(X.r[ECX] & xs_string_mask(asz)) || (compare &&
            ((rep == 0xf3 && !(result_flags & F_ZF)) || (rep == 0xf2 && (result_flags & F_ZF))))) {
            X.flags = result_flags;
            break;
        }
    }
    X.eip = next;
}

#endif
