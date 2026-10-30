/*
 * x86 guest runtime: paged memory, lifted-function registry, the mixed lifted/interpreted call
 * model, import thunks and callbacks. See x86.h for the model.
 *
 * SPDX-License-Identifier: MIT
 */
#include "x86_sem.h"
#include "bgt.h"

void x86_exec_insn(const x86_insn_t *in);

x86_cpu_t X;
uint8_t *x86_pages[1u << 20];
x86_metrics_t x86_metrics;
int x86_force_interp;

/* ------------------------------------------------------------------ host arena */
extern unsigned char __heap_base;
static uintptr_t arena_top;

void *x86_alloc(uint32_t size) {
    if (!arena_top) arena_top = ((uintptr_t)&__heap_base + 15u) & ~(uintptr_t)15u;
    uintptr_t p = arena_top, end = p + ((size + 15u) & ~15u);
    uintptr_t have = (uintptr_t)__builtin_wasm_memory_size(0) * 65536u;
    if (end > have) {
        uintptr_t pages = (end - have + 65535u) / 65536u;
        if (__builtin_wasm_memory_grow(0, pages) == (uintptr_t)-1) return 0;
    }
    arena_top = end;
    __builtin_memset((void *)p, 0, size); /* grown memory is zeroed, but be explicit for reuse */
    return (void *)p;
}

uint8_t *x86_map(uint32_t addr, uint32_t size) {
    if (!size) return 0;
    uint32_t first = addr >> 12, last = (uint32_t)(((uint64_t)addr + size - 1) >> 12);
    uint32_t i = first;
    while (i <= last) {
        if (x86_pages[i]) { i++; continue; }
        uint32_t j = i;
        while (j <= last && !x86_pages[j]) j++;
        uint8_t *blk = (uint8_t *)x86_alloc((j - i) * X86_PAGE);
        if (!blk) return 0;
        for (uint32_t k = i; k < j; k++) x86_pages[k] = blk + (k - i) * X86_PAGE;
        i = j;
    }
    return x86_host(addr);
}

int x86_mapped(uint32_t addr, uint32_t size) {
    if (!size) return 1;
    uint32_t last = (uint32_t)(((uint64_t)addr + size - 1) >> 12);
    for (uint32_t i = addr >> 12; i <= last; i++) if (!x86_pages[i]) return 0;
    return 1;
}

/* ------------------------------------------------------------------ faults */
static char fault_buf[160];
static const char HEX[] = "0123456789abcdef";

void x86_fault(const char *msg, uint32_t eip) {
    uint32_t n = 0;
    const char *p = "x86: ";
    while (*p && n < 100) fault_buf[n++] = *p++;
    while (*msg && n < 140) fault_buf[n++] = *msg++;
    p = " at 0x";
    while (*p) fault_buf[n++] = *p++;
    for (int i = 7; i >= 0; i--) fault_buf[n++] = HEX[(eip >> (i * 4)) & 15u];
    bgt_abort(BGT_E_STATE, fault_buf, n);
    __builtin_unreachable();
}

uint32_t x86_rd8_slow(uint32_t a) { x86_fault("read from unmapped memory", a); }
uint32_t x86_rd16_slow(uint32_t a) {
    if (x86_pages[a >> 12] && x86_pages[(a + 1) >> 12]) return x86_rd8(a) | (x86_rd8(a + 1) << 8);
    x86_fault("read from unmapped memory", a);
}
uint32_t x86_rd32_slow(uint32_t a) {
    if (x86_pages[a >> 12] && x86_pages[(a + 3) >> 12]) return x86_rd16(a) | (x86_rd16(a + 2) << 16);
    x86_fault("read from unmapped memory", a);
}
void x86_wr8_slow(uint32_t a, uint32_t v) { (void)v; x86_fault("write to unmapped memory", a); }
void x86_wr16_slow(uint32_t a, uint32_t v) {
    if (x86_pages[a >> 12] && x86_pages[(a + 1) >> 12]) { x86_wr8(a, v); x86_wr8(a + 1, v >> 8); return; }
    x86_fault("write to unmapped memory", a);
}
void x86_wr32_slow(uint32_t a, uint32_t v) {
    if (x86_pages[a >> 12] && x86_pages[(a + 3) >> 12]) { x86_wr16(a, v); x86_wr16(a + 2, v >> 16); return; }
    x86_fault("write to unmapped memory", a);
}

/* ------------------------------------------------------------------ lifted registry */
static const x86_lifted_entry_t *lifted;
static uint32_t nlifted;

void x86_register_lifted(const x86_lifted_entry_t *table, uint32_t n) {
    lifted = table;
    nlifted = n;
    x86_metrics.lifted_functions = n;
}

x86_lifted_fn x86_find_lifted(uint32_t addr) {
    if (x86_force_interp) return 0;
    uint32_t lo = 0, hi = nlifted;
    while (lo < hi) {
        uint32_t mid = (lo + hi) / 2;
        if (lifted[mid].addr == addr) return lifted[mid].fn;
        if (lifted[mid].addr < addr) lo = mid + 1; else hi = mid;
    }
    return 0;
}

/* ------------------------------------------------------------------ thunks */
static uint32_t thunk_lo, thunk_hi;
static x86_thunk_fn thunk_fn;
void x86_set_thunks(uint32_t lo, uint32_t hi, x86_thunk_fn fn) { thunk_lo = lo; thunk_hi = hi; thunk_fn = fn; }
int x86_is_thunk(uint32_t addr) { return addr >= thunk_lo && addr < thunk_hi; }

