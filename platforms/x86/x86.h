/*
 * IA-32 / AMD64 guest runtime: architecture-sized CPU state, paged or checked flat memory, the
 * interpreter (oracle + fallback), and the call model shared with lifted code.
 *
 * Execution model
 *   - Guest code is either LIFTED (tools/x86 lift -> C functions registered with
 *     x86_register_lifted) or INTERPRETED (x86_exec on decoded instructions).
 *   - Both use the same CPU state (X), memory and semantics (x86_sem.h).
 *   - A guest call pushes the return address on the guest stack; a lifted function returns
 *     to its C caller when its `ret` executes (AMD64 functions return to the registry dispatcher);
 *     x86_invoke() runs any target (lifted,
 *     import thunk or interpreted) until it returns to the expected address.
 *   - Imports are thunk addresses handled by the platform (x86_thunk_fn).
 *   - Blocking platform calls use bgt_yield (asyncify) to wait for the next frame.
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef X86_H
#define X86_H

#include <stdint.h>
#include "x86_decode.h"

enum { EAX, ECX, EDX, EBX, ESP, EBP, ESI, EDI, R8, R9, R10, R11, R12, R13, R14, R15 };
typedef union { uint8_t u8[16]; uint16_t u16[8]; uint32_t u32[4]; uint64_t u64[2]; int8_t i8[16]; int16_t i16[8]; int32_t i32[4]; int64_t i64[2]; float f32[4]; double f64[2]; } x86_vec_t;
#define F_CF 0x001u
#define F_PF 0x004u
#define F_AF 0x010u
#define F_ZF 0x040u
#define F_SF 0x080u
#define F_DF 0x400u
#define F_OF 0x800u

#if defined(X86_FLAT_GUEST) || defined(X86_WIDE_CPU)
typedef uint64_t x86_word_t;
#else
typedef uint32_t x86_word_t;
#endif
typedef struct {
    x86_word_t r[16];
    uint32_t eip, flags, fs_base, gs_base;
    x86_vec_t xmm[16];
    uint32_t mxcsr;
    int mode64, transfer;
    uint32_t frame_insns;
    uint64_t tsc;
} x86_cpu_t;

extern x86_cpu_t X;

/* ------------------------------------------------------------------ guest memory (4 KiB pages) */
#define X86_PAGE 4096u
extern uint8_t *x86_pages[1u << 20];

/* Map [addr, addr+size) to fresh zeroed host memory (page-aligned; idempotent for mapped pages).
 * Returns the host pointer for `addr`, or 0 when out of memory. Pages of one call are contiguous. */
uint8_t *x86_map(uint32_t addr, uint32_t size);
int x86_mapped(uint32_t addr, uint32_t size);
/* Host allocation from the runtime arena (never freed). */
void *x86_alloc(uint32_t size);

uint32_t x86_rd8_slow(uint32_t a);
uint32_t x86_rd16_slow(uint32_t a);
uint32_t x86_rd32_slow(uint32_t a);
void x86_wr8_slow(uint32_t a, uint32_t v);
void x86_wr16_slow(uint32_t a, uint32_t v);
void x86_wr32_slow(uint32_t a, uint32_t v);

