/*
 * Win32 profile core: image loader, import binding to thunks, API dispatch, guest heap,
 * TEB/PEB, resources, the frame driver and metrics.
 *
 * SPDX-License-Identifier: MIT
 */
#include "w32_int.h"

bgt_io_t *w32_io;
w32_metrics_t w32_m;
int w32_exited;
uint32_t w32_exit_code;
w32_module_t w32_mods[NMOD];
uint32_t w32_nmods;

static const w32_config_t *cfg;
static int started;

/* ------------------------------------------------------------------ helpers */
uint32_t w32_slen(const char *s) { uint32_t n = 0; while (s[n]) n++; return n; }
void w32_log(const char *s) { bgt_log(BGT_LOG_INFO, s, w32_slen(s)); }
void w32_logf2(const char *a, const char *b) {
    char buf[200];
    uint32_t n = 0;
    while (*a && n < 120) buf[n++] = *a++;
    while (*b && n < 199) buf[n++] = *b++;
    bgt_log(BGT_LOG_WARN, buf, n);
}
int w32_streqi(const char *a, const char *b) {
    for (;; a++, b++) {
        char x = *a, y = *b;
        if (x >= 'A' && x <= 'Z') x = (char)(x + 32);
        if (y >= 'A' && y <= 'Z') y = (char)(y + 32);
        if (x != y) return 0;
        if (!x) return 1;
    }
}
uint32_t w32_gstrn(uint32_t addr, int32_t n, int wide, char *dst, uint32_t cap) {
    uint32_t k = 0;
    if (!addr || !cap) { if (cap) dst[0] = 0; return 0; }
    for (int32_t i = 0; (n < 0 || i < n) && k + 1 < cap; i++) {
        uint32_t c = wide ? x86_rd16(addr + 2u * (uint32_t)i) : x86_rd8(addr + (uint32_t)i);
        if (n < 0 && !c) break;
        dst[k++] = (char)(c >= 32 && c < 127 ? c : (c == 9 || c == 10 || c == 13 || c == 0 ? c : '?'));
    }
    dst[k] = 0;
    return k;
}
uint32_t w32_gstr(uint32_t addr, int wide, char *dst, uint32_t cap) { return w32_gstrn(addr, -1, wide, dst, cap); }
uint32_t w32_pstr(uint32_t addr, uint32_t cap, int wide, const char *s) {
    if (!cap) return 0;
    uint32_t i = 0;
    for (; s[i] && i + 1 < cap; i++) { if (wide) x86_wr16(addr + 2 * i, (uint8_t)s[i]); else x86_wr8(addr + i, (uint8_t)s[i]); }
    if (wide) x86_wr16(addr + 2 * i, 0); else x86_wr8(addr + i, 0);
    return i;
}
static uint32_t misc_top = W32_MISC;
uint32_t w32_misc_alloc(uint32_t n) {
    uint32_t a = (misc_top + 7u) & ~7u;
    if (a + n > W32_MISC + W32_MISC_SIZE) x86_fault("win32 profile: misc guest memory exhausted", a);
    misc_top = a + n;
    return a;
}
uint32_t w32_now_ms(void) { return w32_io ? w32_io->frame * 1000u / 60u : 0; }

/* ------------------------------------------------------------------ guest heap (first fit, lazily mapped) */
/* block: [u32 size_with_header | used(bit0)] [u32 requested] payload */
static uint32_t heap_end = W32_HEAP_LO, heap_mapped = W32_HEAP_LO;
static void heap_grow_to(uint32_t end) {
    if (end > W32_HEAP_HI) x86_fault("guest heap exhausted", end);
    if (end > heap_mapped) {
        uint32_t to = (end + 0xffffu) & ~0xffffu;
        if (!x86_map(heap_mapped, to - heap_mapped)) x86_fault("out of host memory for guest heap", end);
        heap_mapped = to;
    }
}
uint32_t w32_heap_alloc(uint32_t n, int zero) {
    uint32_t need = (n + 8u + 15u) & ~15u;
    for (uint32_t p = W32_HEAP_LO; p < heap_end;) {
        uint32_t h = x86_rd32(p), size = h & ~15u;
        if (!size) break;
        if (!(h & 1u)) {
            uint32_t q = p + size; /* coalesce following free blocks */
            while (q < heap_end && !(x86_rd32(q) & 1u)) { size += x86_rd32(q) & ~15u; q = p + size; }
            if (size >= need) {
                if (size - need >= 32) { x86_wr32(p + need, size - need); x86_wr32(p + need + 4, 0); size = need; }
                x86_wr32(p, size | 1u); x86_wr32(p + 4, n);
                if (zero) for (uint32_t i = 8; i < size; i++) x86_wr8(p + i, 0);
                return p + 8;
            }
            x86_wr32(p, size);
        }
        p += size;
    }
    uint32_t p = heap_end;
    heap_grow_to(p + need);
    heap_end = p + need;
    x86_wr32(p, need | 1u); x86_wr32(p + 4, n);
    if (zero) for (uint32_t i = 8; i < need; i++) x86_wr8(p + i, 0);
    return p + 8;
}
void w32_heap_free(uint32_t a) {
    if (a >= W32_HEAP_LO + 8 && a < heap_end) x86_wr32(a - 8, x86_rd32(a - 8) & ~15u);
}
uint32_t w32_heap_size(uint32_t a) { return (a >= W32_HEAP_LO + 8 && a < heap_end) ? x86_rd32(a - 4) : 0; }
uint32_t w32_heap_realloc(uint32_t a, uint32_t n) {
    if (!a) return w32_heap_alloc(n, 0);
    uint32_t old = w32_heap_size(a);
    if (n <= ((x86_rd32(a - 8) & ~15u) - 8)) { x86_wr32(a - 4, n); return a; }
    uint32_t b = w32_heap_alloc(n, 0);
    for (uint32_t i = 0; i < old && i < n; i++) x86_wr8(b + i, x86_rd8(a + i));
    w32_heap_free(a);
    return b;
}

