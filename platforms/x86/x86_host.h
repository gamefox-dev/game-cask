/* Shared bounded host span allocator. Included once by x86_rt.c after x86_host_backing.
 * No libc allocation or logging: failure reporting must work even when CRT formatting cannot.
 * SPDX-License-Identifier: MIT */
typedef union XhBlock XhBlock;
union XhBlock { struct { XhBlock *next; uint32_t size, consumer; } h; uint64_t align[2]; };
_Static_assert(sizeof(XhBlock) == 16, "host allocation header");
static XhBlock *xh_pool;
x86_host_stats_t x86_host_stats[XH_COUNT];
uint64_t x86_host_used, x86_host_peak, x86_host_reserved;
const char *x86_host_consumer(unsigned c) {
    static const char *const names[XH_COUNT] = {"runtime", "gl", "crt", "file"};
    return c < XH_COUNT ? names[c] : "invalid";
}
static void xh_text(char **p, const char *s) { while (*s) *(*p)++ = *s++; }
static void xh_number(char **p, uint64_t n) {
    char b[20]; unsigned k = 0; do { b[k++] = (char)('0' + n % 10); n /= 10; } while (n);
    while (k) *(*p)++ = b[--k];
}
static void *xh_failure(unsigned c, uint64_t n) {
    x86_host_stats[c].oom++;
    char b[320], *p = b;
    xh_text(&p, "host allocation failed consumer="); xh_text(&p, x86_host_consumer(c));
    xh_text(&p, " size="); xh_number(&p, n);
    xh_text(&p, " consumer_used="); xh_number(&p, x86_host_stats[c].used);
    xh_text(&p, " used="); xh_number(&p, x86_host_used);
    xh_text(&p, " reserved="); xh_number(&p, x86_host_reserved);
    xh_text(&p, " limit="); xh_number(&p, x86_host_limit());
    bgt_log(3, b, (uint32_t)(p - b)); return 0;
}
static void xh_insert(XhBlock *b) {
    XhBlock **p = &xh_pool, *prev = 0;
    while (*p && (uintptr_t)*p < (uintptr_t)b) { prev = *p; p = &(*p)->h.next; }
    b->h.next = *p; *p = b;
    if (b->h.next && (uintptr_t)b + b->h.size == (uintptr_t)b->h.next) {
        b->h.size += b->h.next->h.size; b->h.next = b->h.next->h.next;
    }
    if (prev && (uintptr_t)prev + prev->h.size == (uintptr_t)b) {
        prev->h.size += b->h.size; prev->h.next = b->h.next;
    }
}
void *x86_host_alloc(unsigned c, uint64_t n) {
    if (c >= XH_COUNT) return 0;
    if (n > UINT32_MAX - 31u) return xh_failure(c, n);
    uint32_t need = ((uint32_t)(n ? n : 1) + 15u) / 16u * 16u + sizeof(XhBlock);
    XhBlock **best = 0;
    for (XhBlock **p = &xh_pool; *p; p = &(*p)->h.next)
        if ((*p)->h.size >= need && (!best || (*p)->h.size < (*best)->h.size)) best = p;
    if (!best) {
        uint32_t grow = need <= UINT32_MAX - 65535u ? (need + 65535u) & ~65535u : need;
        XhBlock *b = x86_host_backing(grow);
        if (!b && grow != need) { grow = need; b = x86_host_backing(grow); }
        if (!b) return xh_failure(c, n);
        b->h.size = grow; x86_host_reserved += grow; x86_host_stats[c].backing_requested += grow; xh_insert(b);
        for (XhBlock **p = &xh_pool; *p; p = &(*p)->h.next)
            if ((*p)->h.size >= need && (!best || (*p)->h.size < (*best)->h.size)) best = p;
    }
    XhBlock *b = *best; *best = b->h.next;
    if (b->h.size - need >= sizeof(XhBlock) + 16u) {
        XhBlock *tail = (XhBlock *)((uint8_t *)b + need);
        tail->h.size = b->h.size - need; b->h.size = need; xh_insert(tail);
    }
    b->h.consumer = c;
    x86_host_stats_t *s = &x86_host_stats[c]; s->used += b->h.size; s->allocations++;
    if (s->used > s->peak) s->peak = s->used;
    x86_host_used += b->h.size;
    if (x86_host_used > x86_host_peak) x86_host_peak = x86_host_used;
    void *out = b + 1; __builtin_memset(out, 0, b->h.size - sizeof *b); return out;
}
uint32_t x86_host_size(const void *p) { return p ? ((const XhBlock *)p - 1)->h.size - sizeof(XhBlock) : 0; }
void x86_host_free(void *p) {
    if (!p) return;
    XhBlock *b = (XhBlock *)p - 1;
    x86_host_stats_t *s = &x86_host_stats[b->h.consumer];
    s->used -= b->h.size; s->frees++; x86_host_used -= b->h.size; xh_insert(b);
}
void *x86_host_realloc(void *p, uint64_t n) {
    if (!p) return x86_host_alloc(XH_CRT, n);
    if (!n) { x86_host_free(p); return 0; }
    uint32_t old = x86_host_size(p);
    if (n <= old) return p;
    void *q = x86_host_alloc(((XhBlock *)p - 1)->h.consumer, n);
    if (q) { __builtin_memcpy(q, p, old); x86_host_free(p); }
    return q;
}
void *x86_alloc(uint32_t n) { return x86_host_alloc(XH_RUNTIME, n); }
