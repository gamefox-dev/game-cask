/*
 * x86tool — analyze, disassemble and lift x86-32 PE images (host tool, built with zig cc).
 *
 *   x86tool analyze FILE [--base HEX] [--name ID]           -> analysis JSON on stdout
 *   x86tool disasm  FILE [--base HEX] [--func HEX]          -> listing on stdout
 *   x86tool lift    FILE --name ID [--base HEX] --out F.c   -> lifted C (+ analysis JSON on stdout)
 *
 * --base relocates the image (applying its .reloc table) to the address the platform will load it
 * at, so absolute addresses baked into the lifted code match the guest memory map.
 *
 * Deterministic: same input and options give byte-identical output.
 *
 * SPDX-License-Identifier: MIT
 */
#define _POSIX_C_SOURCE 200809L
#include <sys/mman.h>
#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../platforms/x86/x86_decode.h"

/* ------------------------------------------------------------------ utilities */
static void die(const char *m) { fprintf(stderr, "x86tool: %s\n", m); exit(2); }
static void *xcalloc(size_t n, size_t s) { void *p = calloc(n ? n : 1, s); if (!p) die("out of memory"); return p; }
static uint32_t r16(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8); }
static uint32_t r32(const uint8_t *p) { return r16(p) | (r16(p + 2) << 16); }
static void w32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }

typedef struct { uint32_t *v; uint32_t n, cap; } vec_t;
static void vpush(vec_t *a, uint32_t x) {
    if (a->n == a->cap) { a->cap = a->cap ? a->cap * 2 : 64; a->v = realloc(a->v, a->cap * 4); if (!a->v) die("oom"); }
    a->v[a->n++] = x;
}
static int cmpu(const void *a, const void *b) { uint32_t x = *(const uint32_t *)a, y = *(const uint32_t *)b; return x < y ? -1 : x > y; }
static void vsort_uniq(vec_t *a) {
    if (!a->n) return;
    qsort(a->v, a->n, 4, cmpu);
    uint32_t k = 1;
    for (uint32_t i = 1; i < a->n; i++) if (a->v[i] != a->v[k - 1]) a->v[k++] = a->v[i];
    a->n = k;
}
static int vhas(const vec_t *a, uint32_t x) { /* a sorted */
    uint32_t lo = 0, hi = a->n;
    while (lo < hi) { uint32_t m = (lo + hi) / 2; if (a->v[m] == x) return 1; if (a->v[m] < x) lo = m + 1; else hi = m; }
    return 0;
}

static void json_str(FILE *f, const char *s) {
    fputc('"', f);
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { fputc('\\', f); fputc(c, f); }
        else if (c < 32 || c > 126) fprintf(f, "\\u%04x", c);
        else fputc(c, f);
    }
    fputc('"', f);
}

/* ------------------------------------------------------------------ PE image */
typedef struct { char name[9]; uint32_t va, vsize, raw, rawsize, chars; } sect_t;
typedef struct { char dll[256]; char name[256]; uint32_t ordinal, iat; uint32_t sites; } import_t;
typedef struct { char name[64]; uint32_t ordinal, addr; } export_t;

typedef struct {
    uint8_t *img;      /* mapped image (virtual layout), relocated to `base` */
    uint32_t size, base, pref_base, entry;
    uint64_t preferred64;
    int mode64, is_dll, has_relocs;
    sect_t sec[96]; uint32_t nsec;
    import_t *imp; uint32_t nimp;
    export_t *exp; uint32_t nexp;
    vec_t reloc_vas;   /* VAs of relocated 32-bit slots */
    uint32_t dd_rva[16], dd_size[16]; /* data directories (imports, IAT, resources, ...) */
    vec_t name_ranges; /* [start, end) VA pairs of import DLL names and hint/name entries */
} pe_t;

static int in_image(const pe_t *pe, uint32_t va, uint32_t n) { return va >= pe->base && (uint64_t)va - pe->base + n <= pe->size; }
static const uint8_t *at(const pe_t *pe, uint32_t va) { return in_image(pe, va, 1) ? pe->img + (va - pe->base) : 0; }
static int is_code(const pe_t *pe, uint32_t va) {
    for (uint32_t i = 0; i < pe->nsec; i++) {
        const sect_t *s = &pe->sec[i];
        if ((s->chars & 0x20000020u) && va >= pe->base + s->va && va < pe->base + s->va + (s->vsize ? s->vsize : s->rawsize)) return 1;
    }
    return 0;
}

static void cstr(const uint8_t *p, uint32_t max, char *out, uint32_t cap) {
    uint32_t i = 0;
    for (; i < max && i + 1 < cap && p[i]; i++) out[i] = (char)p[i];
    out[i] = 0;
}