/* ------------------------------------------------------------------ modules + resources */
w32_module_t *w32_mod_by_handle(uint32_t h) {
    if (!h) { for (uint32_t i = 0; i < w32_nmods; i++) if (!w32_mods[i].is_dll) return &w32_mods[i]; return w32_nmods ? &w32_mods[0] : 0; }
    for (uint32_t i = 0; i < w32_nmods; i++) if (w32_mods[i].base == h) return &w32_mods[i];
    return 0;
}

/* ------------------------------------------------------------------ module names + profile DLLs */
void w32_module_name(const char *raw, char *out, uint32_t cap) {
    const char *b = raw;
    for (const char *c = raw; *c; c++) if (*c == '\\' || *c == '/' || *c == ':') b = c + 1;
    uint32_t k = 0;
    int dot = 0;
    for (; b[k] && k + 5 < cap; k++) { out[k] = b[k]; if (b[k] == '.') dot = 1; }
    out[k] = 0;
    if (k && out[k - 1] == '.') out[--k] = 0;          /* trailing '.': explicitly no extension */
    else if (!dot) { const char *e = ".dll"; while (*e) out[k++] = *e++; out[k] = 0; }
}
int w32_is_sys_dll(const char *name) {
    if (!cfg) return 0;
    for (uint32_t i = 0; i < cfg->nsys_dlls; i++) {
        const char *d = cfg->sys_dlls[i];
        uint32_t n = w32_slen(d);
        if (n && d[n - 1] == '*') {
            uint32_t j = 0;
            for (; j + 1 < n && name[j]; j++) {
                char x = name[j], y = d[j];
                if (x >= 'A' && x <= 'Z') x = (char)(x + 32);
                if (x != y) break;
            }
            if (j + 1 == n) return 1;
        } else if (w32_streqi(d, name)) return 1;
    }
    return 0;
}
#define NSYSDLL 32
static char sysdlls[NSYSDLL][40];
static uint32_t nsysdll;
uint32_t w32_sysdll_handle(const char *name, int load) {
    for (uint32_t i = 0; i < nsysdll; i++) if (w32_streqi(sysdlls[i], name)) return W32_SYSDLL_BASE + 0x1000u * i;
    if (!load || !w32_is_sys_dll(name) || nsysdll >= NSYSDLL) return 0;
    uint32_t k = 0;
    for (; name[k] && k < 39; k++) sysdlls[nsysdll][k] = name[k];
    sysdlls[nsysdll][k] = 0;
    return W32_SYSDLL_BASE + 0x1000u * nsysdll++;
}
const char *w32_sysdll_name(uint32_t h) {
    if (h < W32_SYSDLL_BASE || (h - W32_SYSDLL_BASE) & 0xfffu) return 0;
    uint32_t i = (h - W32_SYSDLL_BASE) / 0x1000u;
    return i < nsysdll ? sysdlls[i] : 0;
}