#ifdef X86_FLAT_GUEST
#ifndef X86_FLAT_BYTES
#define X86_FLAT_BYTES (1024ull << 20)
#endif
#define X86_HOST_ARENA_BYTES (64u << 20)
extern uint8_t *x86_flat;
extern uint64_t x86_guest_committed;
void x86_cooperate(void);
void x86_set_scheduler(void (*schedule)(void));
void x86_x87(const x86_insn_t *in);
__attribute__((noreturn)) void x86_fault(const char *, uint32_t);
static __attribute__((noinline)) uint8_t *x86_flat_at(uint32_t a, uint32_t n) {
    if ((uint64_t)a + n > X86_FLAT_BYTES || !x86_pages[a >> 12] ||
        !x86_pages[((uint64_t)a + n - 1) >> 12]) {
        x86_fault("unmapped flat guest memory", a);
    }
    return x86_flat + a;
}
static inline uint8_t *x86_host(uint32_t a) {
    return a < X86_FLAT_BYTES && x86_pages[a >> 12] ? x86_flat + a : 0;
}
static __attribute__((noinline)) uint32_t x86_rd8(uint32_t a) {return *x86_flat_at(a,1);}
static __attribute__((noinline)) uint32_t x86_rd16(uint32_t a) {
    uint16_t v; __builtin_memcpy(&v, x86_flat_at(a, 2), 2); return v;
}
static __attribute__((noinline)) uint32_t x86_rd32(uint32_t a) {
    uint32_t v; __builtin_memcpy(&v, x86_flat_at(a, 4), 4); return v;
}
static __attribute__((noinline)) void x86_wr8(uint32_t a,uint32_t v) {*x86_flat_at(a,1)=(uint8_t)v;}
static __attribute__((noinline)) void x86_wr16(uint32_t a,uint32_t v) {
    uint16_t x = (uint16_t)v; __builtin_memcpy(x86_flat_at(a, 2), &x, 2);
}
static __attribute__((noinline)) void x86_wr32(uint32_t a,uint32_t v) {
    __builtin_memcpy(x86_flat_at(a, 4), &v, 4);
}
#else
static inline uint8_t *x86_host(uint32_t a) {
    uint8_t *p = x86_pages[a >> 12];
    return p ? p + (a & 0xfffu) : 0;
}
static inline uint32_t x86_rd8(uint32_t a) {
    uint8_t *p = x86_pages[a >> 12];
    return p ? p[a & 0xfffu] : x86_rd8_slow(a);
}
static inline uint32_t x86_rd16(uint32_t a) {
    uint8_t *p = x86_pages[a >> 12];
    if (p && (a & 0xfffu) <= 0xffeu) { uint16_t v; __builtin_memcpy(&v, p + (a & 0xfffu), 2); return v; }
    return x86_rd16_slow(a);
}
static inline uint32_t x86_rd32(uint32_t a) {
    uint8_t *p = x86_pages[a >> 12];
    if (p && (a & 0xfffu) <= 0xffcu) { uint32_t v; __builtin_memcpy(&v, p + (a & 0xfffu), 4); return v; }
    return x86_rd32_slow(a);
}
static inline void x86_wr8(uint32_t a, uint32_t v) {
    uint8_t *p = x86_pages[a >> 12];
    if (p) p[a & 0xfffu] = (uint8_t)v; else x86_wr8_slow(a, v);
}
static inline void x86_wr16(uint32_t a, uint32_t v) {
    uint8_t *p = x86_pages[a >> 12];
    if (p && (a & 0xfffu) <= 0xffeu) { uint16_t t = (uint16_t)v; __builtin_memcpy(p + (a & 0xfffu), &t, 2); }
    else x86_wr16_slow(a, v);
}
static inline void x86_wr32(uint32_t a, uint32_t v) {
    uint8_t *p = x86_pages[a >> 12];
    if (p && (a & 0xfffu) <= 0xffcu) __builtin_memcpy(p + (a & 0xfffu), &v, 4);
    else x86_wr32_slow(a, v);
}
#endif
static inline uint64_t x86_rd64(uint32_t a) { return (uint64_t)x86_rd32(a) | ((uint64_t)x86_rd32(a+4) << 32); }
static inline void x86_wr64(uint32_t a,uint64_t v) { x86_wr32(a,(uint32_t)v);x86_wr32(a+4,(uint32_t)(v>>32)); }
static inline void x86_push(uint64_t v) { X.r[ESP] -= X.mode64 ? 8 : 4; if(X.mode64)x86_wr64((uint32_t)X.r[ESP],v);else x86_wr32((uint32_t)X.r[ESP],(uint32_t)v); }
static inline uint64_t x86_pop(void) { uint64_t v=X.mode64?x86_rd64((uint32_t)X.r[ESP]):x86_rd32((uint32_t)X.r[ESP]);X.r[ESP]+=X.mode64?8:4;return v; }

/* ------------------------------------------------------------------ faults */
/* Stops the game (bgt_abort) with a message naming the guest address. Never returns. */
__attribute__((noreturn)) void x86_fault(const char *msg, uint32_t eip);