static void pe_load(pe_t *pe, const uint8_t *d, uint32_t len, uint32_t want_base) {
    memset(pe, 0, sizeof *pe);
    if (len < 0x40 || d[0] != 'M' || d[1] != 'Z') die("not an MZ/PE file");
    uint32_t nt = r32(d + 0x3c);
    if ((uint64_t)nt + 248 > len || memcmp(d + nt, "PE\0\0", 4)) die("no PE header");
    pe->mode64 = r16(d + nt + 4) == 0x8664;
    if (!pe->mode64 && r16(d + nt + 4) != 0x14c) die("unsupported PE machine");
    uint32_t opt = nt + 24, optsz = r16(d + nt + 20);
    if (r16(d + opt) != (pe->mode64?0x20b:0x10b)) die("PE optional header/machine mismatch");
    if (optsz < (pe->mode64?240:224) || (uint64_t)opt + optsz > len) die("truncated PE32 optional header");
    pe->is_dll = (r16(d + nt + 22) & 0x2000) != 0;
    pe->preferred64 = pe->mode64 ? (uint64_t)r32(d+opt+24)|((uint64_t)r32(d+opt+28)<<32) : r32(d+opt+28);
    pe->pref_base = pe->mode64 ? 0x01000000u : (uint32_t)pe->preferred64;
    pe->size = r32(d + opt + 56);
    if (pe->size > 256u << 20) die("image too large");
    uint32_t hdrsz = r32(d + opt + 60);
    pe->nsec = r16(d + nt + 6);
    if (pe->nsec > 96) die("too many sections");
    pe->img = xcalloc(pe->size, 1);
    memcpy(pe->img, d, hdrsz < len ? (hdrsz < pe->size ? hdrsz : pe->size) : len);
    uint32_t so = opt + optsz;
    if ((uint64_t)so + pe->nsec * 40u > len) die("truncated PE section table");
    for (uint32_t i = 0; i < pe->nsec; i++) {
        const uint8_t *s = d + so + 40 * i;
        sect_t *t = &pe->sec[i];
        memcpy(t->name, s, 8); t->name[8] = 0;
        t->vsize = r32(s + 8); t->va = r32(s + 12); t->rawsize = r32(s + 16); t->raw = r32(s + 20); t->chars = r32(s + 36);
        uint32_t n = t->rawsize < t->vsize || !t->vsize ? t->rawsize : t->vsize;
        if ((uint64_t)t->raw + n > len) n = t->raw < len ? len - t->raw : 0;
        if ((uint64_t)t->va + n > pe->size) n = t->va < pe->size ? pe->size - t->va : 0;
        if (n) memcpy(pe->img + t->va, d + t->raw, n);
    }
    pe->base = want_base ? want_base : pe->pref_base;
    pe->entry = r32(d + opt + 16) ? pe->base + r32(d + opt + 16) : 0;
    const uint8_t *dd = d + opt + (pe->mode64?112:96);
    for (uint32_t k = 0; k < 16 && (pe->mode64?112u:96u) + 8 * k + 8 <= optsz; k++) { pe->dd_rva[k] = r32(dd + 8 * k); pe->dd_size[k] = r32(dd + 8 * k + 4); }
    /* relocations */
    uint32_t rel_rva = r32(dd + 5 * 8), rel_sz = r32(dd + 5 * 8 + 4);
    pe->has_relocs = rel_rva && rel_sz;
    int64_t delta = (int64_t)pe->base - (int64_t)pe->preferred64;
    if (pe->has_relocs) {
        uint32_t p = rel_rva, end = rel_rva + rel_sz;
        while (p + 8 <= end && p + 8 <= pe->size) {
            uint32_t page = r32(pe->img + p), bs = r32(pe->img + p + 4);
            if (bs < 8 || p + bs > pe->size) break;
            for (uint32_t k = 8; k + 2 <= bs; k += 2) {
                uint32_t e = r16(pe->img + p + k), type = e >> 12, off = e & 0xfff;
                if(type == 10 && (uint64_t)page+off+8<=pe->size) {
                    uint8_t *q=pe->img+page+off;uint64_t v=(uint64_t)r32(q)|((uint64_t)r32(q+4)<<32);v+=(uint64_t)delta;
                    w32(q,(uint32_t)v);w32(q+4,(uint32_t)(v>>32));vpush(&pe->reloc_vas,pe->base+page+off);
                }
                if (type == 3 && page + off + 4 <= pe->size) {
                    uint8_t *q = pe->img + page + off;
                    if (delta) w32(q, r32(q) + (uint32_t)delta);
                    vpush(&pe->reloc_vas, pe->base + page + off);
                }
            }
            p += bs;
        }
    } else if (delta) {
        die("image has no relocations and cannot be lifted at a different base");
    }
    vsort_uniq(&pe->reloc_vas);
    /* imports */
    uint32_t imp_rva = r32(dd + 8);
    if (imp_rva) {
        uint32_t cap = 64;
        pe->imp = xcalloc(cap, sizeof(import_t));
        for (uint32_t de = imp_rva; de + 20 <= pe->size; de += 20) {
            uint32_t ilt = r32(pe->img + de), name = r32(pe->img + de + 12), iat = r32(pe->img + de + 16);
            if (!name && !iat) break;
            char dll[256];
            cstr(pe->img + name, 255, dll, sizeof dll);
            vpush(&pe->name_ranges, pe->base + name); vpush(&pe->name_ranges, pe->base + name + (uint32_t)strlen(dll) + 1);
            uint32_t lt = ilt ? ilt : iat;
            uint32_t stride=pe->mode64?8:4;
            for (uint32_t k = 0; lt + stride * k + stride <= pe->size; k++) {
                uint32_t ent = r32(pe->img + lt + stride * k);
                int ordinal=pe->mode64?!!(r32(pe->img+lt+stride*k+4)&0x80000000u):!!(ent&0x80000000u);
                if (!ent) break;
                if (pe->nimp == cap) { cap *= 2; pe->imp = realloc(pe->imp, cap * sizeof(import_t)); if (!pe->imp) die("oom"); }
                import_t *im = &pe->imp[pe->nimp++];
                memset(im, 0, sizeof *im);
                snprintf(im->dll, sizeof im->dll, "%s", dll);
                im->iat = pe->base + iat + stride * k;
                if (ordinal) { im->ordinal = ent & 0xffff; snprintf(im->name, sizeof im->name, "#%u", im->ordinal); }
                else if (ent + 2 < pe->size) {
                    cstr(pe->img + ent + 2, 255, im->name, sizeof im->name);
                    vpush(&pe->name_ranges, pe->base + ent); vpush(&pe->name_ranges, pe->base + ent + 3 + (uint32_t)strlen(im->name));
                }
            }
        }
    }
    /* exports */
    uint32_t exp_rva = r32(dd), exp_sz = r32(dd + 4);
    if (exp_rva && exp_rva + 40 <= pe->size) {
        const uint8_t *e = pe->img + exp_rva;
        uint32_t obase = r32(e + 16), nf = r32(e + 20), nn = r32(e + 24), af = r32(e + 28), an = r32(e + 32), ao = r32(e + 36);
        if (nf < 65536 && af + 4 * nf <= pe->size) {
            pe->exp = xcalloc(nf, sizeof(export_t));
            for (uint32_t i = 0; i < nf; i++) {
                uint32_t rva = r32(pe->img + af + 4 * i);
                if (!rva || (rva >= exp_rva && rva < exp_rva + exp_sz)) continue; /* empty or forwarder */
                export_t *x = &pe->exp[pe->nexp++];
                x->ordinal = obase + i; x->addr = pe->base + rva;
                snprintf(x->name, sizeof x->name, "#%u", x->ordinal);
                for (uint32_t j = 0; j < nn && an + 4 * j + 4 <= pe->size && ao + 2 * j + 2 <= pe->size; j++)
                    if (r16(pe->img + ao + 2 * j) == i) { cstr(pe->img + r32(pe->img + an + 4 * j), 63, x->name, sizeof x->name); break; }
            }
        }
    }
}

static const import_t *import_at_iat(const pe_t *pe, uint32_t va) {
    for (uint32_t i = 0; i < pe->nimp; i++) if (pe->imp[i].iat == va) return &pe->imp[i];
    return 0;
}

static int decode_at(const pe_t *pe, uint32_t va, x86_insn_t *in) {
    const uint8_t *p = at(pe, va);
    if (!p || !is_code(pe, va)) return 0;
    uint32_t avail = pe->base + pe->size - va;
    return x86_decode_mode(p, avail > 15 ? 15 : avail, va, pe->mode64, in);
}

/* ------------------------------------------------------------------ analysis */
typedef struct { uint32_t at; vec_t targets; int resolved; uint32_t table; } ijump_t;
typedef struct {
    uint32_t addr, end;
    int unwind_range;
    vec_t insns;       /* addresses of all instructions in the function (sorted) */
    vec_t labels;      /* branch targets inside the function */
    vec_t calls;       /* direct call targets */
    vec_t imports;     /* indices into pe->imp called */
    ijump_t *ij; uint32_t nij;
    uint32_t indirect_calls, unsupported, fpu, undecodable;
    int seed_kind;     /* 0 entry, 1 export, 2 call target, 3 relocated pointer, 4 immediate pointer */
} func_t;

typedef struct { uint32_t addr; int seed_kind; const char *reason; } dseed_t;
typedef struct {
    pe_t *pe;
    func_t *f; uint32_t nf, capf;
    vec_t known;           /* sorted function entries (rebuilt as discovered) */
    uint32_t census[XO_COUNT];
    vec_t blocked;         /* sorted: pointer seeds classified as data (never functions) */
    dseed_t *ds; uint32_t nds;
} an_t;

static int func_index(an_t *a, uint32_t addr) {
    for (uint32_t i = 0; i < a->nf; i++) if (a->f[i].addr == addr) return (int)i;
    return -1;
}
static void add_func(an_t *a, uint32_t addr, int kind) {
    if (!is_code(a->pe, addr)) return;
    int existing = func_index(a, addr);
    if (existing >= 0) {
        if (kind < a->f[existing].seed_kind) a->f[existing].seed_kind = kind;
        return;
    }
    if (vhas(&a->blocked, addr) && kind >= 3) return;
    if (a->pe->mode64 && kind >= 3) for (uint32_t i = 0; i < a->nf; i++)
        if (a->f[i].unwind_range && addr > a->f[i].addr && addr < a->f[i].end) return;
    if (a->nf == a->capf) { a->capf = a->capf ? a->capf * 2 : 256; a->f = realloc(a->f, a->capf * sizeof(func_t)); if (!a->f) die("oom"); }
    func_t *f = &a->f[a->nf++];
    memset(f, 0, sizeof *f);
    f->addr = addr; f->seed_kind = kind;
}

/* jump table: jmp dword [index*4 + table] — collect consecutive code pointers (bounded by a
 * preceding `cmp index, N` when present, else by the first non-code entry). */