static uint32_t export_forward(const char *fwd, uint32_t depth);
uint32_t w32_export_addr(const w32_module_t *m, const char *name, uint32_t ordinal) {
    if (!m->export_rva) return 0;
    uint32_t e = m->base + m->export_rva;
    uint32_t obase = x86_rd32(e + 16), nf = x86_rd32(e + 20), nn = x86_rd32(e + 24);
    uint32_t af = m->base + x86_rd32(e + 28), an = m->base + x86_rd32(e + 32), ao = m->base + x86_rd32(e + 36);
    uint32_t idx = 0xffffffffu;
    if (name) {
        char buf[80];
        for (uint32_t i = 0; i < nn; i++) {
            w32_gstr(m->base + x86_rd32(an + 4 * i), 0, buf, sizeof buf);
            uint32_t j = 0;
            while (buf[j] && buf[j] == name[j]) j++;
            if (!buf[j] && !name[j]) { idx = x86_rd16(ao + 2 * i); break; }
        }
    } else if (ordinal >= obase) idx = ordinal - obase;
    if (idx >= nf) return 0;
    uint32_t rva = x86_rd32(af + 4 * idx);
    if (rva >= m->export_rva && rva < m->export_rva + m->export_size) { /* forwarder "DLL.Name" / "DLL.#7" */
        char fwd[96];
        w32_gstr(m->base + rva, 0, fwd, sizeof fwd);
        return export_forward(fwd, 0);
    }
    return rva ? m->base + rva : 0;
}

/* resource directory entry lookup: returns the entry's offset field, or 0 */
static uint32_t res_dir(uint32_t base, uint32_t dir, uint32_t id, const char *name, int any) {
    uint32_t p = base + dir, n = x86_rd16(p + 12) + x86_rd16(p + 14);
    char buf[64];
    for (uint32_t k = 0; k < n; k++) {
        uint32_t nm = x86_rd32(p + 16 + 8 * k), tgt = x86_rd32(p + 20 + 8 * k);
        if (any) return tgt;
        if (name) {
            if (!(nm & 0x80000000u)) continue;
            uint32_t so = base + (nm & 0x7fffffffu), len = x86_rd16(so);
            w32_gstrn(so + 2, (int32_t)len, 1, buf, sizeof buf);
            if (w32_streqi(buf, name)) return tgt;
        } else if (!(nm & 0x80000000u) && nm == id) return tgt;
    }
    return 0;
}
/* returns the IMAGE_RESOURCE_DATA_ENTRY address (used as HRSRC) or 0 */
static uint32_t res_entry(uint32_t hmod, uint32_t type, uint32_t id, const char *name) {
    w32_module_t *m = w32_mod_by_handle(hmod);
    if (!m || !m->rsrc_rva) return 0;
    uint32_t base = m->base + m->rsrc_rva;
    uint32_t t = res_dir(base, 0, type, 0, 0);
    if (!(t & 0x80000000u)) return 0;
    uint32_t n = res_dir(base, t & 0x7fffffffu, id, name, 0);
    if (!(n & 0x80000000u)) return 0;
    uint32_t l = res_dir(base, n & 0x7fffffffu, 0, 0, 1);
    if (!l || (l & 0x80000000u)) return 0;
    return base + l;
}
uint32_t w32_res_entry(uint32_t hmod, uint32_t type, uint32_t name_or_id, int name_wide) {
    if (name_or_id < 0x10000u) return res_entry(hmod, type, name_or_id, 0);
    char buf[64];
    w32_gstr(name_or_id, name_wide, buf, sizeof buf);
    if (buf[0] == '#') { uint32_t v = 0; for (char *c = buf + 1; *c >= '0' && *c <= '9'; c++) v = v * 10 + (uint32_t)(*c - '0'); return res_entry(hmod, type, v, 0); }
    return res_entry(hmod, type, 0, buf);
}
static uint32_t res_lookup(uint32_t hmod, uint32_t type, uint32_t id, const char *name, uint32_t *size) {
    w32_module_t *m = w32_mod_by_handle(hmod);
    if (!m || !m->rsrc_rva) return 0;
    uint32_t base = m->base + m->rsrc_rva;
    uint32_t t = res_dir(base, 0, type, 0, 0);
    if (!(t & 0x80000000u)) return 0;
    uint32_t n = res_dir(base, t & 0x7fffffffu, id, name, 0);
    if (!(n & 0x80000000u)) return 0;
    uint32_t l = res_dir(base, n & 0x7fffffffu, 0, 0, 1);
    if (!l || (l & 0x80000000u)) return 0;
    uint32_t e = base + l;
    if (size) *size = x86_rd32(e + 4);
    return m->base + x86_rd32(e);
}
uint32_t w32_res_find(uint32_t hmod, uint32_t type, uint32_t name_or_id, int name_wide, uint32_t *size) {
    if (name_or_id < 0x10000u) return res_lookup(hmod, type, name_or_id, 0, size);
    char buf[64];
    w32_gstr(name_or_id, name_wide, buf, sizeof buf);
    if (buf[0] == '#') { uint32_t v = 0; for (char *c = buf + 1; *c >= '0' && *c <= '9'; c++) v = v * 10 + (uint32_t)(*c - '0'); return res_lookup(hmod, type, v, 0, size); }
    return res_lookup(hmod, type, 0, buf, size);
}
uint32_t w32_res_find_str(uint32_t hmod, uint32_t type, const char *name, uint32_t *size) { return res_lookup(hmod, type, 0, name, size); }

