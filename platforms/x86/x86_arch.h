/* Shared decoder/emitter constants; no runtime/profile policy. SPDX-License-Identifier: MIT */
#ifndef X86_ARCH_H
#define X86_ARCH_H
#include <stdint.h>
enum { EAX, ECX, EDX, EBX, ESP, EBP, ESI, EDI, R8, R9, R10, R11, R12, R13, R14, R15 };
typedef union { uint8_t u8[16]; uint16_t u16[8]; uint32_t u32[4]; uint64_t u64[2]; int8_t i8[16]; int16_t i16[8]; int32_t i32[4]; int64_t i64[2]; float f32[4]; double f64[2]; } x86_vec_t;
#define F_CF 0x001u
#define F_PF 0x004u
#define F_AF 0x010u
#define F_ZF 0x040u
#define F_SF 0x080u
#define F_DF 0x400u
#define F_OF 0x800u

/* Legacy SSE shuffle/unpack m128 operands require 16-byte alignment. Half/quad moves
 * and SSE3 duplicate moves do not. This is independent of optional #AC handling. */
static inline int x86_simd_aligned_legacy(unsigned op, unsigned prefix) {
    return op == 0xc6 || op == 0x70 || op == 0x14 || op == 0x15 ||
        (prefix == 0x66 && ((op >= 0x60 && op <= 0x62) || (op >= 0x68 && op <= 0x6a) || op == 0x6c || op == 0x6d));
}

/* Stable lifted/native exit-reason ABI. */
enum { XE_FORM=1, XE_GUARD, XE_QUANTUM, XE_INTERIOR, XE_INDIRECT, XE_OTHER, XE_INTERPRETER };
#endif
