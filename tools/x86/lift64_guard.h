/* Static, bounded memory-span guards for straight-line AMD64 blocks. MIT.
 * A failed guard executes the original block through shared semantics before any local mutation.
 * Thus a successful guard can use direct flat loads without per-operand fault snapshots. */
typedef struct { x86_opnd_t first; int64_t low, high; } l64_span_t;
typedef struct { l64_span_t spans[16]; int n, safe; } l64_guard_t;
static int l64_span_add(l64_guard_t *g, x86_opnd_t p, int bytes, int64_t stack_delta) {
    if ((p.pad & 1) || bytes < 1 || bytes > 16) return 0;
    /* Normalized RIP-relative no-base addresses are uint32; other disp32 values sign-extend. */
    int64_t offset = (p.pad & 4) ? (int64_t)p.imm :
        (p.base == X86_NOREG && (p.pad & 2)) ? (int64_t)(uint32_t)p.disp : (int64_t)p.disp;
    if (p.base == ESP) offset += stack_delta;
    if (offset > INT64_MAX - bytes) return 0;
    for (int i = 0; i < g->n; i++) {
        l64_span_t *s = &g->spans[i];
        if (s->first.base != p.base || s->first.index != p.index || s->first.scale != p.scale ||
            s->first.seg_fs != p.seg_fs || s->first.pad != p.pad) continue;
        int64_t lo = offset < s->low ? offset : s->low;
        int64_t hi = offset + bytes > s->high ? offset + bytes : s->high;
        if ((uint64_t)hi - (uint64_t)lo > 4096) continue;
        s->low = lo; s->high = hi; return 1;
    }
    if (g->n == 16) return 0;
    g->spans[g->n++] = (l64_span_t){p, offset, offset + bytes}; return 1;
}
static l64_guard_t l64_guard(x86_insn_t *ins, uint32_t begin, uint32_t end) {
    l64_guard_t g = {.safe = 1}; uint32_t changed = 0; int64_t sp = 0;
    for (uint32_t k = begin; k < end; k++) {
        x86_insn_t *in = &ins[k];
        if (!l64_specialized(in) || in->op == XO_LEAVE) { g.safe = 0; break; }
        for (int j = 0; j < in->nops; j++) {
            x86_opnd_t p = in->o[j]; if (p.kind != XK_MEM || in->op == XO_LEA) continue;
            if (in->op == XO_POP && p.base == ESP) g.safe = 0;
            uint32_t bases = (p.base == X86_NOREG ? 0 : 1u << p.base) |
                (p.index == X86_NOREG ? 0 : 1u << p.index);
            if ((bases & changed) || p.index == ESP) { g.safe = 0; break; }
            int bytes = p.size;
            if (in->op == XO_SIMD) {
                int scalar = in->simd_prefix == 0xf2 || in->simd_prefix == 0xf3;
                int op = in->simd_op;
                bytes = scalar && (op == 0x10 || op == 0x11 || (op >= 0x51 && op <= 0x5f)) ?
                    (in->simd_prefix == 0xf2 ? 8 : 4) : 16;
            }
            if (!l64_span_add(&g, p, bytes, sp)) g.safe = 0;
        }
        int op = in->op, n = in->o[0].size == 2 ? 2 : 8;
        if (op == XO_PUSH || op == XO_CALL || op == XO_CALL_IND || op == XO_POP || op == XO_RET) {
            if (changed & (1u << ESP)) g.safe = 0;
            if (op == XO_CALL || op == XO_CALL_IND || op == XO_RET) n = 8;
            if (op == XO_PUSH || op == XO_CALL || op == XO_CALL_IND) sp -= n;
            x86_opnd_t p = {.kind = XK_MEM, .base = ESP, .index = X86_NOREG};
            if (!l64_span_add(&g, p, n, sp)) g.safe = 0;
            if (op == XO_POP || op == XO_RET) sp += n;
        }
        /* Overestimating writes is safe; only ESP add/sub immediates have a tracked affine update. */
        if (in->nops && in->o[0].kind == XK_REG) {
            unsigned r = in->o[0].reg >= 16 ? in->o[0].reg - 16 : in->o[0].reg;
            if (r == ESP && (op == XO_ADD || op == XO_SUB) && in->o[0].size == 8 &&
                in->o[1].kind == XK_IMM) {
                int64_t delta = (int64_t)in->o[1].imm;
                if (delta < -0x100000 || delta > 0x100000) g.safe = 0;
                else sp += op == XO_ADD ? delta : -delta;
            } else if (op != XO_PUSH && op != XO_CMP && op != XO_TEST && op != XO_JMP_IND &&
                       op != XO_CALL_IND) changed |= 1u << r;
        }
        if (op == XO_XCHG && in->o[1].kind == XK_REG)
            changed |= 1u << (in->o[1].reg >= 16 ? in->o[1].reg - 16 : in->o[1].reg);
        if (op == XO_CDQ) changed |= 1u << EDX;
        if (op == XO_CWDE) changed |= 1u << EAX;
        if (!g.safe) break;
    }
    return g;
}
static void l64_emit_guard(FILE *o, const l64_guard_t *g, uint32_t va, uint32_t count) {
    if (!g->safe || !g->n) return;
    fprintf(o, "if(");
    for (int i = 0; i < g->n; i++) {
        const l64_span_t *s = &g->spans[i]; x86_opnd_t p = s->first;
        /* Build the affine expression with a full-width displacement, not truncated to disp32. */
        p.disp = 0; p.imm = 0;
        char ea[300]; l64_ea(ea, sizeof ea, &p, 1);
        fprintf(o, "%s!xl_pointer(%s+0x%llxull,%uu)", i ? "||" : "", ea,
                (unsigned long long)s->low, (unsigned)(s->high - s->low));
    }
    fprintf(o, "){pc=0x%08xu;count=%uu;action=1;goto boundary;}\n", va, count);
}