int32_t w32_load_string(uint32_t hmod, uint32_t id, char *dst, uint32_t cap) {
    uint32_t sz, b = res_lookup(hmod, 6, (id >> 4) + 1, 0, &sz);
    if (!b || !cap) { if (cap) dst[0] = 0; return 0; }
    uint32_t p = b;
    for (uint32_t i = 0; i < 16 && p + 2 <= b + sz; i++) {
        uint32_t n = x86_rd16(p);
        p += 2;
        if (i == (id & 15u)) return (int32_t)w32_gstrn(p, (int32_t)n, 1, dst, cap);
        p += 2 * n;
    }
    dst[0] = 0;
    return 0;
}

/* ------------------------------------------------------------------ thunks + API dispatch */
typedef struct { char dll[32]; char name[48]; const w32_api_t *api; uint32_t hits; } slot_t;
static slot_t *slots;
static uint32_t nslots;

const w32_api_t *w32_find_api(const char *name);
static const w32_api_t *find_api(const char *name) { return w32_find_api(name); }
const w32_api_t *w32_find_api(const char *name) {
    const w32_api_t *tabs[3] = {w32_api_kernel, w32_api_user, w32_api_gdi};
    const uint32_t ns[3] = {w32_api_kernel_n, w32_api_user_n, w32_api_gdi_n};
    for (int t = 0; t < 3; t++)
        for (uint32_t i = 0; i < ns[t]; i++) {
            const char *a = tabs[t][i].name, *b = name;
            while (*a && *a == *b) { a++; b++; }
            if (!*a && !*b) return &tabs[t][i];
        }
    return 0;
}

uint32_t w32_thunk_for(const char *dll, const char *name) {
    for (uint32_t i = 0; i < nslots; i++) {
        const char *a = slots[i].name, *b = name;
        while (*a && *a == *b) { a++; b++; }
        if (!*a && !*b) return W32_THUNK_LO + 16u * i;
    }
    if (nslots >= W32_THUNK_SLOTS) x86_fault("too many imports", 0);
    slot_t *s = &slots[nslots];
    uint32_t i = 0;
    for (; dll[i] && i < 31; i++) s->dll[i] = dll[i];
    s->dll[i] = 0;
    for (i = 0; name[i] && i < 47; i++) s->name[i] = name[i];
    s->name[i] = 0;
    s->api = find_api(s->name);
    return W32_THUNK_LO + 16u * nslots++;
}

uint32_t w32_data_import(const char *name);
uint32_t w32_resolve_api(const char *dll, const char *name) {
    const w32_api_t *api = w32_find_api(name);
    if (!api) return 0;
    if (w32_is_pixel_read_api(name)) w32_rp_enable(); /* late: surfaces drawn before now have unknown history */
    return api->nargs == 255 ? w32_data_import(name) : w32_thunk_for(dll, name);
}
static uint32_t export_forward(const char *fwd, uint32_t depth) {
    char dll[64], fn[64];
    uint32_t k = 0, dot = 0;
    for (uint32_t i = 0; fwd[i]; i++) if (fwd[i] == '.') dot = i;
    if (!dot || depth > 4) return 0;
    for (; k < dot && k < 59; k++) dll[k] = fwd[k];
    dll[k] = 0;
    w32_module_name(dll, dll, sizeof dll);
    for (k = 0; fwd[dot + 1 + k] && k < 63; k++) fn[k] = fwd[dot + 1 + k];
    fn[k] = 0;
    uint32_t ord = 0;
    if (fn[0] == '#') for (const char *c = fn + 1; *c >= '0' && *c <= '9'; c++) ord = ord * 10 + (uint32_t)(*c - '0');
    for (uint32_t i = 0; i < w32_nmods; i++)
        if (w32_streqi(w32_mods[i].name, dll)) return w32_export_addr(&w32_mods[i], ord ? 0 : fn, ord);
    if (w32_is_sys_dll(dll) && !ord) return w32_resolve_api(dll, fn);
    return 0;
}

static void note_stub(const char *name) {
    for (uint32_t i = 0; i < w32_m.stubs_distinct && i < 24; i++) {
        const char *a = w32_m.stubs[i], *b = name;
        while (*a && *a == *b) { a++; b++; }
        if (!*a && !*b) return;
    }
    if (w32_m.stubs_distinct < 24) {
        uint32_t k = 0;
        for (; name[k] && k < 39; k++) w32_m.stubs[w32_m.stubs_distinct][k] = name[k];
        w32_m.stubs[w32_m.stubs_distinct][k] = 0;
    }
    w32_m.stubs_distinct++;
}