static void resolve_table(an_t *a, func_t *f, const x86_insn_t *in, ijump_t *j) {
    const x86_opnd_t *m = &in->o[0];
    if (m->kind != XK_MEM || m->base != X86_NOREG || m->index == X86_NOREG || m->scale != 2) return;
    uint32_t table = (uint32_t)m->disp, bound = 1024;
    /* look back a few instructions for cmp idx, imm */
    for (uint32_t k = f->insns.n; k > 0 && f->insns.n - k < 8; k--) {
        x86_insn_t p;
        if (!decode_at(a->pe, f->insns.v[k - 1], &p)) break;
        if (p.op == XO_CMP && p.o[0].kind == XK_REG && p.o[0].reg == m->index && p.o[1].kind == XK_IMM) { bound = p.o[1].imm + 1; break; }
    }
    if (bound > 4096) bound = 4096;
    for (uint32_t i = 0; i < bound; i++) {
        if (!in_image(a->pe, table + 4 * i, 4)) break;
        uint32_t t = r32(a->pe->img + table + 4 * i - a->pe->base);
        if (!is_code(a->pe, t)) break;
        vpush(&j->targets, t);
    }
    j->table = table;
    j->resolved = j->targets.n > 0;
}

static void analyze_func(an_t *a, uint32_t fi) {
    vec_t work = {0}, seen = {0};
    vpush(&work, a->f[fi].addr);
    while (work.n) {
        uint32_t va = work.v[--work.n];
        for (;;) {
            func_t *f = &a->f[fi];
            int dup = 0;
            for (uint32_t i = 0; i < seen.n; i++) if (seen.v[i] == va) { dup = 1; break; }
            if (dup) break;
            vpush(&seen, va);
            x86_insn_t in;
            if (!decode_at(a->pe, va, &in)) { f->undecodable++; vpush(&f->insns, va); break; }
            vpush(&f->insns, va);
            a->census[in.op]++;
            if (in.op == XO_UNSUPPORTED) f->unsupported++;
            if (in.op == XO_FPU) f->fpu++;
            if (in.op == XO_CALL) { vpush(&f->calls, in.target); add_func(a, in.target, 2); f = &a->f[fi]; }
            if (in.op == XO_CALL_IND) {
                const import_t *im = in.o[0].kind == XK_MEM && in.o[0].base == X86_NOREG && in.o[0].index == X86_NOREG ? import_at_iat(a->pe, (uint32_t)in.o[0].disp) : 0;
                if (im) { vpush(&f->imports, (uint32_t)(im - a->pe->imp)); ((import_t *)im)->sites++; }
                else f->indirect_calls++;
            }
            if (in.op == XO_JCC || in.op == XO_LOOP || in.op == XO_LOOPE || in.op == XO_LOOPNE || in.op == XO_JECXZ) {
                vpush(&f->labels, in.target);
                vpush(&work, in.target);
            }
            if (in.op == XO_JMP) {
                /* jump to a known function entry = tail call; otherwise a block of this function */
                vec_t k = a->known;
                if (in.target != f->addr && vhas(&k, in.target)) break;
                vpush(&f->labels, in.target);
                va = in.target;
                continue;
            }
            if (in.op == XO_JMP_IND) {
                f->ij = realloc(f->ij, (f->nij + 1) * sizeof(ijump_t));
                ijump_t *j = &f->ij[f->nij++];
                memset(j, 0, sizeof *j);
                j->at = va;
                const import_t *im = in.o[0].kind == XK_MEM && in.o[0].base == X86_NOREG && in.o[0].index == X86_NOREG ? import_at_iat(a->pe, (uint32_t)in.o[0].disp) : 0;
                if (im) { j->resolved = 1; vpush(&f->imports, (uint32_t)(im - a->pe->imp)); ((import_t *)im)->sites++; }
                else {
                    resolve_table(a, f, &in, j);
                    for (uint32_t t = 0; t < j->targets.n; t++) { vpush(&f->labels, j->targets.v[t]); vpush(&work, j->targets.v[t]); }
                }
                break;
            }
            if (in.flags & X86_F_TERMINATOR) break;
            va += in.len;
        }
    }
    func_t *f = &a->f[fi];
    vsort_uniq(&f->insns); vsort_uniq(&f->labels); vsort_uniq(&f->calls); vsort_uniq(&f->imports);
    free(work.v); free(seen.v);
}

static void analyze(an_t *a) {
    pe_t *pe = a->pe;
    if (pe->entry) add_func(a, pe->entry, 0);
    for (uint32_t i = 0; i < pe->nexp; i++) add_func(a, pe->exp[i].addr, 1);
    /* relocated slots that point into code: function pointers (WndProcs, vtables, tables) */
    for (uint32_t i = 0; i < pe->reloc_vas.n; i++) {
        uint32_t slot = pe->reloc_vas.v[i];
        if (!in_image(pe, slot, 4)) continue;
        uint32_t t = r32(pe->img + slot - pe->base);
        if (is_code(pe, t) && !is_code(pe, slot)) add_func(a, t, 3);
    }
    /* iterate: analyze functions, collect immediate code pointers from their instructions */
    for (uint32_t done = 0; done < a->nf; done++) {
        a->known.n = 0;
        for (uint32_t i = 0; i < a->nf; i++) vpush(&a->known, a->f[i].addr);
        vsort_uniq(&a->known);
        analyze_func(a, done);
        func_t *f = &a->f[done];
        for (uint32_t k = 0; k < f->insns.n; k++) {
            x86_insn_t in;
            if (!decode_at(pe, f->insns.v[k], &in)) continue;
            for (int o = 0; o < in.nops; o++) {
                uint32_t v = in.o[o].kind == XK_IMM && in.o[o].size == 4 ? in.o[o].imm : 0;
                /* `push imm` / `mov [x], imm` of a code address: callback registration (no-reloc images) */
                if (v && is_code(pe, v) && (in.op == XO_PUSH || in.op == XO_MOV)) {
                    int inside = 0;
                    for (uint32_t q = 0; q < f->insns.n; q++) if (f->insns.v[q] == v) { inside = 1; break; }
                    if (!inside) add_func(a, v, 4);
                }
            }
        }
    }
}

/* Relocated pointers that turned out to be jump-table targets (case labels) inside an analysed
 * function, and are never called, are not functions: drop them. */
static void prune(an_t *a) {
    uint32_t k = 0;
    for (uint32_t i = 0; i < a->nf; i++) {
        func_t *f = &a->f[i];
        int drop = 0;
        if (f->seed_kind >= 3) {
            int called = 0, inside = 0;
            for (uint32_t j = 0; j < a->nf && !called; j++) if (vhas(&a->f[j].calls, f->addr)) called = 1;
            for (uint32_t j = 0; j < a->nf && !inside; j++) {
                if (j == i) continue;
                for (uint32_t q = 0; q < a->f[j].nij && !inside; q++)
                    for (uint32_t t = 0; t < a->f[j].ij[q].targets.n; t++)
                        if (a->f[j].ij[q].targets.v[t] == f->addr) { inside = 1; break; }
            }
            drop = inside && !called;
        }
        if (!drop) a->f[k++] = *f;
    }
    a->nf = k;
}

/* ------------------------------------------------------------------ data seeds
 * Pointer seeds (relocated or immediate pointers into a code section) can point at data that shares the section
 * with code (merged .text: IAT, strings, GUIDs, tables). Such a seed is data, not a function, when:
 *   - it lies inside a PE data directory (import/IAT/export/resource/...) or an import name string;
 *   - its bytes are a NUL-terminated string (ASCII >= 8 printable, or UTF-16LE >= 5 printable, >= 2 distinct);
 *   - it starts with zero bytes (`add [eax], al`), which no compiler emits as a function's first instruction;
 *   - its decoded instructions include undecodable or unsupported ones.
 * Entry points, exports and direct call targets are never reclassified. A misclassified real function would still
 * run (interpreted, visible in interp_insns); a data seed lifted as code inflates every total and can fault. */
