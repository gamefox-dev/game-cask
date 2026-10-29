/*
 * x86-32 decoder (Intel SDM vol. 2 encodings). See x86_decode.h.
 *
 * SPDX-License-Identifier: MIT
 */
#include "x86_decode.h"

const char *const x86_op_names[XO_COUNT] = {
    "add", "or", "adc", "sbb", "and", "sub", "xor", "cmp",
    "rol", "ror", "rcl", "rcr", "shl", "shr", "sal", "sar",
    "test", "inc", "dec", "neg", "not", "mul", "imul", "imul", "div", "idiv",
    "mov", "movzx", "movsx", "lea", "xchg", "xadd", "cmpxchg",
    "push", "pop", "pushad", "popad", "pushfd", "popfd", "sahf", "lahf", "cwde", "cdq",
    "set", "cmov", "bswap", "bt", "bts", "btr", "btc", "bsf", "bsr", "shld", "shrd",
    "movs", "stos", "lods", "cmps", "scas",
    "clc", "stc", "cmc", "cld", "std", "leave", "enter", "nop",
    "j", "jmp", "jmp", "call", "call", "ret", "loop", "loope", "loopne", "jecxz",
    "int", "int3", "hlt", "fpu", "(unsupported)",
};

typedef struct {
    const uint8_t *b;
    uint32_t avail, pos;
    int ok;
} rd_t;

static uint32_t u8(rd_t *r) {
    if (r->pos >= r->avail || r->pos >= 15) { r->ok = 0; return 0; }
    return r->b[r->pos++];
}
static uint32_t u16(rd_t *r) { uint32_t a = u8(r); return a | (u8(r) << 8); }
static uint32_t u32(rd_t *r) { uint32_t a = u16(r); return a | (u16(r) << 16); }
static uint32_t sx8(uint32_t v) { return (uint32_t)(int32_t)(int8_t)v; }
static uint32_t sx16(uint32_t v) { return (uint32_t)(int32_t)(int16_t)v; }

static void reg(x86_opnd_t *o, int r, int size) {
    o->kind = XK_REG; o->reg = (uint8_t)r; o->size = (uint8_t)size;
    o->base = o->index = X86_NOREG;
}
static void imm(x86_opnd_t *o, uint32_t v, int size) {
    o->kind = XK_IMM; o->imm = v; o->size = (uint8_t)size;
    o->base = o->index = X86_NOREG;
}

/* ModRM: fills `rm` (register or memory) and returns the reg field */
static int modrm(rd_t *r, x86_opnd_t *rm, int size, int fs) {
    uint32_t b = u8(r);
    int mod = (int)(b >> 6), m = (int)(b & 7), fld = (int)((b >> 3) & 7);
    if (mod == 3) { reg(rm, m, size); return fld; }
    rm->kind = XK_MEM; rm->size = (uint8_t)size; rm->seg_fs = (uint8_t)fs;
    rm->base = X86_NOREG; rm->index = X86_NOREG; rm->scale = 0; rm->disp = 0;
    if (m == 4) {
        uint32_t sib = u8(r);
        int sc = (int)(sib >> 6), idx = (int)((sib >> 3) & 7), base = (int)(sib & 7);
        if (idx != 4) { rm->index = (uint8_t)idx; rm->scale = (uint8_t)sc; }
        if (base == 5 && mod == 0) rm->disp = (int32_t)u32(r);
        else rm->base = (uint8_t)base;
    } else if (m == 5 && mod == 0) {
        rm->disp = (int32_t)u32(r);
    } else {
        rm->base = (uint8_t)m;
    }
    if (mod == 1) rm->disp += (int32_t)sx8(u8(r));
    else if (mod == 2) rm->disp += (int32_t)u32(r);
    return fld;
}

