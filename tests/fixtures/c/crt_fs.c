/* Original CC0 fixture: CRT file metadata/directory functions must agree with KERNEL32 on one process-local
 * VFS. Normally linked MinGW CRT, built for both guest widths. Windows-specific expectations (struct layouts,
 * UCRT errno mapping) are known-contract assertions, not native Windows executions. */
#include <windows.h>
#include <stddef.h>
#include <stdlib.h>
#include <errno.h>
#include <io.h>
#include <fcntl.h>
#include <direct.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <stdio.h>
#include <wchar.h>

#define STR2(x) #x
#define STR(x) STR2(x)
static unsigned checks, failures;
#define CHECK(x) do { checks++; if (!(x)) { failures++; OutputDebugStringA("FAIL line " STR(__LINE__) ": " #x); } } while (0)
/* -1 return with a specific errno */
#define FAILS(call, code) do { errno = 0; long long r_ = (long long)(call); checks++; \
    if (r_ != -1 || errno != (code)) { failures++; OutputDebugStringA("FAIL line " STR(__LINE__) ": " #call " errno " #code); } } while (0)
#define NULLS(call, code) do { errno = 0; void *r_ = (void *)(call); checks++; \
    if (r_ || errno != (code)) { failures++; OutputDebugStringA("FAIL line " STR(__LINE__) ": " #call " errno " #code); } } while (0)

_Static_assert(sizeof(struct _stat32) == 36 && offsetof(struct _stat32, st_size) == 20 && offsetof(struct _stat32, st_ctime) == 32, "_stat32");
_Static_assert(sizeof(struct _stat32i64) == 48 && offsetof(struct _stat32i64, st_size) == 24 && offsetof(struct _stat32i64, st_atime) == 32, "_stat32i64");
_Static_assert(sizeof(struct _stat64i32) == 48 && offsetof(struct _stat64i32, st_size) == 20 && offsetof(struct _stat64i32, st_atime) == 24, "_stat64i32");
_Static_assert(sizeof(struct _stat64) == 56 && offsetof(struct _stat64, st_size) == 24 && offsetof(struct _stat64, st_ctime) == 48, "_stat64");
_Static_assert(sizeof(struct _finddata32_t) == 280 && sizeof(struct _finddata32i64_t) == 288, "finddata32");
_Static_assert(sizeof(struct _finddata64i32_t) == 296 && sizeof(struct __finddata64_t) == 304, "finddata64");
_Static_assert(sizeof(struct _wfinddata32_t) == 540 && sizeof(struct _wfinddata64_t) == 560, "wfinddata");

static int eq(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
static int weq(const wchar_t *a, const wchar_t *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
static int slen(const char *s) { int n = 0; while (s[n]) n++; return n; }
static long long now_t(void) {
    FILETIME ft; GetSystemTimeAsFileTime(&ft);
    unsigned long long v = ((unsigned long long)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
    return (long long)(v / 10000000ull) - 11644473600ll;
}
static long long ft_t(FILETIME ft) { return (long long)((((unsigned long long)ft.dwHighDateTime << 32) | ft.dwLowDateTime) / 10000000ull) - 11644473600ll; }
static int is_dir(const char *p) { struct _stat64 s; return _stat64(p, &s) == 0 && (s.st_mode & _S_IFMT) == _S_IFDIR; }
static int k_dir(const wchar_t *p) { DWORD a = GetFileAttributesW(p); return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY); }
static int k_missing(const wchar_t *p) { return GetFileAttributesW(p) == INVALID_FILE_ATTRIBUTES; }
static int absent(const char *p) { struct _stat64 s; errno = 0; return _stat64(p, &s) == -1 && errno == ENOENT; }

/* enumeration through the CRT and through KERNEL32: same names, order and attributes */
#define MAXN 24
typedef struct { char name[MAXN][40]; unsigned attr[MAXN]; unsigned n; } list_t;
static void list_crt(const char *pattern, list_t *l) {
    struct __finddata64_t fd; l->n = 0;
    intptr_t h = _findfirst64(pattern, &fd);
    if (h == -1) return;
    do { if (l->n < MAXN) { unsigned i = 0; while (fd.name[i] && i < 39) { l->name[l->n][i] = fd.name[i]; i++; } l->name[l->n][i] = 0; l->attr[l->n++] = fd.attrib; } } while (_findnext64(h, &fd) == 0);
    CHECK(_findclose(h) == 0);
}
static void list_k32(const wchar_t *pattern, list_t *l) {
    WIN32_FIND_DATAW fd; l->n = 0;
    HANDLE h = FindFirstFileW(pattern, &fd);
    if (h == INVALID_HANDLE_VALUE) return;
    do { if (l->n < MAXN) { unsigned i = 0; while (fd.cFileName[i] && i < 39) { l->name[l->n][i] = (char)fd.cFileName[i]; i++; } l->name[l->n][i] = 0; l->attr[l->n++] = fd.dwFileAttributes; } } while (FindNextFileW(h, &fd));
    CHECK(GetLastError() == ERROR_NO_MORE_FILES);
    CHECK(FindClose(h));
}
static int has(const list_t *l, const char *name) { for (unsigned i = 0; i < l->n; i++) if (eq(l->name[i], name)) return 1; return 0; }
static int same_lists(const list_t *a, const list_t *b) {
    if (a->n != b->n) return 0;
    for (unsigned i = 0; i < a->n; i++) if (!eq(a->name[i], b->name[i]) || a->attr[i] != b->attr[i]) return 0;
    return 1;
}

static void test_registry(void) {
    HKEY key = 0, ro = 0; DWORD v = 7, type, size, disposition;
    CHECK(RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\GameCaskK6d", 0, 0, 0, KEY_ALL_ACCESS, 0, &key, &disposition) == ERROR_SUCCESS);
    CHECK(RegSetValueExW(key, L"Score", 0, REG_DWORD, (const BYTE *)&v, 4) == ERROR_SUCCESS);
    CHECK(RegSetValueExA(key, "Name", 0, REG_SZ, (const BYTE *)"player", 7) == ERROR_SUCCESS);
    CHECK(RegSetValueExW(key, L"Other", 0, REG_DWORD, (const BYTE *)&v, 4) == ERROR_SUCCESS);
    size = 4; CHECK(RegQueryValueExW(key, L"Score", 0, &type, (BYTE *)&v, &size) == ERROR_SUCCESS && type == REG_DWORD && v == 7);
    CHECK(RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\GameCaskK6d", 0, KEY_READ, &ro) == ERROR_SUCCESS);
    CHECK(RegDeleteValueW(ro, L"Score") == ERROR_ACCESS_DENIED);
    size = 4; CHECK(RegQueryValueExW(key, L"Score", 0, &type, (BYTE *)&v, &size) == ERROR_SUCCESS); /* denied delete changed nothing */
    CHECK(RegDeleteValueW((HKEY)(ULONG_PTR)0x1234, L"Score") == ERROR_INVALID_HANDLE);
    CHECK(RegDeleteValueW(key, L"Score") == ERROR_SUCCESS);
    size = 4; CHECK(RegQueryValueExW(key, L"Score", 0, &type, (BYTE *)&v, &size) == ERROR_FILE_NOT_FOUND);
    CHECK(RegDeleteValueW(key, L"Score") == ERROR_FILE_NOT_FOUND);
    CHECK(RegDeleteValueW(key, L"NeverSet") == ERROR_FILE_NOT_FOUND);
    char name[16]; size = sizeof name; CHECK(RegQueryValueExA(key, "Name", 0, &type, (BYTE *)name, &size) == ERROR_SUCCESS && eq(name, "player"));
    CHECK(RegDeleteValueA(key, "Name") == ERROR_SUCCESS);
    size = sizeof name; CHECK(RegQueryValueExA(key, "Name", 0, &type, (BYTE *)name, &size) == ERROR_FILE_NOT_FOUND);
    CHECK(RegDeleteValueA(key, "Name") == ERROR_FILE_NOT_FOUND);
    size = 4; CHECK(RegQueryValueExW(key, L"Other", 0, &type, (BYTE *)&v, &size) == ERROR_SUCCESS); /* siblings survive */
    v = 9; CHECK(RegSetValueExW(key, L"Score", 0, REG_DWORD, (const BYTE *)&v, 4) == ERROR_SUCCESS); /* re-creatable */
    v = 0; size = 4; CHECK(RegQueryValueExW(key, L"Score", 0, &type, (BYTE *)&v, &size) == ERROR_SUCCESS && v == 9);
    /* NULL and the empty string both address the unnamed/default value, across A/W calls. */
    CHECK(RegSetValueExW(key, 0, 0, REG_DWORD, (const BYTE *)&v, 4) == ERROR_SUCCESS);
    size = 4; CHECK(RegQueryValueExA(key, "", 0, &type, (BYTE *)&v, &size) == ERROR_SUCCESS && v == 9);
    CHECK(RegDeleteValueA(key, 0) == ERROR_SUCCESS);
    size = 4; CHECK(RegQueryValueExW(key, L"", 0, &type, (BYTE *)&v, &size) == ERROR_FILE_NOT_FOUND);
    CHECK(RegDeleteValueW(key, 0) == ERROR_FILE_NOT_FOUND);
    CHECK(RegSetValueExA(key, "", 0, REG_DWORD, (const BYTE *)&v, 4) == ERROR_SUCCESS);
    CHECK(RegDeleteValueW(key, L"") == ERROR_SUCCESS);
    size = 4; CHECK(RegQueryValueExA(key, 0, 0, &type, (BYTE *)&v, &size) == ERROR_FILE_NOT_FOUND);
    CHECK(RegCloseKey(ro) == ERROR_SUCCESS); CHECK(RegCloseKey(key) == ERROR_SUCCESS);
}

static __attribute__((noinline)) void section0(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- root and shipped metadata (index built from the manifest) */
    static const char *roots[] = { ".", "C:\\GAME", "C:\\GAME\\", "c:\\game", "C:\\", "\\", "C:", "./", "nested/..", "nested\\.\\.." };
    for (unsigned i = 0; i < sizeof roots / sizeof *roots; i++) {
        errno = 0; CHECK(_stat64(roots[i], &s) == 0);
        CHECK((s.st_mode & _S_IFMT) == _S_IFDIR && s.st_mode == 0x41ff && s.st_nlink == 1 && s.st_dev == 2 && s.st_rdev == 2 && s.st_size == 0);
    }
    CHECK(_wstat64(L".", &s) == 0 && s.st_mode == 0x41ff);
    FAILS(_stat64("", &s), ENOENT);
    FAILS(_stat64("a*", &s), ENOENT);
    FAILS(_stat64("D:\\", &s), ENOENT);
    CHECK(_stat64("nested", &s) == 0 && (s.st_mode & _S_IFMT) == _S_IFDIR);
    CHECK(_stat64("NESTED/SEED.TXT", &s) == 0 && s.st_mode == 0x8124 && s.st_size == 17 && s.st_nlink == 1 && s.st_dev == 2);
    CHECK(_stat64("probe.exe", &s2) == 0 && s2.st_mode == 0x816d && s2.st_size > 0);
    CHECK(s.st_mtime == s.st_ctime && s.st_atime == s.st_mtime && s.st_mtime >= 1003968000ll && s.st_mtime <= t0);
    FAILS(_stat64("nested/seed.txt/", &s), ENOENT);
    FAILS(_stat64("nested/absent.txt", &s), ENOENT);
    FAILS(_stat64("absent/seed.txt", &s), ENOENT);
    FAILS(_stat64("nested/seed.txt/below", &s), ENOENT);
    CHECK(k_dir(L".") && k_dir(L"C:\\GAME") && k_dir(L"nested") && !k_dir(L"nested\\seed.txt") && k_missing(L"nested\\absent.txt"));
    CHECK(GetLastError() == ERROR_FILE_NOT_FOUND);
    CHECK(k_missing(L"absent\\x") && GetLastError() == ERROR_PATH_NOT_FOUND);
    CHECK(GetFileAttributesW(L"nested\\seed.txt") == (FILE_ATTRIBUTE_READONLY | FILE_ATTRIBUTE_ARCHIVE));

}
static __attribute__((noinline)) void section1(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- struct layout variants, one file, all width/time combinations */
    { struct _stat32 a; struct _stat32i64 b; struct _stat64i32 c; struct _stat64 d;
      CHECK(_stat32("nested/seed.txt", &a) == 0 && _stat32i64("nested/seed.txt", &b) == 0 && _stat64("nested/seed.txt", &d) == 0);
      CHECK(a.st_size == 17 && b.st_size == 17 && d.st_size == 17 && a.st_mode == b.st_mode && b.st_mode == d.st_mode && a.st_mode == 0x8124);
      CHECK(a.st_mtime == d.st_mtime && b.st_mtime == d.st_mtime && a.st_ctime == d.st_ctime && b.st_atime == d.st_atime);
      CHECK(a.st_dev == 2 && b.st_rdev == 2 && a.st_nlink == 1 && a.st_uid == 0 && a.st_gid == 0 && a.st_ino == 0);
      HMODULE m = LoadLibraryA("msvcrt.dll");
      typedef int (__cdecl *stat_fn)(const char *, void *);
      typedef int (__cdecl *wstat_fn)(const wchar_t *, void *);
      stat_fn s64i32 = (stat_fn)GetProcAddress(m, "_stat64i32"), legacy = (stat_fn)GetProcAddress(m, "_stat"), legacy64 = (stat_fn)GetProcAddress(m, "_stati64");
      wstat_fn w64i32 = (wstat_fn)GetProcAddress(m, "_wstat64i32"), w32 = (wstat_fn)GetProcAddress(m, "_wstat32"), w32i64 = (wstat_fn)GetProcAddress(m, "_wstat32i64");
      CHECK(s64i32 && legacy && legacy64 && w64i32 && w32 && w32i64);
      CHECK(s64i32("nested/seed.txt", &c) == 0 && c.st_size == 17 && c.st_mtime == d.st_mtime && c.st_mode == 0x8124);
      CHECK(w64i32(L"nested/seed.txt", &c) == 0 && c.st_size == 17 && c.st_atime == d.st_atime);
      CHECK(w32(L"nested/seed.txt", &a) == 0 && a.st_size == 17 && w32i64(L"nested/seed.txt", &b) == 0 && b.st_size == 17);
#ifdef _WIN64
      CHECK(legacy("nested/seed.txt", &c) == 0 && c.st_size == 17 && c.st_mtime == d.st_mtime);   /* msvcrt x64: 64-bit time_t */
      CHECK(legacy64("nested/seed.txt", &d) == 0 && d.st_size == 17);
#else
      CHECK(legacy("nested/seed.txt", &a) == 0 && a.st_size == 17 && a.st_mtime == (__time32_t)d.st_mtime);  /* msvcrt x86: 32-bit time_t */
      CHECK(legacy64("nested/seed.txt", &b) == 0 && b.st_size == 17);
#endif
    }
    { struct _stat32 a; struct _stat32i64 b; struct _stat64i32 c;
      CHECK(_fstat32(1, &a) == 0 && a.st_mode == _S_IFCHR && a.st_dev == 1 && a.st_size == 0);
      CHECK(_fstat32i64(1, &b) == 0 && b.st_mode == _S_IFCHR && b.st_size == 0);
      CHECK(_fstat64i32(1, &c) == 0 && c.st_mode == _S_IFCHR && c.st_size == 0);
      CHECK(_fstat64(1, &s) == 0 && s.st_mode == _S_IFCHR && s.st_size == 0);
      FAILS(_fstat64(99, &s), EBADF);
    }

}
static __attribute__((noinline)) void section2(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- mkdir / nesting / errno; distinguish this directory's times from its parent's. */
    Sleep(2100);
    CHECK(_mkdir("work") == 0);
    CHECK(is_dir("work") && k_dir(L"work") && is_dir("WORK") && is_dir("C:\\GAME\\work") && is_dir("./work/."));
    CHECK(_stat64("work", &s) == 0 && s.st_mode == 0x41ff && s.st_nlink == 1 && s.st_size == 0);
    CHECK(s.st_mtime >= t0 && s.st_mtime <= now_t() && s.st_ctime == s.st_mtime);
    FAILS(_mkdir("work"), EEXIST);
    FAILS(_mkdir("WORK\\"), EEXIST);
    FAILS(_mkdir("nested"), EEXIST);
    FAILS(_mkdir("nested/seed.txt"), EEXIST);
    FAILS(_mkdir("missing/child"), ENOENT);
    FAILS(_mkdir(""), ENOENT);
    FAILS(_mkdir("nested/seed.txt/x"), ENOENT);
    FAILS(_mkdir("work/bad*name"), EINVAL);
    FAILS(_mkdir("D:\\other"), ENOENT);
    CHECK(_mkdir("work/a") == 0 && _mkdir("work/a/b") == 0 && _mkdir("work/Mixed") == 0 && _wmkdir(L"work/wide") == 0 && _mkdir("C:\\GAME\\work\\abs") == 0);
    CHECK(is_dir("work/a/b") && is_dir("WORK/A/B") && is_dir("work\\mixed") && is_dir("work/wide") && is_dir("work/abs"));
    CHECK(k_dir(L"work\\a\\b") && k_dir(L"WORK\\MIXED"));
    CHECK(CreateDirectoryW(L"work\\fromk32", 0) && is_dir("work/fromk32"));
    FAILS(_mkdir("work/fromk32"), EEXIST);
    CHECK(!CreateDirectoryW(L"work\\a", 0) && GetLastError() == ERROR_ALREADY_EXISTS);
    CHECK(!CreateDirectoryW(L"nowhere\\x", 0) && GetLastError() == ERROR_PATH_NOT_FOUND);
    CHECK(CreateDirectoryA("work/fromk32a", 0) && is_dir("work/fromk32a"));
    CHECK(_stat64("work", &s2) == 0 && s2.st_mtime >= s.st_mtime);

}
static __attribute__((noinline)) void section3(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- enumeration agreement (non-root directories start with . and ..) */
    { list_t c, k;
      list_crt("work/*", &c); list_k32(L"work/*", &k);
      CHECK(c.n == 8 && has(&c, ".") && has(&c, "..") && has(&c, "a") && has(&c, "Mixed") && has(&c, "wide") && has(&c, "abs") && has(&c, "fromk32") && has(&c, "fromk32a"));
      CHECK(same_lists(&c, &k) && eq(c.name[0], ".") && eq(c.name[1], ".."));
      { struct __finddata64_t f; WIN32_FIND_DATAW w;
        intptr_t h = _findfirst64("work/*", &f); HANDLE kh = FindFirstFileW(L"work/*", &w);
        CHECK(h != -1 && kh != INVALID_HANDLE_VALUE);
        for (unsigned d = 0; d < 2; d++) {
          CHECK(_stat64(d ? "." : "work", &s) == 0);
          CHECK(eq(f.name, d ? ".." : ".") && f.time_create == s.st_ctime && f.time_access == s.st_atime && f.time_write == s.st_mtime);
          CHECK(weq(w.cFileName, d ? L".." : L".") && ft_t(w.ftCreationTime) == s.st_ctime && ft_t(w.ftLastAccessTime) == s.st_atime && ft_t(w.ftLastWriteTime) == s.st_mtime);
          if (!d) CHECK(_findnext64(h, &f) == 0 && FindNextFileW(kh, &w));
        }
        CHECK(_findclose(h) == 0 && FindClose(kh));
      }
      for (unsigned i = 0; i < c.n; i++) CHECK(c.attr[i] & _A_SUBDIR);
      list_crt("work/*.*", &c); CHECK(c.n == 8);
      list_crt("WORK\\M*", &c); CHECK(c.n == 1 && eq(c.name[0], "Mixed"));
      list_crt("work/?", &c); CHECK(c.n == 2 && eq(c.name[0], ".") && eq(c.name[1], "a")); /* ? also matches the one-character "." entry */
      list_crt("work/nothing*", &c); CHECK(c.n == 0);
      list_crt("*", &c); list_k32(L"*", &k);
      CHECK(c.n > 3 && !has(&c, ".") && !has(&c, "..") && has(&c, "nested") && has(&c, "work") && has(&c, "probe.exe") && same_lists(&c, &k));
      list_crt("nested/*", &c); list_k32(L"nested/*", &k);
      CHECK(c.n == 3 && has(&c, ".") && has(&c, "..") && has(&c, "seed.txt") && same_lists(&c, &k));
      list_crt("Data/*.TXT", &c); CHECK(c.n == 1 && eq(c.name[0], "Alpha.TXT")); /* original case is preserved */
      list_crt("work", &c); CHECK(c.n == 1 && eq(c.name[0], "work") && (c.attr[0] & _A_SUBDIR));
      errno = 0; CHECK(_findfirst64("missing/*", (struct __finddata64_t *)buf) == -1 && errno == ENOENT);
      errno = 0; CHECK(_findfirst64("nested/nothing", (struct __finddata64_t *)buf) == -1 && errno == ENOENT);
      struct __finddata64_t invalid_find; struct _wfinddata64_t invalid_wfind;
      FAILS(_findfirst64("work/", &invalid_find), ENOENT);
      FAILS(_wfindfirst64(L"work\\", &invalid_wfind), ENOENT);
      WIN32_FIND_DATAW trailing;
      CHECK(FindFirstFileW(L"work\\", &trailing) == INVALID_HANDLE_VALUE && GetLastError() == ERROR_FILE_NOT_FOUND);
      FAILS(_findclose(-1), EINVAL);
      FAILS(_findnext64(0x1234, (struct __finddata64_t *)buf), EINVAL);
    }
    { /* every _finddata variant and the shipped file's size/time/attributes */
      struct _finddata32_t a; struct _finddata32i64_t b; struct __finddata64_t d; struct _wfinddata32_t wa; struct _wfinddata64_t wd;
      intptr_t h = _findfirst32("nested/seed.txt", &a);
      CHECK(h != -1 && a.size == 17 && eq(a.name, "seed.txt") && a.attrib == (_A_RDONLY | _A_ARCH) && a.time_write >= 1003968000);
      errno = 0; CHECK(_findnext32(h, &a) == -1 && errno == ENOENT); CHECK(_findclose(h) == 0);
      h = _findfirst32i64("nested/seed.txt", &b); CHECK(h != -1 && b.size == 17 && eq(b.name, "seed.txt") && b.time_create == a.time_create); _findclose(h);
      h = _findfirst64("nested/seed.txt", &d); CHECK(h != -1 && d.size == 17 && eq(d.name, "seed.txt") && d.time_access == a.time_access && d.time_write == (long long)a.time_write); _findclose(h);
      h = _wfindfirst32(L"nested/seed.txt", &wa); CHECK(h != -1 && wa.size == 17 && weq(wa.name, L"seed.txt") && wa.attrib == (_A_RDONLY | _A_ARCH)); _findclose(h);
      h = _wfindfirst64(L"nested/*.txt", &wd); CHECK(h != -1 && wd.size == 17 && weq(wd.name, L"seed.txt")); CHECK(_wfindnext64(h, &wd) == -1); _findclose(h);
      HMODULE m = LoadLibraryA("msvcrt.dll");
      typedef intptr_t (__cdecl *first_fn)(const char *, void *);
      typedef int (__cdecl *next_fn)(intptr_t, void *);
      first_fn f64i32 = (first_fn)GetProcAddress(m, "_findfirst64i32"), legacy = (first_fn)GetProcAddress(m, "_findfirst");
      next_fn n64i32 = (next_fn)GetProcAddress(m, "_findnext64i32");
      struct _finddata64i32_t c;
      CHECK(f64i32 && n64i32 && legacy);
      h = f64i32("nested/*", &c); CHECK(h != -1 && eq(c.name, ".") && (c.attrib & _A_SUBDIR) && c.size == 0);
      CHECK(n64i32(h, &c) == 0 && eq(c.name, "..")); CHECK(n64i32(h, &c) == 0 && eq(c.name, "seed.txt") && c.size == 17 && c.time_write == (long long)a.time_write);
      _findclose(h);
      char legacy_data[304];
      h = legacy("nested/seed.txt", legacy_data); CHECK(h != -1); _findclose(h);
    }

}
static __attribute__((noinline)) void section4(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- current directory is shared; relative paths resolve against it in both APIs */
    CHECK(_getcwd(buf, sizeof buf) == buf && eq(buf, "C:\\GAME"));
    CHECK(_wgetcwd(wbuf, 260) == wbuf && weq(wbuf, L"C:\\GAME"));
    CHECK(GetCurrentDirectoryA(260, buf) == 7 && eq(buf, "C:\\GAME"));
    CHECK(_chdir("work/a") == 0);
    CHECK(_getcwd(buf, sizeof buf) == buf && eq(buf, "C:\\GAME\\work\\a"));
    CHECK(GetCurrentDirectoryW(260, wbuf) == 14 && weq(wbuf, L"C:\\GAME\\work\\a"));
    CHECK(is_dir("b") && k_dir(L"b") && is_dir("..\\Mixed") && absent("nested") && k_missing(L"nested"));
    CHECK(_getcwd(buf, 14) == 0 && errno == ERANGE);
    errno = 0; CHECK(_getcwd(buf, 15) == buf);
    CHECK(_getdcwd(0, buf, sizeof buf) == buf && eq(buf, "C:\\GAME\\work\\a") && _getdcwd(3, buf, sizeof buf) == buf);
    NULLS(_getdcwd(4, buf, sizeof buf), EACCES);
    { char *dyn = _getcwd(0, 0); CHECK(dyn && eq(dyn, "C:\\GAME\\work\\a")); free(dyn); }
    { char *dyn = _fullpath(0, "..\\x\\.\\y", 0); CHECK(dyn && eq(dyn, "C:\\GAME\\work\\x\\y")); free(dyn); }
    CHECK(_fullpath(buf, "", sizeof buf) == buf && eq(buf, "C:\\GAME\\work\\a"));
    CHECK(_fullpath(buf, "..\\..\\Nested\\Seed.txt", sizeof buf) == buf && eq(buf, "C:\\GAME\\Nested\\Seed.txt"));
    CHECK(_fullpath(buf, "C:\\GAME\\..\\..\\up", sizeof buf) == buf && eq(buf, "C:\\up"));
    CHECK(_wfullpath(wbuf, L"b", 260) == wbuf && weq(wbuf, L"C:\\GAME\\work\\a\\b"));
    errno = 0; CHECK(_fullpath(buf, "longer-than-five", 5) == 0 && errno == ERANGE);
    CHECK(GetFullPathNameA("b/../c", 260, buf, 0) == 16 && eq(buf, "C:\\GAME\\work\\a\\c"));
    { char *part = (char *)1; wchar_t *wpart = (wchar_t *)1;
      CHECK(GetFullPathNameA("C:\\", 260, buf, &part) == 3 && eq(buf, "C:\\") && part == 0);
      CHECK(GetFullPathNameW(L"C:\\", 260, wbuf, &wpart) == 3 && weq(wbuf, L"C:\\") && wpart == 0);
      CHECK(GetFullPathNameA("b/", 260, buf, &part) == 17 && eq(buf, "C:\\GAME\\work\\a\\b\\") && part == 0);
      CHECK(GetFullPathNameW(L"b\\", 260, wbuf, &wpart) == 17 && weq(wbuf, L"C:\\GAME\\work\\a\\b\\") && wpart == 0);
      CHECK(GetFullPathNameW(L"b\\file", 260, wbuf, &wpart) == 21 && wpart == wbuf + 17 && weq(wpart, L"file"));
      CHECK(_fullpath(buf, "b/", sizeof buf) == buf && eq(buf, "C:\\GAME\\work\\a\\b\\"));
      CHECK(_wfullpath(wbuf, L"b\\", 260) == wbuf && weq(wbuf, L"C:\\GAME\\work\\a\\b\\"));
    }
    /* NULL-output allocation counts must be validated before narrowing/multiplication. */
    NULLS(_wfullpath(0, L"b", (size_t)0x80000000u), ENOMEM);
    NULLS(_wfullpath(0, L"b", (size_t)0x80000001u), ENOMEM);
#ifdef _WIN64
    NULLS(_fullpath(0, "b", (size_t)0x100000001ull), ENOMEM);
    NULLS(_wfullpath(0, L"b", (size_t)0x100000001ull), ENOMEM);
#endif
    FAILS(_rmdir("."), EACCES);
    FAILS(_rmdir("..\\a"), EACCES);          /* the current directory */
    FAILS(rename("..\\a", "..\\a2"), EACCES); /* in use */
    FAILS(_chdir("missing"), ENOENT);
    FAILS(_chdir("C:\\GAME\\nested\\seed.txt"), EINVAL);
    CHECK(_chdir("..\\..") == 0 && _getcwd(buf, sizeof buf) == buf && eq(buf, "C:\\GAME"));
    CHECK(SetCurrentDirectoryW(L"work\\wide") && _getcwd(buf, sizeof buf) == buf && eq(buf, "C:\\GAME\\work\\wide"));
    CHECK(_wchdir(L"C:\\GAME") == 0 && _getcwd(buf, sizeof buf) == buf && eq(buf, "C:\\GAME"));
    CHECK(SetCurrentDirectoryA("work") && is_dir("a") && SetCurrentDirectoryW(L".."));
    CHECK(_getdrive() == 3 && _chdrive(3) == 0);

}
static __attribute__((noinline)) void section5(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- rmdir */
    FAILS(_rmdir("work/a"), ENOTEMPTY);
    CHECK(_rmdir("work/a/b") == 0 && absent("work/a/b") && k_missing(L"work\\a\\b") && GetLastError() == ERROR_FILE_NOT_FOUND);
    CHECK(_rmdir("work/a") == 0 && absent("work/a"));
    FAILS(_rmdir("work/a"), ENOENT);
    FAILS(_rmdir("nested"), EACCES);
    FAILS(_rmdir("nested/seed.txt"), EINVAL);
    FAILS(_rmdir("C:\\GAME"), EACCES);
    FAILS(_rmdir("missing/dir"), ENOENT);
    CHECK(_wrmdir(L"work/wide") == 0 && absent("work/wide"));
    CHECK(RemoveDirectoryW(L"work\\abs") && absent("work/abs") && !RemoveDirectoryW(L"work\\abs") && GetLastError() == ERROR_FILE_NOT_FOUND);
    CHECK(RemoveDirectoryA("work/fromk32a") && absent("work/fromk32a"));
    CHECK(!RemoveDirectoryW(L"nested") && GetLastError() == ERROR_ACCESS_DENIED);
    CHECK(_mkdir("work/wide") == 0); /* the freed name is reusable */

}
static __attribute__((noinline)) void section6(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- rename of directories, with children */
    CHECK(rename("work/Mixed", "work/Renamed") == 0 && absent("work/Mixed") && is_dir("work/Renamed") && k_dir(L"work\\renamed"));
    CHECK(_mkdir("work/p") == 0 && _mkdir("work/p/q") == 0 && _mkdir("work/p/q/r") == 0);
    CHECK(rename("work/p", "work/Moved") == 0 && is_dir("work/Moved/q/r") && absent("work/p") && absent("work/p/q") && k_dir(L"work\\moved\\q\\r"));
    { list_t l; list_crt("work/*", &l); CHECK(has(&l, "Moved") && has(&l, "Renamed") && !has(&l, "p") && !has(&l, "Mixed")); }
    CHECK(rename("work/Moved", "work/MOVED") == 0 && is_dir("work/moved")); /* case-only rename */
    { list_t l; list_crt("work/m*", &l); CHECK(l.n == 1 && eq(l.name[0], "MOVED")); }
    FAILS(rename("work/wide", "work/Renamed"), EEXIST);
    FAILS(rename("missing", "x"), ENOENT);
    FAILS(rename("nested", "moved"), EACCES);
    FAILS(rename("nested/seed.txt", "work/seed.txt"), EACCES);
    FAILS(rename("work/MOVED", "work/MOVED/inside"), EACCES);
    FAILS(rename("work/MOVED", "nowhere/x"), ENOENT);
    FAILS(rename("work/MOVED", "work/bad|name"), EINVAL);
    CHECK(MoveFileW(L"work\\MOVED", L"work\\byk32") && is_dir("work/byk32/q/r") && !MoveFileW(L"work\\byk32", L"work\\wide") && GetLastError() == ERROR_ALREADY_EXISTS);
    CHECK(_wrename(L"work/byk32", L"work/MOVED") == 0);
    CHECK(_rmdir("work/MOVED/q/r") == 0 && _rmdir("work/MOVED/q") == 0 && _rmdir("work/MOVED") == 0);

}
static __attribute__((noinline)) void section7(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- access */
    CHECK(_access("work", 0) == 0 && _access("work", 2) == 0 && _access("nested/seed.txt", 4) == 0 && _waccess(L"nested/seed.txt", 0) == 0);
    FAILS(_access("nested/seed.txt", 2), EACCES);
    FAILS(_access("nested/seed.txt", 6), EACCES);
    FAILS(_access("nested/seed.txt", 1), EINVAL);
    FAILS(_access("absent", 0), ENOENT);
    CHECK(_access_s("work", 0) == 0 && _access_s("absent", 0) == ENOENT && _waccess_s(L"nested/seed.txt", 2) == EACCES);
    FAILS(remove("work"), EACCES);
    FAILS(remove("nested/seed.txt"), EACCES);
    FAILS(remove("absent"), ENOENT);
    FAILS(remove("absent/x"), ENOENT);
    CHECK(!DeleteFileW(L"nested\\seed.txt") && GetLastError() == ERROR_ACCESS_DENIED);
    CHECK(!DeleteFileW(L"work") && GetLastError() == ERROR_ACCESS_DENIED);
    CHECK(!DeleteFileA("absent") && GetLastError() == ERROR_FILE_NOT_FOUND);

}
#ifdef _WIN64
static __attribute__((noinline)) void section8(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- mutable files: the CRT FILE layer writes through the same index */
    { FILE *f = fopen("work/f.txt", "wb");
      CHECK(f != 0);
      CHECK(fwrite("hello", 1, 5, f) == 5);
      CHECK(_stat64("work/f.txt", &s) == 0 && s.st_size == 5 && s.st_mode == 0x81b6 && s.st_nlink == 1 && s.st_dev == 2);
      long long created = s.st_ctime, first = s.st_mtime;
      CHECK(created >= t0 && first >= created && first <= now_t());
      WIN32_FILE_ATTRIBUTE_DATA ad;
      CHECK(GetFileAttributesExW(L"work\\f.txt", GetFileExInfoStandard, &ad) && ad.nFileSizeLow == 5 && ad.nFileSizeHigh == 0 && ad.dwFileAttributes == FILE_ATTRIBUTE_ARCHIVE);
      CHECK(ft_t(ad.ftLastWriteTime) == s.st_mtime && ft_t(ad.ftCreationTime) == s.st_ctime);
      int fd = _fileno(f);
      CHECK(_fstat64(fd, &s2) == 0 && s2.st_size == 5 && s2.st_mode == 0x81b6 && s2.st_mtime == s.st_mtime && s2.st_ctime == s.st_ctime);
      { struct _stat32 a; struct _stat64i32 c; struct _stat32i64 b; HMODULE m = LoadLibraryA("msvcrt.dll");
        typedef int (__cdecl *fstat_fn)(int, void *);
        fstat_fn f64i32 = (fstat_fn)GetProcAddress(m, "_fstat64i32");
        CHECK(_fstat32(fd, &a) == 0 && a.st_size == 5 && _fstat32i64(fd, &b) == 0 && b.st_size == 5 && f64i32 && f64i32(fd, &c) == 0 && c.st_size == 5 && c.st_mtime == s.st_mtime); }
      CHECK(_fstat64(1, &s2) == 0 && s2.st_mode == 0x2000 && s2.st_size == 0);
      FAILS(_fstat64(99, &s2), EBADF);
      Sleep(2500);
      { struct _stat64 parent; WIN32_FILE_ATTRIBUTE_DATA adir; struct __finddata64_t dot;
        CHECK(_stat64("work", &parent) == 0);
        FILE *late = fopen("work/later.tmp", "wb"); CHECK(late && fclose(late) == 0);
        CHECK(_stat64("work", &s2) == 0 && s2.st_mtime >= parent.st_mtime + 2 && s2.st_ctime == parent.st_ctime);
        CHECK(GetFileAttributesExW(L"work", GetFileExInfoStandard, &adir) && ft_t(adir.ftLastWriteTime) == s2.st_mtime);
        intptr_t dh = _findfirst64("work/*", &dot); CHECK(dh != -1 && eq(dot.name, ".") && dot.time_write == s2.st_mtime); _findclose(dh);
        CHECK(remove("work/later.tmp") == 0);
      }
      CHECK(fwrite("!", 1, 1, f) == 1);
      CHECK(_stat64("work/f.txt", &s2) == 0 && s2.st_size == 6 && s2.st_mtime >= first + 2 && s2.st_ctime == created);
      FAILS(remove("work/f.txt"), EACCES);               /* open: sharing violation */
      FAILS(rename("work/f.txt", "work/other.txt"), EACCES);
      CHECK(!DeleteFileW(L"work\\f.txt") && GetLastError() == ERROR_SHARING_VIOLATION);
      FAILS(_rmdir("work"), ENOTEMPTY);
      CHECK(fclose(f) == 0);
      FILE *g = fopen("work/f.txt", "rb"); CHECK(g != 0); CHECK(_stat64("work/f.txt", &s) == 0 && s.st_mtime == s2.st_mtime); /* reading does not touch it */ fclose(g);
    }
    { errno = 0; FILE *bad = fopen("work", "r"); CHECK(!bad && errno == EACCES);
      errno = 0; bad = fopen("work", "w"); CHECK(!bad && errno == EACCES);
      errno = 0; bad = fopen("nodir/x.txt", "w"); CHECK(!bad && errno == ENOENT);
      errno = 0; bad = fopen("nested/seed.txt/x", "w"); CHECK(!bad && errno == ENOENT);
      errno = 0; bad = fopen("work/a*b", "w"); CHECK(!bad && errno == EINVAL);
      errno = 0; bad = fopen("nested/seed.txt", "w"); CHECK(!bad && errno == EACCES);
      errno = 0; bad = fopen("work/absent.txt", "r"); CHECK(!bad && errno == ENOENT);
      CHECK(absent("nodir") && absent("work/absent.txt") && absent("work/a*b")); }
    CHECK(_access("work/f.txt", 6) == 0 && _access("work/f.txt", 2) == 0);
    { list_t c, k; list_crt("work/f.*", &c); list_k32(L"work/f.*", &k); CHECK(c.n == 1 && eq(c.name[0], "f.txt") && !(c.attr[0] & _A_SUBDIR) && same_lists(&c, &k));
      struct __finddata64_t fd; intptr_t h = _findfirst64("work/f.txt", &fd); CHECK(h != -1 && fd.size == 6 && fd.time_write == s2.st_mtime && fd.time_create == s2.st_ctime); _findclose(h);
      WIN32_FIND_DATAW w; HANDLE kh = FindFirstFileW(L"work\\f.txt", &w); CHECK(kh != INVALID_HANDLE_VALUE && w.nFileSizeLow == 6 && ft_t(w.ftLastWriteTime) == s2.st_mtime && ft_t(w.ftCreationTime) == s2.st_ctime); FindClose(kh); }
    FAILS(rename("work/f.txt", "work/g.txt/"), ENOENT);
    CHECK(_stat64("work/f.txt", &s) == 0 && s.st_size == 6 && absent("work/g.txt"));
    CHECK(!MoveFileW(L"work/f.txt", L"work/g.txt/") && GetLastError() == ERROR_PATH_NOT_FOUND);
    CHECK(_stat64("work/f.txt", &s) == 0 && s.st_size == 6 && absent("work/g.txt"));
    CHECK(rename("work/f.txt", "work/g.txt") == 0 && absent("work/f.txt") && k_missing(L"work\\f.txt"));
    CHECK(_stat64("work/g.txt", &s) == 0 && s.st_size == 6 && s.st_ctime == s2.st_ctime);
    { FILE *h2 = fopen("work/h.txt", "wb"); CHECK(h2 && fclose(h2) == 0); }
    FAILS(rename("work/g.txt", "work/h.txt"), EEXIST);
    FAILS(rename("work/g.txt", "work/Renamed"), EEXIST);
    FAILS(rename("work/h.txt", "work/nope/h.txt"), ENOENT);
    { FILE *g = fopen("work/g.txt", "rb"); char data[8] = { 0 }; CHECK(g && fread(data, 1, 8, g) == 6 && eq(data, "hello!")); fclose(g); } /* contents moved with the name */
    CHECK(MoveFileW(L"work\\g.txt", L"work\\k.txt") && _stat64("work/k.txt", &s) == 0 && s.st_size == 6);
    CHECK(remove("work/k.txt") == 0 && absent("work/k.txt"));
    FAILS(remove("work/k.txt"), ENOENT);
    CHECK(DeleteFileW(L"work\\h.txt") && absent("work/h.txt"));
    { FILE *u = fopen("work/u.txt", "wb"); CHECK(u && fclose(u) == 0 && _unlink("work/u.txt") == 0); u = fopen("work/w.txt", "wb"); CHECK(u && fclose(u) == 0 && _wremove(L"work/w.txt") == 0 && absent("work/w.txt")); }
    /* a file below a renamed directory keeps its bytes and index entry */
    CHECK(_mkdir("work/box") == 0);
    { FILE *b = fopen("work/box/in.bin", "wb"); CHECK(b && fwrite("xyz", 1, 3, b) == 3 && fclose(b) == 0); }
    FAILS(_rmdir("work/box"), ENOTEMPTY);
    CHECK(rename("work/box", "work/crate") == 0 && absent("work/box/in.bin") && _stat64("work/crate/in.bin", &s) == 0 && s.st_size == 3);
    { FILE *b = fopen("work/crate/in.bin", "rb"); char d3[4] = { 0 }; CHECK(b && fread(d3, 1, 3, b) == 3 && eq(d3, "xyz")); fclose(b); }
    { FILE *b = fopen("work/crate/in.bin", "ab"); CHECK(b != 0); FAILS(rename("work/crate", "work/box"), EACCES); fclose(b); }
    { FILE *a2 = fopen("work/crate/created-in-cwd.txt", "wb"); CHECK(a2 && fclose(a2) == 0); CHECK(_chdir("work/crate") == 0); CHECK(_stat64("created-in-cwd.txt", &s) == 0);
      FILE *rel = fopen("relative.txt", "wb"); CHECK(rel && fclose(rel) == 0 && _stat64("C:\\GAME\\work\\crate\\relative.txt", &s) == 0);
      FILE *again = fopen("RELATIVE.TXT", "rb"); CHECK(again != 0); if (again) fclose(again);
      CHECK(remove("relative.txt") == 0 && remove("created-in-cwd.txt") == 0 && _chdir("..\\..") == 0); }
    CHECK(remove("work/crate/in.bin") == 0 && _rmdir("work/crate") == 0);
    { FILE *t = tmpfile(); CHECK(t && fwrite("temp", 1, 4, t) == 4); int tfd = _fileno(t); CHECK(_fstat64(tfd, &s) == 0 && s.st_size == 4 && s.st_mode == 0x81b6 && s.st_mtime >= t0);
      Sleep(2100);
      CHECK(_fstat64(tfd, &s2) == 0 && s2.st_ctime == s.st_ctime && s2.st_mtime == s.st_mtime && s2.st_atime == s.st_atime);
      CHECK(fwrite("!", 1, 1, t) == 1 && _fstat64(tfd, &s2) == 0 && s2.st_size == 5 && s2.st_ctime == s.st_ctime && s2.st_mtime >= s.st_mtime + 2);
      fclose(t); FAILS(_fstat64(tfd, &s), EBADF); }
    { list_t l; list_crt("work/*", &l); }
}
#endif
static __attribute__((noinline)) void section9(long long t0) {
    struct _stat64 s, s2; wchar_t wbuf[260]; char buf[260];
    (void)s; (void)s2; (void)wbuf; (void)buf; (void)t0;
    /* ---- clean up the scratch tree through both APIs */
    CHECK(_rmdir("work/Renamed") == 0 && _rmdir("work/wide") == 0 && _rmdir("work/fromk32") == 0);
    CHECK(_rmdir("work") == 0 && absent("work") && k_missing(L"work"));
    { list_t l; list_crt("*", &l); CHECK(!has(&l, "work")); }

    test_registry();

}

#include "crt_fs_prefix.h"
int main(void) {
    test_prefixes();
    long long t0 = now_t();
    CHECK(t0 > 1000000000ll);
    section0(t0);
    section1(t0);
    section2(t0);
    section3(t0);
    section4(t0);
    section5(t0);
    section6(t0);
    section7(t0);
#ifdef _WIN64
    section8(t0);
#endif
    section9(t0);
    char summary[96]; { const char *p = failures ? "crtfs FAIL checks=" : "crtfs PASS checks="; int n = 0; while (p[n]) { summary[n] = p[n]; n++; }
      char digits[12]; int d = 0; unsigned v = checks; do { digits[d++] = (char)('0' + v % 10); v /= 10; } while (v); while (d) summary[n++] = digits[--d]; summary[n] = 0; }
    OutputDebugStringA(summary);
    (void)slen;
    return failures ? 1 : 0;
}