/* ------------------------------------------------------------------ interpreter loop */
/* decoded-instruction cache (direct mapped; self-modifying code is not supported in v0.2) */
#define DC_SIZE 8192u
typedef struct { uint32_t addr; x86_insn_t in; } dc_entry_t;
static dc_entry_t *dcache;

static const x86_insn_t *decode_at(uint32_t eip) {
    if (!dcache) {
        dcache = (dc_entry_t *)x86_alloc(DC_SIZE * sizeof(dc_entry_t));
        if (!dcache) x86_fault("out of memory (decode cache)", eip);
        for (uint32_t i = 0; i < DC_SIZE; i++) dcache[i].addr = 0xffffffffu;
    }
    dc_entry_t *e = &dcache[(eip ^ (eip >> 13)) & (DC_SIZE - 1)];
    if (e->addr == eip) return &e->in;
    uint8_t buf[15];
    uint32_t avail = 0;
    for (; avail < 15; avail++) {
        uint8_t *p = x86_host(eip + avail);
        if (!p) break;
        buf[avail] = *p;
    }
    if (!avail) x86_fault("execute from unmapped memory", eip);
    if (!x86_decode(buf, avail, eip, &e->in)) x86_fault("undecodable instruction", eip);
    e->addr = eip;
    return &e->in;
}

/* run until EIP == ret_addr with ESP > esp_floor */
static void interp_until(uint32_t ret_addr, uint32_t esp_floor) {
    int counted = 0;
    for (;;) {
        uint32_t eip = X.eip;
        if (eip == ret_addr && X.r[ESP] > esp_floor) return;
        if (x86_is_thunk(eip)) {
            x86_metrics.thunk_dispatches++;
            if (thunk_fn(eip)) return;
            continue;
        }
        const x86_insn_t *in = decode_at(eip);
        if (!counted) { counted = 1; x86_metrics.interp_code_entries++; }
        x86_metrics.interp_insns++;
        if ((in->op == XO_CALL || in->op == XO_CALL_IND) && !x86_force_interp) {
            uint32_t t = in->op == XO_CALL ? in->target : xs_read(&in->o[0]);
            x86_lifted_fn fn = x86_find_lifted(t);
            if (fn) {
                uint32_t next = in->addr + in->len;
                x86_push(next);
                x86_metrics.lifted_calls++;
                fn();
                if (X.eip != next) x86_fault("lifted callee returned to an unexpected address", in->addr);
                continue;
            }
        }
        x86_exec_insn(in);
    }
}

void x86_invoke(uint32_t target, uint32_t ret_addr) {
    uint32_t esp_floor = X.r[ESP]; /* return address is at [esp_floor] */
    x86_lifted_fn fn = x86_find_lifted(target);
    if (fn) {
        x86_metrics.lifted_calls++;
        fn();
        return;
    }
    X.eip = target;
    interp_until(ret_addr, esp_floor);
}

void x86_call(uint32_t target, uint32_t next) {
    x86_push(next);
    x86_invoke(target, next);
    if (X.eip != next) x86_fault("callee returned to an unexpected address", target);
}

void x86_continue(uint32_t ra, uint32_t esp0) {
    /* a jump straight to a lifted function entry with the frame torn down is a tail call */
    if (X.r[ESP] == esp0) {
        x86_lifted_fn fn = x86_find_lifted(X.eip);
        if (fn) { x86_metrics.tail_calls_lifted++; x86_metrics.lifted_calls++; fn(); return; }
    }
    /* a tail jump to an import thunk is an API call, not interpretation */
    if (!x86_is_thunk(X.eip)) x86_metrics.continues_interpreted++;
    interp_until(ra, esp0);
}

void x86_exec_one(const x86_insn_t *in) {
    x86_metrics.generic_insn_execs++;
    x86_exec_insn(in);
}

const uint8_t *x86_debug_peek(uint32_t addr, uint32_t len) {
    static uint8_t *buf;
    if (!len || len > X86_PEEK_MAX || (uint64_t)addr + len > 0x100000000ull || !x86_mapped(addr, len)) return 0;
    if (!buf && !(buf = (uint8_t *)x86_alloc(X86_PEEK_MAX))) return 0;
    for (uint32_t i = 0; i < len;) {
        uint32_t a = addr + i, n = X86_PAGE - (a & (X86_PAGE - 1u));
        if (n > len - i) n = len - i;
        __builtin_memcpy(buf + i, x86_host(a), n);
        i += n;
    }
    return buf;
}

#define X86_CALLBACK_SENTINEL 0xfffffff0u
uint32_t x86_callback(uint32_t fn, uint32_t nargs, const uint32_t *args) {
    uint32_t saved_esp = X.r[ESP], saved_eip = X.eip;
    for (uint32_t i = nargs; i > 0; i--) x86_push(args[i - 1]);
    x86_push(X86_CALLBACK_SENTINEL);
    x86_invoke(fn, X86_CALLBACK_SENTINEL);
    if (X.eip != X86_CALLBACK_SENTINEL) x86_fault("callback did not return", fn);
    X.r[ESP] = saved_esp;
    X.eip = saved_eip;
    return X.r[EAX];
}