static int is_string_at(const pe_t *pe, uint32_t va) {
    const uint8_t *p = at(pe, va);
    if (!p) return 0;
    uint32_t avail = pe->base + pe->size - va, n = 0;
    while (n < avail && n < 4096 && p[n] >= 0x20 && p[n] < 0x7f) n++;
    if (n >= 8 && n < avail && p[n] == 0) return 1;
    uint32_t k = 0, distinct = 0;
    uint8_t first = 0;
    while (2 * k + 1 < avail && k < 2048 && p[2 * k] >= 0x20 && p[2 * k] < 0x7f && p[2 * k + 1] == 0) {
        if (!k) first = p[0]; else if (p[2 * k] != first) distinct = 1;
        k++;
    }
    return k >= 5 && distinct && 2 * k + 1 < avail && p[2 * k] == 0 && p[2 * k + 1] == 0;
}
static const char *data_reason(const an_t *a, const func_t *f) {
    const pe_t *pe = a->pe;
    if (f->seed_kind < 3 || f->unwind_range) return 0;
    /* A pointer discovered before a direct call must not weaken call provenance. */
    for (uint32_t i = 0; i < a->nf; i++) if (vhas(&a->f[i].calls, f->addr)) return 0;
    uint32_t va = f->addr;
    for (uint32_t k = 0; k < 16; k++) {
        if (k == 4) continue; /* the security directory holds a file offset, not an RVA */
        if (pe->dd_rva[k] && pe->dd_size[k] && va >= pe->base + pe->dd_rva[k] && va - (pe->base + pe->dd_rva[k]) < pe->dd_size[k]) return "data-directory";
    }
    for (uint32_t i = 0; i + 1 < pe->name_ranges.n; i += 2) if (va >= pe->name_ranges.v[i] && va < pe->name_ranges.v[i + 1]) return "import-name";
    const uint8_t *p = at(pe, va);
    if (pe->mode64) {
        /* Only an entire aligned NULL pointer is decisive on AMD64. Two zero bytes
         * and unsupported instructions (notably UD2) can be intentional real code. */
        if (!(va & 7) && in_image(pe, va, 8) && !r32(p) && !r32(p + 4)) return "zero-pointer";
        return 0; /* Printable instruction streams can be real indirect callbacks. */
    } else if (p && in_image(pe, va, 2) && p[0] == 0 && p[1] == 0) return "zero-bytes";
    if (is_string_at(pe, va)) return "string";
    if (!pe->mode64 && (f->undecodable || f->unsupported)) return "undecodable-or-unsupported";
    return 0;
}
static void reset_analysis(an_t *a) {
    for (uint32_t i = 0; i < a->nf; i++) { free(a->f[i].insns.v); free(a->f[i].labels.v); free(a->f[i].calls.v); free(a->f[i].imports.v); free(a->f[i].ij); }
    a->nf = 0;
    a->known.n = 0;
    memset(a->census, 0, sizeof a->census);
    for (uint32_t i = 0; i < a->pe->nimp; i++) a->pe->imp[i].sites = 0;
}
static void analyze(an_t *a);
static void prune(an_t *a);
/* analyse, classify data seeds, and re-analyse without them until stable (their bogus "calls" vanish too) */
static void analyze64(an_t *a) {
    pe_t *pe=a->pe;
    uint32_t pr=pe->dd_rva[3],ps=pe->dd_size[3];
    for(uint32_t off=0;off+12<=ps;off+=12) {
        if((uint64_t)pr+off+12>pe->size)die("bad exception directory");
        uint32_t begin=pe->base+r32(pe->img+pr+off),end=pe->base+r32(pe->img+pr+off+4);
        if(begin>=end || !is_code(pe,begin) || !in_image(pe,begin,end-begin))continue;
        add_func(a, begin, 0);
        int fi = func_index(a, begin);
        if (fi >= 0) { a->f[fi].end = end; a->f[fi].unwind_range = 1; }
    }
    add_func(a,pe->entry,0);
    for(uint32_t i=0;i<pe->nexp;i++)add_func(a,pe->exp[i].addr,1);
    for(uint32_t i=0;i<pe->reloc_vas.n;i++){uint32_t slot=pe->reloc_vas.v[i];if(in_image(pe,slot,8)){uint64_t v=(uint64_t)r32(pe->img+slot-pe->base)|((uint64_t)r32(pe->img+slot-pe->base+4)<<32);if(v<=UINT32_MAX&&is_code(pe,(uint32_t)v))add_func(a,(uint32_t)v,3);}}
    for(uint32_t i=0;i<a->nf;i++) {
        if (!a->f[i].end) {
            a->known.n = 0;
            for (uint32_t k = 0; k < a->nf; k++) vpush(&a->known, a->f[k].addr);
            vsort_uniq(&a->known);
            analyze_func(a, i);
            if (a->f[i].insns.n) {
                x86_insn_t in;
                uint32_t last = a->f[i].insns.v[a->f[i].insns.n - 1];
                a->f[i].end = last + (decode_at(pe, last, &in) ? in.len : 1);
            }
            /* Leaf functions lack .pdata. Their LEA callbacks must still seed discovery. */
            for (uint32_t k = 0; k < a->f[i].insns.n; k++) {
                x86_insn_t in;
                if (!decode_at(pe, a->f[i].insns.v[k], &in)) continue;
                if (in.op == XO_LEA && in.o[1].base == X86_NOREG && in.o[1].index == X86_NOREG)
                    add_func(a, (uint32_t)in.o[1].disp, 4);
            }
            continue;
        }
        for(uint32_t va=a->f[i].addr;va<a->f[i].end;) {
            x86_insn_t in;vpush(&a->f[i].insns,va);
            if(!decode_at(pe,va,&in)){a->f[i].undecodable++;va++;continue;}
            a->census[in.op]++;if(in.op==XO_UNSUPPORTED)a->f[i].unsupported++;
            if(in.op==XO_FPU)a->f[i].fpu++;
            if (in.op == XO_CALL) { vpush(&a->f[i].calls, in.target); add_func(a, in.target, 2); }
            /* MinGW tail-calls leaf math helpers that have no unwind entry. */
            if ((in.op == XO_JMP || in.op == XO_JCC) &&
                (in.target < a->f[i].addr || in.target >= a->f[i].end)) add_func(a, in.target, 2);
            if(in.op==XO_CALL_IND || in.op==XO_JMP_IND){
                const x86_opnd_t *o=&in.o[0];const import_t *im=o->kind==XK_MEM&&o->base==X86_NOREG&&o->index==X86_NOREG?import_at_iat(pe,(uint32_t)o->disp):0;
                if(im){vpush(&a->f[i].imports,(uint32_t)(im-pe->imp));((import_t *)im)->sites++;}
                if(in.op==XO_CALL_IND && !im)a->f[i].indirect_calls++;
                if(in.op==XO_JMP_IND){func_t *f=&a->f[i];f->ij=realloc(f->ij,(f->nij+1)*sizeof(ijump_t));if(!f->ij)die("oom");ijump_t *j=&f->ij[f->nij++];memset(j,0,sizeof *j);j->at=va;j->resolved=im!=0;}
            }
            if(in.op==XO_LEA&&in.o[1].base==X86_NOREG&&in.o[1].index==X86_NOREG){uint32_t target=(uint32_t)in.o[1].disp;if(is_code(pe,target)){int inside=target>=a->f[i].addr&&target<a->f[i].end;if(!inside)add_func(a,target,4);}}
            va+=in.len;
        }
        vsort_uniq(&a->f[i].insns);vsort_uniq(&a->f[i].calls);
    }
}
static void analyze_all(an_t *a) {
    for (int iter = 0; ; iter++) {
        if (iter) reset_analysis(a);
        if (a->pe->mode64) analyze64(a);
        else { analyze(a); prune(a); }
        uint32_t added = 0;
        for (uint32_t i = 0; i < a->nf; i++) {
            const char *r = data_reason(a, &a->f[i]);
            if (!r) continue;
            a->ds = realloc(a->ds, (a->nds + 1) * sizeof(dseed_t));
            if (!a->ds) die("oom");
            a->ds[a->nds++] = (dseed_t){a->f[i].addr, a->f[i].seed_kind, r};
            vpush(&a->blocked, a->f[i].addr);
            added++;
        }
        if (!added) break;
        vsort_uniq(&a->blocked);
    }
    /* Census is function-instruction membership, not globally unique addresses.
     * Rebuild after pruning so all totals have exactly the same population. */
    memset(a->census, 0, sizeof a->census);
    for (uint32_t i = 0; i < a->nf; i++) {
        func_t *f = &a->f[i]; f->unsupported = f->fpu = f->undecodable = 0;
        for (uint32_t k = 0; k < f->insns.n; k++) {
            x86_insn_t in;
            if (!decode_at(a->pe, f->insns.v[k], &in)) { f->undecodable++; continue; }
            a->census[in.op]++;
            f->unsupported += in.op == XO_UNSUPPORTED; f->fpu += in.op == XO_FPU;
        }
    }
}

