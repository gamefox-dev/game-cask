/* Deterministic CRT process, callbacks, C locale and virtual UTC clock. MIT. */
uint64_t crt_callback(uint32_t fn, unsigned n, const uint64_t *args) { return x86_callback64(fn, n, args); }
static uint32_t error_cell;
uint32_t crt_errno_cell(void) {
    if (!error_cell) error_cell = w32_misc_alloc(4);
    return error_cell;
}
void crt_errno(int e) { x86_wr32(crt_errno_cell(), (uint32_t)e); }
static uint64_t c_errno(void) { return crt_errno_cell(); }
static uint64_t c_set_errno(void) { crt_errno((int)ARG(0)); return 0; }
static uint64_t c_get_errno(void) { x86_wr32(ARG(0), x86_rd32(crt_errno_cell())); return 0; }
static uint64_t c_abs(void) {
    int64_t n = (int32_t)ARG(0);
    return (uint64_t)(n < 0 ? -n : n);
}
static uint64_t c_llabs(void) {
    uint64_t n = ARG64(0);
    return n >> 63 ? 0 - n : n;
}
static uint64_t c_div(void) {
    int32_t a = (int32_t)ARG(0), b = (int32_t)ARG(1);
    if (!b || (a == INT32_MIN && b == -1)) x86_fault("CRT division overflow", X.eip);
    return (uint32_t)(a / b) | ((uint64_t)(uint32_t)(a % b) << 32);
}
static uint64_t c_lldiv(void) {
    uint32_t dst = ARG(0);
    int64_t a = (int64_t)ARG64(1), b = (int64_t)ARG64(2);
    if (!b || (a == INT64_MIN && b == -1)) x86_fault("CRT division overflow", X.eip);
    x86_wr64(dst, (uint64_t)(a / b));
    x86_wr64(dst + 8, (uint64_t)(a % b));
    return dst;
}
static uint32_t rand_state = 1;
static uint64_t c_srand(void) { rand_state = ARG(0); return 0; }
static uint64_t c_rand(void) {
    rand_state = rand_state * 214013u + 2531011u;
    return (rand_state >> 16) & 32767;
}
static uint64_t c_getenv(void) { return 0; } /* Empty, deterministic process environment. */
static uint64_t c_dupenv(void) {
    if (!ARG(0)) return 22;
    x86_wr64(ARG(0), 0);
    if (ARG(1)) x86_wr64(ARG(1), 0);
    return 0;
}
static int compare_guest(uint32_t cmp, uint32_t a, uint32_t b) {
    uint64_t args[2] = {a, b};
    return (int32_t)crt_callback(cmp, 2, args);
}
static void swap_guest(uint32_t a, uint32_t b, uint32_t size) {
    for (uint32_t i = 0; i < size; i++) {
        unsigned t = x86_rd8(a + i);
        x86_wr8(a + i, x86_rd8(b + i));
        x86_wr8(b + i, t);
    }
}
static void sift_guest(uint32_t base, uint32_t root, uint32_t n, uint32_t size, uint32_t cmp) {
    while (root < n / 2) {
        uint32_t child = root * 2 + 1;
        if (child + 1 < n && compare_guest(cmp, base + child * size, base + (child + 1) * size) < 0) child++;
        if (X.transfer || compare_guest(cmp, base + root * size, base + child * size) >= 0) return;
        if (X.transfer) return;
        swap_guest(base + root * size, base + child * size, size);
        root = child;
    }
}
static uint64_t c_qsort(void) {
    uint32_t base = ARG(0), n = ARG(1), size = ARG(2), cmp = ARG(3);
    if ((uint64_t)n * size > UINT32_MAX || ARG64(1) > UINT32_MAX || ARG64(2) > UINT32_MAX) {
        crt_errno(22); return 0;
    }
    if (!n || !size) return 0;
    cmem(base, n * size);
    for (uint32_t i = n / 2; i > 0 && !X.transfer; i--) sift_guest(base, i - 1, n, size, cmp);
    for (uint32_t i = n; i > 1 && !X.transfer; i--) {
        swap_guest(base, base + (i - 1) * size, size);
        sift_guest(base, 0, i - 1, size, cmp);
    }
    return 0;
}
static uint64_t c_bsearch(void) {
    uint32_t key = ARG(0), base = ARG(1), n = ARG(2), size = ARG(3), cmp = ARG(4), lo = 0, hi = n;
    if ((uint64_t)n * size > UINT32_MAX) { crt_errno(22); return 0; }
    while (lo < hi && !X.transfer) {
        uint32_t mid = lo + (hi - lo) / 2, p = base + mid * size;
        int c = compare_guest(cmp, key, p);
        if (!c) return p;
        if (c < 0) hi = mid; else lo = mid + 1;
    }
    return 0;
}
#define EXIT_HANDLERS 512
static uint32_t exits[EXIT_HANDLERS], exit_n;
static uint64_t register_exit(uint32_t fn, int onexit) {
    if (exit_n == EXIT_HANDLERS) { crt_errno(12); return onexit ? 0 : UINT64_MAX; }
    exits[exit_n++] = fn;
    return onexit ? fn : 0;
}
static uint64_t c_atexit(void) { return register_exit(ARG(0), 0); }
static uint64_t c_onexit(void) { return register_exit(ARG(0), 1); }
static uint32_t quick_exits[EXIT_HANDLERS], quick_n;
static uint64_t c_at_quick_exit(void) {
    if (quick_n == EXIT_HANDLERS) { crt_errno(12); return UINT64_MAX; }
    quick_exits[quick_n++] = ARG(0); return 0;
}
static uint64_t c_quick_exit(void) {
    uint32_t code = ARG(0);
    while (quick_n) {
        uint32_t fn = quick_exits[--quick_n];
        if (fn) crt_callback(fn, 0, 0);
        if (X.transfer) return 0;
    }
    w32_exit_guest(code); return 0;
}
void crt_exit_handlers(void) {
    while (exit_n) {
        uint32_t fn = exits[--exit_n];
        if (fn) crt_callback(fn, 0, 0);
        if (X.transfer) return;
    }
}
static uint64_t c_cexit(void) { crt_exit_handlers(); flush_stdout(); return 0; }
static uint64_t c_exit(void) {
    uint32_t code = ARG(0);
    crt_exit_handlers(); flush_stdout(); w32_exit_guest(code); return 0;
}
static uint64_t c_fast_exit(void) { w32_exit_guest(ARG(0)); return 0; }
static uint64_t c_abort(void) { x86_fault("guest CRT abort", X.eip); }
static uint64_t c_onexit_init(void) {
    memset(cmem(ARG(0), 24), 0, 24);
    return 0;
}
static uint64_t c_onexit_register(void) {
    uint32_t t = ARG(0), fn = ARG(1);
    uint32_t begin = cp(x86_rd64(t)), end = cp(x86_rd64(t + 8)), cap = cp(x86_rd64(t + 16));
    if (!begin || end == cap) {
        uint32_t used = end - begin, n = used + 256;
        uint32_t p = w32_heap_realloc(begin, n);
        if (!p) return UINT64_MAX;
        begin = p; end = p + used; cap = p + n;
        x86_wr64(t, begin); x86_wr64(t + 16, cap);
    }
    x86_wr64(end, fn); x86_wr64(t + 8, end + 8);
    return 0;
}
static uint64_t c_onexit_execute(void) {
    uint32_t t = ARG(0), begin = cp(x86_rd64(t)), end = cp(x86_rd64(t + 8));
    while (end > begin) {
        end -= 8;
        uint32_t fn = cp(x86_rd64(end));
        x86_wr64(t + 8, end);
        if (fn) crt_callback(fn, 0, 0);
        if (X.transfer) return 0;
    }
    w32_heap_free(begin);
    memset(cmem(t, 24), 0, 24);
    return 0;
}
static uint64_t init_term(int check) {
    uint32_t begin = ARG(0), end = ARG(1);
    for (uint32_t p = begin; p < end; p += 8) {
        uint32_t fn = cp(x86_rd64(p));
        if (fn) {
            uint64_t result = crt_callback(fn, 0, 0);
            if (X.transfer || (check && result)) return result;
        }
    }
    return 0;
}
static uint64_t c_initterm(void) { return init_term(0); }
static uint64_t c_initterm_e(void) { return init_term(1); }
static uint32_t args_base;
static void args_init(void) {
    if (args_base) return;
    args_base = w32_misc_alloc(112);
    x86_wr32(args_base, 1);
    x86_wr64(args_base + 8, args_base + 32);
    x86_wr64(args_base + 16, args_base + 48);
    x86_wr64(args_base + 24, args_base + 64);
    x86_wr64(args_base + 32, w32_get_cmdline(0));
    x86_wr64(args_base + 48, w32_get_cmdline(1));
}
static uint64_t c_argc(void) { args_init(); return args_base; }
static uint64_t c_argv(void) { args_init(); return args_base + 8; }
static uint64_t c_wargv(void) { args_init(); return args_base + 16; }
static uint64_t c_environ(void) { args_init(); return args_base + 24; }
static uint64_t c_initial_environ(void) { args_init(); return args_base + 64; }
static uint64_t c_mainargs(void) {
    args_init(); x86_wr32(ARG(0), 1);
    x86_wr64(ARG(1), args_base + 32); x86_wr64(ARG(2), args_base + 64);
    return 0;
}
static uint64_t c_wmainargs(void) {
    args_init(); x86_wr32(ARG(0), 1);
    x86_wr64(ARG(1), args_base + 48); x86_wr64(ARG(2), args_base + 64);
    return 0;
}
static uint32_t runtime_cells;
static uint32_t cell(unsigned offset) {
    if (!runtime_cells) runtime_cells = w32_misc_alloc(96);
    return runtime_cells + offset;
}
static uint64_t c_fmode(void) { return cell(0); }
static uint64_t c_commode(void) { return cell(4); }
static uint64_t c_set_fmode(void) { x86_wr32(cell(0), ARG(0)); return 0; }
static uint64_t c_newmode(void) { uint32_t old = x86_rd32(cell(8)); x86_wr32(cell(8), ARG(0)); return old; }
static uint64_t c_invalid_handler(void) {
    uint64_t old = x86_rd64(cell(16)); x86_wr64(cell(16), ARG64(0)); return old;
}
static uint64_t c_app_type(void) { x86_wr32(cell(24), ARG(0)); return 0; }
static uint64_t c_matherr(void) {
    uint64_t old = x86_rd64(cell(32)); x86_wr64(cell(32), ARG64(0)); return old;
}
static uint64_t c_signal(void) {
    uint32_t n = ARG(0);
    if (n >= 32) { crt_errno(22); return UINT64_MAX; }
    static uint64_t handlers[32];
    uint64_t old = handlers[n]; handlers[n] = ARG64(1); return old;
}
static uint64_t c_ok(void) { return 0; }
static uint64_t c_filter(void) { return 0; } /* EXCEPTION_CONTINUE_SEARCH */
static uint64_t c_except(void) { return 1; } /* ExceptionContinueSearch */

