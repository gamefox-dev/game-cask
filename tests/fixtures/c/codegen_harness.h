/* Original CC0 deterministic lifted/interpreted CPU snapshot harness (not a platform mock oracle). */
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES 65536ull
#include "../../../platforms/x86/x86_lift64.h"
#include "bgt.h"
x86_cpu_t X;
x86_metrics_t x86_metrics;
uint8_t *x86_pages[1u << 20];
static uint8_t ram[65536];
uint8_t *x86_flat = ram;
uint64_t x86_guest_committed;
const x86_insn_t *x86_lift_pending;
uint32_t x86_lift_count;
static uint32_t yields;
void x86_fault(const char *m, uint32_t a) { (void)m; (void)a; __builtin_trap(); }
uint32_t x86_address(uint64_t a) {
    if (a > UINT32_MAX) x86_fault("high pointer", X.eip);
    return (uint32_t)a;
}
void x86_cooperate(void) { X.frame_insns = 0; yields++; }
int x86_mapped(uint32_t a, uint32_t n) {
    if ((uint64_t)a + n > 65536) return 0;
    for (uint32_t p = a >> 12; p <= (a + n - 1) >> 12; p++) if (!x86_pages[p]) return 0;
    return 1;
}
void x86_x87(const x86_insn_t *in) { (void)in; __builtin_trap(); }
#include "../../../platforms/x86/x86_decode.c"
#include "../../../platforms/x86/x86_exec64.c"
#include "../../../platforms/x86/x86_simd.c"
void x86_exec_one(const x86_insn_t *in) { x86_exec64(in); }
static void reference(void) {
    x86_insn_t in;
    uint32_t off = X.eip - 0x01001000u;
    if (off >= sizeof test_code || !x86_decode_mode(test_code + off, sizeof test_code - off,
        X.eip, 1, &in)) __builtin_trap();
    x86_exec64(&in);
}
void x86_lift_block(uint32_t count) { while (count--) reference(); }
BGT_EXPORT(reset) void reset(uint32_t pc, uint32_t budget) {
    __builtin_memset(&X, 0, sizeof X); __builtin_memset(ram, 0, sizeof ram);
    for (int i = 0; i < 16; i++) x86_pages[i] = ram + i * 4096;
    X.mode64 = 1; X.mxcsr = 0x1f80; X.eip = pc; X.r[ESP] = 0x8000; X.frame_insns = budget;
    yields = 0; x86_lift_pending = 0; x86_lift_count = 0;
}
BGT_EXPORT(cpu) uint32_t cpu(void) { return (uint32_t)(uintptr_t)&X; }
BGT_EXPORT(cpu_size) uint32_t cpu_size(void) { return sizeof X; }
BGT_EXPORT(ram) uint32_t ram_addr(void) { return (uint32_t)(uintptr_t)ram; }
BGT_EXPORT(unmap) void unmap(uint32_t page) { x86_pages[page] = 0; }
BGT_EXPORT(yields) uint32_t yield_count(void) { return yields; }
