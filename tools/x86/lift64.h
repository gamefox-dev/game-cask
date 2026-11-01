/* AMD64 labelled C with scalar register locals and explicit synchronization boundaries. MIT. */
#include "../../platforms/x86/x86.h"
#define L64_FLAGS (F_CF | F_PF | F_AF | F_ZF | F_SF | F_OF)
static uint32_t l64_used, l64_written;
static int l64_dirty_boundary;
static void l64_sync(FILE *o, int load) {
    for (int i = 0; i < 16; i++) if ((load ? l64_used : l64_written) & (1u << i)) {
        if (load) fprintf(o, "r[%d]=X.r[%d];", i, i);
        else if (l64_dirty_boundary) fprintf(o, "if(dirty&0x%xu)X.r[%d]=r[%d];", 1u << i, i, i);
        else fprintf(o, "X.r[%d]=r[%d];", i, i);
    }
    fprintf(o, load ? "flags=X.flags;clock=X.tsc;budget=X.frame_insns;\n" :
                     "X.flags=flags;X.tsc=clock;X.frame_insns=budget;\n");
}
static void l64_ea(char *s, size_t cap, const x86_opnd_t *p, int segment) {
    char base[100], index[60] = "", seg[40] = "", expr[240];
    if (p->pad & 4) snprintf(base, sizeof base, "0x%llxull", (unsigned long long)p->imm);
    else if (p->base == X86_NOREG)
        snprintf(base, sizeof base, "0x%llxull", (unsigned long long)((p->pad & 2) ?
            (uint32_t)p->disp : (uint64_t)(int64_t)p->disp));
    else snprintf(base, sizeof base, "(r[%u]+0x%llxull)", p->base,
                  (unsigned long long)(uint64_t)(int64_t)p->disp);
    if (p->index != X86_NOREG) snprintf(index, sizeof index, "+(r[%u]<<%u)", p->index, p->scale);
    if (segment && p->seg_fs) snprintf(seg, sizeof seg, "+X.%s_base", p->seg_fs == 2 ? "gs" : "fs");
    snprintf(expr, sizeof expr, "(%s%s)", base, index);
    snprintf(s, cap, "(%s%s%s)", (p->pad & 1) ? "(uint32_t)" : "", expr, seg);
}
static uint32_t l64_remaining;
static int l64_guarded;
static void l64_pointer(FILE *o, const char *ea, int n, uint32_t next, int writing, const char *value) {
    /* The reference's implicit stack primitives use low-32-bit addresses; explicit [RSP]
     * operands still validate full-width effective addresses through l64_ea. */
    if (!strcmp(ea, "r[4]")) ea = "(uint32_t)r[4]";
    if (l64_guarded) { fprintf(o, "p=x86_flat+(uint32_t)%s;\n", ea); return; }
    uint64_t meta = ((uint64_t)next << 32) | ((uint64_t)l64_remaining << 8) | (writing << 5) | n;
    fprintf(o, "address=%s;p=xl_pointer_access(address,%d,%d);if(!p){fault=0x%llxull;value=%s;goto memory_fault;}\n",
            ea, n, writing ? 2 : 1, (unsigned long long)meta, value);
}
static void l64_read(FILE *o, const x86_opnd_t *p, const char *dest, uint32_t next) {
    if (p->kind == XK_IMM) fprintf(o, "%s=0x%llxull;", dest,
        (unsigned long long)(p->imm & (p->size == 8 ? UINT64_MAX : ((1ull << (p->size * 8)) - 1))));
    else if (p->kind == XK_REG) {
        if (p->reg >= 16) fprintf(o, "%s=(r[%u]>>8)&255;", dest, p->reg - 16);
        else fprintf(o, "%s=(uint%u_t)r[%u];", dest, p->size * 8, p->reg);
    } else {
        char ea[300]; l64_ea(ea, sizeof ea, p, 1);
        l64_pointer(o, ea, p->size, next, 0, "0");
        fprintf(o, "%s=xl_load(p,%u);", dest, p->size);
    }
}
static void l64_write(FILE *o, const x86_opnd_t *p, const char *value, uint32_t next) {
    if (p->kind == XK_REG) {
        if (p->reg >= 16) fprintf(o, "r[%u]=(r[%u]&~0xff00ull)|(((%s)&255)<<8);",
                                 p->reg - 16, p->reg - 16, value);
        else if (p->size >= 4) fprintf(o, "r[%u]=(uint%u_t)(%s);", p->reg, p->size * 8, value);
        else fprintf(o, "r[%u]=(r[%u]&~0x%llxull)|((%s)&0x%llxull);", p->reg, p->reg,
            (unsigned long long)((1ull << (p->size * 8)) - 1), value,
            (unsigned long long)((1ull << (p->size * 8)) - 1));
    } else {
        char ea[300]; l64_ea(ea, sizeof ea, p, 1);
        l64_pointer(o, ea, p->size, next, 1, value);
        fprintf(o, "xl_store(p,%s,%u);", value, p->size);
    }
}
static uint32_t l64_cc_flags(int cc) {
    static const uint32_t masks[8] = {F_OF, F_CF, F_ZF, F_CF | F_ZF, F_SF, F_PF, F_SF | F_OF,
                                    F_ZF | F_SF | F_OF};
    return masks[cc / 2];
}
static void l64_flag_io(const x86_insn_t *in, uint32_t *read, uint32_t *write) {
    *read = *write = 0;
    switch (in->op) {
    case XO_ADC: case XO_SBB: *read = F_CF; /* fall through */
    case XO_ADD: case XO_OR: case XO_AND: case XO_SUB: case XO_XOR: case XO_CMP: case XO_TEST:
    case XO_NEG: *write = L64_FLAGS; return;
    case XO_INC: case XO_DEC: *write = L64_FLAGS & ~F_CF; return;
    case XO_JCC: case XO_CMOVCC: case XO_SETCC: *read = l64_cc_flags(in->cc); return;
    case XO_MOV: case XO_MOVZX: case XO_MOVSX: case XO_LEA: case XO_NOT: case XO_NOP:
    case XO_PUSH: case XO_POP: case XO_JMP: case XO_JMP_IND: return;
    case XO_SIMD:
        if (in->simd_op != 0x2e && in->simd_op != 0x2f) return;
        break;
    default: break;
    }
    /* Unknown/partial writers, calls, exits and generic instructions are observation barriers. */
    *read = L64_FLAGS;
}
static int l64_index(func_t *f, uint32_t va) {
    uint32_t lo = 0, hi = f->insns.n;
    while (lo < hi) { uint32_t m = (lo + hi) / 2; if (f->insns.v[m] < va) lo = m + 1; else hi = m; }
    return lo < f->insns.n && f->insns.v[lo] == va ? (int)lo : -1;
}
/* Per-flag backwards fixed point across both successors. External/indirect edges observe all flags.
 * Every instruction remains an external landing-pad entry; liveness only removes unobservable writes. */