/* running hash of every API call (slot, first args, result): the differential oracle compares
 * lifted and interpreted runs of the same input through this */
static uint32_t trace_hash = 2166136261u;
static void trace(uint32_t v) { trace_hash = (trace_hash ^ v) * 16777619u; }

static int thunk_handler(uint32_t addr) {
    uint32_t i = (addr - W32_THUNK_LO) / 16u;
    slot_t *s = &slots[i];
    trace(i);
    for (uint32_t a = 0; a < 4; a++) trace(ARG(a));
    s->hits++;
    w32_m.api_calls++;
    if (!s->api) {
        /* arg count unknown: continuing would corrupt the stack */
        char msg[120];
        uint32_t n = 0;
        const char *p = "win32 profile: unimplemented API ";
        while (*p) msg[n++] = *p++;
        for (const char *q = s->dll; *q && n < 80; q++) msg[n++] = *q;
        msg[n++] = '!';
        for (const char *q = s->name; *q && n < 118; q++) msg[n++] = *q;
        msg[n] = 0;
        note_stub(s->name[0] == '#' ? msg + 33 : s->name); /* ordinals keep their DLL: "dll!#14" */
        x86_fault(msg, addr);
    }
    if (s->api->fn == 0) { /* declared stub: known signature, no behaviour */
        w32_m.stub_calls++;
        note_stub(s->name);
        X.r[EAX] = 0;
    } else {
        X.r[EAX] = s->api->fn();
    }
    trace(X.r[EAX]);
    X.eip = x86_pop();
    if (!s->api->cdecl) X.r[ESP] += 4u * s->api->nargs;
    return 0;
}

/* ------------------------------------------------------------------ image loading */
static uint8_t *file_buf;
#define FILE_BUF_BYTES (4u << 20)

static uint32_t load_image(const w32_module_cfg_t *mc, w32_module_t *m) {
    uint32_t n = w32_slen(mc->asset);
    int32_t h = bgt_asset_open(mc->asset, n);
    if (h <= 0) return 0;
    int32_t len = bgt_asset_size(h);
    if (!file_buf && !(file_buf = (uint8_t *)x86_alloc(FILE_BUF_BYTES))) { bgt_asset_close(h); return 0; }
    if (len <= 0 || (uint32_t)len > FILE_BUF_BYTES) { bgt_asset_close(h); return 0; }
    bgt_asset_read(h, file_buf, (uint32_t)len);
    bgt_asset_close(h);
    const uint8_t *d = file_buf;
#define R16(o) ((uint32_t)d[(o)] | ((uint32_t)d[(o) + 1] << 8))
#define R32(o) (R16(o) | (R16((o) + 2) << 16))
    if (len < 0x40 || d[0] != 'M' || d[1] != 'Z') return 0;
    uint32_t nt = R32(0x3c), opt = nt + 24, optsz = R16(nt + 20), nsec = R16(nt + 6);
    uint32_t pref = R32(opt + 28), size = R32(opt + 56), hdr = R32(opt + 60);
    uint32_t base = mc->base ? mc->base : pref;
    uint8_t *img = x86_map(base, size);
    if (!img) return 0;
    __builtin_memcpy(img, d, hdr < (uint32_t)len ? hdr : (uint32_t)len);
    for (uint32_t i = 0; i < nsec; i++) {
        uint32_t s = opt + optsz + 40 * i, vsz = R32(s + 8), va = R32(s + 12), rsz = R32(s + 16), raw = R32(s + 20);
        uint32_t c = rsz < vsz || !vsz ? rsz : vsz;
        if (raw + c > (uint32_t)len) c = raw < (uint32_t)len ? (uint32_t)len - raw : 0;
        if (va + c > size) c = va < size ? size - va : 0;
        __builtin_memcpy(img + va, d + raw, c);
    }
    uint32_t dd = opt + 96;
    /* relocations (only when loaded away from the preferred base) */
    if (base != pref) {
        uint32_t rr = R32(dd + 40), rs = R32(dd + 44), delta = base - pref;
        for (uint32_t p = rr; p + 8 <= rr + rs;) {
            uint32_t page = x86_rd32(base + p), bs = x86_rd32(base + p + 4);
            if (bs < 8) break;
            for (uint32_t k = 8; k + 2 <= bs; k += 2) {
                uint32_t e = x86_rd16(base + p + k);
                if ((e >> 12) == 3) x86_wr32(base + page + (e & 0xfff), x86_rd32(base + page + (e & 0xfff)) + delta);
            }
            p += bs;
        }
    }
    uint32_t i = 0;
    for (; mc->name[i] && i < 31; i++) m->name[i] = mc->name[i];
    m->name[i] = 0;
    m->base = base; m->size = size;
    m->entry = R32(opt + 16) ? base + R32(opt + 16) : 0;
    m->is_dll = (R16(nt + 22) & 0x2000) != 0;
    m->export_rva = R32(dd); m->export_size = R32(dd + 4);
    m->rsrc_rva = R32(dd + 16);
#undef R16
#undef R32
    return base;
}