static void emit_analysis(FILE *o, an_t *a, const char *name) {
    pe_t *pe = a->pe;
    fprintf(o, "{\n  \"schema\": \"game-cask/x86-analysis/1\",\n  \"module\": "); json_str(o, name);
    fprintf(o, ",\n  \"imageBase\": %u, \"preferredBase\": %u, \"imageSize\": %u, \"entry\": %u, \"dll\": %s, \"relocations\": %u,\n",
            pe->base, pe->pref_base, pe->size, pe->entry, pe->is_dll ? "true" : "false", pe->reloc_vas.n);
    fprintf(o,"  \"machine\":\"%s\",\"pointerBits\":%u,\"preferredBaseHex\":\"0x%llx\",\n",pe->mode64?"x86-64":"i386",pe->mode64?64u:32u,(unsigned long long)pe->preferred64);
    fprintf(o, "  \"sections\": [");
    for (uint32_t i = 0; i < pe->nsec; i++) {
        fprintf(o, "%s{\"name\": ", i ? ", " : ""); json_str(o, pe->sec[i].name);
        fprintf(o, ", \"va\": %u, \"vsize\": %u, \"code\": %s}", pe->base + pe->sec[i].va, pe->sec[i].vsize, (pe->sec[i].chars & 0x20000020u) ? "true" : "false");
    }
    fprintf(o, "],\n  \"imports\": [\n");
    for (uint32_t i = 0; i < pe->nimp; i++) {
        fprintf(o, "    {\"dll\": "); json_str(o, pe->imp[i].dll);
        fprintf(o, ", \"name\": "); json_str(o, pe->imp[i].name);
        fprintf(o, ", \"iat\": %u, \"callSites\": %u}%s\n", pe->imp[i].iat, pe->imp[i].sites, i + 1 < pe->nimp ? "," : "");
    }
    fprintf(o, "  ],\n  \"exports\": [");
    for (uint32_t i = 0; i < pe->nexp; i++) {
        fprintf(o, "%s{\"name\": ", i ? ", " : ""); json_str(o, pe->exp[i].name);
        fprintf(o, ", \"ordinal\": %u, \"addr\": %u}", pe->exp[i].ordinal, pe->exp[i].addr);
    }
    uint32_t insns = 0, unres = 0, icalls = 0, unsup = 0, fpu = 0, undec = 0;
    static const char *const SEED[] = {"entry", "export", "call", "relocated-pointer", "immediate-pointer"};
    fprintf(o, "],\n  \"functions\": [\n");
    for (uint32_t i = 0; i < a->nf; i++) {
        func_t *f = &a->f[i];
        uint32_t fu = 0;
        for (uint32_t k = 0; k < f->nij; k++) if (!f->ij[k].resolved) fu++;
        insns += f->insns.n; unres += fu; icalls += f->indirect_calls; unsup += f->unsupported; fpu += f->fpu; undec += f->undecodable;
        fprintf(o, "    {\"addr\": %u, \"seed\": \"%s\", \"insns\": %u, \"calls\": [", f->addr, SEED[f->seed_kind], f->insns.n);
        for (uint32_t k = 0; k < f->calls.n; k++) fprintf(o, "%s%u", k ? ", " : "", f->calls.v[k]);
        fprintf(o, "], \"imports\": [");
        for (uint32_t k = 0; k < f->imports.n; k++) { fprintf(o, "%s", k ? ", " : ""); json_str(o, pe->imp[f->imports.v[k]].name); }
        fprintf(o, "], \"indirectCalls\": %u, \"indirectJumps\": %u, \"unresolvedJumps\": %u, \"unsupported\": %u, \"fpu\": %u, \"undecodable\": %u}%s\n",
                f->indirect_calls, f->nij, fu, f->unsupported, f->fpu, f->undecodable, i + 1 < a->nf ? "," : "");
    }
    fprintf(o, "  ],\n  \"dataSeeds\": [");
    for (uint32_t i = 0; i < a->nds; i++)
        fprintf(o, "%s{\"addr\": %u, \"seed\": \"%s\", \"reason\": \"%s\"}", i ? ", " : "", a->ds[i].addr, SEED[a->ds[i].seed_kind], a->ds[i].reason);
    fprintf(o, "],\n  \"census\": {");
    int first = 1;
    for (int op = 0; op < XO_COUNT; op++) {
        if (!a->census[op]) continue;
        fprintf(o, "%s\"%s%s\": %u", first ? "" : ", ", x86_op_names[op],
                op == XO_IMUL1 ? "1" : op == XO_JMP_IND || op == XO_CALL_IND ? "_ind" : op == XO_SAL ? "_sal" : "", a->census[op]);
        first = 0;
    }
    fprintf(o, "},\n  \"totals\": {\"functions\": %u, \"dataSeeds\": %u, \"instructions\": %u, \"indirectCalls\": %u, \"unresolvedIndirectJumps\": %u, \"unsupported\": %u, \"fpu\": %u, \"undecodable\": %u}\n}\n",
            a->nf, a->nds, insns, icalls, unres, unsup, fpu, undec);
}

/* ------------------------------------------------------------------ disassembly */
static void disasm(FILE *o, an_t *a, uint32_t only) {
    char txt[160];
    for (uint32_t i = 0; i < a->nf; i++) {
        func_t *f = &a->f[i];
        if (only && f->addr != only) continue;
        fprintf(o, "\nfunction %08x  (%u insns)\n", f->addr, f->insns.n);
        for (uint32_t k = 0; k < f->insns.n; k++) {
            x86_insn_t in;
            uint32_t va = f->insns.v[k];
            if (!decode_at(a->pe, va, &in)) { fprintf(o, "  %08x  (undecodable)\n", va); continue; }
            x86_format(&in, txt, sizeof txt);
            const import_t *im = (in.op == XO_CALL_IND || in.op == XO_JMP_IND) && in.o[0].kind == XK_MEM && in.o[0].base == X86_NOREG && in.o[0].index == X86_NOREG
                                     ? import_at_iat(a->pe, (uint32_t)in.o[0].disp) : 0;
            if (im) fprintf(o, "  %08x%s %s   ; %s!%s\n", va, vhas(&f->labels, va) ? ":" : " ", txt, im->dll, im->name);
            else fprintf(o, "  %08x%s %s\n", va, vhas(&f->labels, va) ? ":" : " ", txt);
        }
    }
}

/* ------------------------------------------------------------------ lifting */
static const char *const RN[8] = {"EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI"};

