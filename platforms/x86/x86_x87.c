/* Binary32/64 x87 loads/stores and FSCALE emitted by MinGW's ldexp. MIT.
 * Extended-precision arithmetic/80-bit memory operands remain visible unsupported operations. */
#include "x86_sem64.h"
#ifdef X86_FLAT_GUEST
#include <math.h>
static double st[8];
static unsigned top, depth;
static void push(double d) {
    if (depth == 8) x86_fault("x87 stack overflow", X.eip);
    top = (top - 1) & 7; st[top] = d; depth++;
}
static void pop(void) {
    if (!depth) x86_fault("x87 stack underflow", X.eip);
    top = (top + 1) & 7; depth--;
}
void x86_x87(const x86_insn_t *in) {
    unsigned op = in->simd_op, modrm = in->simd_imm, reg = (modrm >> 3) & 7;
    if (modrm >= 0xc0) {
        unsigned i = modrm & 7;
        if (op == 0xd9 && (modrm & 0xf8) == 0xc8) {
            double t = st[top]; st[top] = st[(top + i) & 7]; st[(top + i) & 7] = t; return;
        }
        if (op == 0xdd && (modrm & 0xf8) == 0xd8) { st[(top + i) & 7] = st[top]; pop(); return; }
        if (op == 0xd9 && modrm == 0xfd && depth >= 2) {
            double e = trunc(st[(top + 1) & 7]);
            int n = e > 65536 ? 65536 : e < -65536 ? -65536 : (int)e;
            st[top] = scalbn(st[top], n); return;
        }
    } else if (op == 0xd9 || op == 0xdd) {
        uint32_t p = x64_ea(&in->o[0]);
        if (reg == 0) {
            if (op == 0xd9) { float f; uint32_t v = x86_rd32(p); __builtin_memcpy(&f, &v, 4); push(f); }
            else { double d; uint64_t v = x86_rd64(p); __builtin_memcpy(&d, &v, 8); push(d); }
            return;
        }
        if ((reg == 2 || reg == 3) && depth) {
            if (op == 0xd9) { float f = (float)st[top]; uint32_t v; __builtin_memcpy(&v, &f, 4); x86_wr32(p, v); }
            else { uint64_t v; __builtin_memcpy(&v, &st[top], 8); x86_wr64(p, v); }
            if (reg == 3) pop();
            return;
        }
    }
    x86_fault("unsupported x87 operation (extended arithmetic not implemented)", in->addr);
}
#endif
