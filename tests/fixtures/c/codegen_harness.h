/* Original CC0 deterministic lifted/interpreted CPU snapshot harness (not a platform mock oracle). */
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES 65536ull
/* Snapshot-only harness: no profiling clock/provider. Real timing/accounting
 * integration uses x86_rt.c in the dedicated Q78 fixtures. */
#ifndef X86_PROFILE_ENABLED
#define X86_PROFILE_ENABLED 0
#endif
#include "../../../platforms/x86/x86_lift64.h"
#include "bgt.h"
#include "../../../platforms/x86/x86_coverage.h"
x86_cpu_t X;
x86_metrics_t x86_metrics;
/* Counter storage only; exact mixed retirement uses the real-runtime Q78 fixture. */
x86_retired_t x86_retired, harness_retired;
x86_retired_t *x86_thread_retired=&harness_retired;
void (*x86_account_abort_hook)(double);
uint8_t *x86_pages[1u << 20];
uint8_t x86_protection[1u << 20];
int x86_protection_active;
static uint8_t ram[65536];
uint8_t *x86_flat = ram;
uint64_t x86_guest_committed;
const x86_insn_t *x86_lift_pending;
uint32_t x86_lift_count;
/* This single-owner snapshot harness has no host APIs/registry. Integration fixtures use x86_rt.c. */
int x86_is_thunk(uint32_t addr) { (void)addr; return 0; }
void x86_lift_thunk(void) { __builtin_trap(); }
unsigned x86_native_chain;
int x86_native_rechain(x86_native_fn fn){(void)fn;return 0;}
x86_native_fn x86_native_indirect(x86_native_site_t *site,uint32_t target){(void)site;(void)target;return 0;}
void x86_native_drop(void){__builtin_trap();}
void x86_run_native(x86_native_fn step) { step(X.eip); }
/* No registry/invocation scope here: deliberately use the guarded fallback.
 * Bounded direct calls are exercised against the real runtime in native-calls. */
int x86_native_enter(uint32_t target,x86_native_fn fn) { (void)target;(void)fn;return 0; }
int x86_native_resume(uint32_t next,uint64_t floor,x86_native_fn fn) { (void)next;(void)floor;(void)fn;__builtin_trap(); }
x86_lifted_fn x86_find_lifted(uint32_t addr) { (void)addr; return 0; }
static uint32_t yields, fault_address, fault_hash, stop_at_quantum;
unsigned x86_lift_reason;
static unsigned last_reason, last_block_reason;
uint64_t x86_profile_exit(uint32_t address, uint32_t reason) { (void)address; last_reason=reason; return 0; }
BGT_EXPORT(last_exit_reason) uint32_t last_exit_reason(void) { return last_reason; }
static uint32_t policy_storage[32];
void *x86_alloc(uint32_t size) { return size <= sizeof policy_storage ? policy_storage : 0; }
BGT_EXPORT(configure_policy) void configure_policy(void) {
    static const uint32_t entries[]={0x01001000};
    static const x86_code_range_t ranges[]={{0x01001000,0x01002000,0}};
    x86_set_slice(entries,1,ranges,1);
    uint32_t p=x86_prepare_host_slice(1,0);
    if(!p)__builtin_trap();
    uint32_t *e=(uint32_t *)(uintptr_t)((bgt_slice_policy_t *)(uintptr_t)p)->entries_ptr;e[0]=0x01001000;
}
void x86_fault(const char *m, uint32_t a) {
    fault_address = a; fault_hash = 2166136261u;
    while (*m) { fault_hash = (fault_hash ^ (uint8_t)*m++) * 16777619u; }
    __builtin_trap();
}
uint32_t x86_address(uint64_t a) {
    if (a > UINT32_MAX) x86_fault("high pointer", X.eip);
    return (uint32_t)a;
}
void x86_cooperate(void) { X.frame_insns = 0; yields++; if (stop_at_quantum) X.transfer = 1; }
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
void x86_lift_block(uint32_t count) {
    last_block_reason = x86_lift_reason;
    while (count--) { reference(); if (X.transfer) return; }
}
BGT_EXPORT(reset) void reset(uint32_t pc, uint32_t budget) {
    __builtin_memset(&X, 0, sizeof X); __builtin_memset(ram, 0, sizeof ram);
    for (int i = 0; i < 16; i++) { x86_pages[i] = ram + i * 4096; x86_protection[i] = 0; }
    x86_protection_active = 0;
    X.mode64 = 1; X.mxcsr = 0x1f80; X.eip = pc; X.r[ESP] = 0x8000; X.frame_insns = budget;
    yields = fault_address = fault_hash = stop_at_quantum = 0; x86_lift_pending = 0; x86_lift_count = 0; last_reason = last_block_reason = 0;
}
BGT_EXPORT(cpu) uint32_t cpu(void) { return (uint32_t)(uintptr_t)&X; }
BGT_EXPORT(cpu_size) uint32_t cpu_size(void) { return sizeof X; }
BGT_EXPORT(ram) uint32_t ram_addr(void) { return (uint32_t)(uintptr_t)ram; }
BGT_EXPORT(unmap) void unmap(uint32_t page) { x86_pages[page] = 0; }
BGT_EXPORT(protect) void protect(uint32_t page, uint32_t mode) {
    x86_protection[page] = (uint8_t)mode; x86_protection_active = 1;
}
BGT_EXPORT(yields) uint32_t yield_count(void) { return yields; }
BGT_EXPORT(fault_address) uint32_t last_fault_address(void) { return fault_address; }
BGT_EXPORT(fault_hash) uint32_t last_fault_hash(void) { return fault_hash; }
BGT_EXPORT(clock) uint64_t instruction_clock(void) { return X.tsc; }
BGT_EXPORT(last_block_reason) uint32_t block_reason(void) { return last_block_reason; }
BGT_EXPORT(coverage_flush) void coverage_flush(void) { x86_coverage_flush(); }
BGT_EXPORT(coverage_events) uint64_t coverage_events(void) { return x86_coverage_events; }
BGT_EXPORT(coverage_hits) uint64_t coverage_hits(void) { return x86_coverage_cache_hits; }
BGT_EXPORT(coverage_crossings) uint64_t coverage_crossings(void) { return x86_coverage_crossings; }
BGT_EXPORT(stop_at_quantum) void quantum_stop(uint32_t enabled) { stop_at_quantum = enabled; }
BGT_EXPORT(set_reg) void set_reg(uint32_t index, uint64_t value) { if (index < 16) X.r[index] = value; }
BGT_EXPORT(set_xmm) void set_xmm(uint32_t index, uint64_t low, uint64_t high) {
    if (index < 16) { X.xmm[index].u64[0] = low; X.xmm[index].u64[1] = high; }
}
BGT_EXPORT(get_xmm) uint64_t get_xmm(uint32_t index, uint32_t lane) { return X.xmm[index].u64[lane]; }
BGT_EXPORT(get_reg) uint64_t get_reg(uint32_t index) { return X.r[index]; }
BGT_EXPORT(set_mxcsr) void set_mxcsr(uint32_t value) { X.mxcsr = value; }
BGT_EXPORT(set_flags) void set_flags(uint32_t value) { X.flags = value; }
BGT_EXPORT(get_flags) uint32_t get_flags(void) { return X.flags; }
