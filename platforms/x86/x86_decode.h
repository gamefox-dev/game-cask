/*
 * x86-32 instruction decoder shared by the interpreter (oracle / fallback, wasm), the analyzer
 * and the lifter (native host tool). Flat 32-bit protected mode; no 16-bit addressing.
 * Pure function over bytes: no guest memory access, no globals.
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef X86_DECODE_H
#define X86_DECODE_H

#include <stdint.h>

enum {
    /* ALU group order matters: ADD..CMP == 0..7 (ModRM /r field of 80-83) */
    XO_ADD, XO_OR, XO_ADC, XO_SBB, XO_AND, XO_SUB, XO_XOR, XO_CMP,
    /* shift group order == ModRM /r field of C0/C1/D0-D3 (SAL == 6 behaves as SHL) */
    XO_ROL, XO_ROR, XO_RCL, XO_RCR, XO_SHL, XO_SHR, XO_SAL, XO_SAR,
    XO_TEST, XO_INC, XO_DEC, XO_NEG, XO_NOT, XO_MUL, XO_IMUL1, XO_IMUL, XO_DIV, XO_IDIV,
    XO_MOV, XO_MOVZX, XO_MOVSX, XO_LEA, XO_XCHG, XO_XADD, XO_CMPXCHG,
    XO_PUSH, XO_POP, XO_PUSHA, XO_POPA, XO_PUSHF, XO_POPF, XO_SAHF, XO_LAHF, XO_CWDE, XO_CDQ,
    XO_SETCC, XO_CMOVCC, XO_BSWAP, XO_BT, XO_BTS, XO_BTR, XO_BTC, XO_BSF, XO_BSR, XO_SHLD, XO_SHRD,
    XO_MOVS, XO_STOS, XO_LODS, XO_CMPS, XO_SCAS,
    XO_CLC, XO_STC, XO_CMC, XO_CLD, XO_STD, XO_LEAVE, XO_ENTER, XO_NOP,
    XO_JCC, XO_JMP, XO_JMP_IND, XO_CALL, XO_CALL_IND, XO_RET, XO_LOOP, XO_LOOPE, XO_LOOPNE, XO_JECXZ,
    XO_INT, XO_INT3, XO_HLT,
    XO_FPU,     /* x87 escape (D8-DF): length decoded for analysis, not executed in v0.2 */
    XO_UNSUPPORTED, /* valid encoding outside the supported set (segments, BCD, system, SIMD, ...) */
    XO_COUNT
};

extern const char *const x86_op_names[XO_COUNT];

enum { XK_NONE, XK_REG, XK_MEM, XK_IMM };
#define X86_NOREG 0xff

typedef struct {
    uint8_t kind;   /* XK_* */
    uint8_t size;   /* bytes: 1, 2, 4 */
    uint8_t reg;    /* XK_REG: 0-7 (size 1: 0-3 low bytes AL..BL, 4-7 high bytes AH..BH) */
    uint8_t base;   /* XK_MEM: base register or X86_NOREG */
    uint8_t index;  /* XK_MEM: index register or X86_NOREG */
    uint8_t scale;  /* XK_MEM: shift 0-3 */
    uint8_t seg_fs; /* XK_MEM: FS segment override */
    uint8_t pad;
    int32_t disp;   /* XK_MEM displacement / absolute address */
    uint32_t imm;   /* XK_IMM value (sign-extended to 32 bits where the encoding says so) */
} x86_opnd_t;

#define X86_F_BRANCH     0x01u /* conditional/unconditional direct jump (target valid) */
#define X86_F_CALL       0x02u /* direct call (target valid) */
#define X86_F_RET        0x04u
#define X86_F_INDIRECT   0x08u /* indirect jmp/call */
#define X86_F_TERMINATOR 0x10u /* control does not fall through (jmp, ret, hlt, int3, ud) */
#define X86_F_INVALID    0x20u /* undecodable */

typedef struct {
    uint32_t addr;
    uint32_t target;   /* direct branch / call target */
    uint16_t op;       /* XO_* */
    uint8_t len;
    uint8_t osz;       /* operand size: 2 or 4 */
    uint8_t rep;       /* 0, 0xF2 (REPNE), 0xF3 (REP/REPE) */
    uint8_t cc;        /* condition code 0-15 for JCC/SETCC/CMOVCC */
    uint8_t flags;     /* X86_F_* */
    uint8_t nops;      /* number of operands used */
    x86_opnd_t o[3];   /* o[0] destination (or sole operand), o[1] source, o[2] third (imul imm, shld count) */
} x86_insn_t;

/* Decode one instruction at `bytes` (at most `avail` readable bytes), located at guest `addr`.
 * Returns the length (1-15), or 0 if the bytes are not a valid/complete encoding. */
int x86_decode(const uint8_t *bytes, uint32_t avail, uint32_t addr, x86_insn_t *out);

/* Format as Intel-syntax text (for disassembly listings and lifted-code comments). */
int x86_format(const x86_insn_t *in, char *dst, uint32_t cap);

#endif