/* Only the deterministic C locale is exposed; unsupported locales fail visibly via NULL/errno. */
static uint32_t locale_name, lconv_cell, ctype_cell;
static void locale_init(void) {
    if (locale_name) return;
    locale_name = w32_misc_alloc(32);
    w32_pstr(locale_name, 32, 0, "C");
    lconv_cell = w32_misc_alloc(160);
    uint32_t empty = locale_name + 2, dot = locale_name + 4;
    x86_wr8(dot, '.');
    for (uint32_t i = 0; i < 10; i++) x86_wr64(lconv_cell + i * 8, i ? empty : dot);
    for (uint32_t i = 0; i < 8; i++) x86_wr8(lconv_cell + 80 + i, 127);
    uint32_t wempty = locale_name + 8, wdot = locale_name + 12;
    x86_wr16(wdot, '.');
    for (uint32_t i = 0; i < 8; i++) x86_wr64(lconv_cell + 88 + i * 8, i ? wempty : wdot);
}
static uint64_t c_setlocale(void) {
    locale_init();
    if (ARG(1)) {
        const char *s = cstr(ARG(1));
        if (*s && strcmp(s, "C") && strcmp(s, "POSIX")) { crt_errno(22); return 0; }
    }
    return locale_name;
}
static uint64_t c_localeconv(void) { locale_init(); return lconv_cell; }
static uint64_t c_configlocale(void) { return 1; } /* _DISABLE_PER_THREAD_LOCALE */
#define CTYPE_FN(name) static uint64_t c_##name(void) { return name((int)ARG(0)) != 0; }
CTYPE_FN(isalnum)
CTYPE_FN(isalpha)
CTYPE_FN(iscntrl)
CTYPE_FN(isdigit)
CTYPE_FN(isgraph)
CTYPE_FN(islower)
CTYPE_FN(isprint)
CTYPE_FN(ispunct)
CTYPE_FN(isspace)
CTYPE_FN(isupper)
CTYPE_FN(isxdigit)
#undef CTYPE_FN
static uint64_t c_tolower(void) { return (uint64_t)tolower((int)ARG(0)); }
static uint64_t c_toupper(void) { return (uint64_t)toupper((int)ARG(0)); }
static unsigned win_ctype(int c) {
    if (c < 0 || c > 255) return 0;
    unsigned r = 0;
    if (isupper(c)) r |= 1;
    if (islower(c)) r |= 2;
    if (isdigit(c)) r |= 4;
    if (isspace(c)) r |= 8;
    if (ispunct(c)) r |= 16;
    if (iscntrl(c)) r |= 32;
    if (c == ' ' || c == '\t') r |= 64;
    if (isxdigit(c)) r |= 128;
    if (isalpha(c)) r |= 256;
    return r;
}
static uint64_t c_isctype(void) { return win_ctype((int)ARG(0)) & ARG(1); }
static uint64_t c_pctype(void) {
    if (!ctype_cell) {
        ctype_cell = w32_misc_alloc(536);
        x86_wr64(ctype_cell, ctype_cell + 18);
        for (int i = 0; i < 256; i++) x86_wr16(ctype_cell + 18 + (uint32_t)i * 2, win_ctype(i));
    }
    return ctype_cell;
}
static uint64_t c_pctype_func(void) { c_pctype(); return x86_rd64(ctype_cell); }

