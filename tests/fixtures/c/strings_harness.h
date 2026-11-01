/* CC0 synthetic string-contract fixture. Generated and interpreted execution;
 * memory/fault hooks only, no replacement instruction behavior. */
#if TEST_WIDE
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES 65536ull
#endif
#include "../../../platforms/x86/x86_lift64.h"
#include "bgt.h"
x86_cpu_t X;
x86_metrics_t x86_metrics;
uint8_t *x86_pages[1u << 20];
uint8_t x86_protection[1u << 20];
int x86_protection_active;
static uint8_t ram[65536];
uint8_t *x86_flat = ram;
uint64_t x86_guest_committed;
const x86_insn_t *x86_lift_pending;
uint32_t x86_lift_count;
static unsigned yields, suspend_quantum, fault_address;
void x86_fault(const char *message, uint32_t address) {
    (void)message; fault_address = address; __builtin_trap();
}
uint32_t x86_address(uint64_t a) {
    if (a > UINT32_MAX) x86_fault("high pointer", X.eip);
    return (uint32_t)a;
}
void x86_cooperate(void) { X.frame_insns = 0; yields++; if (suspend_quantum) X.transfer = 1; }
int x86_mapped(uint32_t a, uint32_t n) { return x86_accessible(a, n, 1); }
uint32_t x86_rd8_slow(uint32_t a) { x86_fault("read", a); }
uint32_t x86_rd16_slow(uint32_t a) { return x86_rd8(a) | (x86_rd8(a+1) << 8); }
uint32_t x86_rd32_slow(uint32_t a) { return x86_rd16(a) | (x86_rd16(a+2) << 16); }
void x86_wr8_slow(uint32_t a, uint32_t v) { (void)v; x86_fault("write", a); }
void x86_wr16_slow(uint32_t a, uint32_t v) { x86_wr8(a,v); x86_wr8(a+1,v>>8); }
void x86_wr32_slow(uint32_t a, uint32_t v) { x86_wr16(a,v); x86_wr16(a+2,v>>16); }
void x86_x87(const x86_insn_t *in) { (void)in; __builtin_trap(); }
void x86_simd(const x86_insn_t *in) { (void)in; __builtin_trap(); }
void x86_continue(uint32_t a, uint32_t b) { (void)a; (void)b; __builtin_trap(); }
#include "../../../platforms/x86/x86_decode.c"
#include "../../../platforms/x86/x86_exec.c"
#include "../../../platforms/x86/x86_exec64.c"
void x86_exec_one(const x86_insn_t *in) { x86_metrics.generic_insn_execs++; x86_exec_insn(in); }
static void reference(void) {
    x86_insn_t in;
    unsigned off = X.eip - 0x1001000;
    if (off >= sizeof test_code || !x86_decode_mode(test_code + off, sizeof test_code - off,
        X.eip, TEST_WIDE, &in)) __builtin_trap();
#if !TEST_WIDE
    if (++X.frame_insns > 2000000u) { x86_cooperate(); if (X.transfer) return; }
#endif
    x86_exec_one(&in);
}
void x86_lift_block(uint32_t n) { while (n-- && !X.transfer) reference(); }
BGT_EXPORT(reset) void reset(unsigned pc) {
    __builtin_memset(&X, 0, sizeof X); __builtin_memset(ram, 0, sizeof ram);
    for (unsigned i=0;i<16;i++) { x86_pages[i]=ram+i*4096; x86_protection[i]=0; }
    X.mode64=TEST_WIDE; X.eip=pc; X.r[ESP]=0xf000; x86_push(0);
    yields=suspend_quantum=fault_address=0; x86_lift_pending=0; x86_lift_count=0;
}
BGT_EXPORT(ram) unsigned ram_address(void) { return (unsigned)(uintptr_t)ram; }
BGT_EXPORT(set) void set(unsigned r, uint64_t value) { X.r[r]=value; }
BGT_EXPORT(get) uint64_t get(unsigned r) { return X.r[r]; }
BGT_EXPORT(flags) unsigned flags(void) { return X.flags; }
BGT_EXPORT(set_flags) void set_flags(unsigned f) { X.flags=f; }
BGT_EXPORT(pc) unsigned pc(void) { return X.eip; }
BGT_EXPORT(fault_address) unsigned fault_addr(void) { return fault_address; }
BGT_EXPORT(protect) void protect(unsigned page, unsigned mode) { x86_protection[page]=mode; }
BGT_EXPORT(quantum) void quantum(unsigned budget, unsigned suspend) {
    X.frame_insns=budget; suspend_quantum=suspend; X.transfer=0;
}
BGT_EXPORT(yields) unsigned yield_count(void) { return yields; }
BGT_EXPORT(segment) void segment(unsigned fs, unsigned gs) { X.fs_base=fs; X.gs_base=gs; }
