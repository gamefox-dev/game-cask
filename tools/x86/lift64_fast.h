/* K52 fast AMD64 emission (pipeline.liftMode "fast", x86tool --lift-mode fast). MIT.
 *
 * Performance-first shape, opt-in; the exact emitter in lift64.h stays the default and fallback
 * (functions above L64F_MAX_INSNS keep it). See docs/pipeline.md "Fast lifting mode (K52)".
 *  - one C function per guest function, guest GPRs/flags/clock in C locals, published to X only
 *    at calls, returns, generic instructions and exits;
 *  - entries only at the function start, loop headers (quantum resumes) and post-call return
 *    sites; any other PC takes the slow path (one interpreted instruction, then retry);
 *  - flag liveness with calls/returns/tail calls as ABI boundaries, fused compare+branch;
 *  - flat memory: window mask (default) or one committed-range compare, no page tables; stack
 *    slots at a static RSP delta address one base pointer plus a constant;
 *  - quantum polls only at function entries and loop headers, inline when the profile's probe
 *    proves the scheduler cannot suspend/transfer; direct calls/tail calls are depth-bounded C
 *    calls, small direct callees are inlined on the caller's locals, generics execute inline.
 * Dropped on purpose (STRATEGY-UNRESTRICTED): exact fault order/state, per-instruction entries,
 * page holes/protections inside the window, coverage beyond function entries, exact quantum
 * position, flags observed across calls/returns, ABI-violating callee-saved clobbers. */
#define L64F_MAX_INSNS 4096u
#define L64F_DEPTH "128u"
static int lift_fast;             /* --lift-mode fast */
static int lift_fast_resume = 1;  /* --fast-resume off: post-call sites are not entries (measurement) */
static int lift_fast_fuse = 1;    /* --fast-fuse off: no fused predicates (measurement) */
/* Ablation knobs (measurement only): --fast-entries all makes every block start an entry,
 * --fast-quantum block polls every block (--fast-memory/--fast-stack/--fast-inline in lift64.h/below). */
static int lift_fast_all_entries, lift_fast_block_quantum;
/* K72 measurement: --fast-mark on writes comments only (identical compiled code): a function marker and the guest
 * mnemonic before every emitted instruction (`+` = inlined copy), read by tools/report/wasm-size.mjs. */
static int lift_fast_mark;
static void l64f_mark(FILE *o, const x86_insn_t *in, int inlined) {
    if (!lift_fast_mark) return;
    char txt[160] = "", *s = txt;
    if (in->len && l64_specialized(in)) x86_format(in, txt, sizeof txt); else snprintf(txt, sizeof txt, "generic");
    if (in->op == XO_SIMD) { fprintf(o, "/*@%ss.", inlined ? "+" : ""); for (; *s && *s != ' '; s++) fputc(*s >= 'A' && *s <= 'Z' ? *s + 32 : *s, o); fputs("*/", o); return; }
    for (; *s && *s != ' '; s++) if (*s >= 'A' && *s <= 'Z') *s += 32;
    *s = 0;
    if (in->op == XO_JCC) snprintf(txt, sizeof txt, "jcc"); else if (in->op == XO_SETCC) snprintf(txt, sizeof txt, "setcc");
    else if (in->op == XO_CMOVCC) snprintf(txt, sizeof txt, "cmovcc"); else if (in->op == XO_CALL_IND) snprintf(txt, sizeof txt, "call_ind");
    else if (in->op == XO_JMP_IND) snprintf(txt, sizeof txt, "jmp_ind");
    for (s = txt; *s; s++) if (!((*s >= 'a' && *s <= 'z') || (*s >= '0' && *s <= '9') || *s == '_' || *s == '.')) *s = '_';
    fprintf(o, "/*@%s%s*/", inlined ? "+" : "", txt);
}
static uint32_t lift_fast_functions, lift_fast_inlined;
#define L64F_EXT (-2)
typedef struct { int s[2]; const vec_t *table; uint32_t ext; } l64f_succ_t;
static const uint16_t l64f_volatile = (1u << EAX) | (1u << ECX) | (1u << EDX) | (1u << R8) | (1u << R9) | (1u << R10) | (1u << R11);

static int l64f_contiguous(const func_t *f, const x86_insn_t *ins, uint32_t k) {
    return k + 1 < f->insns.n && ins[k].len && ins[k].addr + ins[k].len == f->insns.v[k + 1];
}
static int l64f_control(const x86_insn_t *in) {
    return in->op == XO_JCC || in->op == XO_JMP || in->op == XO_JMP_IND || in->op == XO_CALL ||
        in->op == XO_CALL_IND || in->op == XO_RET;
}
/* Fast-mode flag effects (local liveness): unknown/generic code observes everything; the Win64 ABI makes flags dead
 * across calls and returns (callee/caller never read them). */
static void l64f_flag_io(const x86_insn_t *in, uint32_t *r, uint32_t *w) {
    if (!in->len || !l64_specialized(in)) { *r = L64_FLAGS; *w = 0; return; }
    if (in->op == XO_CALL || in->op == XO_CALL_IND || in->op == XO_RET) { *r = 0; *w = L64_FLAGS; return; }
    l64_flag_io(in, r, w);
}
/* K75 observed flags (default; liftFast.flags "abi" = the K52 rule only, for measurement). Compiled guest code never
 * reads EFLAGS across a call or return, but the platform profile does see them: RtlCaptureContext, RaiseException
 * and APIs that raise (HeapAlloc with HEAP_GENERATE_EXCEPTIONS) store them in a CONTEXT. A second, interprocedural
 * liveness (l64f_obs_io) tracks only those observations, soundly:
 *  - a call or tail jump to an EFLAGS-storing profile import (tools/x86/lift64_eflags.h) reads every flag; other
 *    profile imports pass them through (x86_callback64 restores them around guest callbacks);
 *  - a call or tail jump whose callee is not statically known (an indirect call or unresolved indirect jump: function
 *    pointers, vtables, GetProcAddress results), an import that another guest module provides (--fast-guest-dlls),
 *    or code that is no analyzed function, reads every flag; after an unknown callee returns, the caller reloads
 *    X.flags, and every function whose address is taken (entry, export, relocated or immediate pointer) returns
 *    exact flags (fastFlagTakenExits), so whatever it reaches through a pointer, the callee is covered;
 *  - a direct call or tail call reads them when the callee observes its entry flags; a RET reads them when some
 *    caller observes the flags a callee returns with (that caller reloads X.flags after the call).
 * Writers are the instructions that define flags; everything else, generic instructions included, passes them
 * through (their local reads stay in the K52 liveness). l64f_observe computes the two function sets once per lift
 * over the whole module; emission uses the union of both livenesses, so only code on a path into such a call
 * computes otherwise dead flags. */
static int lift_fast_flags_abi;   /* --fast-flags abi */
static uint8_t *l64f_obs_entry, *l64f_exact_exit; /* per a->f index (l64f_observe); null: K52 rule */
static uint32_t l64f_obs_stats[4]; /* observing functions, exact-exit functions, unknown callees with live flags after, passes */
static uint32_t l64f_obs_taken;    /* address-taken functions marked exact-exit up front */
static const char *lift_fast_guest_dlls; /* --fast-guest-dlls: comma list of the other guest modules' DLL names */
static double l64f_obs_ms;      /* CPU time of l64f_observe (stats: fastFlagAnalysis_cpu_ms) */
/* addr -> a->f index by binary search (func_index is linear; the observation pass looks up every call). */
static uint64_t *l64f_fsorted; static uint32_t l64f_fsorted_n;
static int l64f_fidx(an_t *a, uint32_t addr) {
    if (!l64f_fsorted) return func_index(a, addr);
    uint32_t lo = 0, hi = l64f_fsorted_n;
    while (lo < hi) { uint32_t m = (lo + hi) / 2; if ((uint32_t)(l64f_fsorted[m] >> 32) < addr) lo = m + 1; else hi = m; }
    return lo < l64f_fsorted_n && (uint32_t)(l64f_fsorted[lo] >> 32) == addr ? (int)(uint32_t)l64f_fsorted[lo] : -1;
}
static int l64f_fn_observes(an_t *a, uint32_t target) {
    int g = l64f_fidx(a, target);
    return l64f_obs_entry && (g < 0 || l64f_obs_entry[g]);
}
static int l64f_fn_exact_exit(an_t *a, const func_t *f) {
    if (!l64f_exact_exit) return 0;
    int i = l64f_fidx(a, f->addr);
    return i >= 0 && l64f_exact_exit[i];
}
#include "lift64_eflags.h"
/* The import behind an IAT slot observes EFLAGS (lift64_eflags.h); a slot that names no import is unknown: observes. */
static int l64f_import_observes(an_t *a, uint32_t iat) {
    static const char *const names[] = {W32_EFLAGS_OBSERVERS};
    const import_t *im = import_at_iat(a->pe, iat);
    if (!im) return 1;
    for (unsigned i = 0; i < sizeof names / sizeof names[0]; i++) if (!strcmp(im->name, names[i])) return 1;
    return 0;
}
/* The import behind an IAT slot is another guest module's export (lifted guest code, not the profile). */
static int l64f_import_guest(an_t *a, uint32_t iat) {
    const import_t *im = import_at_iat(a->pe, iat);
    if (!im || !lift_fast_guest_dlls) return 0;
    size_t n = strlen(im->dll);
    for (const char *p = lift_fast_guest_dlls; *p;) {
        const char *e = strchr(p, ','); size_t m = e ? (size_t)(e - p) : strlen(p);
        if (m == n) {
            size_t i = 0;
            while (i < n && tolower((unsigned char)p[i]) == tolower((unsigned char)im->dll[i])) i++;
            if (i == n) return 1;
        }
        if (!e) break;
        p = e + 1;
    }
    return 0;
}
/* A profile import: the slot names an import that no other guest module provides. */
static int l64f_profile_hint(an_t *a, uint32_t hint) { return hint && import_at_iat(a->pe, hint) && !l64f_import_guest(a, hint); }
static void l64f_obs_io(an_t *a, const func_t *f, const x86_insn_t *in, uint32_t hint, int table, uint32_t *r, uint32_t *w) {
    *r = *w = 0;
    if (!in->len || !l64_specialized(in)) return;
    switch (in->op) {
    /* Profile calls pass EFLAGS through, the storing ones read them. An unknown callee reads and defines them. */
    case XO_CALL_IND:
        if (l64f_profile_hint(a, hint)) { if (l64f_import_observes(a, hint)) *r = L64_FLAGS; }
        else { *r = L64_FLAGS; *w = L64_FLAGS; }
        return;
    case XO_JMP_IND:
        if (l64f_profile_hint(a, hint)) { if (l64f_import_observes(a, hint) || l64f_fn_exact_exit(a, f)) *r = L64_FLAGS; }
        else if (hint || !table) *r = L64_FLAGS; /* unknown tail target (a recovered switch stays internal) */
        return;
    case XO_CALL: *r = l64f_fn_observes(a, in->target) ? L64_FLAGS : 0; *w = L64_FLAGS; return;
    case XO_RET: *r = l64f_fn_exact_exit(a, f) ? L64_FLAGS : 0; return;
    case XO_JMP: case XO_JCC:
        /* (Conditional) tail call: the callee sees our flags at entry and returns to our caller. */
        if (l64_index(f, in->target) < 0 && (l64f_fn_observes(a, in->target) || l64f_fn_exact_exit(a, f))) *r = L64_FLAGS;
        return;
    default: { uint32_t lr, lw; l64_flag_io(in, &lr, &lw); *w = lw; return; }
    }
}
/* Relative jump tables (clang: movsx r,[b+i*4]; add r,b; jmp r; MSVC: mov r32,[b+i*4+rva]; add r,b;
 * jmp r) whose base b is set by one constant LEA in the function. The recovered targets are only
 * switch candidates (hints): emitted code compares the real computed target, and a miss exits. */
