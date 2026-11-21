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
/* Fast-mode flag effects: unknown/generic code observes everything; the Win64 ABI makes flags
 * dead across calls and returns (callee/caller never read them). */
static void l64f_flag_io(const x86_insn_t *in, uint32_t *r, uint32_t *w) {
    if (!in->len || !l64_specialized(in)) { *r = L64_FLAGS; *w = 0; return; }
    if (in->op == XO_CALL || in->op == XO_CALL_IND || in->op == XO_RET) { *r = 0; *w = L64_FLAGS; return; }
    l64_flag_io(in, r, w);
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
static uint32_t *l64f_liveness(const func_t *f, const x86_insn_t *ins, const l64f_succ_t *succ) {
    uint32_t n = f->insns.n, *in = xcalloc(n, sizeof *in), *out = xcalloc(n, sizeof *out);
    for (int changed = 1; changed;) {
        changed = 0;
        for (uint32_t j = n; j-- > 0;) {
            uint32_t v = succ[j].ext, r, w;
            for (int q = 0; q < 2; q++) if (succ[j].s[q] >= 0) v |= in[succ[j].s[q]];
            if (succ[j].table) for (uint32_t q = 0; q < succ[j].table->n; q++) {
                int t = l64_index(f, succ[j].table->v[q]); v |= t >= 0 ? in[t] : L64_FLAGS;
            }
            l64f_flag_io(&ins[j], &r, &w);
            out[j] = v; v = r | (v & ~w);
            if (in[j] != v) { in[j] = v; changed = 1; }
        }
    }
    free(in); return out;
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
    func_t *f; uint32_t n, used, written;
    x86_insn_t *ins; uint32_t *hints, *live; vec_t *rel; l64f_succ_t *succ;
    uint8_t *header, *entry, *start, *fuse;
    int64_t *sp; /* static RSP delta before each instruction (L64F_UNK unknown) */
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
    uint32_t n = x->n = f->insns.n; x->f = f;
    x->ins = xcalloc(n, sizeof *x->ins);
    for (uint32_t k = 0; k < n; k++) decode_at(a->pe, f->insns.v[k], &x->ins[k]);
    x86_insn_t *ins = x->ins;
    x->hints = l64_import_hints(a->pe, f);
    x->succ = xcalloc(n, sizeof *x->succ);
    x->rel = xcalloc(n, sizeof *x->rel);
    for (uint32_t k = 0; k < n; k++) if (ins[k].op == XO_JMP_IND) l64f_rel_table(a, f, ins, k, &x->rel[k]);
    for (uint32_t k = 0; k < n; k++) x->succ[k] = l64f_successors(f, ins, k, x->hints, x->rel);
    x->live = l64f_liveness(f, ins, x->succ);
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
    free(x->rel); free(x->ins); free(x->hints); free(x->succ); free(x->live);
    free(x->header); free(x->entry); free(x->start); free(x->fuse); free(x->sp); free(x);
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
static void l64f_body(FILE *o, an_t *a, l64f_fn_t *x, lift_stats_t *st, l64f_inline_t *c, const char *pre, uint32_t ret_to, const char *ret_label, int64_t sp_off);
static void l64f_body(FILE *o, an_t *a, l64f_fn_t *x, lift_stats_t *st, l64f_inline_t *c, const char *pre, uint32_t ret_to, const char *ret_label, int64_t sp_off) {
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
            if (x->header[k]) fprintf(o, "if(__builtin_expect(clock-qbase>=2000000u,0)){X.tsc=clock;X.frame_insns=(uint32_t)(clock-qbase);"
                "XR_LIFT(clock-retire_clock);retire_clock=clock;if(x86_fast_quantum()){XF_SPILL;X.eip=0x%08xu;return;}qbase=clock-X.frame_insns;}", va);
            if (count) fprintf(o, "clock+=%uu;", count);
            fprintf(o, "\n");
        }
        if (!in->len) { fprintf(o, "XF_SPILL;X.eip=0x%08xu;return;\n", f->insns.v[k]); continue; }
        if (!l64_specialized(in)) {
            st->generic++;
            fprintf(o, "XF_SPILL;X.eip=0x%08xu;{static const x86_insn_t I=", va); emit_insn_struct(o, in);
            fprintf(o, ";x86_fast_exec(&I);}if(X.eip!=0x%08xu||xf_busy())return;XF_RELOAD ", next);
            l64f_spset(o, sp_next); fprintf(o, "\n");
            if (!l64f_contiguous(f, ins, k)) fprintf(o, "return;\n");
            continue;
        }
        st->specialized++;
        l64_replay = (l64_replay_t){0}; l64_fault_writes = 0; l64_position = 0;
        uint32_t mask = x->live[k] & L64_FLAGS;
        int fused_consumer = k && x->fuse[k - 1];
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
                else if (inlined) fprintf(o, "if(%s){XF_SPILL;X.eip=0x%08xu;return;}", cond, in->target);
                else { fprintf(o, "if(%s){XF_SPILL;", cond); l64f_direct(o, a, in->target, "return;"); fprintf(o, "}"); }
            }
            break;
        }
        case XO_SIMD: l64_simd(o, in, next); break;
        case XO_JMP:
            if (l64_index(f, in->target) >= 0) fprintf(o, "goto L_%s%08x;\n", pre, in->target);
            else if (inlined) {
                /* An inlined tail call returns to the inlined call's return address. */
                char after[96]; snprintf(after, sizeof after, "if(X.eip!=0x%08xu||xf_busy())return;XF_RELOAD_CALL goto %s;", ret_to, ret_label);
                fprintf(o, "XF_SPILL;"); l64f_direct(o, a, in->target, after); fprintf(o, "\n");
            } else { fprintf(o, "XF_SPILL;"); l64f_direct(o, a, in->target, "return;"); fprintf(o, "\n"); }
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
            fprintf(o, "XF_SPILL;");
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
            if (g) {
                char gpre[32], label[48];
                snprintf(gpre, sizeof gpre, "i%u_", ++c->sites); snprintf(label, sizeof label, "Q_%s%08x", pre, next);
                fprintf(o, "\n");
                l64f_fn_t *y = l64f_analyze(a, g);
                c->budget -= g->insns.n; c->stack[++c->depth] = g->addr; lift_fast_inlined++;
                lift_stats_t copy = *st; /* inlined copies are not additional lifted instructions */
                l64f_body(o, a, y, st, c, gpre, next, label, l64_fast_sp);
                *st = copy;
                c->depth--; l64f_release(y); l64_fast_pc = va;
                /* Both the inlined RET and an inlined tail call's return arrive here. The callee may
                 * have moved RSP (alloca-style ___chkstk/__alloca): re-derive the stack base from the
                 * real r[4], exactly as after a non-inlined call. */
                fprintf(o, "%s: __attribute__((unused));", label); l64f_spset(o, sp_call); fprintf(o, "\n");
                continue;
            }
            fprintf(o, "XF_SPILL;");
            if (x->hints[k]) fprintf(o, "if(t<=UINT32_MAX){X.eip=(uint32_t)t;static x86_import_site_t site={.iat=0x%08xu};"
                "if(x86_try_import(&site,t)){if(X.eip!=0x%08xu||xf_busy())return;XF_RELOAD_CALL ", x->hints[k], next);
            if (x->hints[k]) { l64f_spset(o, sp_call); fprintf(o, "%s}if(x86_defer_import(&site,t))return;}", resume); }
            if (in->op == XO_CALL) l64f_direct(o, a, in->target, "");
            else fprintf(o, "X.eip=x86_address(t);{static x86_fast_site_t site;x86_native_fn step=xf_lookup(&site,X.eip);"
                            "if(step&&x86_fast_depth<" L64F_DEPTH "){x86_fast_depth++;step(X.eip);x86_fast_depth--;}else return;}");
            if (internal) { fprintf(o, "if(X.eip!=0x%08xu||xf_busy())return;XF_RELOAD_CALL ", next); l64f_spset(o, sp_call); fprintf(o, "\n"); }
            else fprintf(o, "return;\n");
            continue;
        }
        case XO_RET:
            l64_pointer(o, "r[4]", 8, next, 0, "0");
            fprintf(o, "t=xl_load(p,8);r[4]+=%llu;", 8ull + aa->imm);
            if (inlined) fprintf(o, "if(t==0x%08xull)goto %s;", ret_to, ret_label);
            fprintf(o, "XF_SPILL;X.eip=x86_address(t);return;\n");
            continue;
        default: break;
        }
        fprintf(o, "\n");
        if (!l64f_contiguous(f, ins, k)) fprintf(o, "XF_SPILL;X.eip=0x%08xu;return;\n", next);
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
    fprintf(o, "\n/* function %08x (%u instructions): K52 fast whole-function form */\n#undef XF_SPILL\n#undef XF_RELOAD\n#undef XF_RELOAD_CALL\n#define XF_SPILL ", f->addr, n);
    for (int i = 0; i < 16; i++) if (written & (1u << i)) fprintf(o, "X.r[%d]=r[%d];", i, i);
    fprintf(o, "X.flags=flags;X.tsc=clock;X.frame_insns=(uint32_t)(clock-qbase);XR_LIFT(clock-retire_clock);retire_clock=clock;\n#define XF_RELOAD ");
    for (int i = 0; i < 16; i++) if (used & (1u << i)) fprintf(o, "r[%d]=X.r[%d];", i, i);
    fprintf(o, "flags=X.flags;clock=X.tsc;qbase=clock-X.frame_insns;retire_clock=clock;xf_lim=x86_guest_committed;\n#define XF_RELOAD_CALL ");
    /* Win64 ABI: callee-saved registers come back unchanged; only volatile ones and RSP reload. */
    for (int i = 0; i < 16; i++) if ((used & (1u << i)) && ((l64f_volatile & (1u << i)) || i == ESP)) fprintf(o, "r[%d]=X.r[%d];", i, i);
    fprintf(o, "clock=X.tsc;qbase=clock-X.frame_insns;retire_clock=clock;xf_lim=x86_guest_committed;\n");
    fprintf(o, "void N_%08x(uint32_t pc){\n", f->addr);
    fprintf(o, "uint64_t r[16],clock,qbase,retire_clock,t=0,u=0,v=0,address=0,value=0,fault=0,ca=0,cb=0,cr=0;"
               "uint32_t flags,entry_index=0;uint8_t *p,*xf_sp=0;x86_vec_t av,bv;uint8_t *const xf_base=x86_flat;uint64_t xf_lim;"
               "(void)t;(void)u;(void)v;(void)p;(void)av;(void)bv;(void)ca;(void)cb;(void)cr;(void)value;(void)fault;(void)entry_index;(void)address;(void)xf_sp;(void)xf_lim;\n");
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
    l64f_body(o, a, x, st, &c, "", 0, 0, 0);
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
