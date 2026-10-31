/* C locale handles and single-byte C encoding (not a pretend UTF-8 system locale). MIT. */
static uint64_t c_one(void) { return 1; }
static uint64_t c_codepage(void) { return 0; } /* C locale */
static uint64_t c_create_locale(void) {
    const char *name = cstr(ARG(1));
    if (*name && strcmp(name, "C") && strcmp(name, "POSIX")) { crt_errno(22); return 0; }
    uint32_t p = w32_heap_alloc(16, 1);
    if (!p) { crt_errno(12); return 0; }
    return p;
}
static uint64_t c_strxfrm(void) {
    uint32_t n = slen(ARG(1), 0), cap = ARG(2);
    if (cap) {
        uint32_t copy = n < cap ? n + 1 : cap;
        memcpy(cwmem(ARG(0), copy), cmem(ARG(1), copy), copy);
    }
    return n;
}
static uint64_t c_wcsxfrm(void) {
    uint32_t n = slen(ARG(1), 1), cap = ARG(2);
    if (cap) {
        uint32_t copy = (n < cap ? n + 1 : cap) * 2;
        memcpy(cwmem(ARG(0), copy), cmem(ARG(1), copy), copy);
    }
    return n;
}
static uint64_t c_iswctype(void) { return win_ctype((int)ARG(0)) & ARG(1); }
static uint64_t c_towlower(void) {
    unsigned c = ARG(0); return c < 128 ? (uint64_t)tolower((int)c) : c;
}
static uint64_t c_towupper(void) {
    unsigned c = ARG(0); return c < 128 ? (uint64_t)toupper((int)c) : c;
}
static uint64_t c_mbrtowc(void) {
    if (!ARG(1)) return 0;
    if (!ARG64(2)) return UINT64_MAX - 1;
    unsigned c = x86_rd8(ARG(1));
    if (c > 127) { crt_errno(42); return UINT64_MAX; }
    if (ARG(0)) x86_wr16(ARG(0), c);
    if (ARG(3)) x86_wr32(ARG(3), 0);
    return c ? 1 : 0;
}
static uint64_t c_mbtowc(void) {
    if (!ARG(1)) return 0;
    if (!ARG64(2)) return UINT64_MAX;
    unsigned c = x86_rd8(ARG(1));
    if (c > 127) { crt_errno(42); return UINT64_MAX; }
    if (ARG(0)) x86_wr16(ARG(0), c);
    return c ? 1 : 0;
}
static uint64_t c_mbrlen(void) {
    if (!ARG(0)) return 0;
    if (!ARG64(1)) return UINT64_MAX - 1;
    unsigned c = x86_rd8(ARG(0));
    if (c > 127) { crt_errno(42); return UINT64_MAX; }
    if (ARG(2)) x86_wr32(ARG(2), 0);
    return c ? 1 : 0;
}
static uint64_t c_mbsrtowcs(void) {
    uint32_t src = cp(x86_rd64(ARG(1))), dst = ARG(0), n = 0;
    uint64_t cap = dst ? ARG64(2) : UINT64_MAX;
    while (n < cap) {
        unsigned c = x86_rd8(src + n);
        if (c > 127) { crt_errno(42); return UINT64_MAX; }
        if (dst) x86_wr16(dst + n * 2, c);
        if (!c) { if (dst) x86_wr64(ARG(1), 0); return n; }
        n++;
    }
    if (dst) x86_wr64(ARG(1), src + n);
    return n;
}
static uint64_t c_wcrtomb(void) {
    if (!ARG(0)) return 1;
    unsigned c = ARG(1);
    if (c > 127) { crt_errno(42); return UINT64_MAX; }
    x86_wr8(ARG(0), c);
    if (ARG(2)) x86_wr32(ARG(2), 0);
    return 1;
}
static uint64_t c_wcrtomb_s(void) {
    if (ARG(0)) x86_wr64(ARG(0), UINT64_MAX);
    if (ARG(1) && (!ARG64(2) || ARG(3) > 127)) return 42;
    if (ARG(1)) x86_wr8(ARG(1), ARG(3));
    if (ARG(0)) x86_wr64(ARG(0), 1);
    if (ARG(4)) x86_wr32(ARG(4), 0);
    return 0;
}
static const char *errstr(unsigned e) {
    switch (e) {
    case 0: return "No error";
    case 2: return "No such file or directory";
    case 9: return "Bad file descriptor";
    case 12: return "Not enough space";
    case 13: return "Permission denied";
    case 22: return "Invalid argument";
    case 34: return "Result too large";
    case 42: return "Illegal byte sequence";
    default: return "Unknown error";
    }
}
static uint64_t c_strerror_s(void) {
    const char *s = errstr(ARG(2));
    if (!ARG(0) || !ARG64(1)) return 22;
    w32_pstr(ARG(0), ARG(1), 0, s); return 0;
}
static uint64_t c_strerror(void) {
    static uint32_t p;
    if (!p) p = w32_misc_alloc(128);
    w32_pstr(p, 128, 0, errstr(ARG(0))); return p;
}
static uint64_t c_sys_nerr(void) {
    static uint32_t p;
    if (!p) { p = w32_misc_alloc(4); x86_wr32(p, 43); }
    return p;
}
static uint64_t c_timezone(void) { return cell(48); }
static uint64_t c_daylight(void) { return cell(56); }
static uint64_t c_tzname(void) {
    uint32_t p = cell(64);
    if (!x86_rd64(p)) {
        uint32_t utc = w32_misc_alloc(8); w32_pstr(utc, 8, 0, "UTC");
        x86_wr64(p, utc); x86_wr64(p + 8, utc);
    }
    return p;
}
