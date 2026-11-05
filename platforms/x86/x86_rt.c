/*
 * x86 guest runtime: paged memory, lifted-function registry, the mixed lifted/interpreted call
 * model, import thunks and callbacks. See x86.h for the model.
 *
 * SPDX-License-Identifier: MIT
 */
#include "x86_sem.h"
#include "bgt.h"
#include "x86_sched.h" /* LANE-C */
#include "x86_coverage.h"

void x86_exec_insn(const x86_insn_t *in);

x86_cpu_t X;
uint8_t *x86_pages[1u << 20];
uint8_t x86_protection[1u << 20];
int x86_protection_active;
x86_metrics_t x86_metrics;
uint64_t x86_guest_instruction_clock(void) { return X.tsc; }
int x86_force_interp;
x86_timing_t x86_timings[XP_CATEGORIES];
x86_census_t x86_census[X86_CENSUS_CAP];
uint64_t x86_census_dropped,x86_census_generation,x86_census_window_start_clock;
void x86_profile_reset(void) {
    __builtin_memset(x86_census,0,sizeof x86_census);x86_census_dropped=0;
    x86_census_generation++;x86_census_window_start_clock=X.tsc;
}
double x86_profile_idle_us;
static double idle_start;
static int idle_exclusive, idle_pending;
static int interpreter_span_set(int active);
double x86_profile_clock(void) { return bgt_time_us() - x86_profile_idle_us; }
void x86_profile_idle_begin(void) {
    idle_exclusive = interpreter_span_set(0);
    idle_start = bgt_time_us();
    idle_pending = 1;
}
void x86_profile_idle_end(void) {
    if (!idle_pending) return;
    idle_pending = 0;
    x86_profile_idle_us += bgt_time_us() - idle_start;
    interpreter_span_set(idle_exclusive);
}
double x86_profile_begin(unsigned category) {
    if(!X86_PROFILE_ENABLED)return -1;
    static uint32_t countdown[XP_CATEGORIES], random=0x19730119;
    x86_timing_t *t = &x86_timings[category];t->calls++;
    if(countdown[category]) {countdown[category]--;return -1;}
    random=random*1664525u+1013904223u;
    countdown[category]=X86_PROFILE_SAMPLE/2+(random%X86_PROFILE_SAMPLE);
    t->samples++; return x86_profile_clock();
}
void x86_profile_end(unsigned category, double start) {
    if (start >= 0) x86_timings[category].sample_us += x86_profile_clock() - start;
}
uint64_t x86_profile_exit(uint32_t address, uint32_t reason) {
    if(!X86_PROFILE_ENABLED)return 0;
    uint32_t h = ((address * 2654435761u) ^ (reason * 2246822519u)) & (X86_CENSUS_CAP-1);
    for (unsigned i=0;i<16;i++,h=(h+1)&(X86_CENSUS_CAP-1)) {
        x86_census_t *e=&x86_census[h];
        if (!e->reason || (e->address==address && e->reason==reason)) {
            e->address=address;e->reason=reason;e->count++;return (uint64_t)(h+1) | (x86_census_generation<<32);
        }
    }
    x86_census_dropped++;return 0;
}
void x86_profile_instruction(uint64_t bucket) {
    if((bucket>>32)!=(uint32_t)x86_census_generation)return;
    uint32_t index=(uint32_t)bucket;if(index)x86_census[index-1].instructions++;
}
/* Exclusive interpreter samples exclude scheduler/native/callback work, including
 * nested interpretation. The span lives on the ordinary C stack across suspension. */
static double *exclusive_span;
double x86_interpreter_exclusive_sample_us;
static double *exclusive_pause(double *start) {
    double *span=exclusive_span;
    if(span){*start=x86_profile_clock();exclusive_span=0;}
    return span;
}
static void exclusive_resume(double *span,double start) {
    if(span){*span+=x86_profile_clock()-start;exclusive_span=span;}
}
/* Physical exclusive time is a union of disjoint, non-extrapolated intervals.
 * Sampling a tiny dispatch also samples timer overhead; scaling that overhead by
 * ~1024 can exceed the entire update budget. Keep those samples diagnostic only.
 * A state transition reads the same monotonic host clock as update wall timing.
 * No clock at consecutive interpreted instructions, and no work when disabled.
 * Idle closes the interval BEFORE Asyncify unwind/JSPI parking; resume reopens it.
 * Recursive interpreter/native/scheduler calls save only the prior state, so an
 * inner interpreter interval is counted once, never both by parent and child. */
