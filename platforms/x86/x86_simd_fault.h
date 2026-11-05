/* Diagnostics shared by native and reference legacy SSE alignment faults. MIT. */
#ifndef X86_SIMD_FAULT_H
#define X86_SIMD_FAULT_H
#include "x86_sem64.h"
static inline const char *xs_aligned_form(unsigned op, unsigned prefix) {
    switch (op) {
    case 0xc6: return prefix == 0x66 ? "SHUFPD" : "SHUFPS";
    case 0x70: return prefix == 0x66 ? "PSHUFD" : prefix == 0xf2 ? "PSHUFLW" : "PSHUFHW";
    case 0x14: return prefix == 0x66 ? "UNPCKLPD" : "UNPCKLPS";
    case 0x15: return prefix == 0x66 ? "UNPCKHPD" : "UNPCKHPS";
    case 0x60: return "PUNPCKLBW"; case 0x61: return "PUNPCKLWD"; case 0x62: return "PUNPCKLDQ";
    case 0x68: return "PUNPCKHBW"; case 0x69: return "PUNPCKHWD"; case 0x6a: return "PUNPCKHDQ";
    case 0x6c: return "PUNPCKLQDQ"; case 0x6d: return "PUNPCKHQDQ";
    default: return "legacy SSE";
    }
}
static inline void xs_alignment_fault(uint32_t address, uint32_t pc, unsigned op, unsigned prefix) {
    char message[96]; unsigned n = 0;
    const char *p = "#GP unaligned ";
    while (*p) message[n++] = *p++;
    p = xs_aligned_form(op, prefix); while (*p) message[n++] = *p++;
    p = " m128 instruction 0x"; while (*p) message[n++] = *p++;
    for (int i = 7; i >= 0; i--) message[n++] = "0123456789abcdef"[(pc >> (i * 4)) & 15];
    message[n] = 0;
    /* x86_fault appends the guest operand address. Do not alter the fault CPU snapshot. */
    x86_fault(message, address);
}
#endif