/* returns 0 when the module imports a DLL that is neither shipped nor implemented by the profile */
static int bind_imports(w32_module_t *m) {
    uint32_t nt = x86_rd32(m->base + 0x3c), dd = m->base + nt + 24 + 96;
    uint32_t imp = x86_rd32(dd + 8);
    if (!imp) return 1;
    char dll[64], name[64];
    for (uint32_t de = m->base + imp;; de += 20) {
        uint32_t ilt = x86_rd32(de), nm = x86_rd32(de + 12), iat = x86_rd32(de + 16);
        if (!nm && !iat) break;
        w32_gstr(m->base + nm, 0, dll, sizeof dll);
        w32_module_t *target = 0;
        for (uint32_t k = 0; k < w32_nmods; k++) if (w32_streqi(w32_mods[k].name, dll)) target = &w32_mods[k];
        if (!target && !w32_sysdll_handle(dll, 1)) {
            char msg[160];
            uint32_t n = 0;
            for (const char *q = m->name; *q && n < 40; q++) msg[n++] = *q;
            for (const char *q = " imports "; *q; q++) msg[n++] = *q;
            for (const char *q = dll; *q && n < 100; q++) msg[n++] = *q;
            for (const char *q = ": neither a pipeline module nor a profile DLL"; *q && n < 159; q++) msg[n++] = *q;
            msg[n] = 0;
            w32_logf2("win32 profile: cannot start: ", msg);
            return 0;
        }
        uint32_t lt = m->base + (ilt ? ilt : iat);
        for (uint32_t k = 0;; k++) {
            uint32_t ent = x86_rd32(lt + 4 * k);
            if (!ent) break;
            uint32_t ord = 0;
            if (ent & 0x80000000u) { /* by ordinal: keep the number in the name ("#14") */
                ord = ent & 0xffffu;
                char t[8]; int tn = 0; uint32_t v = ord;
                do { t[tn++] = (char)('0' + v % 10); v /= 10; } while (v);
                uint32_t q = 0;
                name[q++] = '#';
                while (tn) name[q++] = t[--tn];
                name[q] = 0;
            }
            else w32_gstr(m->base + ent + 2, 0, name, sizeof name);
            uint32_t addr = 0;
            if (target) {
                addr = w32_export_addr(target, ord ? 0 : name, ord);
                if (!addr) { w32_logf2("win32 profile: missing export ", name); addr = w32_thunk_for(dll, name); }
            } else {
                const w32_api_t *api = find_api(name);
                addr = api && api->nargs == 255 ? w32_data_import(name) : w32_thunk_for(dll, name);
            }
            x86_wr32(m->base + iat + 4 * k, addr);
        }
    }
    return 1;
}

static void setup_teb(void) {
    x86_map(W32_TEB, 0x2000);
    x86_wr32(W32_TEB + 0x00, 0xffffffffu); /* SEH chain end */
    x86_wr32(W32_TEB + 0x04, W32_STACK_HI);
    x86_wr32(W32_TEB + 0x08, W32_STACK_LO);
    x86_wr32(W32_TEB + 0x18, W32_TEB);
    x86_wr32(W32_TEB + 0x20, 1); /* pid */
    x86_wr32(W32_TEB + 0x24, 1); /* tid */
    x86_wr32(W32_TEB + 0x30, W32_PEB);
    for (uint32_t i = 0; i < w32_nmods; i++) if (!w32_mods[i].is_dll) x86_wr32(W32_PEB + 8, w32_mods[i].base);
    X.fs_base = W32_TEB;
}