static uint64_t c_clock(void) { return w32_now_ms(); } /* Windows CLOCKS_PER_SEC = 1000 */
static uint64_t c_time64(void) {
    uint64_t t = w32_unix_time_secs();
    if (ARG(0)) x86_wr64(ARG(0), t);
    return t;
}
static uint64_t c_time32(void) {
    uint32_t t = (uint32_t)w32_unix_time_secs();
    if (ARG(0)) x86_wr32(ARG(0), t);
    return t;
}
static void tm_to_guest(uint32_t p, const struct tm *t) {
    const int fields[9] = {t->tm_sec, t->tm_min, t->tm_hour, t->tm_mday, t->tm_mon,
                           t->tm_year, t->tm_wday, t->tm_yday, t->tm_isdst};
    for (unsigned i = 0; i < 9; i++) x86_wr32(p + i * 4, (uint32_t)fields[i]);
}
static struct tm tm_from_guest(uint32_t p) {
    struct tm t = {0};
    t.tm_sec = (int)x86_rd32(p); t.tm_min = (int)x86_rd32(p + 4); t.tm_hour = (int)x86_rd32(p + 8);
    t.tm_mday = (int)x86_rd32(p + 12); t.tm_mon = (int)x86_rd32(p + 16); t.tm_year = (int)x86_rd32(p + 20);
    t.tm_wday = (int)x86_rd32(p + 24); t.tm_yday = (int)x86_rd32(p + 28); t.tm_isdst = (int)x86_rd32(p + 32);
    return t;
}
static uint64_t time_break(int bits, int secure) {
    uint32_t src = ARG(secure ? 1 : 0);
    time_t value = bits == 32 ? (int32_t)x86_rd32(src) : (int64_t)x86_rd64(src);
    struct tm result;
    if (!gmtime_r(&value, &result)) { crt_errno(22); return secure ? 22 : 0; }
    static uint32_t tm_cell;
    if (!tm_cell) tm_cell = w32_misc_alloc(40);
    tm_to_guest(secure ? ARG(0) : tm_cell, &result);
    return secure ? 0 : tm_cell;
}
static uint64_t c_gmtime64(void) { return time_break(64, 0); }
static uint64_t c_gmtime32(void) { return time_break(32, 0); }
static uint64_t c_gmtime64_s(void) { return time_break(64, 1); }
static uint64_t c_gmtime32_s(void) { return time_break(32, 1); }
static uint64_t c_strftime(void) {
    struct tm t = tm_from_guest(ARG(3));
    if (!ARG(1)) return 0;
    return strftime(cmem(ARG(0), ARG(1)), ARG(1), cstr(ARG(2)), &t);
}
static uint64_t c_mktime64(void) {
    struct tm t = tm_from_guest(ARG(0));
    time_t value = timegm(&t);
    tm_to_guest(ARG(0), &t);
    return (uint64_t)value;
}
static uint64_t c_difftime(void) { return rd((double)(int64_t)ARG64(0) - (double)(int64_t)ARG64(1)); }