static void ea(char *d, size_t cap, const x86_opnd_t *m) {
    int n = snprintf(d, cap, "(0x%08xu", (uint32_t)m->disp);
    if (m->base != X86_NOREG) n += snprintf(d + n, cap - (size_t)n, " + X.r[%s]", RN[m->base]);
    if (m->index != X86_NOREG) n += snprintf(d + n, cap - (size_t)n, m->scale ? " + (X.r[%s] << %u)" : " + X.r[%s]", RN[m->index], m->scale);
    if (m->seg_fs) n += snprintf(d + n, cap - (size_t)n, " + X.fs_base");
    snprintf(d + n, cap - (size_t)n, ")");
}
/* C expression reading operand */
static void rd(char *d, size_t cap, const x86_opnd_t *o) {
    char e[160];
    if (o->kind == XK_IMM) { snprintf(d, cap, "0x%xu", (uint32_t)o->imm & (o->size == 4 ? 0xffffffffu : o->size == 2 ? 0xffffu : 0xffu)); return; }
    if (o->kind == XK_REG) {
        if (o->size == 4) snprintf(d, cap, "X.r[%s]", RN[o->reg]);
        else snprintf(d, cap, "xs_getreg(%u, %u)", o->reg, o->size);
        return;
    }
    ea(e, sizeof e, o);
    snprintf(d, cap, "%s(%s)", o->size == 4 ? "x86_rd32" : o->size == 2 ? "x86_rd16" : "x86_rd8", e);
}
/* C statement writing `val` into operand */
static void wr(char *d, size_t cap, const x86_opnd_t *o, const char *val) {
    char e[160];
    if (o->kind == XK_REG) {
        if (o->size == 4) snprintf(d, cap, "X.r[%s] = (uint32_t)(%s);", RN[o->reg], val);
        else snprintf(d, cap, "xs_setreg(%u, %u, %s);", o->reg, o->size, val);
        return;
    }
    ea(e, sizeof e, o);
    snprintf(d, cap, "%s(%s, %s);", o->size == 4 ? "x86_wr32" : o->size == 2 ? "x86_wr16" : "x86_wr8", e, val);
}

static void emit_insn_struct(FILE *o, const x86_insn_t *in) {
    fprintf(o, "{0x%08xu, 0x%08xu, %u, %u, %u, %u, %u, %u, %u, {", in->addr, in->target, in->op, in->len, in->osz, in->rep, in->cc, in->flags, in->nops);
    for (int i = 0; i < 3; i++) {
        const x86_opnd_t *p = &in->o[i];
        fprintf(o, "%s{%u, %u, %u, %u, %u, %u, %u, %u, %d, 0x%llxull}", i ? ", " : "", p->kind, p->size, p->reg, p->base, p->index, p->scale, p->seg_fs, p->pad, p->disp, (unsigned long long)p->imm);
    }
    fprintf(o, "},%u,%u,%u,%u,%u,%u,%u}",in->mode64,in->rex,in->asz,in->simd_op,in->simd_prefix,in->simd_imm,in->lock);
}

typedef struct { uint32_t specialized, generic, calls_direct, calls_indirect, jt_switch, unresolved, flags_elided;
    uint32_t entries; /* LANE-C: resumable registry entries, separate from function count. */ } lift_stats_t;

static int lift_selected(uint32_t addr);
static int lifted_has(an_t *a, uint32_t addr) { return lift_selected(addr) && vhas(&a->known, addr); }
static vec_t skip; /* functions provided by port overrides (sorted) */
static vec_t selected; static int selection;
static int lift_selected(uint32_t addr) { return !selection || vhas(&selected,addr); }

/* Conservative local flag liveness: only elide flag writes when every intervening instruction is
 * known flag-neutral and the next flag user overwrites ALL arithmetic flags before reading any.
 * Calls, branches, partial writers and generic semantics are barriers, including at function exit. */
#include "lift64.h"