static void l64f_regs(const x86_insn_t *in, uint32_t *used, uint32_t *written);
static void l64f_rel_table(an_t *a, const func_t *f, const x86_insn_t *ins, uint32_t k, vec_t *out) {
    const x86_opnd_t *j = &ins[k].o[0];
    if (j->kind != XK_REG || j->size != 8 || k < 2 || !l64f_contiguous(f, ins, k - 1) || !l64f_contiguous(f, ins, k - 2)) return;
    const x86_insn_t *add = &ins[k - 1], *ld = &ins[k - 2];
    if (add->op != XO_ADD || add->o[0].kind != XK_REG || add->o[0].reg != j->reg || add->o[0].size != 8 ||
        add->o[1].kind != XK_REG || add->o[1].size != 8) return;
    unsigned base = add->o[1].reg; const x86_opnd_t *m = &ld->o[1];
    int sext = ld->op == XO_MOVSX && ld->o[0].size == 8, zext = ld->op == XO_MOV && ld->o[0].size == 4;
    if ((!sext && !zext) || ld->o[0].kind != XK_REG || ld->o[0].reg != j->reg || m->kind != XK_MEM || m->size != 4 ||
        m->base != base || m->index == X86_NOREG || m->scale != 2 || m->seg_fs || (m->pad & 1)) return;
    uint64_t b = 0; int defs = 0;
    /* Prefer the nearest constant LEA of the base in the same straight-line run. */
    for (uint32_t q = k - 2; q > 0 && l64f_contiguous(f, ins, q - 1); q--) {
        const x86_insn_t *d = &ins[q - 1]; uint32_t used = 0, written = 0;
        if (d->op == XO_LEA && d->o[0].kind == XK_REG && d->o[0].reg == base && d->o[0].size == 8 &&
            d->o[1].base == X86_NOREG && d->o[1].index == X86_NOREG) {
            b = (d->o[1].pad & 4) ? d->o[1].imm : (d->o[1].pad & 2) ? (uint32_t)d->o[1].disp : (uint64_t)(int64_t)d->o[1].disp;
            defs = 1; break;
        }
        if (!d->len || !l64_specialized(d) || l64f_control(d)) break;
        l64f_regs(d, &used, &written);
        if (written & (1u << base)) break;
    }
    if (!defs) for (uint32_t q = 0; q < f->insns.n; q++) {
        const x86_insn_t *d = &ins[q];
        if (d->op != XO_LEA || d->o[0].kind != XK_REG || d->o[0].reg != base || d->o[0].size != 8 ||
            d->o[1].base != X86_NOREG || d->o[1].index != X86_NOREG) continue;
        uint64_t v = (d->o[1].pad & 4) ? d->o[1].imm : (d->o[1].pad & 2) ? (uint32_t)d->o[1].disp : (uint64_t)(int64_t)d->o[1].disp;
        if (defs++ && v != b) return;
        b = v;
    }
    if (!defs || b > UINT32_MAX) return;
    /* Bound from `cmp idx,imm` (following register copies of the index); otherwise read entries
     * until the first one that is not an instruction of this function (capped). */
    uint32_t bound = 0, aliases = 1u << m->index;
    for (uint32_t q = k - 2; q > 0 && k - q < 16; q--) {
        const x86_insn_t *c = &ins[q - 1];
        if (!l64f_contiguous(f, ins, q - 1)) break;
        if (c->op == XO_CMP && c->o[0].kind == XK_REG && c->o[0].reg < 16 && (aliases >> c->o[0].reg & 1) &&
            c->o[1].kind == XK_IMM && c->o[1].imm < 4096) { bound = (uint32_t)c->o[1].imm + 1; break; }
        if (c->op == XO_MOV && c->o[0].kind == XK_REG && c->o[1].kind == XK_REG && c->o[0].reg < 16 && c->o[1].reg < 16 &&
            (aliases >> c->o[0].reg & 1) && c->o[0].size >= 4) aliases |= 1u << c->o[1].reg;
    }
    uint64_t table = b + (uint64_t)(int64_t)m->disp;
    int capped = !bound;
    if (capped) bound = 256;
    for (uint32_t i = 0; i < bound; i++) {
        if (table + 4ull * i + 4 > UINT32_MAX || !in_image(a->pe, (uint32_t)(table + 4 * i), 4)) { if (capped) break; out->n = 0; return; }
        uint32_t e = r32(a->pe->img + (uint32_t)table + 4 * i - a->pe->base);
        uint64_t t = b + (sext ? (uint64_t)(int64_t)(int32_t)e : e);
        if (t > UINT32_MAX || l64_index(f, (uint32_t)t) < 0) { if (capped) break; out->n = 0; return; }
        vpush(out, (uint32_t)t);
    }
    vsort_uniq(out);
}
static l64f_succ_t l64f_successors(const func_t *f, const x86_insn_t *ins, uint32_t k, const uint32_t *hints, const vec_t *rel) {
    const x86_insn_t *in = &ins[k];
    l64f_succ_t s = {{-1, -1}, 0, 0};
    int fall = l64f_contiguous(f, ins, k) ? (int)k + 1 : L64F_EXT;
    if (!in->len) return s;
    if (!l64_specialized(in)) {
        if (in->flags & X86_F_TERMINATOR) return s;
        s.s[1] = fall; if (fall == L64F_EXT) s.ext = L64_FLAGS;
        if (in->flags & X86_F_BRANCH) { s.s[0] = l64_index(f, in->target); if (s.s[0] < 0) s.ext = L64_FLAGS; }
        return s;
    }
    switch (in->op) {
    case XO_JMP: s.s[0] = l64_index(f, in->target); return s;           /* external: ABI tail call */
    case XO_JCC: s.s[0] = l64_index(f, in->target); if (s.s[0] < 0) s.ext = L64_FLAGS;
        s.s[1] = fall; if (fall == L64F_EXT) s.ext = L64_FLAGS; return s;
    case XO_RET: return s;
    case XO_JMP_IND:
        for (uint32_t q = 0; q < f->nij; q++) if (f->ij[q].at == in->addr && f->ij[q].targets.n) s.table = &f->ij[q].targets;
        if (!s.table && rel[k].n) s.table = &rel[k];
        if (!hints[k]) s.ext = L64_FLAGS;
        return s;
    default:
        s.s[1] = fall; if (fall == L64F_EXT) s.ext = in->op == XO_CALL || in->op == XO_CALL_IND ? 0 : L64_FLAGS;
        return s;
    }
}
/* Live-out flags per instruction (backwards fixed point). */
/* obs = 0: the K52 local liveness; obs = 1: the K75 observation liveness (no external-edge reads, l64f_obs_io). */
static uint32_t *l64f_liveness(an_t *a, const func_t *f, const x86_insn_t *ins, const l64f_succ_t *succ, const uint32_t *hints, int obs) {
    uint32_t n = f->insns.n, *in = xcalloc(n, sizeof *in), *out = xcalloc(n, sizeof *out);
    for (int changed = 1; changed;) {
        changed = 0;
        for (uint32_t j = n; j-- > 0;) {
            uint32_t v = obs ? 0 : succ[j].ext, r, w;
            for (int q = 0; q < 2; q++) if (succ[j].s[q] >= 0) v |= in[succ[j].s[q]];
            if (succ[j].table) for (uint32_t q = 0; q < succ[j].table->n; q++) {
                int t = l64_index(f, succ[j].table->v[q]); v |= t >= 0 ? in[t] : obs ? 0 : L64_FLAGS;
            }
            if (obs) l64f_obs_io(a, f, &ins[j], hints[j], succ[j].table != 0, &r, &w); else l64f_flag_io(&ins[j], &r, &w);
            out[j] = v; v = r | (v & ~w);
            if (in[j] != v) { in[j] = v; changed = 1; }
        }
    }
    free(in); return out;
}
/* K75: the module-wide observed-flags sets (see l64f_flag_io). Worklist fixed point over every analyzed function,
 * independent of the chunk selection: a function observes its entry flags when they are live at its first
 * instruction; a callee must return exact flags when the flags are live after some direct call to it (or a tail
 * call from a function that must). Both sets only grow. Functions the exact emitter keeps are analyzed alike
 * (they compute every flag anyway; what matters is what their fast callers and callees must provide). */
static int l64f_u64cmp(const void *p, const void *q) { uint64_t x = *(const uint64_t *)p, y = *(const uint64_t *)q; return x > y ? 1 : x < y ? -1 : 0; }
static void l64f_observe(an_t *a) {
    uint32_t nf = a->nf;
    free(l64f_obs_entry); free(l64f_exact_exit); free(l64f_fsorted);
    l64f_obs_entry = 0; l64f_exact_exit = 0; l64f_fsorted = 0; memset(l64f_obs_stats, 0, sizeof l64f_obs_stats);
    if (lift_fast_flags_abi || !nf) return;
    clock_t started = clock();
    l64f_fsorted = xcalloc(nf, sizeof *l64f_fsorted); l64f_fsorted_n = nf;
    for (uint32_t i = 0; i < nf; i++) l64f_fsorted[i] = ((uint64_t)a->f[i].addr << 32) | i;
    qsort(l64f_fsorted, nf, sizeof *l64f_fsorted, l64f_u64cmp);
    l64f_obs_entry = xcalloc(nf, 1); l64f_exact_exit = xcalloc(nf, 1);
    vec_t *callers = xcalloc(nf, sizeof *callers);
    uint32_t *queue = xcalloc(nf + 1, sizeof *queue), head = 0, tail = 0; uint8_t *queued = xcalloc(nf, 1);
    for (uint32_t i = 0; i < nf; i++) { queue[tail++] = i; queued[i] = 1; }
    /* Unknown callers (pointers, other modules, the profile) may observe what these return with. */
    l64f_obs_taken = 0;
    for (uint32_t i = 0; i < nf; i++) if (a->f[i].taken) { l64f_exact_exit[i] = 1; l64f_obs_taken++; }
    tail %= nf + 1;
    uint8_t *edges_done = xcalloc(nf, 1);
    while (head != tail) {
        uint32_t fi = queue[head]; head = (head + 1) % (nf + 1); queued[fi] = 0;
        func_t *f = &a->f[fi]; uint32_t n = f->insns.n;
        l64f_obs_stats[3]++;
        if (!n) continue;
        x86_insn_t *ins = xcalloc(n, sizeof *ins);
        for (uint32_t k = 0; k < n; k++) decode_at(a->pe, f->insns.v[k], &ins[k]);
        uint32_t *hints = l64_import_hints(a->pe, f);
        vec_t *rel = xcalloc(n, sizeof *rel); l64f_succ_t *succ = xcalloc(n, sizeof *succ);
        for (uint32_t k = 0; k < n; k++) if (ins[k].op == XO_JMP_IND) l64f_rel_table(a, f, ins, k, &rel[k]);
        for (uint32_t k = 0; k < n; k++) succ[k] = l64f_successors(f, ins, k, hints, rel);
        uint32_t *out = l64f_liveness(a, f, ins, succ, hints, 1);
        /* Entry: live-in of the function's first listed instruction (the fast form requires it to be the entry). */
        uint32_t r, w; l64f_obs_io(a, f, &ins[0], hints[0], succ[0].table != 0, &r, &w);
        if (((r | (out[0] & ~w)) & L64_FLAGS) && !l64f_obs_entry[fi]) {
            l64f_obs_entry[fi] = 1; l64f_obs_stats[0]++;
            for (uint32_t c = 0; c < callers[fi].n; c++) { uint32_t g = callers[fi].v[c]; if (!queued[g]) { queued[g] = 1; queue[tail] = g; tail = (tail + 1) % (nf + 1); } }
        }
        for (uint32_t k = 0; k < n; k++) {
            const x86_insn_t *in = &ins[k]; int g = -1, tailcall = 0;
            /* A code address materialized by this instruction (LEA/MOV of a function start, RIP-relative or absolute)
             * is a pointer some unknown caller may call through: that function returns exact flags. */
            if (!edges_done[fi] && in->len) for (int o = 0; o < in->nops; o++) {
                const x86_opnd_t *q = &in->o[o]; uint64_t v = 0;
                if (q->kind == XK_IMM && in->op != XO_CALL && in->op != XO_JMP && in->op != XO_JCC) v = q->imm;
                else if (q->kind == XK_MEM && in->op == XO_LEA && q->base == X86_NOREG && q->index == X86_NOREG)
                    v = (q->pad & 4) ? q->imm : (q->pad & 2) ? (uint32_t)q->disp : (uint64_t)(int64_t)q->disp;
                int t = v && v <= UINT32_MAX ? l64f_fidx(a, (uint32_t)v) : -1;
                if (t >= 0 && !l64f_exact_exit[t]) {
                    l64f_exact_exit[t] = 1; l64f_obs_taken++;
                    if (!queued[t]) { queued[t] = 1; queue[tail] = (uint32_t)t; tail = (tail + 1) % (nf + 1); }
                }
            }
            if (!in->len || !l64_specialized(in)) continue;
            if (in->op == XO_CALL) g = l64f_fidx(a, in->target);
            else if ((in->op == XO_JMP || in->op == XO_JCC) && l64_index(f, in->target) < 0) { g = l64f_fidx(a, in->target); tailcall = 1; }
            else if (in->op == XO_CALL_IND && !l64f_profile_hint(a, hints[k]) && (out[k] & L64_FLAGS)) { if (!edges_done[fi]) l64f_obs_stats[2]++; continue; }
            else continue;
            if (g < 0) continue;
            if (!edges_done[fi]) vpush(&callers[g], fi);
            int need = tailcall ? l64f_exact_exit[fi] : (out[k] & L64_FLAGS) != 0;
            if (need && !l64f_exact_exit[g]) {
                l64f_exact_exit[g] = 1; l64f_obs_stats[1]++;
                if (!queued[g]) { queued[g] = 1; queue[tail] = (uint32_t)g; tail = (tail + 1) % (nf + 1); }
            }
        }
        edges_done[fi] = 1;
        for (uint32_t k = 0; k < n; k++) free(rel[k].v);
        free(rel); free(succ); free(out); free(hints); free(ins);
    }
    for (uint32_t i = 0; i < nf; i++) free(callers[i].v);
    free(callers); free(queue); free(queued); free(edges_done);
    l64f_obs_ms = (double)(clock() - started) * 1000.0 / CLOCKS_PER_SEC;
}
/* Loop headers: targets of DFS retreating edges (every cycle has one). Roots: the function
 * start, then every remaining label so code reached only through the slow path still polls. */
