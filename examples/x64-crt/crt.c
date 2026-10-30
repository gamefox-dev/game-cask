/* Original CC0 fixture. Same source compiled natively and by normal MinGW -O2/CRT. */
#include <ctype.h>
#include <errno.h>
#include <locale.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <wchar.h>
#ifdef _WIN32
#include <windows.h>
#define ci _stricmp
#else
#include <strings.h>
#define ci strcasecmp
#endif
static uint32_t hash;
static unsigned failures;
static void add(long long x) { hash = (hash ^ (uint32_t)x) * 16777619u; }
static void check(int ok) { if (!ok) failures++; add(ok != 0); }
static void begin(void) { hash = 2166136261u; }
static void end(const char *group) { printf("crt %s=%08x\n", group, hash); }
static int cmp(const void *a, const void *b) { return (*(const int *)a > *(const int *)b) -
                                                   (*(const int *)a < *(const int *)b); }
static void exited(void) { puts("crt exit-handler=PASS"); }
static int varfmt(char *dst, const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); int n = vsnprintf(dst, 128, fmt, ap); va_end(ap); return n;
}
static void strings(void) {
    char b[128], c[128]; wchar_t w[128];
    begin();
    memset(b, 'x', sizeof b); memcpy(c, b, sizeof b); check(memcmp(b, c, sizeof b) == 0);
    memmove(b + 1, b, 20); check(memchr(b, 'x', 20) == b);
    strcpy(b, "Alpha"); strcat(b, "Beta"); add((long long)strlen(b));
    strncpy(c, "AlphaBeta", sizeof c); check(strcmp(b, c) == 0); check(strncmp(b, "AlphaZ", 5) == 0);
    strncat(b, "Gamma", 2); check(strchr(b, 'B') == b + 5); check(strrchr(b, 'a') == b + 10);
    check(strstr(b, "Beta") == b + 5); add((long long)strspn(b, "Alph"));
    add((long long)strcspn(b, "B")); check(strpbrk(b, "BG") == b + 5); check(ci("Hello", "hELLo") == 0);
    wcscpy(w, L"Wide"); wcscat(w, L"String"); add((long long)wcslen(w));
    check(wcscmp(w, L"WideString") == 0); check(wcsncmp(w, L"Wide!", 4) == 0);
    check(wcschr(w, L'S') == w + 4); check(wcsrchr(w, L'i') == w + 7);
    check(wcsstr(w, L"String") == w + 4); add((long long)wcsspn(w, L"Wide"));
    add((long long)wcscspn(w, L"S")); check(wcspbrk(w, L"SQ") == w + 4);
    wcsncpy(w, L"abc", 6); wcsncat(w, L"def", 2); check(wcscmp(w, L"abcde") == 0);
    wmemset(w, L'z', 5); wmemmove(w + 1, w, 4); wmemcpy(w + 6, w, 5); check(wmemcmp(w, w + 6, 5) == 0);
    end("string");
}
static void utility(void) {
    int a[] = {9, -2, 8, 1, 3, 0, 5}; char *e; wchar_t *we;
    begin(); qsort(a, 7, sizeof *a, cmp); for (int i = 0; i < 7; i++) add(a[i]);
    int key = 5; int *found = bsearch(&key, a, 7, sizeof *a, cmp); check(found && *found == 5);
    key = 7; check(!bsearch(&key, a, 7, sizeof *a, cmp));
    add(strtol("-123x", &e, 10)); check(*e == 'x'); add(strtoul("ff!", &e, 16)); check(*e == '!');
    add(strtoll("-1234567890123", 0, 10)); add((long long)strtoull("abcdef123", 0, 16));
    add(wcstol(L"-77w", &we, 10)); check(*we == L'w'); add((long long)wcstoul(L"75", 0, 8));
    add(llround(strtod("1.2345z", &e) * 10000)); check(*e == 'z');
    add(lroundf(strtof("2.5", 0) * 10)); add(llround(wcstod(L"3.125", 0) * 1000));
    add(atoi(" -42")); add(atol("123")); add(atoll("123456789012")); add(llround(atof("1.75") * 100));
    add(abs(-17)); add(labs(-25)); add(llabs(-123456789012ll));
    div_t d = div(-47, 5); add(d.quot); add(d.rem);
    ldiv_t ld = ldiv(23, 4); add(ld.quot); add(ld.rem);
    lldiv_t lld = lldiv(-123456789012ll, 1000); add(lld.quot); add(lld.rem);
    int *p = calloc(9, sizeof *p); check(p && p[0] == 0 && p[8] == 0); free(p);
    p = malloc(16); check(p != 0); if (p) { p[0] = 123; p = realloc(p, 64); check(p && p[0] == 123); } free(p);
    srand(123); int r = rand(); check(r >= 0 && r <= RAND_MAX);
    check(!getenv("BGT_CC0_ABSENT_ENVIRONMENT_9457")); check(atexit(exited) == 0);
    errno = 0; (void)strtoll("9999999999999999999999999", &e, 10); check(errno == ERANGE && !*e);
    end("stdlib");
}
static volatile double x = 0.375, y = 1.25;
static volatile float xf = 0.375f, yf = 1.25f;
static void sample(const char *name, double d, float f) {
    uint64_t db; uint32_t fb; memcpy(&db, &d, 8); memcpy(&fb, &f, 4);
    printf("ulp %s=%016llx,%08x\n", name, (unsigned long long)db, fb);
    add(llround(d * 100000)); add(llround(f * 100000));
}
#ifdef _WIN32
static FARPROC math_api(const char *name) {
    static HMODULE lib;
    if (!lib) lib = LoadLibraryA("api-ms-win-crt-math-l1-1-0.dll");
    FARPROC fn = GetProcAddress(lib, name);
    if (!fn) failures++;
    return fn;
}
#define CALL1(name, type, arg) ((type (*)(type))(uintptr_t)math_api(#name))(arg)
#define CALL2(name, type, a, b) ((type (*)(type, type))(uintptr_t)math_api(#name))(a, b)
#else
#define CALL1(name, type, arg) name(arg)
#define CALL2(name, type, a, b) name(a, b)
#endif
#define UNARY(name) sample(#name, CALL1(name, double, x), CALL1(name##f, float, xf))
#define BINARY(name) sample(#name, CALL2(name, double, x, y), CALL2(name##f, float, xf, yf))
static void maths(void) {
    begin();
    UNARY(sin); UNARY(cos); UNARY(tan); UNARY(asin); UNARY(acos); UNARY(atan);
    UNARY(exp); UNARY(exp2); UNARY(expm1); UNARY(log); UNARY(log2); UNARY(log10); UNARY(log1p);
    UNARY(sqrt); UNARY(cbrt); UNARY(fabs); UNARY(floor); UNARY(ceil); UNARY(trunc); UNARY(round);
    UNARY(sinh); UNARY(cosh); UNARY(tanh); UNARY(asinh); UNARY(atanh); UNARY(erf); UNARY(erfc);
    BINARY(atan2); BINARY(pow); BINARY(hypot); BINARY(fmod); BINARY(remainder); BINARY(copysign);
    BINARY(fmin); BINARY(fmax); BINARY(fdim);
    add(llround(-2.5)); add(llroundf(-2.5f)); add(lround(2.5)); add(lroundf(2.5f));
    int exponent; double integer;
    add(llround(frexp(y, &exponent) * 1000)); add(exponent);
    add(llround(modf(y, &integer) * 1000)); add(llround(integer)); add(llround(ldexp(x, 5) * 1000));
    float fi; add(llround(frexpf(yf, &exponent) * 1000)); add(exponent);
    add(llround(modff(yf, &fi) * 1000)); add(llround(fi)); add(llround(ldexpf(xf, 5) * 1000));
    check(isfinite(x)); check(!isnan(x)); check(signbit(-x) != 0); check(fpclassify(x) == FP_NORMAL);
    end("math");
}
static void io(void) {
    char b[128], c[128]; int a = 0, n = 0; double d = 0; long long big = 0;
    begin();
    add(snprintf(b, sizeof b, "%d %.5f %lld %s", -42, 1.2345, 123456789012ll, "word"));
    add(sscanf(b, "%d %lf %lld %s%n", &a, &d, &big, c, &n));
    add(a); add(llround(d * 10000)); add(big); add(n); check(!strcmp(c, "word"));
    add(varfmt(b, "%*.*f:%08x:%zu", 9, 3, 1.25, 0xab, (size_t)91)); check(strstr(b, "1.250") != 0);
    add(sprintf(c, "%d:%s", 123, "text")); check(!strcmp(c, "123:text"));
    add(snprintf(c, 5, "%s", "abcdefgh")); check(!strcmp(c, "abcd"));
    FILE *f = fopen("crt-runtime.tmp", "w+b"); check(f != 0);
    if (f) {
        add((long long)fwrite("first\nsecond", 1, 12, f)); add(ftell(f)); add(fflush(f)); rewind(f);
        check(fgets(b, sizeof b, f) != 0); check(!strcmp(b, "first\n"));
        add(fgetc(f)); add(ungetc('S', f)); add(fgetc(f));
        add(fseek(f, 0, SEEK_SET)); memset(b, 0, sizeof b); add((long long)fread(b, 1, 12, f));
        check(!strcmp(b, "first\nsecond")); check(fgetc(f) == EOF); check(feof(f) != 0);
        clearerr(f); check(!ferror(f) && !feof(f)); add(fclose(f));
    }
    f = fopen("crt-input.txt", "rb"); check(f != 0);
    if (f) {
        add(fscanf(f, "%d %s %lf", &a, c, &d)); add(a); add(llround(d * 100));
        check(!strcmp(c, "asset")); check(fclose(f) == 0);
    }
    wchar_t w[64]; add(swprintf(w, 64, L"wide %d %.2f", 23, 1.25));
    check(!wcscmp(w, L"wide 23 1.25"));
    end("stdio");
}
static void calendar_locale(void) {
    begin(); check(setlocale(LC_ALL, "C") != 0); check(!strcmp(localeconv()->decimal_point, "."));
    check(isalpha('Q') != 0); check(isdigit('8') != 0); check(isspace('\t') != 0);
    check(isalnum('!') == 0); check(isupper('Q') != 0); check(islower('q') != 0);
    check(isxdigit('F') != 0); check(iscntrl('\n') != 0); check(ispunct('!') != 0);
    check(isprint(' ') != 0); check(isgraph(' ') == 0); add(tolower('Q')); add(toupper('q'));
    end("locale"); begin();
    time_t t = 1004054400; struct tm *tm = gmtime(&t); char b[128];
    check(tm != 0); add(tm->tm_year); add(tm->tm_mon); add(tm->tm_mday); add(tm->tm_wday);
    add((long long)strftime(b, sizeof b, "%Y-%m-%d %H:%M:%S", tm)); check(!strcmp(b, "2001-10-26 00:00:00"));
    check(localtime(&t) != 0); check(time(0) > 0); check(clock() != (clock_t)-1);
    end("time");
}
static void file_edges(void) {
    begin();
    FILE *a = fopen("crt-empty.tmp", "wb"); check(a != 0); if (a) fclose(a);
    a = fopen("crt-empty.tmp", "rb"); check(a != 0); if (a) { check(fgetc(a) == EOF); fclose(a); }
    a = fopen("crt-shared.tmp", "w+b"); check(a != 0);
    if (a) {
        check(fwrite("abc", 1, 3, a) == 3); check(fflush(a) == 0);
        FILE *b = fopen("crt-shared.tmp", "rb"); check(b != 0);
        if (b) { check(fgetc(b) == 'a'); fclose(b); } fclose(a);
    }
    a = fopen("crt-shared.tmp", "a+b"); check(a != 0);
    if (a) { check(fseek(a, 0, SEEK_SET) == 0); check(fputc('Z', a) == 'Z'); fclose(a); }
    a = fopen("crt-shared.tmp", "rb"); check(a != 0);
    if (a) { char b[8] = {0}; check(fread(b, 1, 7, a) == 4); check(!strcmp(b, "abcZ")); fclose(a); }
    for (unsigned i = 0; i < 100; i++) {
        char name[32]; snprintf(name, sizeof name, "crt-reuse-%u.tmp", i);
        a = fopen(name, "wb"); check(a != 0); if (a) fclose(a);
    }
    char b[16]; check(snprintf(b, 10, "%300c", 'X') == 300); check(!strcmp(b, "         "));
    void *pointer = 0; check(sscanf("01000020", "%p", &pointer) == 1);
    check((uintptr_t)pointer == 0x01000020);
    end("file-edges");
}
#ifdef _WIN32
static int bounded_scan(const char *s, size_t n, const char *fmt, ...) {
    typedef int (*scanner)(uint64_t, const char *, size_t, const char *, void *, va_list);
    scanner fn = (scanner)(uintptr_t)GetProcAddress(LoadLibraryA("ucrtbase.dll"), "__stdio_common_vsscanf");
    va_list ap; va_start(ap, fmt); int result = fn(0, s, n, fmt, 0, ap); va_end(ap); return result;
}
static void aliases(void) {
    /* Windows wide output does not require the host C locale's multibyte encoder. */
    wchar_t w[16]; check(swprintf(w, 16, L"%ls", L"\u03a9") == 1); check(w[0] == 0x3a9 && w[1] == 0);
    /* Host-native run avoids libc tmpfile's system-directory policy; Windows CRT is checked here. */
    FILE *f = tmpfile(); check(f != 0);
    if (f) { check(fputc('Z', f) == 'Z'); check(fclose(f) == 0); }
    const char *dlls[] = {"ucrtbase.dll", "msvcrt.dll", "api-ms-win-crt-math-l1-1-0.dll"};
    for (unsigned i = 0; i < 3; i++) {
        HMODULE m = LoadLibraryA(dlls[i]);
        long long (*fn)(double) = (long long (*)(double))(uintptr_t)GetProcAddress(m, "llround");
        check(fn && fn(-2.5) == -3);
    }
    /* Wider names survive LoadLibrary, static imports and missing-symbol diagnostics. */
    check(LoadLibraryA("api-ms-win-crt-utility-l1-1-0.dll") != 0);
    HMODULE lib = LoadLibraryA("ucrtbase.dll");
    int *(*nerr)(void) = (int *(*)(void))(uintptr_t)GetProcAddress(lib, "__sys_nerr");
    check(nerr && *nerr() >= 34);
    typedef int (*legacy_format)(char *, size_t, const char *, ...);
    legacy_format legacy = (legacy_format)(uintptr_t)GetProcAddress(lib, "_snprintf");
    char b[4] = {'?', '?', '?', '!'};
    check(legacy(b, 3, "%s", "abc") == 3); check(!memcmp(b, "abc!", 4));
    check(legacy(b, 2, "%s", "abc") == -1); check(b[0] == 'a' && b[1] == 'b');
    volatile unsigned char *v = VirtualAlloc((void *)(uintptr_t)0x04010000, 65536,
                                            MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    check(v != 0);
    if (v) {
        v[0] = 0x5a;
        void *p = calloc(1, 256 * 1024); check(p != 0); check(v[0] == 0x5a); free(p);
    }
    unsigned char *limited = VirtualAlloc((void *)(uintptr_t)0x20000000, 65536,
                                           MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    check(limited != 0);
    if (limited) {
        limited[65535] = '7'; int scanned = 0;
        check(bounded_scan((char *)limited + 65535, 1, "%d", &scanned) == 1); check(scanned == 7);
    }
}
#endif
int main(void) {
    strings(); utility(); maths(); io(); calendar_locale();
#ifdef _WIN32
    aliases();
#endif
    file_edges();
    printf("crt result=%s failures=%u\n", failures ? "FAIL" : "PASS", failures);
    return failures ? 1 : 0;
}