static int flag_liveness; /* opt-in until a workload proves a size/speed benefit */
static int flags_dead(an_t *a, func_t *f, uint32_t k) {
    if (!flag_liveness) return 0;
    for (uint32_t i = k + 1; i < f->insns.n; i++) {
        x86_insn_t in;
        if (!decode_at(a->pe, f->insns.v[i - 1], &in) || in.addr + in.len != f->insns.v[i]) return 0;
        if (!decode_at(a->pe, f->insns.v[i], &in) || vhas(&f->labels, in.addr)) return 0;
        if (in.op <= XO_CMP && in.op != XO_ADC && in.op != XO_SBB) return 1;
        if (in.op == XO_TEST) return 1;
        if (in.op != XO_MOV && in.op != XO_MOVZX && in.op != XO_MOVSX && in.op != XO_LEA && in.op != XO_NOP) return 0;
    }
    return 0;
}
static void lift_func(FILE *o, an_t *a, func_t *f, lift_stats_t *st) {
    char t1[200], t2[256], t3[512]; /* sized so the worst-case composition provably fits (gcc -Wformat-truncation) */
    if (vhas(&skip, f->addr)) { fprintf(o, "\n/* function %08x: provided by port/overrides (exception) */\n", f->addr); return; }
    fprintf(o, "\n/* function %08x (%u instructions) */\nvoid F_%08x(void) {\n", f->addr, f->insns.n, f->addr);
    fprintf(o, "    bgt_coverage_entry(0x%08xu, 1);\n", f->addr);
    fprintf(o, "    const uint32_t ra = x86_rd32(X.r[ESP]), esp0 = X.r[ESP]; (void)ra; (void)esp0;\n    uint32_t t, u; (void)t; (void)u;\n");
    /* LANE-C: all instruction labels are legal cooperative resume points. */
    fprintf(o, "    switch (X.eip) {\n");
    for (uint32_t k = 0; k < f->insns.n; k++)
        fprintf(o, "    case 0x%08xu: goto L_%08x;\n", f->insns.v[k], f->insns.v[k]);
    fprintf(o, "    default: goto L_%08x; }\n", f->addr);
    for (uint32_t k = 0; k < f->insns.n; k++) {
        uint32_t va = f->insns.v[k];
        x86_insn_t in;
        char txt[160];
        fprintf(o, "L_%08x:", va);
        /* LANE-C: identical instruction quantum in lifted and interpreted i386. */
        fprintf(o, " if (++X.frame_insns > 2000000u) { X.eip = 0x%08xu; "
            "x86_cooperate(); if (X.transfer) return; }", va);
        if (!decode_at(a->pe, va, &in)) { fprintf(o, " x86_fault(\"undecodable instruction\", 0x%08xu);\n", va); continue; }
        x86_format(&in, txt, sizeof txt);
        for (char *c = txt; *c; c++) if (*c == '*' && c[1] == '/') *c = 'x'; /* keep comments closed */
        fprintf(o, " /* %s */\n    ", txt);
        uint32_t next = va + in.len;
        const x86_opnd_t *A = &in.o[0], *B = &in.o[1];
        int sz = A->size ? A->size : 4;
        int spec = 1;
        switch (in.op) {
        case XO_MOV: case XO_MOVZX: rd(t1, sizeof t1, B); wr(t3, sizeof t3, A, t1); fprintf(o, "%s", t3); break;
        case XO_MOVSX: rd(t1, sizeof t1, B); snprintf(t2, sizeof t2, "xs_sext(%s, %u)", t1, B->size); wr(t3, sizeof t3, A, t2); fprintf(o, "%s", t3); break;
        case XO_LEA: ea(t1, sizeof t1, B); wr(t3, sizeof t3, A, t1); fprintf(o, "%s", t3); break;
        case XO_ADD: case XO_OR: case XO_ADC: case XO_SBB: case XO_AND: case XO_SUB: case XO_XOR:
            rd(t1, sizeof t1, A); rd(t2, sizeof t2, B);
            if (in.op != XO_ADC && in.op != XO_SBB && flags_dead(a, f, k)) {
                const char *op = in.op == XO_ADD ? "+" : in.op == XO_SUB ? "-" : in.op == XO_AND ? "&" : in.op == XO_OR ? "|" : "^";
                fprintf(o, "t = (%s %s %s); ", t1, op, t2); st->flags_elided++;
            } else fprintf(o, "t = xs_alu(%u, %s, %s, %d); ", in.op, t1, t2, sz);
            wr(t3, sizeof t3, A, "t"); fprintf(o, "%s", t3); break;
        case XO_CMP: case XO_TEST: rd(t1, sizeof t1, A); rd(t2, sizeof t2, B);
            fprintf(o, "xs_alu(%u, %s, %s, %d);", in.op == XO_CMP ? XO_CMP : XO_AND, t1, t2, sz); break;
        case XO_INC: case XO_DEC: rd(t1, sizeof t1, A);
            fprintf(o, "u = X.flags & F_CF; t = xs_alu(%u, %s, 1, %d); X.flags = (X.flags & ~F_CF) | u; ", in.op == XO_INC ? XO_ADD : XO_SUB, t1, sz);
            wr(t3, sizeof t3, A, "t"); fprintf(o, "%s", t3); break;
        case XO_ROL: case XO_ROR: case XO_RCL: case XO_RCR: case XO_SHL: case XO_SHR: case XO_SAL: case XO_SAR:
            rd(t1, sizeof t1, A); rd(t2, sizeof t2, B);
            fprintf(o, "t = xs_shift(%u, %s, %s, %d); ", in.op, t1, t2, sz); wr(t3, sizeof t3, A, "t"); fprintf(o, "%s", t3); break;
        case XO_PUSH:
            if (in.osz != 4) { spec = 0; break; }
            if (A->kind == XK_IMM) fprintf(o, "x86_push(0x%08xu);", (uint32_t)A->imm); else { rd(t1, sizeof t1, A); fprintf(o, "t = %s; x86_push(t);", t1); }
            break;
        case XO_POP:
            if (in.osz != 4) { spec = 0; break; }
            fprintf(o, "t = x86_pop(); "); wr(t3, sizeof t3, A, "t"); fprintf(o, "%s", t3); break;
        case XO_SETCC: snprintf(t2, sizeof t2, "(uint32_t)xs_cond(%u)", in.cc); wr(t3, sizeof t3, A, t2); fprintf(o, "%s", t3); break;
        case XO_CMOVCC: rd(t1, sizeof t1, B); fprintf(o, "t = %s; if (xs_cond(%u)) { ", t1, in.cc); wr(t3, sizeof t3, A, "t"); fprintf(o, "%s }", t3); break;
        case XO_LEAVE: fprintf(o, "X.r[ESP] = X.r[EBP]; X.r[EBP] = x86_pop();"); break;
        case XO_NOP: fprintf(o, ";"); break;
        case XO_CDQ: if (in.osz == 4) fprintf(o, "X.r[EDX] = (X.r[EAX] & 0x80000000u) ? 0xffffffffu : 0;"); else spec = 0; break;
        /* LANE-K5a: preserve address aliases, source segment and precise REP restart. */
        case XO_MOVS: case XO_STOS: case XO_LODS: case XO_CMPS: case XO_SCAS: fprintf(o, "xs_string(%u, %d, %u, %u, 0x%08xu, 0x%08xu, %u);if(X.transfer)return;", in.op, sz, in.rep, in.asz, in.addr, next, A->seg_fs); break;
        case XO_MUL: case XO_IMUL1: case XO_DIV: case XO_IDIV: {
            rd(t1, sizeof t1, A);
            fprintf(o, "{ const char *e = xs_muldiv(%u, %s, %d); if (e) x86_fault(e, 0x%08xu); }", in.op, t1, sz, va);
            break;
        }
        /* ---- control flow (always lifted explicitly) */
        case XO_JCC: fprintf(o, "if (xs_cond(%u)) goto L_%08x;", in.cc, in.target); break;
        case XO_LOOP: fprintf(o, "if (--X.r[ECX]) goto L_%08x;", in.target); break;
        case XO_LOOPE: fprintf(o, "if (--X.r[ECX] && (X.flags & F_ZF)) goto L_%08x;", in.target); break;
        case XO_LOOPNE: fprintf(o, "if (--X.r[ECX] && !(X.flags & F_ZF)) goto L_%08x;", in.target); break;
        case XO_JECXZ: fprintf(o, "if (!X.r[ECX]) goto L_%08x;", in.target); break;
        case XO_JMP:
            if (vhas(&f->labels, in.target) && (in.target != f->addr || 1)) {
                int inside = 0;
                for (uint32_t q = 0; q < f->insns.n; q++) if (f->insns.v[q] == in.target) { inside = 1; break; }
                if (inside) { fprintf(o, "goto L_%08x;", in.target); break; }
            }
            /* tail call to another function */
            if (lifted_has(a, in.target)) fprintf(o, "X.eip = 0x%08xu; F_%08x(); return;", in.target, in.target);
            else fprintf(o, "X.eip = 0x%08xu; x86_continue(ra, esp0); return;", in.target);
            break;
        case XO_CALL:
            st->calls_direct++;
            if (lifted_has(a, in.target))
                /* LANE-C */
                fprintf(o, "x86_push(0x%08xu); X.eip = 0x%08xu; x86_metrics.lifted_calls++; "
                    "F_%08x(); if (X.transfer) return; if (X.eip != 0x%08xu) "
                    "x86_fault(\"unexpected return\", 0x%08xu);", next, in.target, in.target, next, va);
            else fprintf(o, "x86_call(0x%08xu, 0x%08xu);", in.target, next);
            break;
        case XO_CALL_IND: st->calls_indirect++; rd(t1, sizeof t1, A); fprintf(o, "x86_call(%s, 0x%08xu);", t1, next); break;
        case XO_RET: fprintf(o, "X.eip = x86_pop(); X.r[ESP] += %uu; return;", (uint32_t)A->imm); break;
        case XO_JMP_IND: {
            rd(t1, sizeof t1, A);
            fprintf(o, "t = %s;", t1);
            ijump_t *j = 0;
            for (uint32_t q = 0; q < f->nij; q++) if (f->ij[q].at == va) j = &f->ij[q];
            if (j && j->targets.n) {
                st->jt_switch++;
                fprintf(o, " switch (t) {");
                vec_t uniq = {0};
                for (uint32_t q = 0; q < j->targets.n; q++) vpush(&uniq, j->targets.v[q]);
                vsort_uniq(&uniq);
                for (uint32_t q = 0; q < uniq.n; q++) fprintf(o, " case 0x%08xu: goto L_%08x;", uniq.v[q], uniq.v[q]);
                free(uniq.v);
                fprintf(o, " default: break; }");
            } else st->unresolved += !(j && j->resolved);
            /* import thunk jump or unresolved target: continue this frame elsewhere */
            fprintf(o, " X.eip = t; x86_continue(ra, esp0); return;");
            break;
        }
        default: spec = 0; break;
        }
        if (!spec) {
            st->generic++;
            fprintf(o, "{ static const x86_insn_t I = ");
            emit_insn_struct(o, &in);
            fprintf(o, "; x86_exec_one(&I); }");
            if (in.flags & X86_F_TERMINATOR) fprintf(o, " x86_fault(\"fell through terminator\", 0x%08xu);", va);
        } else {
            st->specialized++;
        }
        if (in.op == XO_CALL || in.op == XO_CALL_IND) fprintf(o, " if (X.transfer) return;"); /* LANE-C */
        fprintf(o, "\n");
        /* fall-through into an instruction that is not next in this function's list: jump to it */
        if (!(in.flags & X86_F_TERMINATOR) && in.op != XO_JMP && in.op != XO_JMP_IND && in.op != XO_RET) {
            if (k + 1 >= f->insns.n || f->insns.v[k + 1] != next) {
                int inside = 0;
                for (uint32_t q = 0; q < f->insns.n; q++) if (f->insns.v[q] == next) { inside = 1; break; }
                if (inside) fprintf(o, "    goto L_%08x;\n", next);
                else fprintf(o, "    X.eip = 0x%08xu; x86_continue(ra, esp0); return;\n", next);
            }
        }
    }
    fprintf(o, "}\n");
}