static int interpreter_span_active;
static double interpreter_span_start,interpreter_span_us;
static int interpreter_span_set(int active) {
    if (!X86_PROFILE_ENABLED) return 0;
    int previous = interpreter_span_active;
    if (active != previous) {
        double now = bgt_time_us();
        if (previous) interpreter_span_us += now - interpreter_span_start;
        interpreter_span_start = now;
        interpreter_span_active = active;
    }
    return previous;
}
double x86_interpreter_exclusive_us(void) {
    return interpreter_span_us+(interpreter_span_active?bgt_time_us()-interpreter_span_start:0);
}
/* C return restorations cannot run after a host exception or wasm trap. The host
 * calls this only after the abandoned stack has exited (never on a normal yield).
 * Use its timestamp, not an import that could throw again. Missing/invalid clock
 * discards only the open interval. Idempotent even after explicit x86_fault.
 * In particular, never retain a sampled pointer into the abandoned C stack or
 * reopen a discarded interval through a stale idle_end restoration. Guest SEH
 * and longjmp use X.transfer and the ordinary return restorations instead. */
BGT_EXPORT(bgt_profile_abort) void x86_profile_abort(double now_us) {
    if (interpreter_span_active && __builtin_isfinite(now_us) && now_us >= interpreter_span_start)
        interpreter_span_us += now_us - interpreter_span_start;
    interpreter_span_active = 0;
    exclusive_span = 0;
    idle_exclusive = idle_pending = 0;
}
static uint64_t interpreter_bucket;
static uint64_t interpreter_generation;
unsigned x86_lift_reason = XE_FORM;
const x86_insn_t *x86_lift_pending;
uint32_t x86_lift_count;
void x86_lift_block(uint32_t count);
#ifdef X86_FLAT_GUEST
uint8_t *x86_flat;
uint64_t x86_guest_committed;
#endif
/* LANE-C: architecture-independent cooperative hook. */
static void (*scheduler)(void);
void x86_set_scheduler(void (*schedule)(void)) { scheduler = schedule; }
void x86_cooperate(void) {
    if (!scheduler) x86_fault("AMD64 instruction budget exhausted without scheduler", X.eip);
    X.frame_insns = 0;
    double start=0,*span=exclusive_pause(&start);
    int active=interpreter_span_set(0);
    scheduler();
    interpreter_span_set(active);
    exclusive_resume(span,start);
}
uint32_t x86_address(uint64_t a) { if(a>UINT32_MAX)x86_fault("64-bit guest pointer outside low address space",X.eip);return (uint32_t)a; }

static void profiled_native(x86_lifted_fn fn) {
    double paused=0,*span=exclusive_pause(&paused);
    int active=interpreter_span_set(0);
    double start=x86_profile_begin(XP_NATIVE);fn();x86_profile_end(XP_NATIVE,start);
    interpreter_span_set(active);
    exclusive_resume(span,paused);
}

/* ------------------------------------------------------------------ host arena */
extern unsigned char __heap_base;
static uintptr_t arena_top;

uint64_t x86_host_limit(void) {
#ifdef X86_FLAT_GUEST
    return X86_HOST_ARENA_BYTES;
#else
    return UINT32_MAX - (((uintptr_t)&__heap_base + 15u) & ~(uintptr_t)15u);
#endif
}
static void *x86_host_backing(uint32_t size) {
    if (!arena_top) arena_top = ((uintptr_t)&__heap_base + 15u) & ~(uintptr_t)15u;
    uintptr_t p = arena_top;
    uint64_t end64 = (uint64_t)p + (((uint64_t)size + 15u) & ~15ull);
#ifdef X86_FLAT_GUEST
    if (!x86_flat) {
        uintptr_t base = ((uintptr_t)&__heap_base + X86_HOST_ARENA_BYTES + 65535u) & ~65535u;
        x86_flat = (uint8_t *)base;
    }
    if (end64 > (uint64_t)(((uintptr_t)&__heap_base + 15u) & ~(uintptr_t)15u) + X86_HOST_ARENA_BYTES) return 0;
#endif
    if (end64 > UINT32_MAX) return 0;
    uintptr_t end = (uintptr_t)end64;
    uintptr_t have = (uintptr_t)__builtin_wasm_memory_size(0) * 65536u;
    if (end > have) {
        uintptr_t pages = (end - have + 65535u) / 65536u;
        if (__builtin_wasm_memory_grow(0, pages) == (uintptr_t)-1) return 0;
    }
    arena_top = end;
    __builtin_memset((void *)p, 0, size); /* grown memory is zeroed, but be explicit for reuse */
    return (void *)p;
}

#include "x86_host.h"

