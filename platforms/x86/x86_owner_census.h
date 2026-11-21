/* K51 owner census: exact retired guest instructions per lifted-function owner (opt-in,
 * BGT_OWNER_CENSUS=1 -> X86_OWNER_CENSUS=1, requires exact accounting). Included once by x86_rt.c
 * after the code-range tables. Default builds compile none of this. SPDX-License-Identifier: MIT */
#if X86_OWNER_CENSUS
typedef struct { uint32_t owner, used; uint64_t n[XR_KINDS], base[XR_KINDS]; } xoc_row_t;
static xoc_row_t xoc_rows[X86_OWNER_CENSUS_CAP];
static uint32_t xoc_used;
static uint64_t xoc_unattributed, xoc_unattributed_base, xoc_frames_dropped;
static x86_census_frame_t xoc_frames[X86_OWNER_CENSUS_FRAMES];
static uint32_t xoc_frame_length, xoc_frame_next;
static uint32_t xoc_row(uint32_t owner) {
    uint32_t h = (owner * 2654435761u) & (X86_OWNER_CENSUS_CAP - 1);
    for (uint32_t i = 0; i < X86_OWNER_CENSUS_CAP; i++, h = (h + 1) & (X86_OWNER_CENSUS_CAP - 1)) {
        if (xoc_rows[h].used) { if (xoc_rows[h].owner == owner) return h + 1; continue; }
        if (xoc_used >= X86_OWNER_CENSUS_CAP / 4 * 3) return 0; /* bounded: excess is unattributed, never dropped */
        xoc_rows[h].used = 1; xoc_rows[h].owner = owner; xoc_used++; return h + 1;
    }
    return 0;
}
/* Rows are never removed, so a cached slot only needs an owner check. */
void x86_census_add(uint32_t *slot, uint32_t owner, unsigned kind, uint64_t n) {
    uint32_t s = *slot;
    if (!s || xoc_rows[s - 1].owner != owner) { s = xoc_row(owner); *slot = s; }
    if (s) xoc_rows[s - 1].n[kind] += n; else xoc_unattributed += n;
}
/* Generic/interpreted retirement: the owner is the analyzed function whose range holds the address. */
static void xoc_at(uint32_t address, unsigned kind) {
    static uint32_t slot, owner = X86_OWNER_UNOWNED; static uint64_t lo = 1, hi = 0;
    if (address < lo || address >= hi) {
        uint32_t a = 0, b = ncode_ranges;
        while (a < b) { uint32_t m = (a + b) / 2; if (code_ranges[m].addr <= address) a = m + 1; else b = m; }
        const x86_code_range_t *r = a && address < code_ranges[a - 1].end ? &code_ranges[a - 1] : 0;
        owner = r ? (code_owner_addresses ? code_owner_addresses[r->owner] : r->addr) : X86_OWNER_UNOWNED;
        lo = r ? r->addr : a ? code_ranges[a - 1].end : 0;
        hi = r ? r->end : a < ncode_ranges ? code_ranges[a].addr : 0x100000000ull;
    }
    x86_census_add(&slot, owner, kind, 1);
}
static uint64_t xoc_sum(const uint64_t *n) { uint64_t s = 0; for (unsigned k = 0; k < XR_KINDS; k++) s += n[k]; return s; }
/* Deterministic order: more instructions first, then lower owner address. */
static void xoc_insert(x86_census_top_t *top, uint32_t *count, uint32_t cap, uint32_t owner, const uint64_t *n) {
    uint64_t total = xoc_sum(n); uint32_t at = *count;
    while (at && (xoc_sum(top[at - 1].instructions) < total ||
        (xoc_sum(top[at - 1].instructions) == total && top[at - 1].owner > owner))) at--;
    if (at >= cap) return;
    uint32_t last = *count < cap ? *count : cap - 1;
    for (uint32_t i = last; i > at; i--) top[i] = top[i - 1];
    top[at].owner = owner; for (unsigned k = 0; k < XR_KINDS; k++) top[at].instructions[k] = n[k];
    if (*count < cap) (*count)++;
}
/* Called at every native guest present (GDI or SwapBuffers): one wholly-contained frame interval. */
void x86_census_present(uint64_t present) {
    x86_census_frame_t *f = &xoc_frames[xoc_frame_next];
    __builtin_memset(f, 0, sizeof *f); f->present = present;
    for (uint32_t i = 0; i < X86_OWNER_CENSUS_CAP; i++) {
        xoc_row_t *r = &xoc_rows[i]; if (!r->used) continue;
        uint64_t d[XR_KINDS];
        for (unsigned k = 0; k < XR_KINDS; k++) { d[k] = r->n[k] - r->base[k]; r->base[k] = r->n[k]; }
        uint64_t sum = xoc_sum(d); if (!sum) continue;
        f->total += sum; f->active++;
        xoc_insert(f->top, &f->count, X86_OWNER_CENSUS_TOP, r->owner, d);
    }
    f->unattributed = xoc_unattributed - xoc_unattributed_base; xoc_unattributed_base = xoc_unattributed;
    xoc_frame_next = (xoc_frame_next + 1) % X86_OWNER_CENSUS_FRAMES;
    if (xoc_frame_length < X86_OWNER_CENSUS_FRAMES) xoc_frame_length++; else xoc_frames_dropped++;
}
uint32_t x86_census_rows(void) { return xoc_used; }
uint64_t x86_census_unattributed(void) { return xoc_unattributed; }
uint32_t x86_census_cumulative(x86_census_top_t *top, uint32_t cap, uint64_t *total) {
    uint32_t count = 0; *total = 0;
    for (uint32_t i = 0; i < X86_OWNER_CENSUS_CAP; i++) if (xoc_rows[i].used) {
        uint64_t sum = xoc_sum(xoc_rows[i].n); if (!sum) continue;
        *total += sum; xoc_insert(top, &count, cap, xoc_rows[i].owner, xoc_rows[i].n);
    }
    return count;
}
uint32_t x86_census_frame_count(void) { return xoc_frame_length; }
uint64_t x86_census_frames_dropped(void) { return xoc_frames_dropped; }
const x86_census_frame_t *x86_census_frame(uint32_t i) {
    if (i >= xoc_frame_length) return 0;
    return &xoc_frames[((xoc_frame_length == X86_OWNER_CENSUS_FRAMES ? xoc_frame_next : 0) + i) % X86_OWNER_CENSUS_FRAMES];
}
#define XOC_AT(address, kind) xoc_at((address), (kind))
#else
#define XOC_AT(address, kind) ((void)0)
#endif