static uint32_t *l64_liveness(func_t *f, x86_insn_t *ins, const uint8_t *guarded, const uint8_t *starts) {
    uint32_t n = f->insns.n, *live = calloc(n, sizeof *live), *out = calloc(n, sizeof *out);
    int changed;
    do {
        changed = 0;
        for (uint32_t j = n; j-- > 0;) {
            x86_insn_t *in = &ins[j]; uint32_t r, w, v = 0;
            l64_flag_io(in, &r, &w);
            /* A memory exception observes the incoming flags, even when a later writer kills them. */
            if (!guarded[j]) {
                for (int k = 0; k < in->nops; k++) if (in->o[k].kind == XK_MEM) r |= L64_FLAGS;
                if (in->op == XO_PUSH || in->op == XO_POP || in->op == XO_LEAVE || in->op == XO_RET ||
                    in->op == XO_CALL || in->op == XO_CALL_IND) r |= L64_FLAGS;
            }
            /* A failed whole-block guard starts reference execution with observable flags. */
            if (starts[j]) r |= L64_FLAGS;
            if (in->op == XO_JMP || in->op == XO_JCC) {
                int t = l64_index(f, in->target); v |= t < 0 ? L64_FLAGS : live[t];
            }
            if (in->op != XO_JMP) {
                int t = l64_index(f, in->addr + in->len); v |= t < 0 ? L64_FLAGS : live[t];
            }
            if (in->op == XO_RET || in->op == XO_JMP_IND) v = L64_FLAGS;
            out[j] = v; v = r | (v & ~w);
            if (live[j] != v) { live[j] = v; changed = 1; }
        }
    } while (changed);
    free(live); return out;
}
static void l64_edge(FILE *o, func_t *f, uint32_t target) {
    if (l64_index(f, target) >= 0) fprintf(o, "goto L_%08x;\n", target);
    else fprintf(o, "pc=0x%08xu;goto exit;\n", target);
}
static int l64_simd_supported(const x86_insn_t *in) {
    unsigned op = in->simd_op;
    return op == 0x10 || op == 0x11 || op == 0x28 || op == 0x29 || op == 0x6f || op == 0x7f ||
        op == 0x54 || op == 0x55 || op == 0x56 || op == 0x57 || op == 0xdb || op == 0xdf ||
        op == 0xeb || op == 0xef || op == 0x58 || op == 0x59 || op == 0x5c || op == 0x5d ||
        op == 0x5e || op == 0x5f;
}
static void l64_simd(FILE *o, const x86_insn_t *in, uint32_t next) {
    const x86_opnd_t *a = &in->o[0], *b = &in->o[1];
    unsigned op = in->simd_op, pre = in->simd_prefix;
    int scalar = pre == 0xf2 || pre == 0xf3, dbl = pre == 0xf2 || pre == 0x66, bytes = dbl ? 8 : 4;
    int store = op == 0x11 || op == 0x29 || op == 0x7f;
    int count = scalar && (op == 0x10 || op == 0x11 || (op >= 0x51 && op <= 0x5f)) ? bytes : 16;
    fprintf(o, "av=X.xmm[%u];", a->reg);
    if (store) {
        if (b->kind == XK_XMM) {
            if (op == 0x11 && scalar) fprintf(o, "__builtin_memcpy(&X.xmm[%u],&av,%d);", b->reg, count);
            else fprintf(o, "X.xmm[%u]=av;", b->reg);
        } else {
            char ea[300]; l64_ea(ea, sizeof ea, b, 1);
            l64_pointer(o, ea, count, next, 2, "0");
            fprintf(o, "__builtin_memcpy(p,&av,%d);", count);
        }
        return;
    }
    if (b->kind == XK_XMM) fprintf(o, "bv=X.xmm[%u];", b->reg);
    else {
        char ea[300]; l64_ea(ea, sizeof ea, b, 1);
        l64_pointer(o, ea, count, next, 3, "0");
        fprintf(o, "bv=(x86_vec_t){0};__builtin_memcpy(&bv,p,%d);", count);
    }
    if (op == 0x10 || op == 0x28 || op == 0x6f) {
        if (op == 0x10 && scalar) {
            if (b->kind == XK_MEM) fprintf(o, "av=(x86_vec_t){0};");
            fprintf(o, "__builtin_memcpy(&av,&bv,%d);", bytes);
        } else fprintf(o, "av=bv;");
    } else if (op >= 0x58 && op <= 0x5f) {
        const char *field = dbl ? "f64" : "f32";
        for (int i = 0; i < (scalar ? 1 : 16 / bytes); i++) {
            fprintf(o, "{double x=av.%s[%d],y=bv.%s[%d];av.%s[%d]=(%s)(", field, i, field, i,
                    field, i, dbl ? "double" : "float");
            fprintf(o, "%s);}", op == 0x58 ? "x+y" : op == 0x59 ? "x*y" : op == 0x5c ? "x-y" :
                op == 0x5d ? "x<y?x:y" : op == 0x5e ? "x/y" : "x>y?x:y");
        }
    } else {
        const char *expr = op == 0x54 || op == 0xdb ? "av.u64[i]&bv.u64[i]" :
            op == 0x55 || op == 0xdf ? "~av.u64[i]&bv.u64[i]" :
            op == 0x56 || op == 0xeb ? "av.u64[i]|bv.u64[i]" : "av.u64[i]^bv.u64[i]";
        fprintf(o, "for(int i=0;i<2;i++)av.u64[i]=%s;", expr);
    }
    fprintf(o, "X.xmm[%u]=av;", a->reg);
}
static int l64_specialized(const x86_insn_t *in) {
    switch (in->op) {
    case XO_MOV: case XO_MOVZX: case XO_MOVSX: case XO_LEA:
    case XO_ADD: case XO_OR: case XO_ADC: case XO_SBB: case XO_AND: case XO_SUB: case XO_XOR:
    case XO_CMP: case XO_TEST: case XO_INC: case XO_DEC: case XO_NEG: case XO_NOT: case XO_IMUL:
    case XO_PUSH: case XO_POP: case XO_CMOVCC: case XO_SETCC: case XO_NOP:
    case XO_ROL: case XO_ROR: case XO_RCL: case XO_RCR: case XO_SHL: case XO_SHR: case XO_SAL: case XO_SAR:
    case XO_BSWAP: case XO_CWDE: case XO_CDQ: case XO_XCHG: case XO_LEAVE:
    case XO_JCC: case XO_JMP: case XO_JMP_IND: case XO_CALL: case XO_CALL_IND: case XO_RET: return 1;
    case XO_SIMD: return l64_simd_supported(in);
    default: return 0;
    }
}
#include "lift64_guard.h"
typedef struct { uint32_t addr, end; } l64_entry_t;
static int l64_entry_cmp(const void *a, const void *b) {
    uint32_t x = ((const l64_entry_t *)a)->addr, y = ((const l64_entry_t *)b)->addr;
    return x > y ? 1 : x < y ? -1 : 0;
}
static void lift64(FILE *o, an_t *a, const char *name, lift_stats_t *st) {
    fprintf(o, "/* GENERATED AMD64 register-local code. */\n#include \"x86_lift64.h\"\n#include \"bgt.h\"\n");
    vec_t order = {0}, ends = {0};
    /* Bound optimizer CFG size independently of guest function size. Internal region entries still
     * cover every landing pad; edges across regions return to the registry without interpreting. */
    for (uint32_t i = 0; i < a->nf; i++) {
        func_t *original = &a->f[i]; if (!lift_selected(original->addr)) continue;
        for (uint32_t begin = 0; begin < original->insns.n; begin += 256) {
        uint32_t end = begin + 256 < original->insns.n ? begin + 256 : original->insns.n;
        func_t region = *original;
        region.addr = original->insns.v[begin];
        region.end = end == original->insns.n ? original->end : original->insns.v[end];
        region.insns.v += begin; region.insns.n = end - begin;
        func_t *f = &region;

        x86_insn_t *ins = calloc(f->insns.n, sizeof *ins);
        for (uint32_t k = 0; k < f->insns.n; k++) decode_at(a->pe, f->insns.v[k], &ins[k]);
        uint8_t *starts = calloc(f->insns.n + 1, 1); starts[0] = starts[f->insns.n] = 1;
        l64_used = l64_written = 0;
        for (uint32_t k = 0; k < f->insns.n; k++) {
            x86_insn_t *in = &ins[k];
            if (in->flags & (X86_F_BRANCH | X86_F_INDIRECT | X86_F_CALL) ||
                !l64_specialized(in) || in->op == XO_RET) {
                starts[k + 1] = 1;
                int t = l64_index(f, in->target); if (t >= 0) starts[t] = 1;
            }
            if (!l64_specialized(in)) starts[k] = 1;
            if (k && ins[k - 1].addr + ins[k - 1].len != in->addr) starts[k] = 1;
            if (!l64_specialized(in)) continue;
            for (int j = 0; j < in->nops; j++) {
                x86_opnd_t *p = &in->o[j];
                if (p->kind == XK_REG) {
                    unsigned reg = p->reg >= 16 ? p->reg - 16 : p->reg;
                    l64_used |= 1u << reg;
                    if (j == 0) l64_written |= 1u << reg;
                }
                if (p->kind == XK_MEM) {
                    if (p->base != X86_NOREG) l64_used |= 1u << p->base;
                    if (p->index != X86_NOREG) l64_used |= 1u << p->index;
                }
            }
            if (in->op == XO_CWDE || in->op == XO_CDQ) {
                l64_used |= 1u << EAX; l64_written |= 1u << (in->op == XO_CWDE ? EAX : EDX);
            }
            if (in->op == XO_XCHG && in->o[1].kind == XK_REG)
                l64_written |= 1u << (in->o[1].reg >= 16 ? in->o[1].reg - 16 : in->o[1].reg);
            if (in->op == XO_LEAVE) { l64_used |= (1u << EBP) | (1u << ESP); l64_written |= l64_used; }
            if (in->op == XO_CALL || in->op == XO_CALL_IND || in->op == XO_RET ||
                in->op == XO_PUSH || in->op == XO_POP) { l64_used |= 1u << ESP; l64_written |= 1u << ESP; }
        }

        uint8_t *guarded = calloc(f->insns.n, 1);
        for (uint32_t k = 0; k < f->insns.n;) {
            uint32_t end = k + 1; while (end < f->insns.n && !starts[end]) end++;
            l64_guard_t guard = l64_guard(ins, k, end);
            for (; k < end; k++) guarded[k] = guard.safe && guard.n;
        }
        uint32_t *live = l64_liveness(f, ins, guarded, starts);
        l64_used |= l64_written;
        /* A distinct signature keeps Asyncify's conservative void(void) scheduler-call target
         * set from including native regions, which cannot suspend. Registry wrappers stay tiny. */
        fprintf(o, "\nstatic __attribute__((minsize,noinline)) void R_%08x_%08x(uint32_t pc){\n",
                original->addr, f->addr);
        fprintf(o, "uint64_t r[16],clock,t=0,u=0,v=0,address=0,value=0,fault=0;"
                   "uint32_t flags,budget,count=0,dirty=0;int action=0,width=0,writing=0;"
                   "const x86_insn_t *pending=0;uint8_t *p;"
                   "x86_vec_t av,bv;(void)t;(void)u;(void)v;(void)p;(void)av;(void)bv;(void)dirty;\n");
        l64_sync(o, 1);
        /* Record only entries actually handled by this region. An indirect jump
         * may dispatch out to an import thunk or another owner; its real handler
         * supplies coverage, not this region's unsuccessful lookup. */
        fprintf(o, "goto dispatch;\ndispatch:switch(pc){\n");
        for (uint32_t k = 0; k < f->insns.n; k++) if (starts[k])
            fprintf(o, "case 0x%08xu:bgt_coverage_entry(pc,1);goto L_%08x;\n", f->insns.v[k], f->insns.v[k]);
        fprintf(o, "default:goto landing;}\n");
        uint32_t block_end = 0;
        for (uint32_t k = 0; k < f->insns.n; k++) {
            x86_insn_t *in = &ins[k]; uint32_t va = f->insns.v[k], next = va + in->len;
            const x86_opnd_t *aa = &in->o[0], *bb = &in->o[1]; int n = aa->size ? aa->size : in->osz;
            if (starts[k]) fprintf(o, "L_%08x:;\n", va);
            if (!in->len) { fprintf(o, "pc=0x%08xu;goto exit;\n", va); continue; }
            if (!l64_specialized(in)) {
                st->generic++;
                fprintf(o, "{static const x86_insn_t I="); emit_insn_struct(o, in);
                fprintf(o, ";pending=&I;}pc=0x%08xu;action=0;goto boundary;\n", va); continue;
            }
            st->specialized++;
            if (starts[k]) {
                block_end = k + 1; while (block_end < f->insns.n && !starts[block_end]) block_end++;
                uint32_t count = block_end - k;
                l64_guard_t guard = l64_guard(ins, k, block_end);
                l64_guarded = guard.safe && guard.n;
                l64_emit_guard(o, &guard, va, count);
                fprintf(o, "if(budget+%uu>2000000u){pc=0x%08xu;count=%uu;action=1;goto boundary;}"
                           "clock+=%uu;budget+=%uu;\n", count, va, count, count, count);
            }
            uint32_t writes = 0;
            if (aa->kind == XK_REG && in->op != XO_CMP && in->op != XO_TEST && in->op != XO_PUSH &&
                in->op != XO_CALL_IND && in->op != XO_JMP_IND) writes |= 1u << (aa->reg >= 16 ? aa->reg - 16 : aa->reg);
            if (in->op == XO_CWDE) writes |= 1u << EAX;
            if (in->op == XO_CDQ) writes |= 1u << EDX;
            if (in->op == XO_XCHG && bb->kind == XK_REG) writes |= 1u << (bb->reg >= 16 ? bb->reg - 16 : bb->reg);
            if (in->op == XO_PUSH || in->op == XO_POP || in->op == XO_CALL || in->op == XO_CALL_IND ||
                in->op == XO_RET || in->op == XO_LEAVE) writes |= 1u << ESP;
            if (in->op == XO_LEAVE) writes |= 1u << EBP;
            if (writes) fprintf(o, "dirty|=0x%xu;", writes);
            l64_remaining = block_end - k - 1;
            uint32_t mask = live[k] & L64_FLAGS;
            /* Read-modify-write faults expose the computed flags before the store fails. */
            if (aa->kind == XK_MEM && !l64_guarded) mask = L64_FLAGS;
            switch (in->op) {
            case XO_MOV: case XO_MOVZX: case XO_MOVSX:
                l64_read(o, bb, "t", next);
                if (in->op == XO_MOVSX) fprintf(o, "t=x64_sext(t,%u);", bb->size);
                l64_write(o, aa, "t", next); break;
            case XO_LEA: {
                char ea[300]; l64_ea(ea, sizeof ea, bb, 0); l64_write(o, aa, ea, next); break;
            }
            case XO_ADD: case XO_OR: case XO_ADC: case XO_SBB: case XO_AND: case XO_SUB: case XO_XOR:
            case XO_CMP: case XO_TEST: case XO_INC: case XO_DEC: case XO_NEG:
                if (in->op == XO_NEG) { fprintf(o, "t=0;"); l64_read(o, aa, "u", next); }
                else {
                    l64_read(o, aa, "t", next);
                    if (in->op == XO_INC || in->op == XO_DEC) fprintf(o, "u=1;");
                    else l64_read(o, bb, "u", next);
                }
                if (in->op == XO_INC || in->op == XO_DEC) mask &= ~F_CF;
                if (mask != (in->op == XO_INC || in->op == XO_DEC ? L64_FLAGS & ~F_CF : L64_FLAGS))
                    st->flags_elided++;
                int alu_op = in->op == XO_INC ? XO_ADD :
                    in->op == XO_DEC || in->op == XO_NEG ? XO_SUB : in->op;
                if (mask == L64_FLAGS) fprintf(o, "t=xl_alu_full(%u,t,u,%d,&flags);", alu_op, n);
                else fprintf(o, "t=xl_alu(%u,t,u,%d,&flags,0x%xu);", alu_op, n, mask);
                if (in->op != XO_CMP && in->op != XO_TEST) l64_write(o, aa, "t", next);
                break;
            case XO_NOT: l64_read(o, aa, "t", next); l64_write(o, aa, "~t", next); break;
            case XO_ROL: case XO_ROR: case XO_RCL: case XO_RCR: case XO_SHL: case XO_SHR: case XO_SAL: case XO_SAR:
                l64_read(o, aa, "t", next); l64_read(o, bb, "u", next);
                fprintf(o, "X.flags=flags;t=x64_shift(%u,t,(uint32_t)u,%d);flags=X.flags;", in->op, n);
                l64_write(o, aa, "t", next); break;
            case XO_BSWAP:
                l64_read(o, aa, "t", next);
                fprintf(o, "t=__builtin_bswap%u((uint%u_t)t);", n * 8, n * 8);
                l64_write(o, aa, "t", next); break;
            case XO_CWDE:
                fprintf(o, "t=x64_sext(r[0],%u);", in->osz / 2);
                { x86_opnd_t dest = {.kind = XK_REG, .size = in->osz, .reg = EAX};
                  l64_write(o, &dest, "t", next); } break;
            case XO_CDQ:
                fprintf(o, "t=(r[0]&(1ull<<%u))?x64_mask(%u):0;", in->osz * 8 - 1, in->osz);
                { x86_opnd_t dest = {.kind = XK_REG, .size = in->osz, .reg = EDX};
                  l64_write(o, &dest, "t", next); } break;
            case XO_XCHG:
                l64_read(o, aa, "t", next); l64_read(o, bb, "u", next);
                l64_write(o, aa, "u", next); l64_write(o, bb, "t", next); break;
            case XO_LEAVE:
                fprintf(o, "r[4]=r[5];"); l64_pointer(o, "r[4]", 8, next, 0, "0");
                fprintf(o, "r[5]=xl_load(p,8);r[4]+=8;"); break;
            case XO_IMUL:
                l64_read(o, in->nops == 3 ? bb : aa, "t", next);
                l64_read(o, in->nops == 3 ? &in->o[2] : bb, "u", next);
                fprintf(o, "t=xl_imul(t,u,%d,&flags);", n);
                l64_write(o, aa, "t", next); break;
            case XO_PUSH:
                l64_read(o, aa, "t", next); fprintf(o, "r[4]-=%d;", n == 2 ? 2 : 8);
                l64_pointer(o, "r[4]", n == 2 ? 2 : 8, next, 1, "t");
                fprintf(o, "xl_store(p,t,%d);", n == 2 ? 2 : 8); break;
            case XO_POP:
                l64_pointer(o, "r[4]", n == 2 ? 2 : 8, next, 0, "0");
                fprintf(o, "t=xl_load(p,%d);r[4]+=%d;", n == 2 ? 2 : 8, n == 2 ? 2 : 8);
                l64_write(o, aa, "t", next); break;
            case XO_CMOVCC:
                l64_read(o, bb, "t", next); fprintf(o, "if(xl_cond(%u,flags)){", in->cc);
                l64_write(o, aa, "t", next); fprintf(o, "}"); break;
            case XO_SETCC:
                fprintf(o, "t=xl_cond(%u,flags);", in->cc); l64_write(o, aa, "t", next); break;
            case XO_SIMD: l64_simd(o, in, next); break;
            case XO_JCC:
                fprintf(o, "if(xl_cond(%u,flags)){", in->cc); l64_edge(o, f, in->target); fprintf(o, "}"); break;
            case XO_JMP: l64_edge(o, f, in->target); continue;
            case XO_JMP_IND:
                l64_read(o, aa, "t", next);
                fprintf(o, "if(t>UINT32_MAX){pc=0x%08xu;action=4;goto boundary;}"
                           "pc=(uint32_t)t;goto dispatch;\n", next); continue;
            case XO_CALL: case XO_CALL_IND:
                if (in->op == XO_CALL) { fprintf(o, "t=0x%08xu;", in->target); st->calls_direct++; }
                else { l64_read(o, aa, "t", next); st->calls_indirect++; }
                fprintf(o, "r[4]-=8;");
                { char ret[40]; snprintf(ret, sizeof ret, "0x%08xull", next);
                  l64_pointer(o, "r[4]", 8, next, 1, ret); fprintf(o, "xl_store(p,%s,8);", ret); }
                fprintf(o, "pc=0x%08xu;action=2;goto boundary;\n", next); continue;
            case XO_RET:
                l64_pointer(o, "r[4]", 8, next, 0, "0"); fprintf(o, "t=xl_load(p,8);r[4]+=8;");
                /* Pop is visible even when the returned full-width pointer is invalid. */
                fprintf(o, "pc=0x%08xu;value=0x%llxull;action=3;goto boundary;\n",
                        next, (unsigned long long)aa->imm);
                continue;
            default: break;
            }
            fprintf(o, "\n");
            if (starts[k + 1]) l64_edge(o, f, next);
        }
        fprintf(o, "landing:\n");
        fprintf(o, "{static const uint32_t entries[]={");
        for (uint32_t k = 0; k < f->insns.n; k++) fprintf(o, "0x%08xu,", f->insns.v[k]);
        fprintf(o, "};if(!xl_contains(entries,%uu,pc))goto exit;}bgt_coverage_entry(pc,1);count=1;action=1;\n", f->insns.n);
        fprintf(o, "boundary:\n"); l64_dirty_boundary = 1; l64_sync(o, 0); l64_dirty_boundary = 0;
        fprintf(o, "X.eip=pc;if(action==0)x86_lift_pending=pending;"
                   "else if(action==1)x86_lift_count=count;"
                   "else{X.eip=x86_address(t);if(action==3)X.r[4]+=value;}return;\n");
        fprintf(o, "memory_fault: __attribute__((unused));\n"
                   "pc=(uint32_t)(fault>>32);width=fault&31;writing=(fault>>5)&3;"
                   "clock-=(fault>>8)&0xffffffu;budget-=(fault>>8)&0xffffffu;\n"); l64_sync(o, 0);
        fprintf(o, "X.eip=pc;{uint32_t a=x86_address(address);"
                   "if(writing==2){for(int j=0;j<width;j++)x86_wr8(a+(uint32_t)j,av.u8[j]);}"
                   "else if(writing==3){for(int j=0;j<width;j++)(void)x86_rd8(a+(uint32_t)j);}"
                   "else if(writing)x64_store(a,value,width);else (void)x64_load(a,width);}"
                   "x86_fault(\"unmapped flat guest memory\",(uint32_t)address);\n");
        fprintf(o, "exit:\n"); l64_sync(o, 0); fprintf(o, "X.eip=pc;return;\n}\n");
        free(guarded); free(starts); free(live); free(ins);
        }
        fprintf(o, "void F_%08x(void){\n", original->addr);
        fprintf(o, "static void (*const regions[])(uint32_t)={");
        for (uint32_t begin = 0; begin < original->insns.n; begin += 256)
            fprintf(o, "R_%08x_%08x,", original->addr, original->insns.v[begin]);
        fprintf(o, "};unsigned region=0;\n");
        for (uint32_t begin = 256; begin < original->insns.n; begin += 256)
            fprintf(o, "if(X.eip>=0x%08xu)region=%uu;\n", original->insns.v[begin], begin / 256);
        fprintf(o, "regions[region](X.eip);\n");
        fprintf(o, "}\n"); vpush(&order, original->addr); vpush(&ends, original->end);
        for (uint32_t j = 0; j < original->nij; j++) if (!original->ij[j].resolved) st->unresolved++;
    }
    l64_entry_t *entries = xcalloc(order.n, sizeof *entries);
    for (uint32_t i = 0; i < order.n; i++) entries[i] = (l64_entry_t){order.v[i], ends.v[i]};
    qsort(entries, order.n, sizeof *entries, l64_entry_cmp);
    fprintf(o, "const x86_lifted_entry_t x86_lifted_%s[]={\n", name);
    for (uint32_t i = 0; i < order.n; i++) {
        fprintf(o, "{0x%08xu,F_%08x,0x%08xu},\n", entries[i].addr, entries[i].addr, entries[i].end);
    }
    free(entries);
    fprintf(o, "};\nconst uint32_t x86_lifted_%s_count=%u;\n", name, order.n); free(order.v); free(ends.v);
}