int x86_decode(const uint8_t *bytes, uint32_t avail, uint32_t addr, x86_insn_t *in) {
    rd_t r = {bytes, avail, 0, 1};
    __builtin_memset(in, 0, sizeof *in);
    in->addr = addr;
    in->osz = 4;
    for (int i = 0; i < 3; i++) in->o[i].base = in->o[i].index = X86_NOREG;
    int fs = 0, unsup = 0;
    uint32_t op;
    for (;;) {
        op = u8(&r);
        if (!r.ok) return 0;
        if (op == 0x66) in->osz = 2;
        else if (op == 0x64) fs = 1;
        else if (op == 0x65 || op == 0x67) unsup = 1; /* GS / 16-bit addressing: not supported */
        else if (op == 0xf2 || op == 0xf3) in->rep = (uint8_t)op;
        else if (op == 0xf0 || op == 0x2e || op == 0x3e || op == 0x26 || op == 0x36) { /* lock / null segments */ }
        else break;
    }
    int osz = in->osz;
    int sz = (op & 1) ? osz : 1;
    x86_opnd_t *a = &in->o[0], *b = &in->o[1], *c = &in->o[2];
    int f;
#define DONE(n) do { in->nops = (uint8_t)(n); goto done; } while (0)

    if (op < 0x40 && (op & 7) < 6) { /* ALU block */
        in->op = (uint16_t)(op >> 3);
        switch (op & 7) {
        case 0: case 1: f = modrm(&r, a, sz, fs); reg(b, f, sz); break;
        case 2: case 3: f = modrm(&r, b, sz, fs); reg(a, f, sz); break;
        case 4: reg(a, 0, 1); imm(b, u8(&r), 1); break;
        default: reg(a, 0, osz); imm(b, osz == 4 ? u32(&r) : u16(&r), osz); break;
        }
        DONE(2);
    }
    if (op >= 0x40 && op <= 0x4f) { in->op = op < 0x48 ? XO_INC : XO_DEC; reg(a, (int)(op & 7), osz); DONE(1); }
    if (op >= 0x50 && op <= 0x57) { in->op = XO_PUSH; reg(a, (int)(op & 7), osz); DONE(1); }
    if (op >= 0x58 && op <= 0x5f) { in->op = XO_POP; reg(a, (int)(op & 7), osz); DONE(1); }
    if (op >= 0x70 && op <= 0x7f) { in->op = XO_JCC; in->cc = (uint8_t)(op & 15); in->target = sx8(u8(&r)); in->flags = X86_F_BRANCH; DONE(0); }
    if (op >= 0x91 && op <= 0x97) { in->op = XO_XCHG; reg(a, 0, osz); reg(b, (int)(op & 7), osz); DONE(2); }
    if (op >= 0xb0 && op <= 0xb7) { in->op = XO_MOV; reg(a, (int)(op & 7), 1); imm(b, u8(&r), 1); DONE(2); }
    if (op >= 0xb8 && op <= 0xbf) { in->op = XO_MOV; reg(a, (int)(op & 7), osz); imm(b, osz == 4 ? u32(&r) : u16(&r), osz); DONE(2); }
    if (op >= 0xd8 && op <= 0xdf) { /* x87: decode length only */
        in->op = XO_FPU; x86_opnd_t t; modrm(&r, &t, 4, fs); DONE(0);
    }

    switch (op) {
    case 0x0f: {
        uint32_t op2 = u8(&r);
        if (op2 >= 0x80 && op2 <= 0x8f) { in->op = XO_JCC; in->cc = (uint8_t)(op2 & 15); in->target = osz == 4 ? u32(&r) : sx16(u16(&r)); in->flags = X86_F_BRANCH; DONE(0); }
        if (op2 >= 0x90 && op2 <= 0x9f) { in->op = XO_SETCC; in->cc = (uint8_t)(op2 & 15); modrm(&r, a, 1, fs); DONE(1); }
        if (op2 >= 0x40 && op2 <= 0x4f) { in->op = XO_CMOVCC; in->cc = (uint8_t)(op2 & 15); f = modrm(&r, b, osz, fs); reg(a, f, osz); DONE(2); }
        if (op2 >= 0xc8 && op2 <= 0xcf) { in->op = XO_BSWAP; reg(a, (int)(op2 & 7), 4); DONE(1); }
        switch (op2) {
        case 0xb6: case 0xb7: case 0xbe: case 0xbf:
            in->op = (op2 & 8) ? XO_MOVSX : XO_MOVZX;
            f = modrm(&r, b, (op2 & 1) ? 2 : 1, fs); reg(a, f, osz); DONE(2);
        case 0xaf: in->op = XO_IMUL; f = modrm(&r, b, osz, fs); reg(a, f, osz); DONE(2);
        case 0xa3: case 0xab: case 0xb3: case 0xbb:
            in->op = op2 == 0xa3 ? XO_BT : op2 == 0xab ? XO_BTS : op2 == 0xb3 ? XO_BTR : XO_BTC;
            f = modrm(&r, a, osz, fs); reg(b, f, osz); DONE(2);
        case 0xba:
            f = modrm(&r, a, osz, fs); imm(b, u8(&r), 1);
            if (f < 4) { unsup = 1; DONE(2); }
            in->op = (uint16_t)(XO_BT + (f - 4)); DONE(2);
        case 0xbc: case 0xbd: in->op = op2 == 0xbc ? XO_BSF : XO_BSR; f = modrm(&r, b, osz, fs); reg(a, f, osz); DONE(2);
        case 0xa4: case 0xa5: case 0xac: case 0xad:
            in->op = op2 < 0xac ? XO_SHLD : XO_SHRD;
            f = modrm(&r, a, osz, fs); reg(b, f, osz);
            if (op2 & 1) reg(c, 1, 1); else imm(c, u8(&r), 1);
            DONE(3);
        case 0xc0: case 0xc1: in->op = XO_XADD; f = modrm(&r, a, (op2 & 1) ? osz : 1, fs); reg(b, f, (op2 & 1) ? osz : 1); DONE(2);
        case 0xb0: case 0xb1: in->op = XO_CMPXCHG; f = modrm(&r, a, (op2 & 1) ? osz : 1, fs); reg(b, f, (op2 & 1) ? osz : 1); DONE(2);
        case 0x1f: in->op = XO_NOP; { x86_opnd_t t; modrm(&r, &t, osz, fs); } DONE(0); /* multi-byte nop */
        default:
            /* other 0F opcodes (cpuid, rdtsc, SIMD, ...): best-effort length via ModRM when it has one */
            in->op = XO_UNSUPPORTED;
            if (op2 == 0x31 || op2 == 0xa2 || op2 == 0x05 || op2 == 0x0b) DONE(0);
            { x86_opnd_t t; modrm(&r, &t, osz, fs); }
            DONE(0);
        }
    }
    case 0x60: in->op = XO_PUSHA; DONE(0);
    case 0x61: in->op = XO_POPA; DONE(0);
    case 0x68: in->op = XO_PUSH; imm(a, osz == 4 ? u32(&r) : u16(&r), osz); DONE(1);
    case 0x6a: in->op = XO_PUSH; imm(a, sx8(u8(&r)), osz); DONE(1);
    case 0x69: case 0x6b:
        in->op = XO_IMUL; f = modrm(&r, b, osz, fs); reg(a, f, osz);
        imm(c, op == 0x69 ? (osz == 4 ? u32(&r) : sx16(u16(&r))) : sx8(u8(&r)), osz); DONE(3);
    case 0x80: case 0x81: case 0x82: case 0x83: {
        int s2 = (op == 0x81 || op == 0x83) ? osz : 1;
        f = modrm(&r, a, s2, fs); in->op = (uint16_t)f;
        if (op == 0x81) imm(b, osz == 4 ? u32(&r) : u16(&r), s2);
        else if (op == 0x83) imm(b, sx8(u8(&r)), s2);
        else imm(b, u8(&r), 1);
        DONE(2);
    }
    case 0x84: case 0x85: in->op = XO_TEST; f = modrm(&r, a, sz, fs); reg(b, f, sz); DONE(2);
    case 0x86: case 0x87: in->op = XO_XCHG; f = modrm(&r, a, sz, fs); reg(b, f, sz); DONE(2);
    case 0x88: case 0x89: in->op = XO_MOV; f = modrm(&r, a, sz, fs); reg(b, f, sz); DONE(2);
    case 0x8a: case 0x8b: in->op = XO_MOV; f = modrm(&r, b, sz, fs); reg(a, f, sz); DONE(2);
    case 0x8d: in->op = XO_LEA; f = modrm(&r, b, osz, 0); reg(a, f, osz); if (b->kind != XK_MEM) unsup = 1; DONE(2);
    case 0x8f: in->op = XO_POP; modrm(&r, a, osz, fs); DONE(1);
    case 0x90: in->op = XO_NOP; DONE(0);
    case 0x98: in->op = XO_CWDE; DONE(0);
    case 0x99: in->op = XO_CDQ; DONE(0);
    case 0x9c: in->op = XO_PUSHF; DONE(0);
    case 0x9d: in->op = XO_POPF; DONE(0);
    case 0x9e: in->op = XO_SAHF; DONE(0);
    case 0x9f: in->op = XO_LAHF; DONE(0);
    case 0xa0: case 0xa1: case 0xa2: case 0xa3: {
        x86_opnd_t *m = (op < 0xa2) ? b : a, *rg = (op < 0xa2) ? a : b;
        in->op = XO_MOV; reg(rg, 0, sz);
        m->kind = XK_MEM; m->size = (uint8_t)sz; m->seg_fs = (uint8_t)fs; m->disp = (int32_t)u32(&r);
        DONE(2);
    }
    case 0xa4: case 0xa5: in->op = XO_MOVS; a->size = (uint8_t)sz; DONE(0);
    case 0xa6: case 0xa7: in->op = XO_CMPS; a->size = (uint8_t)sz; DONE(0);
    case 0xaa: case 0xab: in->op = XO_STOS; a->size = (uint8_t)sz; DONE(0);
    case 0xac: case 0xad: in->op = XO_LODS; a->size = (uint8_t)sz; DONE(0);
    case 0xae: case 0xaf: in->op = XO_SCAS; a->size = (uint8_t)sz; DONE(0);
    case 0xa8: case 0xa9: in->op = XO_TEST; reg(a, 0, sz); imm(b, sz == 4 ? u32(&r) : sz == 2 ? u16(&r) : u8(&r), sz); DONE(2);
    case 0xc0: case 0xc1: f = modrm(&r, a, sz, fs); in->op = (uint16_t)(XO_ROL + f); imm(b, u8(&r), 1); DONE(2);
    case 0xd0: case 0xd1: f = modrm(&r, a, sz, fs); in->op = (uint16_t)(XO_ROL + f); imm(b, 1, 1); DONE(2);
    case 0xd2: case 0xd3: f = modrm(&r, a, sz, fs); in->op = (uint16_t)(XO_ROL + f); reg(b, 1, 1); DONE(2);
    case 0xc2: in->op = XO_RET; imm(a, u16(&r), 2); in->flags = X86_F_RET | X86_F_TERMINATOR; DONE(1);
    case 0xc3: in->op = XO_RET; imm(a, 0, 2); in->flags = X86_F_RET | X86_F_TERMINATOR; DONE(1);
    case 0xc6: case 0xc7: in->op = XO_MOV; modrm(&r, a, sz, fs); imm(b, sz == 4 ? u32(&r) : sz == 2 ? u16(&r) : u8(&r), sz); DONE(2);
    case 0xc8: in->op = XO_ENTER; imm(a, u16(&r), 2); imm(b, u8(&r), 1); DONE(2);
    case 0xc9: in->op = XO_LEAVE; DONE(0);
    case 0xcc: in->op = XO_INT3; in->flags = X86_F_TERMINATOR; DONE(0);
    case 0xcd: in->op = XO_INT; imm(a, u8(&r), 1); in->flags = X86_F_TERMINATOR; DONE(1);
    case 0xe0: case 0xe1: case 0xe2: case 0xe3:
        in->op = op == 0xe0 ? XO_LOOPNE : op == 0xe1 ? XO_LOOPE : op == 0xe2 ? XO_LOOP : XO_JECXZ;
        in->target = sx8(u8(&r)); in->flags = X86_F_BRANCH; DONE(0);
    case 0xe8: in->op = XO_CALL; in->target = u32(&r); in->flags = X86_F_CALL; DONE(0);
    case 0xe9: in->op = XO_JMP; in->target = u32(&r); in->flags = X86_F_BRANCH | X86_F_TERMINATOR; DONE(0);
    case 0xeb: in->op = XO_JMP; in->target = sx8(u8(&r)); in->flags = X86_F_BRANCH | X86_F_TERMINATOR; DONE(0);
    case 0xf4: in->op = XO_HLT; in->flags = X86_F_TERMINATOR; DONE(0);
    case 0xf5: in->op = XO_CMC; DONE(0);
    case 0xf8: in->op = XO_CLC; DONE(0);
    case 0xf9: in->op = XO_STC; DONE(0);
    case 0xfc: in->op = XO_CLD; DONE(0);
    case 0xfd: in->op = XO_STD; DONE(0);
    case 0xf6: case 0xf7: {
        f = modrm(&r, a, sz, fs);
        static const uint16_t g3[8] = {XO_TEST, XO_TEST, XO_NOT, XO_NEG, XO_MUL, XO_IMUL1, XO_DIV, XO_IDIV};
        in->op = g3[f];
        if (f < 2) { imm(b, sz == 4 ? u32(&r) : sz == 2 ? u16(&r) : u8(&r), sz); DONE(2); }
        DONE(1);
    }
    case 0xfe:
        f = modrm(&r, a, 1, fs);
        if (f > 1) { unsup = 1; DONE(1); }
        in->op = f ? XO_DEC : XO_INC; DONE(1);
    case 0xff:
        f = modrm(&r, a, osz, fs);
        switch (f) {
        case 0: in->op = XO_INC; DONE(1);
        case 1: in->op = XO_DEC; DONE(1);
        case 2: in->op = XO_CALL_IND; a->size = 4; in->flags = X86_F_INDIRECT; DONE(1);
        case 4: in->op = XO_JMP_IND; a->size = 4; in->flags = X86_F_INDIRECT | X86_F_TERMINATOR; DONE(1);
        case 6: in->op = XO_PUSH; DONE(1);
        default: unsup = 1; DONE(1); /* far call/jmp */
        }
    default:
        /* segment push/pop, BCD, string I/O, far control transfers, ... */
        in->op = XO_UNSUPPORTED;
        if (op == 0x9a || op == 0xea) { u32(&r); u16(&r); }
        else if (op == 0xca) u16(&r);
        else if (op == 0x8c || op == 0x8e || op == 0x62 || op == 0x63 || op == 0xc4 || op == 0xc5) { x86_opnd_t t; modrm(&r, &t, osz, fs); }
        else if (op == 0xe4 || op == 0xe5 || op == 0xe6 || op == 0xe7 || op == 0xd4 || op == 0xd5 || op == 0x6a) u8(&r);
        DONE(0);
    }
done:
#undef DONE
    if (!r.ok) return 0;
    in->len = (uint8_t)r.pos;
    if (unsup) in->op = XO_UNSUPPORTED;
    if (in->op == XO_UNSUPPORTED) in->flags |= X86_F_TERMINATOR;
    if (in->flags & (X86_F_BRANCH | X86_F_CALL)) in->target += addr + in->len;
    return in->len;
}