int32_t w32_boot(const w32_config_t *c, bgt_io_t *io) {
    cfg = c;
    w32_io = io;
    slots = (slot_t *)x86_alloc(W32_THUNK_SLOTS * sizeof(slot_t));
    if (!slots || !x86_map(W32_THUNK_LO, W32_THUNK_HI - W32_THUNK_LO) || !x86_map(W32_MISC, W32_MISC_SIZE)) return BGT_E_LIMIT;
    if (!x86_map(W32_STACK_LO, W32_STACK_HI - W32_STACK_LO)) return BGT_E_LIMIT;
    x86_set_thunks(W32_THUNK_LO, W32_THUNK_HI, thunk_handler);
    for (uint32_t i = 0; i < c->nmodules && i < NMOD; i++) {
        if (!load_image(&c->modules[i], &w32_mods[w32_nmods])) { w32_logf2("win32 profile: cannot load ", c->modules[i].asset); return BGT_E_NOT_FOUND; }
        w32_nmods++;
    }
    for (uint32_t i = 0; i < w32_nmods; i++) if (!bind_imports(&w32_mods[i])) return BGT_E_NOT_FOUND;
    /* one registry over all modules' lifted functions (each table is sorted; merge them) */
    uint32_t total = 0;
    for (uint32_t i = 0; i < c->nmodules; i++) total += c->modules[i].nlifted;
    x86_lifted_entry_t *all = (x86_lifted_entry_t *)x86_alloc((total ? total : 1) * sizeof(x86_lifted_entry_t));
    uint32_t n = 0;
    for (uint32_t i = 0; i < c->nmodules; i++)
        for (uint32_t k = 0; k < c->modules[i].nlifted; k++) all[n++] = c->modules[i].lifted[k];
    for (uint32_t i = 1; i < n; i++) { /* insertion sort: modules occupy disjoint ranges, so this is cheap */
        x86_lifted_entry_t t = all[i];
        uint32_t j = i;
        while (j > 0 && all[j - 1].addr > t.addr) { all[j] = all[j - 1]; j--; }
        all[j] = t;
    }
    x86_register_lifted(all, n);
    /* pixel reads are answered by CPU replay of the recorded GDI ops; record only if some module can read */
    for (uint32_t i = 0; i < nslots; i++) if (w32_is_pixel_read_api(slots[i].name)) w32_rp_enable();
    setup_teb();
    X.r[ESP] = W32_STACK_HI - 64;
    X.r[EBP] = 0;
    w32_gdi_init();
    w32_user_init();
    io->logical_width = (uint32_t)(c->default_w > 0 ? c->default_w : 640);
    io->logical_height = (uint32_t)(c->default_h > 0 ? c->default_h : 480);
    return BGT_OK;
}

void w32_wait_frame(void) {
    w32_m.yields++;
    bgt_yield();
    if (w32_io->events & BGT_EVENT_TARGETS_LOST) { w32_m.targets_lost++; w32_gdi_targets_lost(); w32_user_targets_lost(); }
    w32_user_pump_input();
    w32_user_fire_timers();
}

#define RET_SENTINEL 0xfffffff4u
void w32_update(void) {
    if (started) return; /* the guest lives inside bgt_yield from here on */
    started = 1;
    /* DLL entry points first (DLL_PROCESS_ATTACH), then the program */
    for (uint32_t i = 0; i < w32_nmods; i++) {
        if (!w32_mods[i].is_dll || !w32_mods[i].entry) continue;
        uint32_t args[3] = {w32_mods[i].base, 1, 0};
        x86_callback(w32_mods[i].entry, 3, args);
    }
    w32_module_t *mainm = w32_mod_by_handle(0);
    if (!mainm || !mainm->entry) x86_fault("no program entry point", 0);
    x86_push(RET_SENTINEL);
    x86_invoke(mainm->entry, RET_SENTINEL);
    /* the program returned from its entry point */
    w32_exited = 1;
    w32_log("win32 profile: program returned from its entry point");
    for (;;) w32_wait_frame();
}

void w32_render(void) { w32_gdi_flush_and_present(); }