/* ------------------------------------------------------------------ dispatch */
typedef void (*x86_lifted_fn)(void);
/* AMD64 entries cover [addr,end), permitting landing-pad resumption. IA-32 entries use end=0. */
typedef struct { uint32_t addr; x86_lifted_fn fn; uint32_t end; } x86_lifted_entry_t;
/* Register a sorted table of lifted functions (generated by tools/x86 lift). */
void x86_register_lifted(const x86_lifted_entry_t *table, uint32_t n);
x86_lifted_fn x86_find_lifted(uint32_t addr);

/* Import thunks: executing at an address in [lo, hi) calls `fn(addr)`, which must emulate the
 * API (read args from the guest stack, set EAX, pop the return address into EIP and the args for
 * stdcall). Returns nonzero to request a stop (e.g. ExitProcess). */
typedef int (*x86_thunk_fn)(uint32_t addr);
void x86_set_thunks(uint32_t lo, uint32_t hi, x86_thunk_fn fn);
int x86_is_thunk(uint32_t addr);

/* Run guest code at `target` (with the return address already pushed) until control returns to
 * `ret_addr` with ESP above the pushed return address. Lifted code is preferred; otherwise the
 * interpreter runs (and switches back to lifted code at every call into a lifted function). */
void x86_invoke(uint32_t target, uint32_t ret_addr);

/* Lifted-code helpers ------------------------------------------------------------------------- */
/* Call from lifted code: push next, run target, verify we came back to `next`. */
void x86_call(uint32_t target, uint32_t next);
/* Continue the current guest frame in the interpreter from X.eip (unresolved indirect jump, jump
 * out of the lifted function, fall-through past its known code) until the frame returns to `ra`
 * with ESP above `esp0` (the frame's entry ESP, where `ra` was stored). */
void x86_continue(uint32_t ra, uint32_t esp0);
/* Execute one instruction through the interpreter (lifted code's per-instruction fallback). */
void x86_exec_one(const x86_insn_t *in);

/* Callback into guest code from the platform (WndProc, TimerProc, ...): stdcall/cdecl agnostic,
 * restores ESP afterwards. Returns EAX. */
uint32_t x86_callback(uint32_t fn, uint32_t nargs, const uint32_t *args);
uint64_t x86_callback64(uint32_t fn,uint32_t nargs,const uint64_t *args);
void x86_exec64(const x86_insn_t *in);
void x86_simd(const x86_insn_t *in);
uint32_t x86_address(uint64_t a);
#ifdef X86_FLAT_GUEST
extern uint8_t *x86_flat;
#endif

/* ------------------------------------------------------------------ metrics */
/* Names say what they count (kit v0.2.1; v0.2 had `interp_entries`, `exec_one`, `continues`). */
typedef struct {
    uint64_t interp_insns;          /* guest instructions executed by the interpreter (0 = fully lifted) */
    uint64_t lifted_calls;          /* entries into lifted functions */
    uint64_t interp_code_entries;   /* entries into non-lifted guest code (the interpreter ran >= 1 instruction) */
    uint64_t generic_insn_execs;    /* instructions executed through the shared semantic core inside lifted code */
    uint64_t tail_calls_lifted;     /* lifted jumps out of a function resolved straight to a lifted entry (tail calls) */
    uint64_t continues_interpreted; /* lifted frames that had to continue in the interpreter (unresolved jumps,
                                       code beyond known functions) */
    uint64_t thunk_dispatches;      /* import thunks reached through x86_invoke/the interpreter (== platform API calls) */
    uint32_t lifted_functions;      /* registered lifted functions */
} x86_metrics_t;
extern x86_metrics_t x86_metrics;

/* Interpreter-only mode (differential oracle): ignore lifted functions. */
extern int x86_force_interp;

/* Debug/test only (read-only): copy [addr, addr+len) of guest memory into a host scratch buffer and return
 * it, or 0 when any byte is unmapped or len is 0 or > X86_PEEK_MAX. Never faults, never writes guest state. */
#define X86_PEEK_MAX 65536u
const uint8_t *x86_debug_peek(uint32_t addr, uint32_t len);

#endif