static void lift(FILE *o, an_t *a, const char *name, lift_stats_t *st) {
    if(a->pe->mode64){lift64(o,a,name,st);return;}
    fprintf(o, "/* GENERATED by tools/x86/x86tool lift from module \"%s\" (base 0x%08x). Do not edit:\n", name, a->pe->base);
    fprintf(o, " * re-run the pipeline; override individual functions in port/overrides/. */\n");
    fprintf(o, "#include \"x86_lift.h\"\n#include \"bgt.h\"\n\n");
    for (uint32_t i = 0; i < a->nf; i++) fprintf(o, "void F_%08x(void);\n", a->f[i].addr);
    for (uint32_t i = 0; i < a->nf; i++) if(lift_selected(a->f[i].addr)) lift_func(o, a, &a->f[i], st);
    /* sorted registry */
    vec_t order = {0};
    for (uint32_t i = 0; i < a->nf; i++) if(lift_selected(a->f[i].addr)) vpush(&order, a->f[i].addr);
    vsort_uniq(&order);
    fprintf(o, "\nconst x86_lifted_entry_t x86_lifted_%s[] = {\n", name);
    /* LANE-C: exact instruction entries avoid claiming gaps/overlapping i386 function ranges. */
    vec_t entries = {0};
    for (uint32_t i = 0; i < order.n; i++) {
        func_t *f = &a->f[func_index(a, order.v[i])];
        if (vhas(&skip, f->addr)) vpush(&entries, f->addr);
        else for (uint32_t j = 0; j < f->insns.n; j++) vpush(&entries, f->insns.v[j]);
    }
    vsort_uniq(&entries);
    for (uint32_t i = 0; i < entries.n; i++) {
        uint32_t owner = 0;
        for (uint32_t j = 0; j < order.n; j++) {
            func_t *f = &a->f[func_index(a, order.v[j])];
            if (vhas(&f->insns, entries.v[i])) { owner = f->addr; break; }
        }
        fprintf(o, "    {0x%08xu, F_%08x, 0x%08xu},\n", entries.v[i], owner,
            entries.v[i] == owner ? owner + 1 : 0);
    }
    st->entries = entries.n; /* LANE-C */
    free(entries.v);
    fprintf(o, "};\nconst uint32_t x86_lifted_%s_count = sizeof x86_lifted_%s / sizeof x86_lifted_%s[0];\n",
        name, name, name); /* LANE-C */
    free(order.v);
}

/* ------------------------------------------------------------------ main */
int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: x86tool analyze|disasm|lift FILE [--base HEX] [--name ID] [--func HEX] [--out FILE.c]\n");
        return 1;
    }
    if (!strcmp(argv[1], "decode")) { /* decode HEXBYTES at 0x1000: one line per instruction (tests) */
        uint8_t buf[256]; uint32_t n = 0;
        for (const char *h = argv[2]; h[0] && h[1] && n < sizeof buf; h += 2) { char t[3] = {h[0], h[1], 0}; buf[n++] = (uint8_t)strtoul(t, 0, 16); }
        for (uint32_t off = 0; off < n;) {
            x86_insn_t in; char txt[160];
            int len = x86_decode(buf + off, n - off, 0x1000 + off, &in);
            if (!len) { printf("%04x: (invalid)\n", 0x1000 + off); break; }
            x86_format(&in, txt, sizeof txt);
            printf("%04x: %u %s\n", 0x1000 + off, (unsigned)len, txt);
            off += (uint32_t)len;
        }
        return 0;
    }
    const char *cmd = argv[1], *file = argv[2], *name = "module", *out = 0;
    uint32_t base = 0, func = 0;
    for (int i = 3; i + 1 < argc; i += 2) {
        if (!strcmp(argv[i], "--base")) base = (uint32_t)strtoul(argv[i + 1], 0, 16);
        else if (!strcmp(argv[i], "--name")) name = argv[i + 1];
        else if (!strcmp(argv[i], "--func")) func = (uint32_t)strtoul(argv[i + 1], 0, 16);
        else if (!strcmp(argv[i], "--out")) out = argv[i + 1];
        else if (!strcmp(argv[i], "--select")) {
            selection=1;FILE *list=fopen(argv[i+1],"rb");if(!list)die("cannot open function selection");
            unsigned addr;while(fscanf(list,"%x",&addr)==1)vpush(&selected,(uint32_t)addr);fclose(list);vsort_uniq(&selected);
        }
        else if (!strcmp(argv[i], "--flag-liveness")) flag_liveness = strcmp(argv[i + 1], "off") != 0;
        else if (!strcmp(argv[i], "--skip")) {
            for (char *s = argv[i + 1]; *s;) { vpush(&skip, (uint32_t)strtoul(s, &s, 16)); while (*s == ',') s++; }
            vsort_uniq(&skip);
        }
        else die("unknown option");
    }
    for (const char *c = name; *c; c++) if (!((*c >= 'a' && *c <= 'z') || (*c >= '0' && *c <= '9') || *c == '_')) die("--name must be [a-z0-9_]");
    FILE *f = fopen(file, "rb");
    if (!f) die("cannot open input");
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (len <= 0) die("empty input or unable to determine input size");
    if ((uint64_t)len > UINT32_MAX) die("input exceeds PE file-offset range (4 GiB)");
    /* File-backed mapping faults in only headers and the virtual image's backed ranges.
     * A huge raw overlay is never copied wholesale into the analyzer heap. POSIX host tool (macOS/Linux). */
    const uint8_t *d = mmap(0, (size_t)len, PROT_READ, MAP_PRIVATE, fileno(f), 0);
    if (d == MAP_FAILED) die("cannot map input file read-only");
    pe_t pe;
    pe_load(&pe, d, (uint32_t)len, base);
    munmap((void *)d, (size_t)len);
    fclose(f);
    an_t a;
    memset(&a, 0, sizeof a);
    a.pe = &pe;
    analyze_all(&a);
    a.known.n = 0;
    for (uint32_t i = 0; i < a.nf; i++) vpush(&a.known, a.f[i].addr);
    vsort_uniq(&a.known);
    if (!strcmp(cmd, "analyze")) { emit_analysis(stdout, &a, name); return 0; }
    if (!strcmp(cmd, "disasm")) { disasm(stdout, &a, func); return 0; }
    if (!strcmp(cmd, "lift")) {
        if (!out) die("lift needs --out FILE.c");
        FILE *o = fopen(out, "wb");
        if (!o) die("cannot write output");
        lift_stats_t st = {0};
        lift(o, &a, name, &st);
        fclose(o);
        emit_analysis(stdout, &a, name);
        uint32_t emitted=0;for(uint32_t i=0;i<a.nf;i++)if(lift_selected(a.f[i].addr))emitted++;
        fprintf(stderr, "lifted %s: %u functions (%u overridden, %u data seeds rejected), %u specialized + %u generic instructions, %u jump-table switches, %u unresolved indirect jumps\n",
                name, emitted, skip.n, a.nds, st.specialized, st.generic, st.jt_switch, st.unresolved);
        FILE *sf = fopen(strcat(strcpy(xcalloc(strlen(out) + 16, 1), out), ".stats.json"), "wb");
        if (sf) {
            /* LANE-C: distinguish resumable registry entries from source functions. */
            fprintf(sf, "{\"functions\": %u, \"dataSeeds\": %u, \"overridden\": %u, \"specialized\": %u, "
                    "\"generic\": %u, \"jumpTables\": %u, \"unresolvedJumps\": %u, "
                    "\"flagsElided\": %u, \"entries\": %u}\n",
                    emitted, a.nds, skip.n, st.specialized, st.generic, st.jt_switch, st.unresolved,
                    st.flags_elided, pe.mode64 ? emitted : st.entries);
            fclose(sf);
        }
        return 0;
    }
    die("unknown command");
    return 1;
}