/* ------------------------------------------------------------------ metrics / debug */
static char json[4096];
static uint32_t jn;
static void jput(const char *s) { while (*s && jn + 1 < sizeof json) json[jn++] = *s++; }
static void jnum(uint64_t v) {
    char t[24]; int n = 0;
    do { t[n++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (n && jn + 1 < sizeof json) json[jn++] = t[--n];
}
static void jkv(const char *k, uint64_t v) { jput("\""); jput(k); jput("\":"); jnum(v); jput(","); }

const char *w32_metrics_json(void) {
    jn = 0;
    jput("{\"platform\":\"win32\",");
    jkv("lifted_functions", x86_metrics.lifted_functions);
    jkv("lifted_calls", x86_metrics.lifted_calls);
    jkv("interp_insns", x86_metrics.interp_insns);
    jkv("interp_code_entries", x86_metrics.interp_code_entries);
    jkv("generic_insn_execs", x86_metrics.generic_insn_execs);
    jkv("tail_calls_lifted", x86_metrics.tail_calls_lifted);
    jkv("continues_interpreted", x86_metrics.continues_interpreted);
    jkv("api_calls", w32_m.api_calls);
    jkv("imports_bound", nslots);
    jkv("stub_calls", w32_m.stub_calls);
    jkv("gdi_ops", w32_m.gdi_ops);
    jkv("gdi_approx_rop", w32_m.gdi_approx_rop);
    jkv("gdi_unsupported", w32_m.gdi_unsupported);
    jkv("gdi_pixel_reads", w32_m.gdi_pixel_reads);
    jkv("gdi_cpu_replays", w32_m.gdi_cpu_replays);
    jkv("gdi_replay_compactions", w32_m.gdi_replay_compactions);
    jkv("gdi_getpixel_noread", w32_m.gdi_getpixel_noread);
    jkv("pixel_replay", (uint64_t)w32_rp_enabled());
    jkv("mono_color_blits", w32_m.mono_color_blits);
    jkv("messages", w32_m.messages);
    jkv("paints", w32_m.paints);
    jkv("timers_fired", w32_m.timers_fired);
    jkv("yields", w32_m.yields);
    jkv("peek_yields", w32_m.peek_yields);
    jkv("targets_lost", w32_m.targets_lost);
    jkv("exited", (uint64_t)w32_exited);
    jkv("trace_hash", trace_hash);
    jput("\"stubs\":[");
    for (uint32_t i = 0; i < w32_m.stubs_distinct && i < 24; i++) { if (i) jput(","); jput("\""); jput(w32_m.stubs[i]); jput("\""); }
    jput("],\"apis_hit\":[");
    int first = 1;
    for (uint32_t i = 0; i < nslots; i++) {
        if (!slots[i].hits) continue;
        if (!first) jput(",");
        first = 0;
        jput("\""); jput(slots[i].name); jput("\"");
    }
    jput("]}");
    json[jn] = 0;
    return json;
}

/* deterministic state: the API-call trace (what the program asked the platform to do) */
uint32_t w32_state_hash(void) { return trace_hash; }

/* ------------------------------------------------------------------ debug JSON */
void wj_raw(w32_json_t *j, const char *s) { while (*s && j->n + 1 < j->cap) j->b[j->n++] = *s++; }
void wj_str(w32_json_t *j, const char *s) {
    static const char hex[] = "0123456789abcdef";
    wj_raw(j, "\"");
    for (; *s && j->n + 8 < j->cap; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { j->b[j->n++] = '\\'; j->b[j->n++] = (char)c; }
        else if (c < 0x20 || c >= 0x7f) { wj_raw(j, "\\u00"); j->b[j->n++] = hex[c >> 4]; j->b[j->n++] = hex[c & 15u]; }
        else j->b[j->n++] = (char)c;
    }
    wj_raw(j, "\"");
}
void wj_int(w32_json_t *j, int64_t v) {
    char t[24]; int n = 0;
    uint64_t u = v < 0 ? (uint64_t)(-v) : (uint64_t)v;
    do { t[n++] = (char)('0' + u % 10); u /= 10; } while (u);
    if (v < 0 && j->n + 1 < j->cap) j->b[j->n++] = '-';
    while (n && j->n + 1 < j->cap) j->b[j->n++] = t[--n];
}
void wj_rect(w32_json_t *j, int32_t x, int32_t y, int32_t w, int32_t h) {
    wj_raw(j, "["); wj_int(j, x); wj_raw(j, ","); wj_int(j, y); wj_raw(j, ","); wj_int(j, w); wj_raw(j, ","); wj_int(j, h); wj_raw(j, "]");
}

/* debugState: the metrics plus read-only views a test may use to drive the program through real input
 * (UI layout) and to locate guest data for __BGT_TEST__.peek (module bases). Never a way to change state. */
const char *w32_debug_json(void) {
    static w32_json_t j;
    if (!j.b) { j.cap = 64u << 10; j.b = (char *)x86_alloc(j.cap); if (!j.b) return w32_metrics_json(); }
    j.n = 0;
    const char *m = w32_metrics_json();
    uint32_t mn = w32_slen(m);
    for (uint32_t i = 0; i + 1 < mn && j.n + 1 < j.cap; i++) j.b[j.n++] = m[i]; /* metrics object without its '}' */
    wj_raw(&j, ",\"modules\":[");
    for (uint32_t i = 0; i < w32_nmods; i++) {
        if (i) wj_raw(&j, ",");
        wj_raw(&j, "{\"name\":"); wj_str(&j, w32_mods[i].name);
        wj_raw(&j, ",\"base\":"); wj_int(&j, w32_mods[i].base);
        wj_raw(&j, ",\"size\":"); wj_int(&j, w32_mods[i].size); wj_raw(&j, "}");
    }
    wj_raw(&j, "],\"ui\":");
    w32_user_debug_ui(&j);
    wj_raw(&j, "}");
    j.b[j.n] = 0;
    return j.b;
}