/* ---------------------------------------------------------------- formatting */

static const char *const R32[8] = {"eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"};
static const char *const R16[8] = {"ax", "cx", "dx", "bx", "sp", "bp", "si", "di"};
static const char *const R8[8] = {"al", "cl", "dl", "bl", "ah", "ch", "dh", "bh"};
static const char *const CC[16] = {"o", "no", "b", "ae", "e", "ne", "be", "a", "s", "ns", "p", "np", "l", "ge", "le", "g"};

typedef struct { char *d; uint32_t cap, n; } out_t;
static void put(out_t *o, const char *s) { while (*s) { if (o->n + 1 < o->cap) o->d[o->n] = *s; o->n++; s++; } }
static void hex(out_t *o, uint32_t v) {
    char t[11]; int k = 0;
    t[k++] = '0'; t[k++] = 'x';
    int started = 0;
    for (int i = 7; i >= 0; i--) {
        uint32_t nib = (v >> (i * 4)) & 15;
        if (nib || started || i == 0) { t[k++] = (char)(nib < 10 ? '0' + nib : 'a' + nib - 10); started = 1; }
    }
    t[k] = 0;
    put(o, t);
}
static void opnd(out_t *o, const x86_opnd_t *p) {
    if (p->kind == XK_REG) { put(o, p->size == 4 ? R32[p->reg] : p->size == 2 ? R16[p->reg] : R8[p->reg]); return; }
    if (p->kind == XK_IMM) { hex(o, p->imm); return; }
    put(o, p->size == 4 ? "dword [" : p->size == 2 ? "word [" : "byte [");
    if (p->seg_fs) put(o, "fs:");
    int any = 0;
    if (p->base != X86_NOREG) { put(o, R32[p->base]); any = 1; }
    if (p->index != X86_NOREG) {
        if (any) put(o, "+");
        put(o, R32[p->index]);
        if (p->scale) { char s[3] = {'*', (char)('0' + (1 << p->scale)), 0}; put(o, s); }
        any = 1;
    }
    if (p->disp || !any) {
        if (any) { if (p->disp < 0) { put(o, "-"); hex(o, (uint32_t)(-p->disp)); } else { put(o, "+"); hex(o, (uint32_t)p->disp); } }
        else hex(o, (uint32_t)p->disp);
    }
    put(o, "]");
}

int x86_format(const x86_insn_t *in, char *dst, uint32_t cap) {
    out_t o = {dst, cap, 0};
    if (in->rep && (in->op >= XO_MOVS && in->op <= XO_SCAS)) put(&o, in->rep == 0xf2 ? "repne " : "rep ");
    put(&o, x86_op_names[in->op]);
    if (in->op == XO_JCC || in->op == XO_SETCC || in->op == XO_CMOVCC) put(&o, CC[in->cc]);
    if (in->op >= XO_MOVS && in->op <= XO_SCAS) put(&o, in->o[0].size == 4 ? "d" : in->o[0].size == 2 ? "w" : "b");
    if (in->flags & (X86_F_BRANCH | X86_F_CALL)) { put(&o, " "); hex(&o, in->target); }
    for (int i = 0; i < in->nops; i++) { put(&o, i ? ", " : " "); opnd(&o, &in->o[i]); }
    if (o.cap) dst[o.n < o.cap ? o.n : o.cap - 1] = 0;
    return (int)o.n;
}