uint8_t *x86_map(uint32_t addr, uint32_t size) {
    if (!size) return 0;
#ifdef X86_FLAT_GUEST
    if ((uint64_t)addr + size > X86_FLAT_BYTES) return 0;
    if (!x86_flat && !x86_alloc(16)) return 0;
    uint64_t end = (uint64_t)(uintptr_t)x86_flat + addr + size;
    uint64_t have = (uint64_t)__builtin_wasm_memory_size(0) * 65536u;
    if (end > have) {
        uint32_t pages = (uint32_t)((end - have + 65535u) / 65536u);
        if (__builtin_wasm_memory_grow(0, pages) == (uintptr_t)-1) return 0;
    }
    if (x86_guest_committed < (uint64_t)addr + size) x86_guest_committed = (uint64_t)addr + size;
    uint32_t flat_last = (uint32_t)(((uint64_t)addr + size - 1) >> 12);
    for (uint32_t p = addr >> 12; p <= flat_last; p++)
        x86_pages[p] = x86_flat + ((uintptr_t)p << 12);
    return x86_flat + addr;
#endif
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
    if ((uint64_t)addr + size > 0x100000000ull) return 0;
    if (!size) return 1;
    uint32_t last = (uint32_t)(((uint64_t)addr + size - 1) >> 12);
    for (uint32_t i = addr >> 12; i <= last; i++) if (!x86_pages[i]) return 0;
    return 1;
}

/* ------------------------------------------------------------------ faults */
static char fault_buf[768];
static const char HEX[] = "0123456789abcdef";