static void l64f_headers(const func_t *f, const l64f_succ_t *succ, uint8_t *header) {
    uint32_t n = f->insns.n, *stack = xcalloc(n, sizeof *stack), *edge = xcalloc(n, sizeof *edge);
    uint8_t *state = xcalloc(n, 1);
    for (uint32_t root = 0; root < n; root++) {
        if (state[root] || (root && !vhas(&f->labels, f->insns.v[root]))) continue;
        uint32_t sp = 0; stack[sp++] = root; state[root] = 1; edge[root] = 0;
        while (sp) {
            uint32_t k = stack[sp - 1], e = edge[k]++, ntab = succ[k].table ? succ[k].table->n : 0;
            if (e >= 2 + ntab) { state[k] = 2; sp--; continue; }
            int t = e < 2 ? succ[k].s[e] : l64_index(f, succ[k].table->v[e - 2]);
            if (t < 0) continue;
            if (state[t] == 1) header[t] = 1;
            else if (!state[t]) { state[t] = 1; edge[t] = 0; stack[sp++] = (uint32_t)t; }
        }
    }
    free(stack); free(edge); free(state);
}
static void l64f_regs(const x86_insn_t *in, uint32_t *used, uint32_t *written) {
    if (!in->len || !l64_specialized(in)) return;
    for (int j = 0; j < in->nops; j++) {
        const x86_opnd_t *p = &in->o[j];
        if (p->kind == XK_REG) {
            unsigned reg = p->reg >= 16 ? p->reg - 16 : p->reg;
            *used |= 1u << reg; if (j == 0) *written |= 1u << reg;
        }
        if (p->kind == XK_MEM) {
            if (p->base != X86_NOREG) *used |= 1u << p->base;
            if (p->index != X86_NOREG) *used |= 1u << p->index;
        }
    }
    if (in->op == XO_CWDE || in->op == XO_CDQ) { *used |= 1u << EAX; *written |= 1u << (in->op == XO_CWDE ? EAX : EDX); }
    if (in->op == XO_CMPXCHG || in->op == XO_CMPXCHG_PAIR) {
        *used |= 1u << EAX; *written |= 1u << EAX;
        if (in->op == XO_CMPXCHG_PAIR) { *used |= (1u << EBX) | (1u << ECX) | (1u << EDX); *written |= 1u << EDX; }
    }
    if ((in->op == XO_XCHG || in->op == XO_XADD ||
         (in->op == XO_SIMD && in->simd_op == 0x7e && in->simd_prefix != 0xf3)) && in->o[1].kind == XK_REG)
        *written |= 1u << (in->o[1].reg >= 16 ? in->o[1].reg - 16 : in->o[1].reg);
    if (in->op == XO_LEAVE) { *used |= (1u << EBP) | (1u << ESP); *written |= (1u << EBP) | (1u << ESP); }
    if (in->op == XO_CALL || in->op == XO_CALL_IND || in->op == XO_RET || in->op == XO_PUSH || in->op == XO_POP) {
        *used |= 1u << ESP; *written |= 1u << ESP;
    }
}
static int l64f_fusable_producer(const x86_insn_t *in) {
    unsigned op = in->op;
    return !l64_atomic(in) && (op == XO_ADD || op == XO_SUB || op == XO_CMP || op == XO_TEST || op == XO_AND ||
        op == XO_OR || op == XO_XOR || op == XO_INC || op == XO_DEC);
}
static int l64f_alu_op(unsigned op) {
    return op == XO_INC ? XO_ADD : op == XO_DEC || op == XO_NEG || op == XO_CMP ? XO_SUB : op == XO_TEST ? XO_AND : (int)op;
}
/* The emitter's direct-call/tail-call form for a known function start. */
static void l64f_direct(FILE *o, an_t *a, uint32_t target, const char *after) {
    int fi = func_index(a, target);
    if (fi < 0 || vhas(&skip, target)) { fprintf(o, "X.eip=0x%08xu;return;", target); return; }
    char weak[24] = "";
    if (!lift_selected(target)) snprintf(weak, sizeof weak, "N_%08x&&", target);
    fprintf(o, "X.eip=0x%08xu;if(%sx86_fast_depth<" L64F_DEPTH "){x86_fast_depth++;N_%08x(0x%08xu);x86_fast_depth--;}else return;%s",
        target, weak, target, target, after);
}
/* Per-function fast analysis, shared by top-level emission and inlined copies. */
typedef struct {
    an_t *a; func_t *f; uint32_t n, used, written;
    x86_insn_t *ins; uint32_t *hints, *live, *olive; vec_t *rel; l64f_succ_t *succ; /* olive: K75 observation liveness */
    uint8_t *header, *entry, *start, *fuse;
    int64_t *sp; /* static RSP delta before each instruction (L64F_UNK unknown) */
    /* K72 --fast-sync minimal: per instruction the registers possibly written since the last point where
     * X and the locals agreed (dirty, before the instruction), the registers live before it, and the
     * inlining decision of each call with the inlined subtree's register sets. */
    uint16_t *dirty, *glive, *inl_u, *inl_w; func_t **inl;
} l64f_fn_t;
/* Forward RSP-delta dataflow from the owner entry: push/pop/call (ABI: net zero)/add/sub/lea of
 * RSP by constants; any other RSP write makes it unknown. Emitted code re-derives the stack base
 * from the real RSP after every call, generic instruction and entry, so deltas stay relative. */
#define L64F_UNSET INT64_MAX
static int64_t l64f_sp_step(const x86_insn_t *in, int64_t d) {
    if (d == L64F_UNK) return d;
    const x86_opnd_t *a = &in->o[0], *b = &in->o[1];
    int n = a->size == 2 ? 2 : 8;
    if (!in->len) return L64F_UNK;
    if (!l64_specialized(in)) {
        if (in->op == XO_PUSHF) return d - 8;
        if (in->op == XO_POPF) return d + 8;
        if (in->op == XO_ENTER || in->op == XO_PUSHA || in->op == XO_POPA || (a->kind == XK_REG && a->reg == ESP)) return L64F_UNK;
        return d;
    }
    switch (in->op) {
    case XO_PUSH: return d - n;
    case XO_POP: return a->kind == XK_REG && a->reg == ESP ? L64F_UNK : d + n;
    case XO_CALL: case XO_CALL_IND: return d;
    case XO_LEAVE: return L64F_UNK;
    case XO_ADD: case XO_SUB:
        if (a->kind == XK_REG && a->reg == ESP) {
            if (a->size != 8 || b->kind != XK_IMM) return L64F_UNK;
            int64_t v = (int64_t)b->imm; if (v < -(1 << 20) || v > (1 << 20)) return L64F_UNK;
            return in->op == XO_ADD ? d + v : d - v;
        }
        return d;
    case XO_LEA:
        if (a->kind == XK_REG && a->reg == ESP) {
            if (a->size != 8 || b->base != ESP || b->index != X86_NOREG || b->seg_fs || (b->pad & 1)) return L64F_UNK;
            return d + b->disp;
        }
        return d;
    default: break;
    }
    uint32_t used = 0, written = 0;
    l64f_regs(in, &used, &written);
    if ((written & (1u << ESP)) && in->op != XO_CMP && in->op != XO_TEST && in->op != XO_JMP_IND) return L64F_UNK;
    if ((in->op == XO_XCHG || in->op == XO_XADD) && b->kind == XK_REG && b->reg == ESP) return L64F_UNK;
    return d;
}
static int64_t *l64f_stack(const func_t *f, const x86_insn_t *ins, const l64f_succ_t *succ) {
    uint32_t n = f->insns.n, *queue = xcalloc(n + 1, sizeof *queue), head = 0, tail = 0;
    int64_t *sp = xcalloc(n, sizeof *sp); uint8_t *queued = xcalloc(n, 1);
    for (uint32_t k = 0; k < n; k++) sp[k] = L64F_UNSET;
    if (n) { sp[0] = 0; queue[tail++] = 0; queued[0] = 1; }
    /* Pass 2 seeds every statically unreached instruction as unknown: such code still runs (slow
     * path, unresolved targets) and must poison every known block it can flow into. */
    for (int pass = 0; pass < 2; pass++) {
    /* Alignment padding (NOP/INT3 after a terminator) never executes and must not poison. */
    if (pass) for (uint32_t k = 0; k < n; k++) if (sp[k] == L64F_UNSET && ins[k].op != XO_NOP && ins[k].op != XO_INT3) {
        sp[k] = L64F_UNK; queued[k] = 1; queue[tail] = k; tail = (tail + 1) % (n + 1);
    }
    while (head != tail) {
        uint32_t k = queue[head]; head = (head + 1) % (n + 1); queued[k] = 0;
        int64_t d = l64f_sp_step(&ins[k], sp[k]);
        uint32_t ntab = succ[k].table ? succ[k].table->n : 0;
        for (uint32_t e = 0; e < 2 + ntab; e++) {
            int t = e < 2 ? succ[k].s[e] : l64_index(f, succ[k].table->v[e - 2]);
            if (t < 0) continue;
            int64_t v = sp[t] == L64F_UNSET ? d : sp[t] == d ? d : L64F_UNK;
            if (v != sp[t]) { sp[t] = v; if (!queued[t]) { queued[t] = 1; queue[tail] = (uint32_t)t; tail = (tail + 1) % (n + 1); } }
        }
    }
    }
    for (uint32_t k = 0; k < n; k++) if (sp[k] == L64F_UNSET) sp[k] = L64F_UNK;
    free(queue); free(queued); return sp;
}
/* Host stack base such that the slot at total delta e is xf_sp + e + L64F_BIAS; d is the total
 * delta of the current r[4]. */
