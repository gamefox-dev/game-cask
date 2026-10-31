/*
 * x86-32 interpreter: executes decoded instructions with the shared semantics (x86_sem.h).
 * Serves as the differential oracle for lifted code and as the fallback for code that could
 * not be lifted (unresolved indirect targets, unsupported encodings inside lifted functions).
 *
 * SPDX-License-Identifier: MIT
 */
#include "x86_sem.h"

/* Execute `in` (located at in->addr); sets X.eip to the next instruction or branch target.
 * Calls into lifted functions directly. */
void x86_exec_insn(const x86_insn_t *in) {
#ifdef X86_FLAT_GUEST
    x86_exec64(in);return;
#endif
    const x86_opnd_t *a = &in->o[0], *b = &in->o[1], *c = &in->o[2];
    uint32_t next = in->addr + in->len;
    int sz = a->size ? a->size : 4;
    X.eip = next;
    switch (in->op) {
    case XO_ADD: case XO_OR: case XO_ADC: case XO_SBB: case XO_AND: case XO_SUB: case XO_XOR: {
        uint32_t r = xs_alu(in->op, xs_read(a), xs_read(b), sz);
        xs_write(a, r);
        return;
    }
    case XO_CMP: xs_alu(XO_CMP, xs_read(a), xs_read(b), sz); return;
    case XO_TEST: xs_alu(XO_AND, xs_read(a), xs_read(b), sz); return;
    case XO_ROL: case XO_ROR: case XO_RCL: case XO_RCR: case XO_SHL: case XO_SHR: case XO_SAL: case XO_SAR:
        xs_write(a, xs_shift(in->op, xs_read(a), xs_read(b), sz)); return;
    case XO_INC: case XO_DEC: {
        uint32_t cf = X.flags & F_CF;
        xs_write(a, xs_alu(in->op == XO_INC ? XO_ADD : XO_SUB, xs_read(a), 1, sz));
        X.flags = (X.flags & ~F_CF) | cf;
        return;
    }
    case XO_NEG: { uint32_t v = xs_read(a); uint32_t r = xs_alu(XO_SUB, 0, v, sz); xs_write(a, r); xs_setf(F_CF, (v & X86_MASK[sz]) != 0); return; }
    case XO_NOT: xs_write(a, ~xs_read(a) & X86_MASK[sz]); return;
    case XO_MUL: case XO_IMUL1: case XO_DIV: case XO_IDIV: {
        const char *e = xs_muldiv(in->op, xs_read(a), sz);
        if (e) x86_fault(e, in->addr);
        return;
    }
    case XO_IMUL: {
        uint32_t x = in->nops == 3 ? xs_read(b) : xs_read(a), y = in->nops == 3 ? c->imm : xs_read(b);
        int64_t full = (int64_t)(int32_t)xs_sext(x, sz) * (int64_t)(int32_t)xs_sext(y & X86_MASK[sz], sz);
        uint32_t t = (uint32_t)full & X86_MASK[sz];
        xs_write(a, t);
        xs_imul_flags(full, t, sz);
        return;
    }
    case XO_MOV: xs_write(a, xs_read(b)); return;
    case XO_MOVZX: xs_write(a, xs_read(b)); return;
    case XO_MOVSX: xs_write(a, xs_sext(xs_read(b), b->size)); return;
    case XO_LEA: xs_write(a, xs_ea(b)); return;
    case XO_XCHG: { uint32_t x = xs_read(a), y = xs_read(b); xs_write(a, y); xs_write(b, x); return; }
    case XO_XADD: { uint32_t x = xs_read(a), y = xs_read(b); uint32_t r = xs_alu(XO_ADD, x, y, sz); xs_write(b, x); xs_write(a, r); return; }
    case XO_CMPXCHG: {
        uint32_t d = xs_read(a);
        xs_alu(XO_CMP, xs_getreg(EAX, sz), d, sz);
        if (X.flags & F_ZF) xs_write(a, xs_read(b)); else xs_setreg(EAX, sz, d);
        return;
    }
    case XO_PUSH: {
        uint32_t v = a->kind == XK_IMM ? a->imm : xs_read(a);
        if (in->osz == 2) { X.r[ESP] -= 2; x86_wr16(X.r[ESP], v); } else x86_push(v);
        return;
    }
    case XO_POP: {
        uint32_t v;
        if (in->osz == 2) { v = x86_rd16(X.r[ESP]); X.r[ESP] += 2; } else v = x86_pop();
        xs_write(a, v); /* pop [esp+x] uses ESP after increment, as on hardware */
        return;
    }
    case XO_PUSHA: { uint32_t sp = X.r[ESP]; for (int i = 0; i < 8; i++) x86_push(i == ESP ? sp : X.r[i]); return; }
    case XO_POPA: for (int i = 7; i >= 0; i--) { uint32_t v = x86_pop(); if (i != ESP) X.r[i] = v; } return;
    case XO_PUSHF: x86_push(X.flags | 2u); return;
    case XO_POPF: X.flags = x86_pop() & 0xcd5u; return;
    case XO_SAHF: X.flags = (X.flags & ~0xd5u) | ((X.r[EAX] >> 8) & 0xd5u); return;
    case XO_LAHF: xs_setreg(4, 1, (X.flags & 0xd5u) | 2u); return;
    case XO_CWDE: if (in->osz == 4) X.r[EAX] = xs_sext(X.r[EAX] & 0xffffu, 2); else xs_setreg(EAX, 2, xs_sext(X.r[EAX] & 0xffu, 1)); return;
    case XO_CDQ: if (in->osz == 4) X.r[EDX] = (X.r[EAX] & 0x80000000u) ? 0xffffffffu : 0; else xs_setreg(EDX, 2, (X.r[EAX] & 0x8000u) ? 0xffffu : 0); return;
    case XO_SETCC: xs_write(a, (uint32_t)xs_cond(in->cc)); return;
    case XO_CMOVCC: { uint32_t v = xs_read(b); if (xs_cond(in->cc)) xs_write(a, v); return; }
    case XO_BSWAP: { uint32_t v = X.r[a->reg]; X.r[a->reg] = (uint32_t)((v >> 24) | ((v >> 8) & 0xff00u) | ((v << 8) & 0xff0000u) | (v << 24)); return; }
    case XO_BT: case XO_BTS: case XO_BTR: case XO_BTC: {
        uint32_t bit = xs_read(b);
        x86_opnd_t m = *a;
        if (a->kind == XK_MEM && b->kind == XK_REG) { m.disp += ((int32_t)bit >> 5) * 4; m.size = 4; bit &= 31u; }
        uint32_t v = xs_read(&m), k = bit & (uint32_t)(sz * 8 - 1);
        xs_setf(F_CF, (v >> k) & 1u);
        if (in->op == XO_BT) return;
        if (in->op == XO_BTS) v |= 1u << k; else if (in->op == XO_BTR) v &= ~(1u << k); else v ^= 1u << k;
        xs_write(&m, v);
        return;
    }
    case XO_BSF: case XO_BSR: {
        uint32_t v = xs_read(b) & X86_MASK[sz];
        xs_setf(F_ZF, v == 0);
        if (v) xs_write(a, in->op == XO_BSF ? (uint32_t)__builtin_ctz(v) : (uint32_t)(31 - __builtin_clz(v)));
        return;
    }
    case XO_SHLD: case XO_SHRD: {
        uint32_t cnt = xs_read(c) & 31u, d = xs_read(a), s = xs_read(b), r;
        if (!cnt) return;
        int bits = sz * 8;
        if (in->op == XO_SHLD) { r = (d << cnt) | (s >> (bits - (int)cnt)); xs_setf(F_CF, (d >> (bits - (int)cnt)) & 1u); }
        else { r = (d >> cnt) | (s << (bits - (int)cnt)); xs_setf(F_CF, (d >> (cnt - 1)) & 1u); }
        r &= X86_MASK[sz];
        xs_szp(r, sz);
        xs_write(a, r);
        return;
    }
    case XO_MOVS: case XO_STOS: case XO_LODS: case XO_CMPS: case XO_SCAS: xs_string(in->op, sz, in->rep); return;
    case XO_CLC: X.flags &= ~F_CF; return;
    case XO_STC: X.flags |= F_CF; return;
    case XO_CMC: X.flags ^= F_CF; return;
    case XO_CLD: X.flags &= ~F_DF; return;
    case XO_STD: X.flags |= F_DF; return;
    case XO_LEAVE: X.r[ESP] = X.r[EBP]; X.r[EBP] = x86_pop(); return;
    case XO_ENTER: {
        if (b->imm & 31u) x86_fault("enter with nesting level", in->addr);
        x86_push(X.r[EBP]); X.r[EBP] = X.r[ESP]; X.r[ESP] -= a->imm; return;
    }
    case XO_NOP: return;
    case XO_JCC: if (xs_cond(in->cc)) X.eip = in->target; return;
    case XO_JMP: X.eip = in->target; return;
    case XO_JMP_IND: X.eip = xs_read(a); return;
    case XO_LOOP: X.r[ECX]=(uint32_t)(X.r[ECX]-1);if (X.r[ECX]) X.eip = in->target; return;
    case XO_LOOPE:X.r[ECX]=(uint32_t)(X.r[ECX]-1);if (X.r[ECX] && (X.flags & F_ZF)) X.eip = in->target; return;
    case XO_LOOPNE:X.r[ECX]=(uint32_t)(X.r[ECX]-1);if (X.r[ECX] && !(X.flags & F_ZF)) X.eip = in->target; return;
    case XO_JECXZ: if (!X.r[ECX]) X.eip = in->target; return;
    case XO_CALL: x86_push(next); X.eip = in->target; return;
    case XO_CALL_IND: { uint32_t t = xs_read(a); x86_push(next); X.eip = t; return; }
    case XO_RET: X.eip = x86_pop(); X.r[ESP] += a->imm; return;
    case XO_FPU: x86_x87(in); return;
    case XO_INT: case XO_INT3: case XO_HLT: x86_fault("int/int3/hlt executed", in->addr);
    default: x86_fault("unsupported instruction", in->addr);
    }
}
