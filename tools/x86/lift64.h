/* AMD64 labelled C with scalar register locals and explicit synchronization boundaries. MIT. */
#include "../../platforms/x86/x86_arch.h"
#define L64_FLAGS (F_CF | F_PF | F_AF | F_ZF | F_SF | F_OF)
static uint32_t l64_used, l64_written;
static int lift_inline_memory, lift_inline_alu, lift_affine_counting, lift_optimize_small;
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
/* Cold flag deoptimization recipes use recoverable register results, never a hot operand log.
 * An overwrite/load that destroys a dependency invalidates the recipe and retains precise liveness. */
typedef struct { int op, reg, n; uint64_t imm; uint32_t mask, position; } l64_replay_t;
static l64_replay_t l64_replay;
static uint32_t l64_fault_writes;
static uint32_t l64_position;
/* Affine instruction debt: sequential instructions need no runtime counter update. */
static void l64_flush(FILE *o, uint32_t position) {
    if (!lift_affine_counting) return;
    fprintf(o, "clock+=(uint32_t)(debt+%uu);budget+=(uint32_t)(debt+%uu);debt=-%d;",
            position, position, (int)position);
}
static int l64_guarded;
static void l64_replay_flags(FILE *o) {
    l64_replay_t p = l64_replay;
    if (!p.mask) return;
    fprintf(o, "if(entry_index<=%uu){uint64_t z=(uint%u_t)r[%d];", p.position, p.n * 8, p.reg);
    if (p.op == XO_ADD) fprintf(o, "(void)xl_alu(%d,z-0x%llxull,0x%llxull,%d,&flags,0x%xu);",
        XO_ADD, (unsigned long long)p.imm, (unsigned long long)p.imm, p.n, p.mask);
    else if (p.op == XO_SUB) fprintf(o, "(void)xl_alu(%d,z+0x%llxull,0x%llxull,%d,&flags,0x%xu);",
        XO_SUB, (unsigned long long)p.imm, (unsigned long long)p.imm, p.n, p.mask);
    else fprintf(o, "(void)xl_alu(%d,z,0x%llxull,%d,&flags,0x%xu);",
        p.op, (unsigned long long)p.imm, p.n, p.mask);
    fprintf(o, "}");
}
static void l64_pointer(FILE *o, const char *ea, int n, uint32_t next, int writing, const char *value) {
    /* The reference's implicit stack primitives use low-32-bit addresses; explicit [RSP]
     * operands still validate full-width effective addresses through l64_ea. */
    if (!strcmp(ea, "r[4]")) ea = "(uint32_t)r[4]";
    if (l64_guarded) { fprintf(o, "p=x86_flat+(uint32_t)%s;\n", ea); return; }
    /* Fault-replay discriminators are not access bits: 0=scalar read, 1=scalar store,
     * 2=vector store, 3=vector read. A vector read must never demand WRITE permission. */
    unsigned access = writing == 1 || writing == 2 ? 2 : 1;
    uint64_t meta = ((uint64_t)next << 32) | ((uint64_t)l64_position << 8) | (writing << 5) | n;
    fprintf(o, "address=%s;p=%s(address,%d,%u);if(!p){", ea,
            lift_inline_memory ? "xl_pointer_access" : "xl_pointer_checked", n, access);
    if (writing == 0 || writing == 3 || !l64_fault_writes) l64_replay_flags(o);
    fprintf(o, "fault=0x%llxull;value=%s;goto memory_fault;}\n", (unsigned long long)meta, value);
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
        if (in->simd_op == 0x2e || in->simd_op == 0x2f) *write = L64_FLAGS;
        return;
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
static l64_replay_t *l64_replays(func_t *f, x86_insn_t *ins, const uint8_t *starts) {
    l64_replay_t *out = calloc(f->insns.n, sizeof *out), p = {0};
    for (uint32_t k = 0; k < f->insns.n; k++) {
        x86_insn_t *in = &ins[k]; const x86_opnd_t *a = &in->o[0], *b = &in->o[1];
        if (starts[k]) p.mask = 0;
        if (!lift_inline_alu) p.mask = 0;
        out[k] = p;
        if (in->op == XO_XCHG && a->kind == XK_REG &&
            (a->reg == p.reg || (a->reg >= 16 && a->reg - 16 == p.reg))) out[k].mask = 0;
        if (p.reg == ESP && (in->op == XO_PUSH || in->op == XO_POP || in->op == XO_CALL ||
            in->op == XO_CALL_IND || in->op == XO_RET || in->op == XO_LEAVE)) out[k].mask = 0;
        uint32_t r, w; l64_flag_io(in, &r, &w);
        if (a->kind == XK_REG && (a->reg == p.reg || (a->reg >= 16 && a->reg - 16 == p.reg)) &&
            in->op != XO_CMP && in->op != XO_TEST && in->op != XO_PUSH) p.mask = 0;
        if (in->op == XO_SIMD && in->simd_op == 0x7e && in->simd_prefix != 0xf3 &&
            b->kind == XK_REG && (b->reg == p.reg || (b->reg >= 16 && b->reg - 16 == p.reg))) p.mask = 0;
        if (in->op == XO_XCHG || in->op == XO_CDQ || in->op == XO_CWDE ||
            in->op == XO_LEAVE || in->op == XO_POP) p.mask = 0;
        if (!w) { if (r == L64_FLAGS) p.mask = 0; continue; }
        p.mask = 0;
        if (a->kind != XK_REG || a->reg >= 16) continue;
        int op = in->op;
        if ((op == XO_ADD || op == XO_SUB || op == XO_CMP || op == XO_TEST) && b->kind == XK_IMM) {
            p = (l64_replay_t){op, a->reg, a->size, b->imm, L64_FLAGS, k};
        } else if (op == XO_INC || op == XO_DEC)
            p = (l64_replay_t){op == XO_INC ? XO_ADD : XO_SUB, a->reg, a->size, 1, L64_FLAGS & ~F_CF, k};
    }
    return out;
}
static uint32_t *l64_liveness(func_t *f, x86_insn_t *ins, const uint8_t *guarded, const uint8_t *starts,
        const l64_replay_t *replays) {
    uint32_t n = f->insns.n, *live = calloc(n, sizeof *live), *out = calloc(n, sizeof *out);
    int changed;
    do {
        changed = 0;
        for (uint32_t j = n; j-- > 0;) {
            x86_insn_t *in = &ins[j]; uint32_t r, w, v = 0;
            l64_flag_io(in, &r, &w);
            /* A memory exception observes the incoming flags, even when a later writer kills them. */
            if (!guarded[j]) {
                for (int k = 0; k < in->nops; k++) if (in->o[k].kind == XK_MEM) r |= L64_FLAGS & ~replays[j].mask;
                if (in->op == XO_PUSH || in->op == XO_POP || in->op == XO_LEAVE || in->op == XO_RET ||
                    in->op == XO_CALL || in->op == XO_CALL_IND) r |= L64_FLAGS & ~replays[j].mask;
            }
            /* A failed whole-block guard/quantum check resumes before its first instruction. */
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
static void l64_edge(FILE *o, func_t *f, uint32_t target, uint32_t from) {
    int t = l64_index(f, target);
    if (t >= 0) {
        if (!lift_affine_counting) { fprintf(o, "goto L_%08x;\n", target); return; }
        if ((uint32_t)t <= from) {
            l64_flush(o, from + 1);
            fprintf(o, "goto L_%08x;\n", target);
        } else {
            if ((uint32_t)t != from + 1) fprintf(o, "debt+=%d;", (int)(from + 1) - t);
            fprintf(o, "goto B_%08x;\n", target);
        }
    } else {
        l64_flush(o, from + 1);
        fprintf(o, "pc=0x%08xu;goto exit;\n", target);
    }
}
/* Bit-preserving moves/shuffles: no FP conversion, host SIMD, or alias-sensitive lane writes. */
static int l64_simd_bits(const x86_insn_t *in) {
    unsigned op = in->simd_op, pre = in->simd_prefix;
    return op == 0x12 || op == 0x13 || op == 0x14 || op == 0x15 || op == 0x16 || op == 0x17 ||
        op == 0x6e || op == 0x7e || op == 0xc6 || op == 0x70 || (op == 0xd6 && pre == 0x66) ||
        (pre == 0x66 && ((op >= 0x60 && op <= 0x62) || (op >= 0x68 && op <= 0x6a) || op == 0x6c || op == 0x6d));
}
static void l64_simd_bit_emit(FILE *o, const x86_insn_t *in, uint32_t next) {
    const x86_opnd_t *a = &in->o[0], *b = &in->o[1];
    unsigned op = in->simd_op, pre = in->simd_prefix, imm = in->simd_imm;
    if (op == 0x6e) {
        l64_read(o, b, "t", next);
        fprintf(o, "X.xmm[%u]=(x86_vec_t){0};X.xmm[%u].u64[0]=t;", a->reg, a->reg); return;
    }
    if (op == 0x7e && pre != 0xf3) {
        fprintf(o, "t=X.xmm[%u].u64[0];", a->reg); l64_write(o, b, "t", next); return;
    }
    fprintf(o, "av=X.xmm[%u];", a->reg);
    if (op == 0x13 || op == 0x17 || op == 0xd6) {
        if (op == 0x17) fprintf(o, "av.u64[0]=av.u64[1];");
        fprintf(o, "av.u64[1]=0;");
        if (b->kind == XK_XMM) fprintf(o, "X.xmm[%u]=av;", b->reg);
        else {
            char ea[300]; l64_ea(ea, sizeof ea, b, 1);
            l64_pointer(o, ea, 8, next, 2, "0"); fprintf(o, "__builtin_memcpy(p,&av,8);");
        }
        return;
    }
    if (b->kind == XK_XMM) fprintf(o, "bv=X.xmm[%u];", b->reg);
    else {
        char ea[300]; l64_ea(ea, sizeof ea, b, 1);
        if (x86_simd_aligned_legacy(op, pre)) {
            uint64_t meta = ((uint64_t)next << 32) | ((uint64_t)l64_position << 8) | (5 << 5) | b->size;
            fprintf(o, "address=%s;if(address&15){", ea); l64_replay_flags(o);
            fprintf(o, "fault=0x%llxull;goto memory_fault;}", (unsigned long long)meta);
        }
        l64_pointer(o, ea, b->size, next, 3, "0");
        fprintf(o, "bv=(x86_vec_t){0};__builtin_memcpy(&bv,p,%u);", b->size);
    }
    if (op == 0x7e) fprintf(o, "av=(x86_vec_t){0};av.u64[0]=bv.u64[0];");
    else if (op == 0x12 && pre == 0xf2) fprintf(o, "av.u64[0]=av.u64[1]=bv.u64[0];");
    else if ((op == 0x12 || op == 0x16) && pre == 0xf3) {
        for (int i = 0; i < 4; i++) fprintf(o, "av.u32[%d]=bv.u32[%d];", i, (i & 2) + (op == 0x16));
    } else if (op == 0x12 || op == 0x16)
        fprintf(o, "av.u64[%u]=bv.u64[%u];", op == 0x16, b->kind == XK_XMM && op == 0x12);
    else if (op == 0xc6) {
        /* av is both source and result; take a snapshot before any lane assignment. */
        fprintf(o, "{x86_vec_t src=av;");
        if (pre == 0x66) fprintf(o, "av.u64[0]=src.u64[%u];av.u64[1]=bv.u64[%u];", imm & 1, (imm >> 1) & 1);
        else fprintf(o, "av.u32[0]=src.u32[%u];av.u32[1]=src.u32[%u];av.u32[2]=bv.u32[%u];av.u32[3]=bv.u32[%u];",
            imm & 3, (imm >> 2) & 3, (imm >> 4) & 3, (imm >> 6) & 3);
        fprintf(o, "}");
    } else if (op == 0x70) {
        fprintf(o, "av=bv;");
        int base = pre == 0xf3 ? 4 : 0;
        for (int i = 0; i < 4; i++) {
            if (pre == 0x66) fprintf(o, "av.u32[%d]=bv.u32[%u];", i, (imm >> (2 * i)) & 3);
            else fprintf(o, "av.u16[%d]=bv.u16[%u];", base + i, base + ((imm >> (2 * i)) & 3));
        }
    } else {
        int width = op <= 0x15 ? (pre == 0x66 ? 8 : 4) : op == 0x6c || op == 0x6d ? 8 : 1 << ((op & 7) % 3);
        int high = op == 0x15 || (op >= 0x68 && op <= 0x6a) || op == 0x6d;
        fprintf(o, "{x86_vec_t src=av;");
        for (int i = 0; i < 8 / width; i++) fprintf(o, "av.u%u[%d]=src.u%u[%d];av.u%u[%d]=bv.u%u[%d];",
            width * 8, 2 * i, width * 8, high * (8 / width) + i,
            width * 8, 2 * i + 1, width * 8, high * (8 / width) + i);
        fprintf(o, "}");
    }
    fprintf(o, "X.xmm[%u]=av;", a->reg);
}
static int l64_atomic(const x86_insn_t *in) {
    return in->op == XO_XADD || in->op == XO_CMPXCHG || in->op == XO_CMPXCHG_PAIR ||
        (in->o[0].kind == XK_MEM && (in->op == XO_XCHG || (in->lock &&
         (in->op <= XO_XOR || in->op == XO_INC || in->op == XO_DEC || in->op == XO_NEG || in->op == XO_NOT ||
          in->op == XO_BTS || in->op == XO_BTR || in->op == XO_BTC))));
}
static void l64_atomic_emit(FILE *o, const x86_insn_t *in, uint32_t next) {
    const x86_opnd_t *a = &in->o[0], *b = &in->o[1]; int n = a->size, op = in->op;
    int bitop = op == XO_BTS || op == XO_BTR || op == XO_BTC;
    if (a->kind == XK_MEM) {
        char ea[300]; l64_ea(ea, sizeof ea, a, 1);
        if (bitop) l64_read(o, b, "u", next);
        fprintf(o, "address=%s;", ea);
        if (bitop && b->kind == XK_REG) fprintf(o, "address=xa_bit_address(address,u,%d,%d,%s);", n, !!(a->pad & 1), a->seg_fs ? (a->seg_fs == 2 ? "X.gs_base" : "X.fs_base") : "0");
        uint64_t meta = ((uint64_t)next << 32) | ((uint64_t)l64_position << 8) | (4 << 5) | n;
        fprintf(o, "p=%s(address,%u,3);if(!p%s){",
            lift_inline_memory ? "xl_pointer_access" : "xl_pointer_checked", n, n == 16 ? "||(address&15)" : "");
        l64_replay_flags(o);
        fprintf(o, "fault=0x%llxull;goto memory_fault;}xa_fence();", (unsigned long long)meta);
        if (n == 16) fprintf(o, "t=xl_load(p,8);u=xl_load(p+8,8);");
        else fprintf(o, "t=xl_load(p,%u);", n);
    } else l64_read(o, a, "t", next);
    if (op == XO_CMPXCHG_PAIR) {
        if (n == 16) fprintf(o, "if(t==r[0]&&u==r[2]){xl_store(p,r[3],8);xl_store(p+8,r[1],8);flags|=F_ZF;}"
            "else{xl_store(p,t,8);xl_store(p+8,u,8);r[0]=t;r[2]=u;flags&=~F_ZF;}");
        else fprintf(o, "if(t==(((uint64_t)(uint32_t)r[2]<<32)|(uint32_t)r[0])){"
            "xl_store(p,((uint64_t)(uint32_t)r[1]<<32)|(uint32_t)r[3],8);flags|=F_ZF;}"
            "else{xl_store(p,t,8);r[0]=(uint32_t)t;r[2]=(uint32_t)(t>>32);flags&=~F_ZF;}");
    } else {
        if (in->nops > 1) l64_read(o, b, "u", next);
        if (bitop) fprintf(o, "{uint64_t bit=1ull<<(u&%u);flags=(flags&~F_CF)|((t&bit)?F_CF:0);v=%s;}",
            n * 8 - 1, op == XO_BTS ? "t|bit" : op == XO_BTR ? "t&~bit" : "t^bit");
        else if (op == XO_CMPXCHG) {
            fprintf(o, "(void)xl_alu(%u,r[0],t,%d,&flags,0x%xu);if(flags&F_ZF)v=u;else{v=t;", XO_CMP, n, L64_FLAGS);
            x86_opnd_t acc = {.kind = XK_REG, .reg = EAX, .size = (uint8_t)n};
            l64_write(o, &acc, "t", next); fprintf(o, "}");
        } else if (op == XO_XADD) {
            fprintf(o, "v=xl_alu(%u,t,u,%d,&flags,0x%xu);", XO_ADD, n, L64_FLAGS); l64_write(o, b, "t", next);
        } else if (op == XO_XCHG) fprintf(o, "v=u;");
        else if (op == XO_NOT) fprintf(o, "v=~t;");
        else if (op == XO_NEG) fprintf(o, "v=xl_alu(%u,0,t,%d,&flags,0x%xu);", XO_SUB, n, L64_FLAGS);
        else if (op == XO_INC || op == XO_DEC) fprintf(o, "v=xl_alu(%u,t,1,%d,&flags,0x%xu);",
            op == XO_INC ? XO_ADD : XO_SUB, n, L64_FLAGS & ~F_CF);
        else fprintf(o, "v=xl_alu(%u,t,u,%d,&flags,0x%xu);", op, n, L64_FLAGS);
        if (a->kind == XK_MEM) fprintf(o, "xl_store(p,v,%d);", n); else l64_write(o, a, "v", next);
        if (op == XO_XCHG) l64_write(o, b, "t", next);
    }
    if (a->kind == XK_MEM) fprintf(o, "xa_fence();");
}

static int l64_simd_supported(const x86_insn_t *in) {
    unsigned op = in->simd_op;
    return l64_simd_bits(in) || op == 0x10 || op == 0x11 || op == 0x28 || op == 0x29 || op == 0x6f || op == 0x7f ||
        op == 0x54 || op == 0x55 || op == 0x56 || op == 0x57 || op == 0xdb || op == 0xdf ||
        op == 0xeb || op == 0xef || op == 0x58 || op == 0x59 || op == 0x5c || op == 0x5d ||
        op == 0x5e || op == 0x5f || op == 0x2e || op == 0x2f || op == 0x51 || op == 0xc2 ||
        ((op == 0x2a || op == 0x2c || op == 0x2d || op == 0x5a) &&
         (in->simd_prefix == 0xf2 || in->simd_prefix == 0xf3));
}
static void l64_simd(FILE *o, const x86_insn_t *in, uint32_t next) {
    const x86_opnd_t *a = &in->o[0], *b = &in->o[1];
    unsigned op = in->simd_op, pre = in->simd_prefix;
    int scalar = pre == 0xf2 || pre == 0xf3, dbl = pre == 0xf2 || pre == 0x66, bytes = dbl ? 8 : 4;
    if (l64_simd_bits(in)) { l64_simd_bit_emit(o, in, next); return; }
    if (op == 0x2a) {
        l64_read(o, b, "t", next);
        fprintf(o, "X.xmm[%u].%s[0]=(%s)xs_from_int((int64_t)x64_sext(t,%u),%d,X.mxcsr);",
            a->reg, dbl ? "u64" : "u32", dbl ? "uint64_t" : "uint32_t", b->size, dbl);
        return;
    }
    if (op == 0x2c || op == 0x2d) {
        if (b->kind == XK_XMM) fprintf(o, "bv=X.xmm[%u];", b->reg);
        else {
            char ea[300]; l64_ea(ea, sizeof ea, b, 1);
            l64_pointer(o, ea, bytes, next, 3, "0");
            fprintf(o, "bv=(x86_vec_t){0};__builtin_memcpy(&bv,p,%d);", bytes);
        }
        fprintf(o, "t=(uint64_t)xs_to_int(bv.%s[0],%d,%d,X.mxcsr);", dbl ? "f64" : "f32", a->size * 8, op == 0x2c);
        l64_write(o, a, "t", next); return;
    }
    int store = op == 0x11 || op == 0x29 || op == 0x7f;
    int count = (op == 0x2e || op == 0x2f || (scalar && (op == 0x10 || op == 0x11 || op == 0xc2 || (op >= 0x51 && op <= 0x5f)))) ? bytes : 16;
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
    if (op == 0x2e || op == 0x2f) {
        fprintf(o, "{double x=av.%s[0],y=bv.%s[0];flags&=~0x%xu;"
            "if(x!=x||y!=y)flags|=F_ZF|F_PF|F_CF;else if(x==y)flags|=F_ZF;else if(x<y)flags|=F_CF;}",
            dbl ? "f64" : "f32", dbl ? "f64" : "f32", L64_FLAGS);
        return;
    }
    if (op == 0x5a) {
        if (dbl) fprintf(o, "av.u32[0]=xs_double_to_float(bv.u64[0],X.mxcsr);");
        else fprintf(o, "av.f64[0]=(double)bv.f32[0];");
    } else if (op == 0x10 || op == 0x28 || op == 0x6f) {
        if (op == 0x10 && scalar) {
            if (b->kind == XK_MEM) fprintf(o, "av=(x86_vec_t){0};");
            fprintf(o, "__builtin_memcpy(&av,&bv,%d);", bytes);
        } else fprintf(o, "av=bv;");
    } else if (op == 0xc2) {
        const char *field = dbl ? "f64" : "f32";
        const char *exprs[] = {"x==y", "x<y", "x<=y", "x!=x||y!=y", "x!=y", "!(x<y)", "!(x<=y)", "x==x&&y==y"};
        for (int i = 0; i < (scalar ? 1 : 16 / bytes); i++)
            fprintf(o, "{double x=av.%s[%d],y=bv.%s[%d];av.%s[%d]=(%s)?%s:0;}",
                field, i, field, i, dbl ? "u64" : "u32", i, exprs[in->simd_imm & 7], dbl ? "UINT64_MAX" : "UINT32_MAX");
    } else if (op == 0x51) {
        for (int i = 0; i < (scalar ? 1 : 16 / bytes); i++)
            fprintf(o, "av.%s[%d]=(%s)__builtin_sqrt(bv.%s[%d]);",
                dbl ? "f64" : "f32", i, dbl ? "double" : "float", dbl ? "f64" : "f32", i);
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
    if (l64_atomic(in)) return 1;
    switch (in->op) {
    case XO_MOV: case XO_MOVZX: case XO_MOVSX: case XO_LEA:
    case XO_ADD: case XO_OR: case XO_ADC: case XO_SBB: case XO_AND: case XO_SUB: case XO_XOR:
    case XO_CMP: case XO_TEST: case XO_INC: case XO_DEC: case XO_NEG: case XO_NOT: case XO_IMUL:
    case XO_PUSH: case XO_POP: case XO_CMOVCC: case XO_SETCC: case XO_NOP:
    case XO_ROL: case XO_ROR: case XO_RCL: case XO_RCR: case XO_SHL: case XO_SHR: case XO_SAL: case XO_SAR:
    case XO_BSWAP: case XO_CWDE: case XO_CDQ: case XO_XCHG: case XO_LEAVE:
    case XO_XADD: case XO_CMPXCHG: case XO_CMPXCHG_PAIR:
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
    fprintf(o, "/* GENERATED AMD64 register-local code. */\n#include \"x86_lift64.h\"\n");
    vec_t order = {0}, ends = {0};
    /* Bound optimizer CFG size independently of guest function size. Internal region entries still
     * cover every landing pad; edges across regions return to the registry without interpreting. */
    for (uint32_t i = 0; i < a->nf; i++) {
        func_t *original = &a->f[i]; if (!lift_selected(original->addr)) continue;
        if (vhas(&skip,original->addr)) {
            fprintf(o,"extern void F_%08x(void); /* measured override, no native body */\n",original->addr);
            vpush(&order,original->addr);vpush(&ends,original->addr+1);continue;
        }
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
            if (in->op == XO_CMPXCHG || in->op == XO_CMPXCHG_PAIR) {
                l64_used |= 1u << EAX; l64_written |= 1u << EAX;
                if (in->op == XO_CMPXCHG_PAIR) { l64_used |= (1u << EBX) | (1u << ECX) | (1u << EDX); l64_written |= 1u << EDX; }
            }
            if ((in->op == XO_XCHG || in->op == XO_XADD ||
                 (in->op == XO_SIMD && in->simd_op == 0x7e && in->simd_prefix != 0xf3)) && in->o[1].kind == XK_REG)
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
        l64_replay_t *replays = l64_replays(f, ins, starts);
        uint32_t *live = l64_liveness(f, ins, guarded, starts, replays);
        l64_used |= l64_written;
        /* A distinct signature keeps Asyncify's conservative void(void) scheduler-call target
         * set from including native regions, which cannot suspend. Registry wrappers stay tiny. */
        /* Small regions benefit from ordinary -O2 and wrapper devirtualization/inlining.
         * Keep large regions size-biased until a coverage hot list can justify their expansion. */
        fprintf(o, "\nstatic %svoid R_%08x_%08x(uint32_t pc){\n",
                lift_optimize_small && f->insns.n <= 4 ? "" : "__attribute__((minsize,noinline)) ", original->addr, f->addr);
        fprintf(o, "uint64_t r[16],clock,t=0,u=0,v=0,address=0,value=0,fault=0;"
                   "uint32_t flags,budget,count=0,dirty=0,exit_reason=XE_OTHER,entry_index=0;int32_t debt=0;int action=0,width=0,writing=0;"
                   "const x86_insn_t *pending=0;uint8_t *p;"
                   "x86_vec_t av,bv;(void)t;(void)u;(void)v;(void)p;(void)av;(void)bv;(void)dirty;(void)debt;(void)entry_index;\n");
        l64_sync(o, 1);
        /* Record only entries actually handled by this region. An indirect jump
         * may dispatch out to an import thunk or another owner; its real handler
         * supplies coverage, not this region's unsuccessful lookup. */
        fprintf(o, "goto dispatch;\ndispatch:switch(pc){\n");
        for (uint32_t k = 0; k < f->insns.n; k++) if (starts[k])
            fprintf(o, "case 0x%08xu:exit_reason=XE_OTHER;x86_coverage_lifted(pc,1);goto L_%08x;\n", f->insns.v[k], f->insns.v[k]);
        fprintf(o, "default:goto landing;}\n");
        uint32_t block_end = 0;
        for (uint32_t k = 0; k < f->insns.n; k++) {
            x86_insn_t *in = &ins[k]; uint32_t va = f->insns.v[k], next = va + in->len;
            const x86_opnd_t *aa = &in->o[0], *bb = &in->o[1]; int n = aa->size ? aa->size : in->osz;
            if (starts[k] && lift_affine_counting) {
                /* L_ is an external entry/backedge; forward native edges bypass it through B_. */
                fprintf(o, "L_%08x:;entry_index=0;debt=-%d;if(budget+%uu>2000000u){pc=0x%08xu;count=1;action=1;x86_lift_reason=XE_QUANTUM;goto boundary;}\n"
                           "B_%08x: __attribute__((unused));\n", va, (int)k, f->insns.n, va, va);
            } else if (starts[k]) fprintf(o, "L_%08x:;entry_index=0;\n", va);
            if (!in->len) { l64_flush(o, k); fprintf(o, "pc=0x%08xu;goto exit;\n", va); continue; }
            if (!l64_specialized(in)) {
                st->generic++;
                l64_flush(o, k);
                fprintf(o, "{static const x86_insn_t I="); emit_insn_struct(o, in);
                fprintf(o, ";pending=&I;}pc=0x%08xu;action=0;goto boundary;\n", va); continue;
            }
            st->specialized++;
            if (starts[k]) {
                block_end = k + 1; while (block_end < f->insns.n && !starts[block_end]) block_end++;
                uint32_t count = block_end - k;
                l64_guard_t guard = l64_guard(ins, k, block_end);
                l64_guarded = guard.safe && guard.n;
                l64_emit_guard(o, &guard, va, count, k);
                if (!lift_affine_counting) fprintf(o,
                    "if(budget+%uu>2000000u){pc=0x%08xu;count=%uu;action=1;x86_lift_reason=XE_QUANTUM;goto boundary;}"
                    "clock+=%uu;budget+=%uu;\n", count, va, count, count, count);
            }
            if (!starts[k]) fprintf(o, "N_%08x: __attribute__((unused));\n", va);
            uint32_t writes = 0;
            if (aa->kind == XK_REG && in->op != XO_CMP && in->op != XO_TEST && in->op != XO_PUSH &&
                in->op != XO_CALL_IND && in->op != XO_JMP_IND) writes |= 1u << (aa->reg >= 16 ? aa->reg - 16 : aa->reg);
            if (in->op == XO_CWDE) writes |= 1u << EAX;
            if (in->op == XO_CDQ) writes |= 1u << EDX;
            if (in->op == XO_CMPXCHG || in->op == XO_CMPXCHG_PAIR) writes |= 1u << EAX;
            if (in->op == XO_CMPXCHG_PAIR) writes |= 1u << EDX;
            if ((in->op == XO_XCHG || in->op == XO_XADD ||
                 (in->op == XO_SIMD && in->simd_op == 0x7e && in->simd_prefix != 0xf3)) && bb->kind == XK_REG) writes |= 1u << (bb->reg >= 16 ? bb->reg - 16 : bb->reg);
            if (in->op == XO_PUSH || in->op == XO_POP || in->op == XO_CALL || in->op == XO_CALL_IND ||
                in->op == XO_RET || in->op == XO_LEAVE) writes |= 1u << ESP;
            if (in->op == XO_LEAVE) writes |= 1u << EBP;
            if (writes) fprintf(o, "dirty|=0x%xu;", writes);
            l64_replay = replays[k];
            { uint32_t reads; l64_flag_io(in, &reads, &l64_fault_writes); }
            l64_position = lift_affine_counting ? k + 1 : block_end - k - 1;
            uint32_t mask = live[k] & L64_FLAGS;
            /* Read-modify-write faults expose the computed flags before the store fails. */
            if (aa->kind == XK_MEM && !l64_guarded) mask = L64_FLAGS;
            if (l64_atomic(in)) { l64_atomic_emit(o, in, next); } else switch (in->op) {
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
                int faulting_inc = (in->op == XO_INC || in->op == XO_DEC) && aa->kind == XK_MEM && !l64_guarded;
                if (faulting_inc) fprintf(o, "v=flags&F_CF;");
                else if (in->op == XO_INC || in->op == XO_DEC) mask &= ~F_CF;
                if (mask != (in->op == XO_INC || in->op == XO_DEC ? L64_FLAGS & ~F_CF : L64_FLAGS))
                    st->flags_elided++;
                int alu_op = in->op == XO_INC ? XO_ADD :
                    in->op == XO_DEC || in->op == XO_NEG ? XO_SUB : in->op;
                if (!lift_inline_alu && mask == L64_FLAGS)
                    fprintf(o, "t=xl_alu_full(%u,t,u,%d,&flags);", alu_op, n);
                else fprintf(o, "t=xl_alu(%u,t,u,%d,&flags,0x%xu);", alu_op, n, mask);
                if (in->op != XO_CMP && in->op != XO_TEST) l64_write(o, aa, "t", next);
                if (faulting_inc) fprintf(o, "flags=(flags&~F_CF)|(uint32_t)v;");
                break;
            case XO_NOT: l64_read(o, aa, "t", next); l64_write(o, aa, "~t", next); break;
            case XO_ROL: case XO_ROR: case XO_RCL: case XO_RCR: case XO_SHL: case XO_SHR: case XO_SAL: case XO_SAR:
                l64_fault_writes = L64_FLAGS;
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
                fprintf(o, "if(xl_cond(%u,flags)){", in->cc); l64_edge(o, f, in->target, k); fprintf(o, "}"); break;
            case XO_JMP: l64_edge(o, f, in->target, k); continue;
            case XO_JMP_IND:
                l64_read(o, aa, "t", next);
                l64_flush(o, k + 1);
                fprintf(o, "if(t>UINT32_MAX){pc=0x%08xu;action=4;goto boundary;}"
                           "pc=(uint32_t)t;exit_reason=XE_INDIRECT;goto dispatch;\n", next); continue;
            case XO_CALL: case XO_CALL_IND:
                if (in->op == XO_CALL) { fprintf(o, "t=0x%08xu;", in->target); st->calls_direct++; }
                else { l64_read(o, aa, "t", next); st->calls_indirect++; }
                l64_flush(o, k + 1);
                fprintf(o, "r[4]-=8;");
                { char ret[40]; snprintf(ret, sizeof ret, "0x%08xull", next);
                  l64_pointer(o, "r[4]", 8, next, 1, ret); fprintf(o, "xl_store(p,%s,8);", ret); }
                fprintf(o, "pc=0x%08xu;action=2;goto boundary;\n", next); continue;
            case XO_RET:
                l64_flush(o, k + 1);
                l64_pointer(o, "r[4]", 8, next, 0, "0"); fprintf(o, "t=xl_load(p,8);r[4]+=8;");
                /* Pop is visible even when the returned full-width pointer is invalid. */
                fprintf(o, "pc=0x%08xu;value=0x%llxull;action=3;goto boundary;\n",
                        next, (unsigned long long)aa->imm);
                continue;
            default: break;
            }
            fprintf(o, "\n");
            if (starts[k + 1]) l64_edge(o, f, next, k);
        }
        fprintf(o, "landing:\n");
        fprintf(o, "switch(pc){\n");
        for (uint32_t k = 0; k < f->insns.n; k++) if (!starts[k] &&
                (f->insns.n <= 8 || ins[k].op == XO_SIMD || l64_atomic(&ins[k]))) {
            uint32_t end = k + 1; while (end < f->insns.n && !starts[end]) end++;
            uint32_t va = f->insns.v[k], count = end - k;
            fprintf(o, "case 0x%08xu:exit_reason=XE_OTHER;x86_coverage_lifted(pc,1);entry_index=%uu;", va, k);
            if (lift_affine_counting) fprintf(o, "debt=-%d;", (int)k);
            /* The interior suffix rechecks every guard before entering code that assumes it.
             * Counter updates mirror the ordinary block start, but count only the suffix. */
            l64_guard_t guard = l64_guard(ins, k, end);
            l64_emit_guard(o, &guard, va, count, k);
            if (lift_affine_counting) fprintf(o,
                "if(budget+%uu>2000000u){count=1;action=1;x86_lift_reason=XE_QUANTUM;goto boundary;}", f->insns.n);
            else fprintf(o, "if(budget+%uu>2000000u){count=%uu;action=1;x86_lift_reason=XE_QUANTUM;goto boundary;}"
                "clock+=%uu;budget+=%uu;", count, count, count, count);
            fprintf(o, "goto N_%08x;\n", va);
        }
        fprintf(o, "default:break;}\n");
        /* Broad suffix duplication was measured at +82% whole-module size on x64-cpp.
         * Keep native SSE/tiny entries; larger non-SSE landings retain bounded semantics. */
        fprintf(o, "{static const uint32_t entries[]={");
        for (uint32_t k = 0; k < f->insns.n; k++) fprintf(o, "0x%08xu,", f->insns.v[k]);
        fprintf(o, "};if(!xl_contains(entries,%uu,pc))goto exit;}exit_reason=XE_OTHER;x86_coverage_lifted(pc,1);count=1;action=1;x86_lift_reason=XE_INTERIOR;\n", f->insns.n);
        fprintf(o, "boundary:\n"); l64_dirty_boundary = 1; l64_sync(o, 0); l64_dirty_boundary = 0;
        fprintf(o, "X.eip=pc;if(action==0)x86_lift_pending=pending;"
                   "else if(action==1)x86_lift_count=count;"
                   "else{X.eip=x86_address(t);if(action==3)X.r[4]+=value;}return;\n");
        fprintf(o, "memory_fault: __attribute__((unused));\n"
                   "pc=(uint32_t)(fault>>32);width=fault&31;writing=(fault>>5)&7;");
        if (lift_affine_counting) fprintf(o, "clock+=(uint32_t)(debt+((fault>>8)&0xffffffu));"
                   "budget+=(uint32_t)(debt+((fault>>8)&0xffffffu));\n");
        else fprintf(o, "clock-=(fault>>8)&0xffffffu;budget-=(fault>>8)&0xffffffu;\n");
        l64_sync(o, 0);
        fprintf(o, "X.eip=pc;{if(writing==4){(void)xa_check(address,(unsigned)width);x86_fault(\"invalid atomic memory\",(uint32_t)address);}uint32_t a=x86_address(address);if(writing==5)x86_fault(\"unaligned SSE operand\",a);"
                   "if(writing==2){for(int j=0;j<width;j++)x86_wr8(a+(uint32_t)j,av.u8[j]);}"
                   "else if(writing==3){for(int j=0;j<width;j++)(void)x86_rd8(a+(uint32_t)j);}"
                   "else if(writing)x64_store(a,value,width);else (void)x64_load(a,width);}"
                   "x86_fault(\"unmapped flat guest memory\",(uint32_t)address);\n");
        fprintf(o, "exit:\n"); l64_sync(o, 0); fprintf(o, "X.eip=pc;x86_profile_exit(pc,exit_reason);return;\n}\n");
        free(replays); free(guarded); free(starts); free(live); free(ins);
        }
        fprintf(o, "void N_%08x(uint32_t pc){\n", original->addr);
        fprintf(o, "static void (*const regions[])(uint32_t)={");
        for (uint32_t begin = 0; begin < original->insns.n; begin += 256)
            fprintf(o, "R_%08x_%08x,", original->addr, original->insns.v[begin]);
        fprintf(o, "};unsigned region=0;\n");
        for (uint32_t begin = 256; begin < original->insns.n; begin += 256)
            fprintf(o, "if(pc>=0x%08xu)region=%uu;\n", original->insns.v[begin], begin / 256);
        fprintf(o, "regions[region](pc);}\nvoid F_%08x(void){x86_run_native(N_%08x);}\n",
            original->addr, original->addr); vpush(&order, original->addr); vpush(&ends, original->end);
        for (uint32_t j = 0; j < original->nij; j++) if (!original->ij[j].resolved) st->unresolved++;
    }
    l64_entry_t *entries = xcalloc(order.n, sizeof *entries);
    for (uint32_t i = 0; i < order.n; i++) entries[i] = (l64_entry_t){order.v[i], ends.v[i]};
    qsort(entries, order.n, sizeof *entries, l64_entry_cmp);
    fprintf(o, "const x86_lifted_entry_t x86_lifted_%s[]={\n", name);
    for (uint32_t i = 0; i < order.n; i++) {
        fprintf(o, "{0x%08xu,F_%08x,0x%08xu,", entries[i].addr, entries[i].addr, entries[i].end);
        if (vhas(&skip,entries[i].addr)) fprintf(o, "0},\n");
        else fprintf(o, "N_%08x},\n", entries[i].addr);
    }
    free(entries);
    fprintf(o, "};\nconst uint32_t x86_lifted_%s_count=%u;\n", name, order.n); free(order.v); free(ends.v);
}
