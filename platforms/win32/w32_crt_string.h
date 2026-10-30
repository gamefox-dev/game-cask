/* String, memory and numeric-conversion bridges. MIT. */
static uint64_t c_malloc(void) {
    if (ARG64(0) > UINT32_MAX) { crt_errno(12); return 0; }
    uint32_t p = w32_heap_alloc(ARG(0), 0);
    if (!p) crt_errno(12);
    return p;
}
static uint64_t c_calloc(void) {
    uint64_t a = ARG64(0), b = ARG64(1);
    if (b && a > UINT32_MAX / b) { crt_errno(12); return 0; }
    uint32_t p = w32_heap_alloc((uint32_t)(a * b), 1);
    if (!p) crt_errno(12);
    return p;
}
static uint64_t c_realloc(void) {
    if (!ARG64(1)) { w32_heap_free(ARG(0)); return 0; }
    if (ARG64(1) > UINT32_MAX) { crt_errno(12); return 0; }
    uint32_t p = w32_heap_realloc(ARG(0), ARG(1));
    if (!p) crt_errno(12);
    return p;
}
static uint64_t c_free(void) { w32_heap_free(ARG(0)); return 0; }
static uint64_t c_msize(void) { return w32_heap_size(ARG(0)); }
static uint64_t c_aligned_malloc(void) {
    uint64_t n = ARG64(0), a = ARG64(1);
    if (!a || (a & (a - 1))) { crt_errno(22); return 0; }
    if (a < 8) a = 8;
    if (n > UINT32_MAX - 8 || a > UINT32_MAX - n - 8) { crt_errno(12); return 0; }
    uint32_t p = w32_heap_alloc((uint32_t)(n + a + 8), 0);
    if (!p) { crt_errno(12); return 0; }
    uint32_t q = (p + 8 + (uint32_t)a - 1) & ~((uint32_t)a - 1);
    x86_wr64(q - 8, p);
    return q;
}
static uint64_t c_aligned_free(void) {
    if (ARG(0)) w32_heap_free(cp(x86_rd64(ARG(0) - 8)));
    return 0;
}
static uint64_t c_memset(void) {
    if (ARG64(2) > UINT32_MAX) x86_fault("CRT memory size overflow", X.eip);
    if (ARG(2)) memset(cmem(ARG(0), ARG(2)), (int)ARG(1), ARG(2));
    return ARG64(0);
}
static uint64_t c_memcpy(void) {
    if (ARG64(2) > UINT32_MAX) x86_fault("CRT memory size overflow", X.eip);
    if (ARG(2)) memmove(cmem(ARG(0), ARG(2)), cmem(ARG(1), ARG(2)), ARG(2));
    return ARG64(0);
}
static uint64_t c_memcmp(void) {
    return ARG(2) ? (uint64_t)(int64_t)memcmp(cmem(ARG(0), ARG(2)), cmem(ARG(1), ARG(2)), ARG(2)) : 0;
}
static uint64_t c_memchr(void) {
    if (!ARG(2)) return 0;
    uint8_t *p = memchr(cmem(ARG(0), ARG(2)), (int)ARG(1), ARG(2));
    return p ? (uint32_t)(p - x86_flat) : 0;
}
static unsigned sch(uint32_t p, unsigned wide) { return wide ? x86_rd16(p) : x86_rd8(p); }
static void swr(uint32_t p, unsigned wide, unsigned c) {
    if (wide) x86_wr16(p, c); else x86_wr8(p, c);
}
static uint32_t slen(uint32_t p, unsigned wide) {
    uint32_t n = 0, step = wide ? 2 : 1;
    while (sch(p + step * n, wide)) n++;
    return n;
}
static uint64_t str_len(unsigned wide) { return slen(ARG(0), wide); }
static uint64_t str_copy(unsigned wide, int bounded, int cat) {
    uint32_t d = ARG(0), s = ARG(1), step = wide ? 2 : 1;
    uint32_t n = bounded ? ARG(2) : UINT32_MAX;
    if (cat) d += step * slen(d, wide);
    uint32_t i = 0;
    for (; i < n; i++) {
        unsigned ch = sch(s + step * i, wide);
        swr(d + step * i, wide, ch);
        if (!ch) break;
    }
    if (cat) swr(d + step * i, wide, 0);
    else if (bounded) for (; i < n; i++) swr(d + step * i, wide, 0);
    return ARG64(0);
}
static uint64_t str_cmp(unsigned wide, int bounded, int fold) {
    uint32_t n = bounded ? ARG(2) : UINT32_MAX, step = wide ? 2 : 1;
    for (uint32_t i = 0; i < n; i++) {
        unsigned a = sch(ARG(0) + step * i, wide), b = sch(ARG(1) + step * i, wide);
        if (fold) { if (a < 128) a = (unsigned)tolower((int)a); if (b < 128) b = (unsigned)tolower((int)b); }
        if (a != b) return (uint64_t)(int64_t)((int)a - (int)b);
        if (!a) break;
    }
    return 0;
}
static uint64_t str_chr(unsigned wide, int last) {
    uint32_t p = ARG(0), step = wide ? 2 : 1, result = 0;
    unsigned target = ARG(1) & (wide ? 65535 : 255);
    for (;;) {
        unsigned ch = sch(p, wide);
        if (ch == target) { result = p; if (!last) return p; }
        if (!ch) return result;
        p += step;
    }
}
static uint64_t str_span(unsigned wide, int reject, int find) {
    uint32_t p = ARG(0), set = ARG(1), step = wide ? 2 : 1, n = 0;
    while (sch(p + n * step, wide)) {
        unsigned ch = sch(p + n * step, wide);
        int member = 0;
        for (uint32_t s = set; sch(s, wide); s += step) if (sch(s, wide) == ch) { member = 1; break; }
        if (find && member) return p + n * step;
        if (!find && member == reject) break;
        n++;
    }
    return find ? 0 : n;
}
static uint64_t str_str(unsigned wide) {
    uint32_t step = wide ? 2 : 1, s = ARG(0), sub = ARG(1);
    for (;; s += step) {
        uint32_t n = 0;
        while (sch(sub + n, wide) && sch(s + n, wide) == sch(sub + n, wide)) n += step;
        if (!sch(sub + n, wide)) return s;
        if (!sch(s, wide)) return 0;
    }
}
#define STRING_FUNCS(prefix, wide) \
    static uint64_t c_##prefix##len(void) { return str_len(wide); } \
    static uint64_t c_##prefix##cpy(void) { return str_copy(wide, 0, 0); } \
    static uint64_t c_##prefix##ncpy(void) { return str_copy(wide, 1, 0); } \
    static uint64_t c_##prefix##cat(void) { return str_copy(wide, 0, 1); } \
    static uint64_t c_##prefix##ncat(void) { return str_copy(wide, 1, 1); } \
    static uint64_t c_##prefix##cmp(void) { return str_cmp(wide, 0, 0); } \
    static uint64_t c_##prefix##ncmp(void) { return str_cmp(wide, 1, 0); } \
    static uint64_t c_##prefix##icmp(void) { return str_cmp(wide, 0, 1); } \
    static uint64_t c_##prefix##nicmp(void) { return str_cmp(wide, 1, 1); } \
    static uint64_t c_##prefix##chr(void) { return str_chr(wide, 0); } \
    static uint64_t c_##prefix##rchr(void) { return str_chr(wide, 1); } \
    static uint64_t c_##prefix##str(void) { return str_str(wide); } \
    static uint64_t c_##prefix##spn(void) { return str_span(wide, 0, 0); } \
    static uint64_t c_##prefix##cspn(void) { return str_span(wide, 1, 0); } \
    static uint64_t c_##prefix##pbrk(void) { return str_span(wide, 0, 1); }