static void l64f_spset(FILE *o, int64_t d) {
    if (!l64_fast_stack || !l64_fast_memory || d == L64F_UNK) return;
    if (l64_fast_memory == 2) fprintf(o, "xf_sp=xf_base+((uint32_t)r[4]&XF_MASK)-%lld;", (long long)(d + L64F_BIAS));
    else fprintf(o, "xf_sp=xf_base+(uint32_t)r[4]-%lld;", (long long)(d + L64F_BIAS));
}
static int64_t l64f_total(int64_t d, int64_t off) { return d == L64F_UNK || off == L64F_UNK ? L64F_UNK : d + off; }
static l64f_fn_t *l64f_analyze(an_t *a, func_t *f) {
    l64f_fn_t *x = xcalloc(1, sizeof *x);
    uint32_t n = x->n = f->insns.n; x->f = f; x->a = a;
    x->ins = xcalloc(n, sizeof *x->ins);
    for (uint32_t k = 0; k < n; k++) decode_at(a->pe, f->insns.v[k], &x->ins[k]);
    x86_insn_t *ins = x->ins;
    x->hints = l64_import_hints(a->pe, f);
    x->succ = xcalloc(n, sizeof *x->succ);
    x->rel = xcalloc(n, sizeof *x->rel);
    for (uint32_t k = 0; k < n; k++) if (ins[k].op == XO_JMP_IND) l64f_rel_table(a, f, ins, k, &x->rel[k]);
    for (uint32_t k = 0; k < n; k++) x->succ[k] = l64f_successors(f, ins, k, x->hints, x->rel);
    x->live = l64f_liveness(a, f, ins, x->succ, x->hints, 0);
    if (l64f_obs_entry) { /* K75: emission computes flags the profile observes too (union of both livenesses) */
        x->olive = l64f_liveness(a, f, ins, x->succ, x->hints, 1);
        for (uint32_t k = 0; k < n; k++) x->live[k] |= x->olive[k];
    }
    x->header = xcalloc(n, 1); x->entry = xcalloc(n, 1); x->start = xcalloc(n + 1, 1); x->fuse = xcalloc(n, 1);
    l64f_headers(f, x->succ, x->header);
    if (lift_fast_block_quantum) for (uint32_t k = 0; k < n; k++) x->header[k] = 1;
    for (uint32_t k = 0; k < n; k++) {
        const x86_insn_t *in = &ins[k]; l64f_succ_t *s = &x->succ[k];
        l64f_regs(in, &x->used, &x->written);
        if (!k || x->header[k]) x->entry[k] = 1;
        if (lift_fast_resume && k && (ins[k - 1].op == XO_CALL || ins[k - 1].op == XO_CALL_IND) &&
            l64f_contiguous(f, ins, k - 1)) x->entry[k] = 1;
        if (!k || x->entry[k] || vhas(&f->labels, in->addr) || !in->len || !l64_specialized(in)) x->start[k] = 1;
        if (k && (!ins[k - 1].len || !l64_specialized(&ins[k - 1]) || l64f_control(&ins[k - 1]) ||
                  !l64f_contiguous(f, ins, k - 1))) x->start[k] = 1;
        if (s->s[0] >= 0) x->start[s->s[0]] = 1; /* branch targets; s[1] is the fall-through */
        if (s->table) for (uint32_t q = 0; q < s->table->n; q++) {
            int t = l64_index(f, s->table->v[q]); if (t >= 0) x->start[t] = 1;
        }
    }
    if (lift_fast_all_entries) for (uint32_t k = 0; k < n; k++) x->entry[k] = x->start[k];
    for (uint32_t k = 0; k + 1 < n; k++) {
        const x86_insn_t *c = &ins[k + 1];
        if (!lift_fast_fuse || !ins[k].len || !l64_specialized(&ins[k]) || !l64f_fusable_producer(&ins[k]) ||
            !l64f_contiguous(f, ins, k) || x->start[k + 1] || !c->len) continue;
        if (c->op != XO_JCC && c->op != XO_SETCC && c->op != XO_CMOVCC) continue;
        if ((ins[k].op == XO_INC || ins[k].op == XO_DEC) && (l64_cc_flags(c->cc) & F_CF)) continue;
        x->fuse[k] = 1;
    }
    x->used |= x->written;
    x->sp = l64f_stack(f, ins, x->succ);
    return x;
}
static void l64f_release(l64f_fn_t *x) {
    for (uint32_t k = 0; k < x->n; k++) free(x->rel[k].v);
    free(x->rel); free(x->ins); free(x->hints); free(x->succ); free(x->live); free(x->olive);
    free(x->header); free(x->entry); free(x->start); free(x->fuse); free(x->sp);
    free(x->dirty); free(x->glive); free(x->inl_u); free(x->inl_w); free(x->inl); free(x);
}
/* Emitter-level inlining of small direct callees (no state publication, no busy checks): the
 * callee body runs on the caller's locals; its RET jumps back when it pops the pushed return
 * address and otherwise exits like any return. Bounded size/depth/budget, never recursive. */
static uint32_t lift_fast_inline = 48;  /* --fast-inline N: max callee instructions (0 = off) */
#define L64F_INLINE_DEPTH 2
#define L64F_INLINE_BUDGET 768u
typedef struct { uint32_t stack[L64F_INLINE_DEPTH + 1], depth, budget, sites; } l64f_inline_t;
static func_t *l64f_inline_target(an_t *a, const l64f_fn_t *x, uint32_t k, const l64f_inline_t *c) {
    const x86_insn_t *in = &x->ins[k];
    if (!lift_fast_inline || in->op != XO_CALL || c->depth >= L64F_INLINE_DEPTH || !l64f_contiguous(x->f, x->ins, k)) return 0;
    int fi = func_index(a, in->target);
    if (fi < 0 || vhas(&skip, in->target) || !lift_selected(in->target)) return 0;
    func_t *g = &a->f[fi];
    if (!g->insns.n || g->insns.v[0] != g->addr || g->insns.n > lift_fast_inline || g->insns.n > c->budget) return 0;
    for (uint32_t i = 0; i <= c->depth; i++) if (c->stack[i] == g->addr) return 0;
    return g;
}
/* Register sets of a function including everything it would inline (same decisions as emission). */
static void l64f_plan(an_t *a, l64f_fn_t *x, l64f_inline_t *c, uint32_t *used, uint32_t *written) {
    *used |= x->used; *written |= x->written;
    for (uint32_t k = 0; k < x->n; k++) {
        func_t *g = l64f_inline_target(a, x, k, c);
        if (!g) continue;
        l64f_fn_t *y = l64f_analyze(a, g);
        c->budget -= g->insns.n; c->stack[++c->depth] = g->addr;
        l64f_plan(a, y, c, used, written);
        c->depth--; l64f_release(y);
    }
}
/* K78 check: whether a function, with everything it would inline (same decisions as l64f_plan), holds a generic
 * (helper-emulated) instruction. Those write registers in X and the following XF_RELOAD puts every used register
 * back into the locals, so l64f_regs (specialized instructions only) does not bound what the subtree changes. */
static int l64f_plan_generic(an_t *a, l64f_fn_t *x, l64f_inline_t *c) {
    int generic = 0;
    for (uint32_t k = 0; k < x->n; k++) if (!x->ins[k].len || !l64_specialized(&x->ins[k])) generic = 1;
    for (uint32_t k = 0; k < x->n; k++) {
        func_t *g = l64f_inline_target(a, x, k, c);
        if (!g) continue;
        l64f_fn_t *y = l64f_analyze(a, g);
        c->budget -= g->insns.n; c->stack[++c->depth] = g->addr;
        generic |= l64f_plan_generic(a, y, c);
        c->depth--; l64f_release(y);
    }
    return generic;
}
/* K72 (liftFast.sync "minimal", --fast-sync minimal): call sites and exits spill only the registers written
 * since the last synchronization with X (function entry reload, a returned call, a generic instruction), and
 * after a call reload only the volatile registers that are live (plus RSP). Invariant per register: either it
 * is dirty (the local is the value) or X holds the value, and a live clean local equals X. Spills count as
 * reads in the liveness, so a register spilled later without an intervening write is reloaded after a call.
 * Same Win64 assumptions as the full form (callee-saved registers survive calls); no new ones. */