void x86_fault(const char *msg, uint32_t eip) {
    interpreter_span_set(0);
    x86_coverage_flush();
    uint32_t n = 0;
    const char *p = "x86: ";
    while (*p && n + 32 < sizeof fault_buf) fault_buf[n++] = *p++;
    while (*msg && n + 32 < sizeof fault_buf) fault_buf[n++] = *msg++;
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
/* Exact-PC direct-mapped lookup: cache only immutable registry results, not guest pointers.
 * Permissions and force-interpreter are checked on every hit. Registration invalidates all slots. */
static struct { uint32_t addr; x86_lifted_fn fn; x86_native_fn native; int valid; } lifted_cache[1024];

void x86_register_lifted(const x86_lifted_entry_t *table, uint32_t n) {
    lifted = table;
    nlifted = n;
    __builtin_memset(lifted_cache, 0, sizeof lifted_cache);
    /* LANE-C: i386 continuation entries are not additional functions. */
    x86_metrics.lifted_functions = 0;
    for (uint32_t i = 0; i < n; i++)
        if (table[i].end) x86_metrics.lifted_functions++;
}

x86_lifted_fn x86_find_lifted(uint32_t addr) {
    if(x86_pages[addr>>12] && x86_protection[addr>>12])x86_check_access(addr,1,4);
    if (x86_force_interp) return 0;
    unsigned slot = (addr ^ (addr >> 10)) & 1023u;
    if (lifted_cache[slot].valid && lifted_cache[slot].addr == addr) {
#if X86_COVERAGE_MODE == 2
        if (lifted_cache[slot].fn) x86_coverage_entry(addr,1);
#endif
        return lifted_cache[slot].fn;
    }
    x86_lifted_fn found = 0; x86_native_fn native = 0;
    /* LANE-C: i386 exact continuation entries and AMD64 instruction ranges. */
    uint32_t lo = 0, hi = nlifted;
    while (lo < hi) {
        uint32_t mid = (lo + hi) / 2;
        if (lifted[mid].addr <= addr) lo = mid + 1; else hi = mid;
    }
    if (lo) {
        const x86_lifted_entry_t *e = &lifted[lo - 1];
        if (addr == e->addr || addr < e->end) { found = e->fn; native = e->native; }
    }
    lifted_cache[slot].addr = addr; lifted_cache[slot].fn = found;
    lifted_cache[slot].native = native; lifted_cache[slot].valid = 1;
#if X86_COVERAGE_MODE == 2
    if (found) x86_coverage_entry(addr,1);
#endif
    return found;
}

static x86_native_fn find_native(uint32_t addr) {
    if (!x86_find_lifted(addr)) return 0;
    return lifted_cache[(addr ^ (addr >> 10)) & 1023u].native;
}
/* Each nested invocation installs its own stop boundary. Native chaining must not consume
 * a caller continuation past the return requested by callbacks or cold generic CALLs. */
static uint32_t native_stop, native_floor;
static int native_limit;

/* ------------------------------------------------------------------ thunks */
static uint32_t thunk_lo, thunk_hi;
static x86_thunk_fn thunk_fn;
static x86_import_binding_t *import_buckets[1024];
static uint32_t import_generation = 1;
static const x86_import_binding_t *pending_import;
void x86_set_thunks(uint32_t lo, uint32_t hi, x86_thunk_fn fn) {
    thunk_lo = lo; thunk_hi = hi; thunk_fn = fn;
    __builtin_memset(import_buckets,0,sizeof import_buckets);
    pending_import=0;
    if(!++import_generation)x86_fault("import generation exhausted",0);
}
void x86_bind_import(uint32_t iat,uint32_t target,void *opaque,
                     x86_bound_import_fn call,x86_leaf_import_fn leaf) {
    unsigned h=(iat^(iat>>12))&1023u;
    x86_import_binding_t *b=x86_alloc(sizeof *b);
    if(!b)x86_fault("import binding allocation failed",iat);
    *b=(x86_import_binding_t){iat,target,opaque,call,leaf,import_buckets[h]};
    import_buckets[h]=b;
    if(!++import_generation)x86_fault("import generation exhausted",iat);
}
static const x86_import_binding_t *import_binding(x86_import_site_t *site,uint64_t target) {
    if(site->generation!=import_generation) {
        unsigned h=(site->iat^(site->iat>>12))&1023u;
        site->binding=import_buckets[h];
        while(site->binding&&site->binding->iat!=site->iat)site->binding=site->binding->next;
        site->generation=import_generation;
    }
    return site->binding&&target==site->binding->target?site->binding:0;
}
int x86_try_import(x86_import_site_t *site,uint64_t target) {
    const x86_import_binding_t *b=import_binding(site,target);
    if(!b||!b->leaf)return 0;
    /* No guest locals/pointers remain authoritative in the caller. This signature's
     * entire reachable target set is explicitly non-suspending, unlike call(void*). */
    if(!b->leaf(b->opaque,target))return 0;
    x86_metrics.direct_import_calls++;x86_metrics.leaf_import_calls++;
    return 1;
}
int x86_defer_import(x86_import_site_t *site,uint64_t target) {
    pending_import=import_binding(site,target);
    return pending_import!=0;
}
int x86_is_thunk(uint32_t addr) { return addr >= thunk_lo && addr < thunk_hi; }
/* Native regions have already spilled and returned. Only this tiny wrapper may suspend,
 * invoke callbacks, grow memory or transfer; it never holds a local guest register/pointer. */
void x86_lift_thunk(void) {
#ifdef X86_FLAT_GUEST
    if (!X.transfer && !x86_lift_pending && !x86_lift_count && x86_is_thunk(X.eip)) {
        x86_metrics.thunk_dispatches++;
        thunk_fn(X.eip);
    }
#endif
}

/* One flat native driver for all owners. Native steps return before host calls/suspension;
 * guest recursion and tail cycles consume no recursive C frames. Legacy/override entries
 * (native=NULL), semantic work and quantum crossings return to the ordinary dispatcher. */
void x86_run_native(x86_native_fn step) {
#ifdef X86_FLAT_GUEST
    uint32_t stop = native_stop, floor = native_floor; int limit = native_limit;
    for (;;) {
        uint32_t old = X.eip; uint64_t clock = X.tsc;
        step(X.eip);
        if (X.transfer || x86_lift_pending || x86_lift_count) return;
        if (X.eip == old && X.tsc == clock) x86_fault("lifted AMD64 entry made no progress", old);
        if (limit && X.eip == stop && X.r[ESP] > floor) return;
        if (pending_import) {
            const x86_import_binding_t *b=pending_import;pending_import=0;
            x86_metrics.direct_import_calls++;
            b->call(b->opaque);
        } else if (x86_is_thunk(X.eip)) x86_lift_thunk();
        if (X.transfer || x86_lift_pending || x86_lift_count) return;
        if (limit && X.eip == stop && X.r[ESP] > floor) return;
        /* A naked call outside invoke has no return boundary; execute only its supplied step. */
        if (!limit || !(step = find_native(X.eip))) return;
        x86_metrics.lifted_calls++;
    }
#else
    step(X.eip);
#endif
}

/* Coverage is block/continuation entry evidence, not an instruction trace. The host
 * deduplicates addresses. Function census uses a bounded byte per analyzed owner. */
static const x86_code_range_t *code_ranges, *cached_range;
static uint32_t ncode_ranges, cached_lo;
static uint64_t cached_hi;
static uint8_t *interpreted_owners;
static const uint32_t *code_owner_addresses;
static x86_interpreter_coverage_t interpreter_coverage={.capacity=X86_INTERPRETER_CAP};
static uint32_t *interpreter_index;
static uint32_t interpreter_record,interpreter_rows_allocated;
void x86_register_code_owner_addresses(const uint32_t *addresses) {code_owner_addresses=addresses;}
const x86_interpreter_coverage_t *x86_interpreter_coverage(void) {return &interpreter_coverage;}
static uint32_t interpreter_row(uint32_t address,const x86_code_range_t *range) {
    if(X86_COVERAGE_MODE==2)return 0;
    if(!interpreter_index)interpreter_index=x86_alloc(X86_INTERPRETER_CAP*sizeof(uint32_t));
    if(!interpreter_index){interpreter_coverage.dropped++;return 0;}
    uint32_t h=(address*2654435761u)&(X86_INTERPRETER_CAP-1);
    for(unsigned i=0;i<16;i++,h=(h+1)&(X86_INTERPRETER_CAP-1)){
        uint32_t row=interpreter_index[h];
        if(row && interpreter_coverage.rows[row-1].address==address)return row;
        if(!row && interpreter_coverage.length<X86_INTERPRETER_CAP){
            if(interpreter_coverage.length==interpreter_rows_allocated){
                uint32_t n=interpreter_rows_allocated?interpreter_rows_allocated*2:256;
                if(n>X86_INTERPRETER_CAP)n=X86_INTERPRETER_CAP;
                x86_interpreter_entry_t *rows=x86_alloc(n*sizeof(*rows));
                if(!rows){interpreter_coverage.dropped++;return 0;}
                if(interpreter_coverage.length)__builtin_memcpy(rows,interpreter_coverage.rows,interpreter_coverage.length*sizeof(*rows));
                x86_host_free(interpreter_coverage.rows);interpreter_coverage.rows=rows;interpreter_rows_allocated=n;
            }
            row=++interpreter_coverage.length;interpreter_index[h]=row;
            x86_interpreter_entry_t *e=&interpreter_coverage.rows[row-1];
            e->address=address;e->owner=range?(code_owner_addresses?code_owner_addresses[range->owner]:range->addr):UINT32_MAX;
            return row;
        }
    }
    interpreter_coverage.dropped++;return 0;
}
void x86_register_code_ranges(const x86_code_range_t *ranges, uint32_t count, uint32_t functions) {
    code_owner_addresses=0;
    code_ranges = ranges; ncode_ranges = count; cached_range = 0; cached_lo = 0; cached_hi = 0;
    interpreted_owners = functions ? x86_alloc(functions) : 0;
    if (functions && !interpreted_owners) x86_fault("out of memory (coverage owners)", 0);
}
static int interpreted_entry(uint32_t addr, int entry) {
    int changed = addr < cached_lo || (uint64_t)addr >= cached_hi;
    if (changed) {
        uint32_t lo = 0, hi = ncode_ranges;
        while (lo < hi) { uint32_t m = (lo + hi) / 2; if (code_ranges[m].addr <= addr) lo = m + 1; else hi = m; }
        cached_range = lo && addr < code_ranges[lo-1].end ? &code_ranges[lo-1] : 0;
        cached_lo = cached_range ? cached_range->addr : lo ? code_ranges[lo-1].end : 0;
        cached_hi = cached_range ? cached_range->end : lo < ncode_ranges ? code_ranges[lo].addr : 0x100000000ull;
    }
    /* Entering an unowned gap is also a continuation boundary. Cache the gap
     * so its remaining straight-line instructions do not become entry events. */
    entry = entry || changed;
    if(entry)x86_coverage_entry(addr,2);
    if(entry || interpreter_generation!=x86_census_generation) {
        interpreter_generation=x86_census_generation;
        interpreter_bucket=x86_profile_exit(addr,XE_INTERPRETER);
    }
    return entry;
}
static void interpreted_count(uint32_t address, int entry, const x86_code_range_t *owner) {
    x86_metrics.interp_insns++;
    if(entry)interpreter_record=interpreter_row(address,owner);
    if(interpreter_record){
        x86_interpreter_entry_t *e=&interpreter_coverage.rows[interpreter_record-1];
        e->instructions++;if(entry)e->count++;
    }
    x86_profile_instruction(interpreter_bucket);
    if (owner && !interpreted_owners[owner->owner]) {
        interpreted_owners[owner->owner] = 1; x86_metrics.interp_functions++;
    }
    if (entry) {
        x86_metrics.interp_code_entries++;
        if (!owner) x86_metrics.interp_unowned_entries++;
    }
}
static int is_string(int op) {
    return op == XO_MOVS || op == XO_STOS || op == XO_LODS || op == XO_CMPS || op == XO_SCAS;
}
static int ends_block(const x86_insn_t *in) {
    switch (in->op) {
    case XO_CALL: case XO_CALL_IND: case XO_RET: case XO_JMP: case XO_JMP_IND:
    case XO_JCC: case XO_LOOP: case XO_LOOPE: case XO_LOOPNE: case XO_JECXZ: return 1;
    default: return 0;
    }
}

/* ------------------------------------------------------------------ interpreter loop */
/* decoded-instruction cache (direct mapped; self-modifying code is not supported in v0.2) */
#define DC_SIZE 8192u
typedef struct { uint32_t addr; x86_insn_t in; } dc_entry_t;
static dc_entry_t *dcache;

/* Return an owned value, never a cache pointer: execution can cooperate before
 * its first operand read (and REP can cooperate internally). Reentrant guest
 * execution may replace any direct-mapped slot while this C frame is parked. */
static x86_insn_t decode_at(uint32_t eip) {
    x86_check_access(eip,1,4);
    if (!dcache) {
        dcache = (dc_entry_t *)x86_alloc(DC_SIZE * sizeof(dc_entry_t));
        if (!dcache) x86_fault("out of memory (decode cache)", eip);
        for (uint32_t i = 0; i < DC_SIZE; i++) dcache[i].addr = 0xffffffffu;
    }
    dc_entry_t *e = &dcache[(eip ^ (eip >> 13)) & (DC_SIZE - 1)];
    if (e->addr == eip) return e->in;
    uint8_t buf[15];
    uint32_t avail = 0;
    for (; avail < 15; avail++) {
        uint8_t *p = x86_host(eip + avail);
        if (!p) break;
        buf[avail] = *p;
    }
    if (!avail) x86_fault("execute from unmapped memory", eip);
    if (!x86_decode_mode(buf, avail, eip,
#ifdef X86_FLAT_GUEST
        1,
#else
        0,
#endif
        &e->in)) x86_fault("undecodable instruction", eip);
    e->addr = eip;
    return e->in;
}

/* run until EIP == ret_addr with ESP > esp_floor */
static void interp_loop(uint32_t ret_addr, uint32_t esp_floor) {
#ifdef X86_FLAT_GUEST
    {
        int entry = 1;
        for(;;) {
            if (X.eip == X86_THREAD_RETURN) X.transfer = X86_SCHEDULE; /* LANE-C */
            if(X.transfer)return;
            if(X.eip==ret_addr && X.r[ESP]>esp_floor)return;
            if(x86_is_thunk(X.eip)){interpreter_span_set(0);x86_metrics.thunk_dispatches++;thunk_fn(X.eip);entry=1;continue;}
            x86_lifted_fn f=x86_find_lifted(X.eip);
            if (f) {
                entry = 1;
                uint32_t old = X.eip;
                uint64_t old_clock = X.tsc;
                interpreter_span_set(0);
                x86_metrics.lifted_calls++;
                profiled_native(f);
                if (x86_lift_pending) {
                    const x86_insn_t *pending = x86_lift_pending; x86_lift_pending = 0;
                    x86_exec_one(pending);
                } else if (x86_lift_count) {
                    uint32_t count = x86_lift_count; x86_lift_count = 0;
                    x86_lift_block(count);
                } else if (X.eip == old && X.tsc == old_clock && !X.transfer) {
                    x86_fault("lifted AMD64 entry made no progress", old);
                }
            }
            else {
                interpreter_span_set(1);
                double interpreter_start=x86_profile_begin(XP_INTERPRETER),excluded=0;
                if(interpreter_start>=0)exclusive_span=&excluded;
                const x86_insn_t decoded = decode_at(X.eip);
                const x86_insn_t *in = &decoded;
                int counted_entry = interpreted_entry(X.eip, entry);
                const x86_code_range_t *owner = cached_range;
                uint32_t budget = X.frame_insns, addr = in->addr;
                int next_entry = ends_block(in), string = is_string(in->op), rep = in->rep;
                x86_word_t count = X.r[ECX];
                uint64_t saved_bucket=interpreter_bucket;
                uint32_t saved_record=interpreter_record;
                x86_exec64(in);
                if(interpreter_start>=0){x86_interpreter_exclusive_sample_us+=x86_profile_clock()-interpreter_start-excluded;exclusive_span=0;}
                x86_profile_end(XP_INTERPRETER,interpreter_start);
                interpreter_bucket=saved_bucket;interpreter_record=saved_record;
                /* Both dispatch and the first string iteration can transfer before execution.
                 * A partially executed REP changes its count and still counts once. A zero-
                 * count REP completes at next, so it also remains a completed dispatch.
                 * Keep all evidence local: a scheduler callback may interpret reentrantly. */
                if (!(X.transfer && X.eip == addr && (string ?
                      (!rep || X.r[ECX] == count) : budget >= 2000000u))) interpreted_count(addr, counted_entry, owner);
                entry = next_entry;
            }
        }
    }
#endif
    int entry = 1;
    for (;;) {
        uint32_t eip = X.eip;
        if (eip == X86_THREAD_RETURN) X.transfer = X86_SCHEDULE; /* LANE-C */
        if (X.transfer) return;
        if (eip == ret_addr && X.r[ESP] > esp_floor) return;
        if (x86_is_thunk(eip)) {
            interpreter_span_set(0);
            x86_metrics.thunk_dispatches++;
            if (thunk_fn(eip)) return;
            entry = 1;
            continue;
        }
        /* LANE-C: resume a suspended i386 caller without interpreting its continuation. */
        x86_lifted_fn resume = x86_find_lifted(eip);
        if (resume) { interpreter_span_set(0);x86_metrics.lifted_calls++; profiled_native(resume); entry = 1; continue; }
        /* LANE-C: mirror the lifted i386 instruction quantum. */
        if (++X.frame_insns > 2000000u) { x86_cooperate(); if (X.transfer) return; }
        interpreter_span_set(1);
        double interpreter_start=x86_profile_begin(XP_INTERPRETER),excluded=0;
        if(interpreter_start>=0)exclusive_span=&excluded;
        const x86_insn_t decoded = decode_at(eip);
        const x86_insn_t *in = &decoded;
        int counted_entry = interpreted_entry(eip, entry);
        const x86_code_range_t *owner = cached_range;
        int string = is_string(in->op), rep = in->rep, next_entry = ends_block(in);
        uint32_t addr = in->addr;
        x86_word_t count = X.r[ECX];
        if (!string) interpreted_count(addr, counted_entry, owner);
        if ((in->op == XO_CALL || in->op == XO_CALL_IND) && !x86_force_interp) {
            uint32_t t = in->op == XO_CALL ? in->target : xs_read(&in->o[0]);
            x86_lifted_fn fn = x86_find_lifted(t);
            if (fn) {
                uint32_t next = in->addr + in->len;
                x86_push(next);
                x86_metrics.lifted_calls++;
                profiled_native(fn);
                if(interpreter_start>=0){x86_interpreter_exclusive_sample_us+=x86_profile_clock()-interpreter_start-excluded;exclusive_span=0;}
                x86_profile_end(XP_INTERPRETER,interpreter_start);
                entry = 1;
                if (X.transfer) return; /* LANE-C */
                if (X.eip != next) x86_fault("lifted callee returned to an unexpected address", in->addr);
                continue;
            }
        }
        uint64_t saved_bucket=interpreter_bucket;
        uint32_t saved_record=interpreter_record;
        x86_exec_insn(in);
        if(interpreter_start>=0){x86_interpreter_exclusive_sample_us+=x86_profile_clock()-interpreter_start-excluded;exclusive_span=0;}
        x86_profile_end(XP_INTERPRETER,interpreter_start);
        interpreter_bucket=saved_bucket;interpreter_record=saved_record;
        /* i386's outer quantum check already ran; strings have an inner check too. */
        if (string && !(X.transfer && X.eip == addr && (!rep || X.r[ECX] == count)))
            interpreted_count(addr, counted_entry, owner);
        entry = next_entry;
    }
}

static void interp_until(uint32_t ret_addr, uint32_t esp_floor) {
    uint32_t saved_stop = native_stop, saved_floor = native_floor; int saved_limit = native_limit;
    native_stop = ret_addr; native_floor = esp_floor; native_limit = 1;
    int active=interpreter_span_set(0);
    interp_loop(ret_addr, esp_floor);
    interpreter_span_set(active);
    native_stop = saved_stop; native_floor = saved_floor; native_limit = saved_limit;
}

static void invoke_inner(uint32_t target, uint32_t ret_addr) {
    X.eip = target; /* LANE-C: every lifted entry has a continuation dispatcher. */
    uint32_t esp_floor = (uint32_t)X.r[ESP]; /* return address is at [esp_floor] */
#ifdef X86_FLAT_GUEST
    X.eip=target;interp_until(ret_addr,esp_floor);return;
#endif
    x86_lifted_fn fn = x86_find_lifted(target);
    if (fn) {
        x86_coverage_lifted(target,1);
        x86_metrics.lifted_calls++;
        profiled_native(fn);
        return;
    }
    X.eip = target;
    interp_until(ret_addr, esp_floor);
}

void x86_invoke(uint32_t target, uint32_t ret_addr) {
    double start=0,*span=exclusive_pause(&start);
    int active=interpreter_span_set(0);
    invoke_inner(target,ret_addr);
    interpreter_span_set(active);
    exclusive_resume(span,start);
}

void x86_call(uint32_t target, uint32_t next) {
    x86_push(next);
    x86_invoke(target, next);
    if (X.transfer) return; /* LANE-C */
    if (X.eip != next) x86_fault("callee returned to an unexpected address", target);
}

void x86_continue(uint32_t ra, uint32_t esp0) {
    /* a jump straight to a lifted function entry with the frame torn down is a tail call */
    if (X.r[ESP] == esp0) {
        x86_lifted_fn fn = x86_find_lifted(X.eip);
        if (fn) { x86_metrics.tail_calls_lifted++; x86_metrics.lifted_calls++; profiled_native(fn); return; }
    }
    /* a tail jump to an import thunk is an API call, not interpretation */
    if (!x86_is_thunk(X.eip)) x86_metrics.continues_interpreted++;
    interp_until(ra, esp0);
}

/* Cold quantum-crossing path for a straight-line lifted block. Unlike interpretation/fallback
 * entries this is bounded by the statically emitted block length and uses the generic semantic
 * counter. It preserves the exact instruction at which the reference cooperates. */
void x86_lift_block(uint32_t count) {
    uint64_t bucket=x86_profile_exit(X.eip,x86_lift_reason);
    while (count--) {
        const x86_insn_t decoded = decode_at(X.eip);
        const x86_insn_t *in = &decoded;
        uint32_t next = in->addr + in->len;
        int call = in->op == XO_CALL || in->op == XO_CALL_IND;
        x86_profile_instruction(bucket);
        x86_metrics.generic_insn_execs++;
        double generic_start=x86_profile_begin(XP_GENERIC);
        x86_exec_insn(in);
        x86_profile_end(XP_GENERIC,generic_start);
        /* LANE-F/C: a quantum transfer can precede this pending CALL's execution. */
        if (X.transfer) return;
        if (call) x86_invoke(X.eip, next);
        if (X.transfer) return;
    }
}

void x86_exec_one(const x86_insn_t *in) {
    x86_profile_instruction(x86_profile_exit(in->addr,XE_FORM));
    x86_metrics.generic_insn_execs++;
    double start=x86_profile_begin(XP_GENERIC);
    x86_exec_insn(in);
    x86_profile_end(XP_GENERIC,start);
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
uint64_t x86_callback64(uint32_t fn,uint32_t nargs,const uint64_t *args) {
#if !defined(X86_FLAT_GUEST) && !defined(X86_WIDE_CPU)
    (void)nargs;(void)args;x86_fault("Win64 callback in i386 process",fn);
#else
    uint64_t saved[16];__builtin_memcpy(saved,X.r,sizeof saved);
    x86_vec_t xmm[16];__builtin_memcpy(xmm,X.xmm,sizeof xmm);
    uint32_t ip=X.eip;uint64_t sp=(X.r[ESP]-32u-8u*(nargs>4?nargs-4:0))&~15ull;
    X.r[ESP]=sp;
    static const int regs[4]={ECX,EDX,R8,R9};
    for(uint32_t i=0;i<nargs;i++) {if(i<4)X.r[regs[i]]=args[i];else x86_wr64((uint32_t)sp+32+8*(i-4),args[i]);}
    X.callback_depth++; /* LANE-C */
    x86_push(X86_CALLBACK_SENTINEL);x86_invoke(fn,X86_CALLBACK_SENTINEL);
    X.callback_depth--;
    uint64_t result=X.r[EAX];
    if(!X.transfer){__builtin_memcpy(X.r,saved,sizeof saved);__builtin_memcpy(X.xmm,xmm,sizeof xmm);X.eip=ip;}
    return result;
#endif
}
uint32_t x86_callback(uint32_t fn, uint32_t nargs, const uint32_t *args) {
#ifdef X86_FLAT_GUEST
    {uint64_t a[16];if(nargs>16)x86_fault("callback too many arguments",fn);for(uint32_t i=0;i<nargs;i++)a[i]=args[i];return (uint32_t)x86_callback64(fn,nargs,a);}
#endif
    uint32_t saved_esp = X.r[ESP], saved_eip = X.eip;
    for (uint32_t i = nargs; i > 0; i--) x86_push(args[i - 1]);
    X.callback_depth++; /* LANE-C */
    x86_push(X86_CALLBACK_SENTINEL);
    x86_invoke(fn, X86_CALLBACK_SENTINEL);
    X.callback_depth--;
    if (X.eip != X86_CALLBACK_SENTINEL) x86_fault("callback did not return", fn);
    X.r[ESP] = saved_esp;
    X.eip = saved_eip;
    return X.r[EAX];
}