STRING_FUNCS(str, 0)
STRING_FUNCS(wcs, 1)
#undef STRING_FUNCS
static uint64_t c_strdup(void) {
    uint32_t n = slen(ARG(0), 0) + 1, p = w32_heap_alloc(n, 0);
    if (p) memcpy(cmem(p, n), cmem(ARG(0), n), n); else crt_errno(12);
    return p;
}
static uint64_t c_wcsdup(void) {
    uint32_t n = 2 * (slen(ARG(0), 1) + 1), p = w32_heap_alloc(n, 0);
    if (p) memcpy(cmem(p, n), cmem(ARG(0), n), n); else crt_errno(12);
    return p;
}
static uint64_t c_wmemcpy(void) {
    uint64_t n = ARG64(2) * 2;
    if (n > UINT32_MAX) x86_fault("CRT wide memory size overflow", X.eip);
    if (n) memmove(cmem(ARG(0), (uint32_t)n), cmem(ARG(1), (uint32_t)n), (size_t)n);
    return ARG64(0);
}
static uint64_t c_wmemset(void) {
    for (uint32_t i = 0; i < ARG(2); i++) x86_wr16(ARG(0) + 2 * i, ARG(1));
    return ARG64(0);
}
static uint64_t c_wmemcmp(void) {
    for (uint32_t i = 0; i < ARG(2); i++) {
        unsigned a = x86_rd16(ARG(0) + 2 * i), b = x86_rd16(ARG(1) + 2 * i);
        if (a != b) return (uint64_t)(int64_t)((int)a - (int)b);
    }
    return 0;
}
static uint64_t convert_int(int bits, int unsign, int wide, int base_arg) {
    char *s, *end, *copy = 0;
    if (wide) {
        uint32_t n = slen(ARG(0), 1);
        copy = malloc(n + 1);
        if (!copy) { crt_errno(12); return 0; }
        for (uint32_t i = 0; i <= n; i++) {
            unsigned ch = x86_rd16(ARG(0) + 2 * i);
            copy[i] = ch < 128 ? (char)ch : '?';
        }
        s = copy;
    } else s = cstr(ARG(0));
    int base = base_arg ? (int)ARG(2) : 10;
    errno = 0;
    uint64_t result;
    if (bits == 32) result = unsign ? (uint32_t)strtoul(s, &end, base) : (uint64_t)(int64_t)strtol(s, &end, base);
    else result = unsign ? strtoull(s, &end, base) : (uint64_t)strtoll(s, &end, base);
    if (base_arg && ARG(1)) x86_wr64(ARG(1), ARG(0) + (uint32_t)(end - s) * (wide ? 2 : 1));
    if (errno) crt_errno(errno == ERANGE ? 34 : 22);
    free(copy);
    return result;
}
static uint64_t convert_float(int single, int wide, int end_arg) {
    char *s, *end, *copy = 0;
    if (wide) {
        uint32_t n = slen(ARG(0), 1);
        copy = malloc(n + 1);
        if (!copy) { crt_errno(12); return rd(0); }
        for (uint32_t i = 0; i <= n; i++) {
            unsigned ch = x86_rd16(ARG(0) + 2 * i);
            copy[i] = ch < 128 ? (char)ch : '?';
        }
        s = copy;
    } else s = cstr(ARG(0));
    errno = 0;
    double result = single ? strtof(s, &end) : strtod(s, &end);
    if (end_arg && ARG(1)) x86_wr64(ARG(1), ARG(0) + (uint32_t)(end - s) * (wide ? 2 : 1));
    if (errno) crt_errno(errno == ERANGE ? 34 : 22);
    free(copy);
    return single ? rf((float)result) : rd(result);
}
static uint64_t c_strtol(void) { return convert_int(32, 0, 0, 1); }
static uint64_t c_strtoul(void) { return convert_int(32, 1, 0, 1); }
static uint64_t c_strtoll(void) { return convert_int(64, 0, 0, 1); }
static uint64_t c_strtoull(void) { return convert_int(64, 1, 0, 1); }
static uint64_t c_wcstol(void) { return convert_int(32, 0, 1, 1); }
static uint64_t c_wcstoul(void) { return convert_int(32, 1, 1, 1); }
static uint64_t c_wcstoll(void) { return convert_int(64, 0, 1, 1); }
static uint64_t c_wcstoull(void) { return convert_int(64, 1, 1, 1); }
static uint64_t c_atoi(void) { return convert_int(32, 0, 0, 0); }
static uint64_t c_atoll(void) { return convert_int(64, 0, 0, 0); }
static uint64_t c_strtod(void) { return convert_float(0, 0, 1); }
static uint64_t c_strtof(void) { return convert_float(1, 0, 1); }
static uint64_t c_wcstod(void) { return convert_float(0, 1, 1); }
static uint64_t c_wcstof(void) { return convert_float(1, 1, 1); }
static uint64_t c_atof(void) { return convert_float(0, 0, 0); }