static int lift_fast_sync;
static uint16_t l64f_spill_set, l64f_used_set; /* the top-level function's written / used registers */
#define L64F_RSP ((uint16_t)(1u << ESP))
static uint16_t l64f_reg_bit(unsigned r) { return r >= 16 ? (uint16_t)(1u << (r - 16)) : (uint16_t)(1u << r); }
/* Registers an instruction fully defines without reading (32/64-bit destination of a pure move/load). */
static uint16_t l64f_gpr_defs(const x86_insn_t *in) {
    const x86_opnd_t *d = &in->o[0];
    if (!in->len || !l64_specialized(in) || l64_atomic(in) || d->kind != XK_REG || d->reg >= 16 || d->size < 4) return 0;
    return in->op == XO_MOV || in->op == XO_MOVZX || in->op == XO_MOVSX || in->op == XO_LEA || in->op == XO_POP ? (uint16_t)(1u << d->reg) : 0;
}
static uint16_t l64f_gpr_reads(const x86_insn_t *in) {
    if (!in->len || !l64_specialized(in)) return 0xffffu;
    uint32_t used = 0, written = 0;
    uint16_t defs = l64f_gpr_defs(in);
    if (!defs) { l64f_regs(in, &used, &written); return (uint16_t)used; }
    const x86_opnd_t *b = &in->o[1]; uint16_t r = in->op == XO_POP ? L64F_RSP : 0;
    if (b->kind == XK_REG) r |= l64f_reg_bit(b->reg);
    if (b->kind == XK_MEM) { if (b->base != X86_NOREG) r |= l64f_reg_bit(b->base); if (b->index != X86_NOREG) r |= l64f_reg_bit(b->index); }
    return r;
}
static uint16_t l64f_gpr_writes(const x86_insn_t *in) { uint32_t used = 0, written = 0; l64f_regs(in, &used, &written); return (uint16_t)written; }
/* Same decisions as l64f_body/l64f_plan from the context `c` (by value): which calls inline, and their subtree sets. */
static void l64f_decide(an_t *a, l64f_fn_t *x, l64f_inline_t c) {
    for (uint32_t k = 0; k < x->n; k++) {
        func_t *g = l64f_inline_target(a, x, k, &c);
        x->inl[k] = g;
        if (!g) continue;
        l64f_fn_t *y = l64f_analyze(a, g);
        uint32_t u = 0, w = 0;
        c.budget -= g->insns.n; c.stack[++c.depth] = g->addr;
        l64f_plan(a, y, &c, &u, &w);
        c.depth--; l64f_release(y);
        x->inl_u[k] = (uint16_t)(u | w); x->inl_w[k] = (uint16_t)w;
    }
}
static int l64f_exits_inline(const l64f_fn_t *x, uint32_t k) { /* the fall-through after k leaves the function */
    const x86_insn_t *in = &x->ins[k];
    return in->len && l64_specialized(in) && !l64f_control(in) && !l64f_contiguous(x->f, x->ins, k);
}
static void l64f_flow(an_t *a, l64f_fn_t *x, const l64f_inline_t *c, uint16_t entry_dirty, uint16_t exit_live, int inlined) {
    uint32_t n = x->n;
    x->dirty = xcalloc(n + 1, sizeof *x->dirty); x->glive = xcalloc(n + 1, sizeof *x->glive);
    x->inl_u = xcalloc(n + 1, sizeof *x->inl_u); x->inl_w = xcalloc(n + 1, sizeof *x->inl_w); x->inl = xcalloc(n + 1, sizeof *x->inl);
    l64f_decide(a, x, *c);
    /* Forward: dirty registers (union over paths). */
    uint8_t *seen = xcalloc(n + 1, 1);
    if (n) { x->dirty[0] = entry_dirty; seen[0] = 1; }
    /* K78: native execution also starts at every other entry (post-call sites, loop headers), synchronized (XF_RELOAD:
     * dirty 0). Code that only those entries reach (the analyzer sweeps a function's whole .pdata range: C++ landing
     * pads and catch continuations, case bodies behind jump tables it cannot recover) must propagate its writes into
     * the code it jumps back to, or the next call/exit there does not store them (found by liftFast.check on a landing
     * pad that rejoins its loop; tests/unit/fast-check.test.ts). An inlined copy is entered only at its start. */
    if (!inlined) for (uint32_t k = 1; k < n; k++) if (x->entry[k]) seen[k] = 1;
    for (int changed = 1; changed;) {
        changed = 0;
        for (uint32_t k = 0; k < n; k++) {
            if (!seen[k]) continue;
            const x86_insn_t *in = &x->ins[k]; uint16_t d = x->dirty[k], out;
            if (!in->len || !l64_specialized(in)) out = 0;          /* generic: spilled, executed, fully reloaded */
            else if ((in->op == XO_CALL || in->op == XO_CALL_IND) && !x->inl[k]) out = 0; /* returned call */
            else if (x->inl[k]) out = d | L64F_RSP | x->inl_w[k];
            else out = d | l64f_gpr_writes(in);
            const l64f_succ_t *sc = &x->succ[k]; uint32_t ntab = sc->table ? sc->table->n : 0;
            for (uint32_t e = 0; e < 2 + ntab; e++) {
                int t = e < 2 ? sc->s[e] : l64_index(x->f, sc->table->v[e - 2]);
                if (t < 0) continue;
                if (!seen[t] || (x->dirty[t] | out) != x->dirty[t]) { x->dirty[t] |= out; seen[t] = 1; changed = 1; }
            }
        }
    }
    /* Code no entry reaches is still emitted (it never runs natively: the slow path interprets up to an entry);
     * treat it as fully dirty so its spills stay complete. */
    for (uint32_t k = 0; k < n; k++) if (!seen[k] && !x->entry[k]) x->dirty[k] = 0xffffu;
    free(seen);
    /* Backward: live registers before each instruction (spills are reads). */
    for (int changed = 1; changed;) {
        changed = 0;
        for (uint32_t k = n; k-- > 0;) {
            const x86_insn_t *in = &x->ins[k]; const l64f_succ_t *sc = &x->succ[k];
            uint16_t d = x->dirty[k], out = 0, v;
            uint32_t ntab = sc->table ? sc->table->n : 0;
            for (uint32_t e = 0; e < 2 + ntab; e++) {
                int t = e < 2 ? sc->s[e] : l64_index(x->f, sc->table->v[e - 2]);
                if (t >= 0) out |= x->glive[t];
            }
            if (!in->len) v = d;
            else if (!l64_specialized(in)) v = d;                   /* reads X after spilling d; reloads every used register */
            else if (in->op == XO_CALL || in->op == XO_CALL_IND) {
                uint16_t r = l64f_gpr_reads(in) | L64F_RSP | d;
                if (x->inl[k]) v = r | x->inl_u[k] | out;
                else v = r | (uint16_t)(out & ~(l64f_volatile | L64F_RSP));
            } else if (in->op == XO_RET) v = l64f_gpr_reads(in) | d | L64F_RSP | (inlined ? exit_live : 0);
            else if (in->op == XO_JMP && l64_index(x->f, in->target) < 0)
                v = d | (inlined ? (uint16_t)(L64F_RSP | (exit_live & ~(l64f_volatile | L64F_RSP))) : 0);
            else {
                uint16_t defs = l64f_gpr_defs(in);
                v = (uint16_t)(out & ~defs) | l64f_gpr_reads(in);
                if (in->op == XO_JCC || in->op == XO_JMP_IND) v |= d;  /* external taken path / dispatch miss spills */
                if (l64f_exits_inline(x, k)) v |= (uint16_t)((d | l64f_gpr_writes(in)) & ~defs) | l64f_gpr_reads(in);
            }
            if (x->header[k]) v |= d;                                /* the poll's yield exit spills */
            if (v != x->glive[k]) { x->glive[k] = v; changed = 1; }
        }
    }
}
/* K78 liftFast.check "sync" (--fast-check sync): a self-checking diagnostic build. It executes with the values the
 * full form would have (every register minimal sync leaves clean is compared with X at each spill and repaired; every
 * used volatile register reloads after a call) and reports, without trapping, each point where minimal sync or the
 * Win64 call contract would have produced a different value (xf_sync_violation in x86_rt.c, metrics `sync_check`):
 *   1 dirty miss: a register minimal sync does not store differs from X at a call/exit (the callee or the caller
 *     after the exit would read a stale value);
 *   2 liveness miss: a volatile register minimal sync does not reload after a call is read (or stored) before it
 *     is written, and the callee had changed it (`xs`: volatile locals that would be stale);
 *   3 callee-saved clobber: a returned call changed RBX/RBP/RSI/RDI/R12-R15 (fast mode keeps the caller's value);
 *   4 inlined callee-saved clobber: an inlined body (or its tail callee) returned with a callee-saved register changed
 *     (the inlined copy exposes it, a real call hides it: the result depends on liftFast.inline);
 *   5 register-model miss: an instruction's emitted C uses a register l64f_gpr_reads/writes lack (found at lift time,
 *     reported when the instruction runs).
 * With `sync: full` only 3 and 4 are checked. EFLAGS are not checked (fast mode never computes dead flags). */
static int lift_fast_check;
/* vK72 TEST ONLY (--fast-test-corrupt stack, liftFast.testCorrupt): every lifted RET flips a byte 512 bytes below RSP,
 * a deliberately wrong lifted result that changes guest RAM but no register and no API argument. The oracle's guest
 * state hash must catch it (tests/unit/oracle-guest-state.test.ts). K78 (--fast-test-corrupt sync, = 2): deliberately
 * wrong minimal-sync decisions (every spill omits its highest-numbered dirty non-RSP register; no volatile register reloads
 * after a call), which the check build must report (tests/unit/fast-check.test.ts). Never for real builds. */
static int lift_fast_test_corrupt;
static uint16_t l64f_corrupt_spill(uint16_t mask) {
    if (lift_fast_test_corrupt != 2) return mask;
    uint16_t m = (uint16_t)(mask & ~L64F_RSP);
    return m ? (uint16_t)(mask & ~(1u << (31 - __builtin_clz(m)))) : mask;
}
static uint32_t l64f_ck_owner;              /* the top-level function being emitted */
static const char *l64f_ck_callee = "0u";   /* the call/tail-call target expression of the next spill */
#define L64F_CALLEE_SAVED ((uint16_t)~(l64f_volatile | L64F_RSP))
static void l64f_ck_report(FILE *o, unsigned kind, const char *reg, const l64f_fn_t *x, const char *callee, const char *got, const char *want) {
    fprintf(o, "xf_sync_violation(%uu<<8|%s,0x%08xu,0x%08xu,0x%08xu,%s,%s,%s);", kind, reg, l64f_ck_owner, x->f->addr, l64_fast_pc, callee, got, want);
}
static uint32_t lift_fast_check_model; /* lift stats: register-model misses found in emitted instruction text */
/* The guest registers a piece of emitted C reads and writes: `r[N]` (not `X.r[N]`) followed by `=` (not `==`) is a
 * write, a compound assignment both, anything else a read. */
static void l64f_text_regs(const char *s, uint16_t *reads, uint16_t *writes) {
    for (const char *p = s; (p = strstr(p, "r[")); p += 2) {
        if (p > s && (isalnum((unsigned char)p[-1]) || p[-1] == '_' || p[-1] == '.' || p[-1] == '>')) continue;
        char *e; long n = strtol(p + 2, &e, 10);
        if (e == p + 2 || *e != ']' || n < 0 || n > 15) continue;
        const char *q = e + 1; while (*q == ' ') q++;
        int assign = q[0] == '=' && q[1] != '=';
        int compound = (strchr("+-*/%&|^", q[0]) && q[0] && q[1] == '=') || ((q[0] == '<' || q[0] == '>') && q[1] == q[0] && q[2] == '=');
        if (assign) *writes |= (uint16_t)(1u << n);
        else if (compound) { *writes |= (uint16_t)(1u << n); *reads |= (uint16_t)(1u << n); }
        else *reads |= (uint16_t)(1u << n);
    }
}
/* Before a minimal spill of `mask`: the clean registers must already be in X; no stale volatile may be stored. */
static void l64f_ck_spill(FILE *o, const l64f_fn_t *x, uint16_t mask) {
    if (!lift_fast_check || !lift_fast_sync || !x->dirty) return;
    uint16_t clean = (uint16_t)(l64f_spill_set & ~mask), stale = (uint16_t)(mask & l64f_volatile);
    for (int i = 0; i < 16; i++) if (clean & (1u << i)) {
        char reg[8], g[16], w[16]; snprintf(reg, sizeof reg, "%d", i); snprintf(g, sizeof g, "X.r[%d]", i); snprintf(w, sizeof w, "r[%d]", i);
        fprintf(o, "if(__builtin_expect(X.r[%d]!=r[%d],0)){", i, i); l64f_ck_report(o, 1, reg, x, l64f_ck_callee, g, w); fprintf(o, "X.r[%d]=r[%d];}", i, i);
    }
    if (stale) { fprintf(o, "if(__builtin_expect(xs&%uu,0)){", stale); char reg[48]; snprintf(reg, sizeof reg, "(uint32_t)__builtin_ctz(xs&%uu)", stale); l64f_ck_report(o, 2, reg, x, l64f_ck_callee, "0", "0"); fputs("}", o); }
}
static void l64f_spill(FILE *o, const l64f_fn_t *x, uint16_t mask) {
    if (!lift_fast_sync || !x->dirty) { fputs("XF_SPILL;", o); return; }
    mask = l64f_corrupt_spill((uint16_t)(mask & l64f_spill_set));
    l64f_ck_spill(o, x, mask);
    for (int i = 0; i < 16; i++) if (mask & (1u << i)) fprintf(o, "X.r[%d]=r[%d];", i, i);
    fputs("XF_SYNC;", o);
}
/* Bounded append for call-site text built in a buffer (check mode makes it long). */
static void l64f_cat(char *buf, size_t cap, size_t *at, const char *fmt, ...) __attribute__((format(printf, 4, 5)));
static void l64f_cat(char *buf, size_t cap, size_t *at, const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    int n = *at < cap ? vsnprintf(buf + *at, cap - *at, fmt, ap) : -1;
    va_end(ap);
    if (n < 0 || (size_t)n >= cap - *at) die("fast emission: call-site text too long");
    *at += (size_t)n;
}
/* Check mode after a normal call return: callee-saved registers the caller uses must be unchanged in X. A clobbered
 * one the function stores is put back (the full form would store the caller's value at its next spill anyway). */
static void l64f_ck_saved(char *buf, size_t cap, size_t *at, const l64f_fn_t *x, const char *callee) {
    if (!lift_fast_check) return;
    uint16_t saved = (uint16_t)(l64f_used_set & L64F_CALLEE_SAVED);
    for (int i = 0; i < 16; i++) if (saved & (1u << i)) {
        if (l64f_spill_set & (1u << i)) { /* repaired in X: the next call compares against the caller's value again */
            l64f_cat(buf, cap, at, "if(__builtin_expect(X.r[%d]!=r[%d],0)){xf_sync_violation(3u<<8|%du,0x%08xu,0x%08xu,0x%08xu,%s,X.r[%d],r[%d]);X.r[%d]=r[%d];}",
                i, i, i, l64f_ck_owner, x->f->addr, l64_fast_pc, callee, i, i, i, i);
            continue;
        }
        /* vK78: a register this function only reads stays clobbered in X (the full form never stores it). After a report
         * the clobbered value becomes the reference (xk/xr_N), so a later callee is blamed only if it changes X again. */
        l64f_cat(buf, cap, at, "{uint64_t e_=(xk&%uu)?xr_%d:r[%d];if(__builtin_expect(X.r[%d]!=e_,0)){xf_sync_violation(3u<<8|%du,0x%08xu,0x%08xu,0x%08xu,%s,X.r[%d],e_);xk|=%uu;xr_%d=X.r[%d];}}",
            1u << i, i, i, i, i, l64f_ck_owner, x->f->addr, l64_fast_pc, callee, i, 1u << i, i, i);
    }
}
/* After a normal call return: live volatile registers and RSP. `live` = registers live at the return site. */
static const char *l64f_reload_text(char *buf, size_t cap, const l64f_fn_t *x, uint16_t live, const char *callee) {
    size_t at = 0; buf[0] = 0;
    if (!lift_fast_sync || !x->dirty) {
        l64f_cat(buf, cap, &at, "XF_RELOAD_CALL ");
        l64f_ck_saved(buf, cap, &at, x, callee);
        return buf;
    }
    uint16_t mask = l64f_used_set & (uint16_t)((l64f_volatile & live) | L64F_RSP);
    if (lift_fast_test_corrupt == 2) mask &= L64F_RSP;
    if (lift_fast_check) {
        /* Reload every used volatile (the full form's values); remember the ones minimal sync would leave stale. */
        uint16_t skipped = (uint16_t)(l64f_used_set & l64f_volatile & ~mask);
        l64f_cat(buf, cap, &at, "xs&=%uu;", (unsigned)(uint16_t)~mask);
        for (int i = 0; i < 16; i++) if (skipped & (1u << i)) l64f_cat(buf, cap, &at, "if(r[%d]!=X.r[%d])xs|=%uu;r[%d]=X.r[%d];", i, i, 1u << i, i, i);
        l64f_ck_saved(buf, cap, &at, x, callee);
    }
    for (int i = 0; i < 16; i++) if (mask & (1u << i)) l64f_cat(buf, cap, &at, "r[%d]=X.r[%d];", i, i);
    l64f_cat(buf, cap, &at, "XF_RELOAD_CLOCK ");
    return buf;
}
#define L64F_TEXT 12288
static void l64f_reload_call(FILE *o, const l64f_fn_t *x, uint16_t live, const char *callee) { char b[L64F_TEXT]; fputs(l64f_reload_text(b, sizeof b, x, live, callee), o); }
static uint16_t l64f_live_after(const l64f_fn_t *x, uint32_t k) { return k + 1 < x->n ? x->glive[k + 1] : 0; }
/* K75: a returned non-profile call whose flags are observed later takes the callee's exact flags from X. */
static const char *l64f_flags_after(const l64f_fn_t *x, uint32_t k) {
    return x->olive && !l64f_profile_hint(x->a, x->hints[k]) && (x->olive[k] & L64_FLAGS) ? "flags=X.flags;" : "";
}
/* K72 liftFast.calls "outlined" (--fast-calls outlined): call sites store the registers, then xf_enter (clock,
 * flags, X.eip, depth slot), the plain C call, xf_leave (depth, abnormal-exit check); see x86_guest.h. */
static int lift_fast_calls_out;
static void l64f_spill_regs(FILE *o, const l64f_fn_t *x, uint16_t mask) {
    mask = (lift_fast_sync && x->dirty ? l64f_corrupt_spill((uint16_t)(mask & l64f_spill_set)) : 0xffffu) & l64f_spill_set;
    l64f_ck_spill(o, x, mask);
    for (int i = 0; i < 16; i++) if (mask & (1u << i)) fprintf(o, "X.r[%d]=r[%d];", i, i);
    fputs("XR_LIFT(clock-retire_clock);retire_clock=clock;", o);
}
/* Outlined direct call or tail call of a known function start; registers are already stored. `after` follows a
 * normal return when next != 0 (call: `if(xf_leave(next))return;` + after), else the frame returns (tail call). */
static void l64f_direct_out(FILE *o, an_t *a, uint32_t target, uint32_t next, const char *after) {
    int fi = func_index(a, target);
    if (fi < 0 || vhas(&skip, target)) {
        fprintf(o, "X.flags=flags;X.tsc=clock;X.frame_insns=(uint32_t)(clock-qbase);X.eip=0x%08xu;return;", target); return;
    }
    char weak[48] = "";
    if (!lift_selected(target)) snprintf(weak, sizeof weak, "||(!N_%08x&&(x86_fast_depth--,1))", target);
    fprintf(o, "if(xf_enter(0x%08xu,flags,clock,qbase)%s)return;N_%08x(0x%08xu);", target, weak, target, target);
    if (next) fprintf(o, "if(xf_leave(0x%08xu))return;%s", next, after);
    else fputs("xf_leave(0);return;", o);
}
static void l64f_body(FILE *o, an_t *a, l64f_fn_t *x, lift_stats_t *st, l64f_inline_t *c, const char *pre, uint32_t ret_to, const char *ret_label, int64_t sp_off, uint16_t entry_dirty, uint16_t exit_live);
static void l64f_body(FILE *o, an_t *a, l64f_fn_t *x, lift_stats_t *st, l64f_inline_t *c, const char *pre, uint32_t ret_to, const char *ret_label, int64_t sp_off, uint16_t entry_dirty, uint16_t exit_live) {
    if (lift_fast_sync) l64f_flow(a, x, c, entry_dirty, exit_live, ret_label != 0);
    func_t *f = x->f; uint32_t n = x->n; x86_insn_t *ins = x->ins;
    int inlined = ret_label != 0;
    for (uint32_t k = 0; k < n; k++) {
        x86_insn_t *in = &ins[k]; uint32_t va = in->addr ? in->addr : f->insns.v[k], next = va + in->len;
        const x86_opnd_t *aa = &in->o[0], *bb = &in->o[1]; int sz = aa->size ? aa->size : in->osz;
        l64_fast_pc = va;
        l64_fast_sp = l64f_total(x->sp[k], sp_off);
        int64_t sp_next = l64f_total(k + 1 < n ? x->sp[k + 1] : L64F_UNK, sp_off);
        if (x->start[k]) {
            uint32_t count = 0;
            if (in->len && l64_specialized(in)) for (uint32_t j = k; j < n && (j == k || !x->start[j]); j++) count++;
            fprintf(o, "L_%s%08x: __attribute__((unused));", pre, va);
            if (x->header[k]) {
                fprintf(o, "if(__builtin_expect(clock-qbase>=2000000u,0)){X.tsc=clock;X.frame_insns=(uint32_t)(clock-qbase);"
                    "XR_LIFT(clock-retire_clock);retire_clock=clock;if(x86_fast_quantum()){");
                l64f_spill(o, x, x->dirty ? x->dirty[k] : 0);
                fprintf(o, "X.eip=0x%08xu;return;}qbase=clock-X.frame_insns;}", va);
            }
            if (count) fprintf(o, "clock+=%uu;", count);
            fprintf(o, "\n");
        }
        l64f_mark(o, in, inlined);
        uint16_t dk = x->dirty ? x->dirty[k] : 0;
        if (!in->len) { l64f_spill(o, x, dk); fprintf(o, "X.eip=0x%08xu;return;\n", f->insns.v[k]); continue; }
        if (!l64_specialized(in)) {
            st->generic++;
            l64f_spill(o, x, dk); fprintf(o, "X.eip=0x%08xu;{static const x86_insn_t I=", va); emit_insn_struct(o, in);
            if (lift_fast_calls_out) fprintf(o, ";x86_fast_exec(&I);}if(xf_check(0x%08xu))return;XF_RELOAD ", next);
            else fprintf(o, ";x86_fast_exec(&I);}if(X.eip!=0x%08xu||xf_busy())return;XF_RELOAD ", next);
            if (lift_fast_check && lift_fast_sync) fputs("xs=0;", o); /* K78: every used register reloaded */
            if (lift_fast_check) fputs("xk=0;", o);
            l64f_spset(o, sp_next); fprintf(o, "\n");
            if (!l64f_contiguous(f, ins, k)) fprintf(o, "return;\n");
            continue;
        }
        st->specialized++;
        if (lift_fast_check && lift_fast_sync) {
            /* K78 check: a volatile register minimal sync would have left stale after a call must not be read. */
            uint16_t rd = (uint16_t)(l64f_gpr_reads(in) & l64f_volatile), df = (uint16_t)(l64f_gpr_defs(in) & l64f_volatile);
            if (rd) {
                char reg[48]; snprintf(reg, sizeof reg, "(uint32_t)__builtin_ctz(xs&%uu)", rd);
                fprintf(o, "if(__builtin_expect(xs&%uu,0)){", rd); l64f_ck_report(o, 2, reg, x, "0u", "0", "0"); fputs("}", o);
            }
            if (df) fprintf(o, "xs&=%uu;", (unsigned)(uint16_t)~df);
        }
        l64_replay = (l64_replay_t){0}; l64_fault_writes = 0; l64_position = 0;
        uint32_t mask = x->live[k] & L64_FLAGS;
        int fused_consumer = k && x->fuse[k - 1];
        /* K78 check mode: emit the instruction into a buffer and compare the registers its C text reads and writes
         * with the register model the sync analysis uses (l64f_gpr_reads/l64f_gpr_writes); a miss is reported at run
         * time (kind 5) when the instruction executes, and counted in the lift stats. */
        FILE *ck_out = 0; char *ck_text = 0; size_t ck_len = 0;
        if (lift_fast_check && !l64f_control(in) && (ck_out = open_memstream(&ck_text, &ck_len))) { FILE *t_ = o; o = ck_out; ck_out = t_; }
        if (l64_atomic(in)) { l64_atomic_emit(o, in, next); } else switch (in->op) {
        case XO_MOV: case XO_MOVZX: case XO_MOVSX:
            l64_read(o, bb, "t", next);
            if (in->op == XO_MOVSX) fprintf(o, "t=x64_sext(t,%u);", bb->size);
            l64_write(o, aa, "t", next); break;
        case XO_LEA: { char ea[300]; l64_ea(ea, sizeof ea, bb, 0); l64_write(o, aa, ea, next); break; }
        case XO_ADD: case XO_OR: case XO_ADC: case XO_SBB: case XO_AND: case XO_SUB: case XO_XOR:
        case XO_CMP: case XO_TEST: case XO_INC: case XO_DEC: case XO_NEG: {
            if (in->op == XO_NEG) { fprintf(o, "t=0;"); l64_read(o, aa, "u", next); }
            else {
                l64_read(o, aa, "t", next);
                if (in->op == XO_INC || in->op == XO_DEC) fprintf(o, "u=1;"); else l64_read(o, bb, "u", next);
            }
            uint32_t writes = in->op == XO_INC || in->op == XO_DEC ? L64_FLAGS & ~F_CF : L64_FLAGS;
            uint32_t m = (x->fuse[k] ? x->live[k + 1] : mask) & writes;
            if (m != writes) st->flags_elided++;
            if (x->fuse[k]) fprintf(o, "ca=t;cb=u;");
            unsigned alu = in->op == XO_INC ? XO_ADD : in->op == XO_DEC || in->op == XO_NEG ? XO_SUB : in->op;
            fprintf(o, "t=xl_alu(%u,t,u,%d,&flags,0x%xu);", alu, sz, m);
            if (x->fuse[k]) fprintf(o, "cr=t;");
            if (in->op != XO_CMP && in->op != XO_TEST) l64_write(o, aa, "t", next);
            break;
        }
        case XO_NOT: l64_read(o, aa, "t", next); l64_write(o, aa, "~t", next); break;
        case XO_ROL: case XO_ROR: case XO_RCL: case XO_RCR: case XO_SHL: case XO_SHR: case XO_SAL: case XO_SAR:
            l64_read(o, aa, "t", next); l64_read(o, bb, "u", next);
            if ((in->op == XO_SHL || in->op == XO_SAL || in->op == XO_SHR || in->op == XO_SAR) && !mask)
                fprintf(o, "t=xf_shift(%u,t,(uint32_t)u,%d);", in->op, sz);
            else if (in->op == XO_SHL || in->op == XO_SAL || in->op == XO_SHR || in->op == XO_SAR)
                fprintf(o, "t=xl_shift(%u,t,(uint32_t)u,%d,&flags);", in->op, sz);
            else fprintf(o, "X.flags=flags;t=x64_shift(%u,t,(uint32_t)u,%d);flags=X.flags;", in->op, sz);
            l64_write(o, aa, "t", next); break;
        case XO_BSWAP:
            l64_read(o, aa, "t", next); fprintf(o, "t=__builtin_bswap%u((uint%u_t)t);", sz * 8, sz * 8);
            l64_write(o, aa, "t", next); break;
        case XO_CWDE:
            fprintf(o, "t=x64_sext(r[0],%u);", in->osz / 2);
            { x86_opnd_t dest = {.kind = XK_REG, .size = in->osz, .reg = EAX}; l64_write(o, &dest, "t", next); } break;
        case XO_CDQ:
            fprintf(o, "t=(r[0]&(1ull<<%u))?x64_mask(%u):0;", in->osz * 8 - 1, in->osz);
            { x86_opnd_t dest = {.kind = XK_REG, .size = in->osz, .reg = EDX}; l64_write(o, &dest, "t", next); } break;
        case XO_XCHG:
            l64_read(o, aa, "t", next); l64_read(o, bb, "u", next);
            l64_write(o, aa, "u", next); l64_write(o, bb, "t", next); break;
        case XO_LEAVE:
            l64_fast_sp = L64F_UNK;
            fprintf(o, "r[4]=r[5];"); l64_pointer(o, "r[4]", 8, next, 0, "0");
            fprintf(o, "r[5]=xl_load(p,8);r[4]+=8;"); break;
        case XO_IMUL:
            l64_read(o, in->nops == 3 ? bb : aa, "t", next);
            l64_read(o, in->nops == 3 ? &in->o[2] : bb, "u", next);
            fprintf(o, "t=xl_imul(t,u,%d,&flags);", sz); l64_write(o, aa, "t", next); break;
        case XO_PUSH:
            l64_read(o, aa, "t", next); fprintf(o, "r[4]-=%d;", sz == 2 ? 2 : 8);
            if (l64_fast_sp != L64F_UNK) l64_fast_sp -= sz == 2 ? 2 : 8;
            l64_pointer(o, "r[4]", sz == 2 ? 2 : 8, next, 1, "t"); fprintf(o, "xl_store(p,t,%d);", sz == 2 ? 2 : 8); break;
        case XO_POP:
            l64_pointer(o, "r[4]", sz == 2 ? 2 : 8, next, 0, "0");
            fprintf(o, "t=xl_load(p,%d);r[4]+=%d;", sz == 2 ? 2 : 8, sz == 2 ? 2 : 8);
            if (l64_fast_sp != L64F_UNK) l64_fast_sp += sz == 2 ? 2 : 8;
            l64_write(o, aa, "t", next); break;
        case XO_CMOVCC: case XO_SETCC: case XO_JCC: {
            char cond[200];
            if (fused_consumer) snprintf(cond, sizeof cond, "xf_cond(%d,ca,cb,cr,%d,%u)", l64f_alu_op(ins[k - 1].op),
                ins[k - 1].o[0].size ? ins[k - 1].o[0].size : ins[k - 1].osz, in->cc);
            else snprintf(cond, sizeof cond, "xl_cond(%u,flags)", in->cc);
            if (in->op == XO_CMOVCC) {
                l64_read(o, bb, "t", next); fprintf(o, "if(%s){", cond); l64_write(o, aa, "t", next); fprintf(o, "}");
                /* AMD64: a 32-bit CMOVcc zero-extends its destination even when the condition is false. */
                if (aa->kind == XK_REG && aa->reg < 16 && sz == 4) fprintf(o, "else r[%u]=(uint32_t)r[%u];", aa->reg, aa->reg);
            }
            else if (in->op == XO_SETCC) { fprintf(o, "t=%s;", cond); l64_write(o, aa, "t", next); }
            else {
                int t = l64_index(f, in->target);
                if (t >= 0) fprintf(o, "if(%s)goto L_%s%08x;", cond, pre, in->target);
                else {
                    char callee[16]; snprintf(callee, sizeof callee, "0x%08xu", in->target); l64f_ck_callee = callee;
                    if (inlined) { fprintf(o, "if(%s){", cond); l64f_spill(o, x, dk); fprintf(o, "X.eip=0x%08xu;return;}", in->target); }
                    else if (lift_fast_calls_out) { fprintf(o, "if(%s){", cond); l64f_spill_regs(o, x, dk); l64f_direct_out(o, a, in->target, 0, ""); fprintf(o, "}"); }
                    else { fprintf(o, "if(%s){", cond); l64f_spill(o, x, dk); l64f_direct(o, a, in->target, "return;"); fprintf(o, "}"); }
                    l64f_ck_callee = "0u";
                }
            }
            break;
        }
        case XO_SIMD: l64_simd(o, in, next); break;
        case XO_JMP:
            if (l64_index(f, in->target) >= 0) { fprintf(o, "goto L_%s%08x;\n", pre, in->target); continue; }
            { char callee[16]; snprintf(callee, sizeof callee, "0x%08xu", in->target); l64f_ck_callee = callee;
            if (inlined) {
                /* An inlined tail call returns to the inlined call's return address. */
                char after[L64F_TEXT + 128], rl[L64F_TEXT];
                /* K75: the tail callee returned with exact flags when this inlined function must return them. */
                const char *fl = l64f_fn_exact_exit(a, f) ? "flags=X.flags;" : "";
                if (lift_fast_calls_out) {
                    snprintf(after, sizeof after, "%s%sgoto %s;", l64f_reload_text(rl, sizeof rl, x, exit_live, callee), fl, ret_label);
                    l64f_spill_regs(o, x, dk); l64f_direct_out(o, a, in->target, ret_to, after); fprintf(o, "\n");
                } else {
                    snprintf(after, sizeof after, "if(X.eip!=0x%08xu||xf_busy())return;%s%sgoto %s;", ret_to, l64f_reload_text(rl, sizeof rl, x, exit_live, callee), fl, ret_label);
                    l64f_spill(o, x, dk); l64f_direct(o, a, in->target, after); fprintf(o, "\n");
                }
            } else if (lift_fast_calls_out) { l64f_spill_regs(o, x, dk); l64f_direct_out(o, a, in->target, 0, ""); fprintf(o, "\n"); }
            else { l64f_spill(o, x, dk); l64f_direct(o, a, in->target, "return;"); fprintf(o, "\n"); }
            l64f_ck_callee = "0u"; }
            continue;
        case XO_JMP_IND:
            l64_read(o, aa, "t", next);
            if (x->succ[k].table) {
                vec_t uniq = {0};
                for (uint32_t q = 0; q < x->succ[k].table->n; q++) vpush(&uniq, x->succ[k].table->v[q]);
                vsort_uniq(&uniq); st->jt_switch++;
                fprintf(o, "switch(t){");
                for (uint32_t q = 0; q < uniq.n; q++) if (l64_index(f, uniq.v[q]) >= 0) fprintf(o, "case 0x%08xu:goto L_%s%08x;", uniq.v[q], pre, uniq.v[q]);
                fprintf(o, "default:break;}");
                free(uniq.v);
            }
            l64f_ck_callee = "(uint32_t)t"; l64f_spill(o, x, dk); l64f_ck_callee = "0u";
            if (x->hints[k]) fprintf(o, "if(t<=UINT32_MAX){X.eip=(uint32_t)t;static x86_import_site_t site={.iat=0x%08xu};"
                "if(x86_try_import(&site,t))return;if(x86_defer_import(&site,t))return;}", x->hints[k]);
            fprintf(o, "X.eip=x86_address(t);{static x86_fast_site_t site;x86_native_fn step=xf_lookup(&site,X.eip);"
                       "if(step&&x86_fast_depth<" L64F_DEPTH "){x86_fast_depth++;step(X.eip);x86_fast_depth--;}}return;\n");
            continue;
        case XO_CALL: case XO_CALL_IND: {
            int internal = l64f_contiguous(f, ins, k);
            char resume[64];
            /* After a normal return X is complete: everything we wrote was spilled before the call. */
            if (internal) snprintf(resume, sizeof resume, "goto L_%s%08x;", pre, next); else snprintf(resume, sizeof resume, "return;");
            if (in->op == XO_CALL) { fprintf(o, "t=0x%08xu;", in->target); st->calls_direct++; }
            else { l64_read(o, aa, "t", next); st->calls_indirect++; }
            fprintf(o, "r[4]-=8;");
            int64_t sp_call = l64_fast_sp;
            if (l64_fast_sp != L64F_UNK) l64_fast_sp -= 8;
            { char ret[40]; snprintf(ret, sizeof ret, "0x%08xull", next); l64_pointer(o, "r[4]", 8, next, 1, ret); fprintf(o, "xl_store(p,%s,8);", ret); }
            func_t *g = l64f_inline_target(a, x, k, c);
            if (x->dirty && g != x->inl[k]) die("fast sync: inlining decision diverged from the flow analysis");
            uint16_t live_next = x->dirty ? l64f_live_after(x, k) : 0;
            if (g) {
                char gpre[32], label[48];
                snprintf(gpre, sizeof gpre, "i%u_", ++c->sites); snprintf(label, sizeof label, "Q_%s%08x", pre, next);
                fprintf(o, "\n");
                l64f_fn_t *y = l64f_analyze(a, g);
                c->budget -= g->insns.n; c->stack[++c->depth] = g->addr; lift_fast_inlined++;
                lift_stats_t copy = *st; /* inlined copies are not additional lifted instructions */
                /* K78 check: the callee-saved registers the inlined subtree writes must come back unchanged. */
                uint16_t ck_saved = 0; unsigned ck_depth = c->depth;
                if (lift_fast_check) {
                    uint32_t pu = 0, pw = 0; l64f_inline_t cc = *c; l64f_plan(a, y, &cc, &pu, &pw);
                    /* Every write path: specialized writes (l64f_plan) and, when the subtree holds a generic
                     * instruction, every register the locals reload from X after it (vK78: an inlined CPUID). */
                    cc = *c;
                    if (l64f_plan_generic(a, y, &cc)) pw |= l64f_used_set;
                    ck_saved = (uint16_t)(pw & L64F_CALLEE_SAVED);
                    for (int i = 0; i < 16; i++) if (ck_saved & (1u << i)) fprintf(o, "xc%u_%d=r[%d];", ck_depth, i, i);
                }
                l64f_body(o, a, y, st, c, gpre, next, label, l64_fast_sp, (uint16_t)(dk | L64F_RSP), live_next);
                *st = copy;
                c->depth--; l64f_release(y); l64_fast_pc = va;
                /* Both the inlined RET and an inlined tail call's return arrive here. The callee may
                 * have moved RSP (alloca-style ___chkstk/__alloca): re-derive the stack base from the
                 * real r[4], exactly as after a non-inlined call. */
                fprintf(o, "%s: __attribute__((unused));", label); l64f_spset(o, sp_call);
                for (int i = 0; i < 16; i++) if (ck_saved & (1u << i)) {
                    char reg[8], got[16], want[16], callee[16];
                    snprintf(reg, sizeof reg, "%d", i); snprintf(got, sizeof got, "r[%d]", i); snprintf(want, sizeof want, "xc%u_%d", ck_depth, i); snprintf(callee, sizeof callee, "0x%08xu", g->addr);
                    fprintf(o, "if(__builtin_expect(r[%d]!=%s,0)){", i, want); l64f_ck_report(o, 4, reg, x, callee, got, want); fputs("}", o);
                }
                fprintf(o, "\n");
                continue;
            }
            if (lift_fast_calls_out && !x->hints[k]) {
                /* Outlined protocol (a call with an import hint keeps the inline form below). */
                l64f_ck_callee = "(uint32_t)t"; l64f_spill_regs(o, x, (uint16_t)(dk | L64F_RSP)); l64f_ck_callee = "0u";
                char rl[L64F_TEXT], after[L64F_TEXT + 128];
                if (internal) snprintf(after, sizeof after, "%s%s", l64f_reload_text(rl, sizeof rl, x, live_next, "(uint32_t)t"), l64f_flags_after(x, k)); else snprintf(after, sizeof after, "return;");
                if (in->op == XO_CALL) l64f_direct_out(o, a, in->target, next, after);
                else fprintf(o, "X.eip=x86_address(t);{static x86_fast_site_t site;x86_native_fn step=xf_lookup(&site,X.eip);"
                                "if(xf_enter(X.eip,flags,clock,qbase)||(!step&&(x86_fast_depth--,1)))return;step(X.eip);}if(xf_leave(0x%08xu))return;%s", next, after);
                if (internal) l64f_spset(o, sp_call);
                fprintf(o, "\n");
                continue;
            }
            l64f_ck_callee = "(uint32_t)t"; l64f_spill(o, x, (uint16_t)(dk | L64F_RSP)); l64f_ck_callee = "0u";
            if (x->hints[k]) { fprintf(o, "if(t<=UINT32_MAX){X.eip=(uint32_t)t;static x86_import_site_t site={.iat=0x%08xu};"
                "if(x86_try_import(&site,t)){if(X.eip!=0x%08xu||xf_busy())return;", x->hints[k], next); l64f_reload_call(o, x, live_next, "(uint32_t)t"); }
            if (x->hints[k]) { l64f_spset(o, sp_call); fprintf(o, "%s}if(x86_defer_import(&site,t))return;}", resume); }
            if (in->op == XO_CALL) l64f_direct(o, a, in->target, "");
            else fprintf(o, "X.eip=x86_address(t);{static x86_fast_site_t site;x86_native_fn step=xf_lookup(&site,X.eip);"
                            "if(step&&x86_fast_depth<" L64F_DEPTH "){x86_fast_depth++;step(X.eip);x86_fast_depth--;}else return;}");
            if (internal) { fprintf(o, "if(X.eip!=0x%08xu||xf_busy())return;", next); l64f_reload_call(o, x, live_next, "(uint32_t)t"); fputs(l64f_flags_after(x, k), o); l64f_spset(o, sp_call); fprintf(o, "\n"); }
            else fprintf(o, "return;\n");
            continue;
        }
        case XO_RET:
            if (lift_fast_test_corrupt == 1) fprintf(o, "{uint8_t*q_=xf_base+(((uint32_t)r[4]-512u)&XF_MASK);q_[0]^=0x5au;}");
            l64_pointer(o, "r[4]", 8, next, 0, "0");
            fprintf(o, "t=xl_load(p,8);r[4]+=%llu;", 8ull + aa->imm);
            if (inlined) fprintf(o, "if(t==0x%08xull)goto %s;", ret_to, ret_label);
            l64f_spill(o, x, (uint16_t)(dk | L64F_RSP)); fprintf(o, "X.eip=x86_address(t);return;\n");
            continue;
        default: break;
        }
        if (ck_out) {
            fclose(o); o = ck_out; fputs(ck_text, o);
            uint16_t tr = 0, tw = 0; l64f_text_regs(ck_text, &tr, &tw); free(ck_text);
            uint16_t miss = (uint16_t)((tr & ~l64f_gpr_reads(in)) | (tw & ~l64f_gpr_writes(in)));
            for (int i = 0; i < 16; i++) if (miss & (1u << i)) {
                char reg[8]; snprintf(reg, sizeof reg, "%d", i); l64f_ck_report(o, 5, reg, x, "0u", "0", "0");
                lift_fast_check_model++;
                char txt[160] = ""; x86_format(in, txt, sizeof txt);
                fprintf(stderr, "x86tool: fast check: register model misses r[%d] (%s) of `%s` at %08x\n", i, tr & (1u << i) ? "read" : "write", txt, va);
            }
        }
        fprintf(o, "\n");
        if (!l64f_contiguous(f, ins, k)) { l64f_spill(o, x, (uint16_t)(dk | l64f_gpr_writes(in))); fprintf(o, "X.eip=0x%08xu;return;\n", next); }
    }
}
static void l64f_lift(FILE *o, an_t *a, func_t *f, lift_stats_t *st) {
    l64_guarded = 0; /* exact-mode block guard state never leaks into fast operands */
    l64f_fn_t *x = l64f_analyze(a, f);
    uint32_t used = 0, written = 0, n = x->n;
    l64f_inline_t c = {.stack = {f->addr}, .budget = L64F_INLINE_BUDGET};
    l64f_plan(a, x, &c, &used, &written);
    used |= written;
    lift_fast_functions++;
    /* Spill/reload macros are function-local: each spills exactly this function's locals. */
    fprintf(o, "\n");
    if (lift_fast_mark) fprintf(o, "/*@F %08x %u*/", f->addr, n); /* same line: marked and unmarked C share line numbers */
    fprintf(o, "/* function %08x (%u instructions): K52 fast whole-function form */\n#undef XF_SPILL\n#undef XF_RELOAD\n#undef XF_RELOAD_CALL\n#define XF_SPILL ", f->addr, n);
    for (int i = 0; i < 16; i++) if (written & (1u << i)) fprintf(o, "X.r[%d]=r[%d];", i, i);
    fprintf(o, "X.flags=flags;X.tsc=clock;X.frame_insns=(uint32_t)(clock-qbase);XR_LIFT(clock-retire_clock);retire_clock=clock;\n#define XF_RELOAD ");
    for (int i = 0; i < 16; i++) if (used & (1u << i)) fprintf(o, "r[%d]=X.r[%d];", i, i);
    fprintf(o, "flags=X.flags;clock=X.tsc;qbase=clock-X.frame_insns;retire_clock=clock;xf_lim=x86_guest_committed;\n#define XF_RELOAD_CALL ");
    /* Win64 ABI: callee-saved registers come back unchanged; only volatile ones and RSP reload. */
    for (int i = 0; i < 16; i++) if ((used & (1u << i)) && ((l64f_volatile & (1u << i)) || i == ESP)) fprintf(o, "r[%d]=X.r[%d];", i, i);
    fprintf(o, "clock=X.tsc;qbase=clock-X.frame_insns;retire_clock=clock;xf_lim=x86_guest_committed;\n");
    l64f_spill_set = (uint16_t)written; l64f_used_set = (uint16_t)used;
    if (lift_fast_sync) {
        fprintf(o, "#undef XF_SYNC\n#undef XF_RELOAD_CLOCK\n#define XF_SYNC X.flags=flags;X.tsc=clock;X.frame_insns=(uint32_t)(clock-qbase);XR_LIFT(clock-retire_clock);retire_clock=clock\n"
                   "#define XF_RELOAD_CLOCK clock=X.tsc;qbase=clock-X.frame_insns;retire_clock=clock;xf_lim=x86_guest_committed;\n");
    }
    fprintf(o, "void N_%08x(uint32_t pc){\n", f->addr);
    fprintf(o, "uint64_t r[16],clock,qbase,retire_clock,t=0,u=0,v=0,address=0,value=0,fault=0,ca=0,cb=0,cr=0;"
               "uint32_t flags,entry_index=0;uint8_t *p,*xf_sp=0;x86_vec_t av,bv;uint8_t *const xf_base=x86_flat;uint64_t xf_lim;"
               "(void)t;(void)u;(void)v;(void)p;(void)av;(void)bv;(void)ca;(void)cb;(void)cr;(void)value;(void)fault;(void)entry_index;(void)address;(void)xf_sp;(void)xf_lim;\n");
    if (lift_fast_check) { /* K78: stale-volatile mask (minimal sync) and inline snapshots of callee-saved registers */
        l64f_ck_owner = f->addr;
        fputs("uint16_t xs=0,xk=0;(void)xs;(void)xk;", o);
        for (int i = 0; i < 16; i++) if ((L64F_CALLEE_SAVED & used & ~written) & (1u << i)) fprintf(o, "uint64_t xr_%d=0;(void)xr_%d;", i, i);
        for (unsigned d = 1; d <= L64F_INLINE_DEPTH; d++) for (int i = 0; i < 16; i++)
            if ((L64F_CALLEE_SAVED & used) & (1u << i)) fprintf(o, "uint64_t xc%u_%d=0;(void)xc%u_%d;", d, i, d, i);
        fputs("x86_sync_check.live=1;\n", o);
    }
    fprintf(o, "XR_OWNER(0x%08xu)\nXF_RELOAD\nswitch(pc){", f->addr);
    for (uint32_t k = 0; k < n; k++) if (x->entry[k]) {
        fprintf(o, "case 0x%08xu:", f->insns.v[k]); l64f_spset(o, x->sp[k]); fprintf(o, "goto %s_%08x;", k ? "L" : "E", f->insns.v[k]);
    }
    fprintf(o, "default:goto slow;}\n");
    fprintf(o, "E_%08x:x86_coverage_lifted(0x%08xu,1);"
               "if(__builtin_expect(clock-qbase>=2000000u,0)){if(x86_fast_quantum()){X.eip=0x%08xu;return;}qbase=clock-X.frame_insns;}\n",
            f->addr, f->addr, f->addr);
    l64_fast = 1;
    c = (l64f_inline_t){.stack = {f->addr}, .budget = L64F_INLINE_BUDGET};
    l64f_body(o, a, x, st, &c, "", 0, 0, 0, 0, 0);
    l64_fast = 0; l64_fast_sp = L64F_UNK;
    /* Any other PC: interpret one instruction and retry (the interpreter re-enters lifted code). */
    fprintf(o, "slow:X.eip=pc;x86_lift_count=1;x86_lift_reason=XE_INTERIOR;return;\n"
               "memory_fault: __attribute__((unused));X.eip=(uint32_t)(fault>>32);x86_fault(\"invalid fast guest memory access\",(uint32_t)address);\n}\n");
    fprintf(o, "void F_%08x(void){x86_run_native(N_%08x);}\n", f->addr, f->addr);
    for (uint32_t j = 0; j < f->nij; j++) if (!f->ij[j].resolved) st->unresolved++;
    l64f_release(x);
}
/* Fast-mode tail calls and conditional tail jumps need prototypes for other functions' N_. */
static void l64f_declare_tails(FILE *o, an_t *a, vec_t *weak) {
    for (uint32_t i = 0; i < a->nf; i++) {
        func_t *f = &a->f[i];
        if (!lift_selected(f->addr) || vhas(&skip, f->addr) || f->insns.n > L64F_MAX_INSNS || !f->insns.n || f->insns.v[0] != f->addr) continue;
        for (uint32_t k = 0; k < f->insns.n; k++) {
            x86_insn_t in;
            if (!decode_at(a->pe, f->insns.v[k], &in) || (in.op != XO_JMP && in.op != XO_JCC)) continue;
            if (l64_index(f, in.target) >= 0 || func_index(a, in.target) < 0 || vhas(&skip, in.target)) continue;
            if (!lift_selected(in.target)) vpush(weak, in.target);
        }
    }
    (void)o;
}
