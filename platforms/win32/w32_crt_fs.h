/* CRT metadata, directory and path functions (msvcrt/UCRT, both guest widths) over the shared VFS index.
 * Every function here calls the same w32_fs_* operations as the KERNEL32 front ends; only the error
 * translation (Win32 error -> errno) and the guest struct layouts are CRT specific. MIT. */
#ifdef X86_FLAT_GUEST
uint32_t crt_errno_cell(void);
#define XC_ERRNO_CELL() crt_errno_cell()
#else
static uint32_t xc_errno_v;
static uint32_t xc_errno_cell(void) { if (!xc_errno_v) xc_errno_v = w32_misc_alloc(4); return xc_errno_v; }
#define XC_ERRNO_CELL() xc_errno_cell()
#endif
/* UCRT __acrt_errno_map_os_error table (INFERRED from the documented mapping; ERROR_DIRECTORY and
 * ERROR_INVALID_NAME are absent from it and therefore EINVAL). */
int w32_errno_from_win32(uint32_t e) {
    switch (e) {
    case 1: return 22; case 2: case 3: return 2; case 4: return 24; case 5: return 13; case 6: return 9;
    case 7: case 8: case 9: return 12; case 10: return 7; case 11: return 8; case 12: case 13: return 22;
    case 15: return 2; case 16: return 13; case 17: return 18; case 18: return 2; case 33: return 13;
    case 53: return 2; case 65: return 13; case 67: return 2; case 80: return 17; case 82: case 83: return 13;
    case 87: return 22; case 89: return 11; case 108: return 13; case 109: return 32; case 112: return 28;
    case 114: return 9; case 128: case 129: return 10; case 130: return 9; case 131: return 22; case 132: return 13;
    case 145: return 41; case 158: return 13; case 161: return 2; case 164: return 11; case 167: return 13;
    case 183: return 17; case 206: return 2; case 215: return 11; case 1816: return 12;
    }
    if (e >= 19 && e <= 36) return 13;
    if (e >= 188 && e <= 202) return 8;
    return 22;
}
static uint32_t xc_set(int e) { x86_wr32(XC_ERRNO_CELL(), (uint32_t)e); return 0xffffffffu; }
static uint32_t xc_fail(uint32_t win32) { return xc_set(w32_errno_from_win32(win32)); }
static uint32_t xc_errno(void) { return XC_ERRNO_CELL(); }
static uint32_t xc_get_errno(void) { if (!ARG(0)) { xc_set(22); return 22; } x86_wr32(ARG(0), x86_rd32(XC_ERRNO_CELL())); return 0; }
static uint32_t xc_set_errno(void) { x86_wr32(XC_ERRNO_CELL(), ARG(0)); return 0; }

/* Reads the ASCII path argument; 0 when NULL or too long (> 511 characters). */
static int xc_path(uint32_t arg, int wide, char *raw, unsigned cap) {
    if (!arg) return 0;
    uint32_t n = w32_gstr(arg, wide, raw, cap);
    return n + 1 < cap;
}
static int64_t xc_time(uint64_t ft) { return (int64_t)(ft / 10000000ull) - 11644473600ll; }

/* ---- stat family: kind 0 = _stat32, 1 = _stat32i64, 2 = _stat64i32, 3 = _stat64 (identical for both widths) */
static uint32_t xc_fill_stat(uint32_t out, unsigned kind, const w32_fs_info_t *i, int chr, int fd) {
    static const uint32_t sizes[4] = { 36, 48, 48, 56 };
    if (!x86_accessible(out, sizes[kind], 2)) return xc_set(22);
    int64_t t[3] = { xc_time(i->accessed ? i->accessed : i->written), xc_time(i->written), xc_time(i->created) };
    int time32 = kind == 0 || kind == 1, size32 = kind == 0 || kind == 2;
    if (!chr) {
        if (time32) for (unsigned k = 0; k < 3; k++) if (t[k] < 0 || t[k] > 0x7fffffffll) return xc_set(132);
        if (size32 && i->size > 0x7fffffffull) return xc_set(132);
    }
    for (uint32_t k = 0; k < sizes[kind]; k += 4) x86_wr32(out + k, 0);
    uint32_t mode;
    if (chr) mode = 0x2000;
    else {
        mode = i->dir ? 0x4000u | 0x40u : 0x8000u;
        mode |= 0x100u; if (!(i->attrs & 1)) mode |= 0x80u;
        if (!i->dir && i->exec) mode |= 0x40u;
        mode |= (mode & 0x1c0u) >> 3; mode |= (mode & 0x1c0u) >> 6;
    }
    uint32_t dev = chr ? (uint32_t)fd : 2u;
    x86_wr32(out, dev); x86_wr16(out + 6, mode); x86_wr16(out + 8, 1); x86_wr32(out + 16, dev);
    uint32_t size_at = size32 ? 20u : 24u, time_at = kind == 0 ? 24u : kind == 1 ? 32u : kind == 2 ? 24u : 32u;
    if (size32) x86_wr32(out + size_at, (uint32_t)(chr ? 0 : i->size)); else x86_wr64(out + size_at, chr ? 0 : i->size);
    for (unsigned k = 0; k < 3; k++) {
        if (time32) x86_wr32(out + time_at + 4 * k, (uint32_t)(chr ? 0 : t[k]));
        else x86_wr64(out + time_at + 8 * k, (uint64_t)(chr ? 0 : t[k]));
    }
    return 0;
}
static uint32_t xc_do_stat(int wide, unsigned kind) {
    char raw[520]; w32_fs_info_t info;
    if (!ARG(1)) return xc_set(22);
    if (!ARG(0)) return xc_set(22);
    if (!xc_path(ARG(0), wide, raw, sizeof raw)) return xc_set(2);
    if (w32_fs_stat(raw, &info)) return xc_set(2); /* UCRT reports every lookup failure as ENOENT */
    return xc_fill_stat(ARG(1), kind, &info, 0, 0);
}
static uint32_t xc_do_fstat(unsigned kind) {
    w32_fs_info_t info; int chr = 0, fd = (int)ARG(0);
    if (!ARG(1)) return xc_set(22);
    if (!w32_crt_fd_stat(fd, &info, &chr)) return xc_set(9);
    return xc_fill_stat(ARG(1), kind, &info, chr, fd);
}

/* ---- find family: kind as above; handles are the KERNEL32 search handles */
static void xc_find_write(uint32_t out, int wide, unsigned kind, const find_entry_t *e) {
    static const uint32_t narrow[4] = { 280, 288, 296, 304 }, wides[4] = { 540, 544, 560, 560 };
    uint32_t total = wide ? wides[kind] : narrow[kind];
    for (uint32_t k = 0; k + 4 <= total; k += 4) x86_wr32(out + k, 0);
    x86_wr32(out, e->attrs);
    int time32 = kind < 2, size32 = kind == 0 || kind == 2;
    uint64_t ft[3] = { e->created, e->accessed, e->written };
    for (unsigned k = 0; k < 3; k++) {
        int64_t t = ft[k] ? xc_time(ft[k]) : -1;
        if (time32) x86_wr32(out + 4 + 4 * k, (uint32_t)t); else x86_wr64(out + 8 + 8 * k, (uint64_t)t);
    }
    uint32_t size_at = time32 ? 16u : 32u, name_at = kind == 0 ? 20u : kind == 1 ? 24u : kind == 2 ? 36u : 40u;
    if (size32) x86_wr32(out + size_at, (uint32_t)e->size); else x86_wr64(out + size_at, e->size);
    w32_pstr(out + name_at, 260, wide, e->name);
}
static uint32_t xc_do_findfirst(int wide, unsigned kind) {
    char raw[520]; unsigned slot; find_entry_t e;
    if (!ARG(1)) return xc_set(22);
    if (!xc_path(ARG(0), wide, raw, sizeof raw)) return xc_set(ARG(0) ? 2 : 22);
    uint32_t err = find_begin(raw, &slot, &e);
    if (err) return xc_fail(err);
    xc_find_write(ARG(1), wide, kind, &e);
    return 0x120000 + slot;
}
static uint32_t xc_do_findnext(int wide, unsigned kind) {
    uint32_t slot = ARG(0) - 0x120000;
    if (slot >= 64 || !find_files[slot].open || !ARG(1)) return xc_set(22);
    find_entry_t e;
    if (!find_take(slot, &e)) return xc_set(2);
    xc_find_write(ARG(1), wide, kind, &e); return 0;
}
static uint32_t xc_findclose(void) {
    uint32_t slot = ARG(0) - 0x120000;
    if (slot >= 64 || !find_files[slot].open) return xc_set(22);
    find_files[slot].open = 0; return 0;
}

/* ---- access, directories, files */
static uint32_t xc_access_impl(int wide, int secure) {
    char raw[520]; w32_fs_info_t info; uint32_t mode = ARG(1);
    if (!ARG(0) || (mode & ~6u)) { xc_set(22); return secure ? 22 : 0xffffffffu; }
    uint32_t e = xc_path(ARG(0), wide, raw, sizeof raw) ? w32_fs_stat(raw, &info) : 2;
    if (e) { xc_set(2); return secure ? 2 : 0xffffffffu; }
    if ((mode & 2) && (info.attrs & 1) && !info.dir) { xc_set(13); return secure ? 13 : 0xffffffffu; }
    return 0;
}
static uint32_t xc_path_op(int wide, uint32_t (*op)(const char *)) {
    char raw[520];
    if (!ARG(0)) return xc_set(22);
    if (!xc_path(ARG(0), wide, raw, sizeof raw)) return xc_set(2);
    uint32_t e = op(raw); return e ? xc_fail(e) : 0;
}
static uint32_t xc_rename(int wide) {
    char a[520], b[520];
    if (!ARG(0) || !ARG(1)) return xc_set(22);
    if (!xc_path(ARG(0), wide, a, sizeof a) || !xc_path(ARG(1), wide, b, sizeof b)) return xc_set(2);
    uint32_t e = w32_fs_move(a, b); return e ? xc_fail(e) : 0;
}
static uint32_t xc_result_string(const char *text, uint32_t n, uint32_t buf, uint64_t units, int wide) {
    if (!buf) {
        uint64_t cap = units > n + 1 ? units : n + 1;
        unsigned width = wide ? 2u : 1u;
        /* Validate size_t before narrowing or multiplying: a wrapped byte count corrupts the guest heap. */
        if (cap > UINT32_MAX / width) { xc_set(12); return 0; }
        uint32_t p = w32_heap_alloc((uint32_t)cap * width, 0);
        if (!p) { xc_set(12); return 0; }
        w32_pstr(p, n + 1, wide, text); return p;
    }
    if (units <= n) { xc_set(units ? 34 : 22); return 0; }
    w32_pstr(buf, n + 1, wide, text); return buf;
}
static uint32_t xc_getcwd(int wide) {
    char t[560]; uint32_t n = w32_fs_cwd_text(t);
    if ((int32_t)ARG(1) < 0) { xc_set(22); return 0; }
    return xc_result_string(t, n, ARG(0), ARG(1), wide);
}
static uint32_t xc_getdcwd(int wide) {
    char t[560]; uint32_t n = w32_fs_cwd_text(t), drive = ARG(0);
    if ((int32_t)ARG(2) < 0) { xc_set(22); return 0; }
    if (drive != 0 && drive != 3) { xc_set(13); return 0; }
    return xc_result_string(t, n, ARG(1), ARG(2), wide);
}
static uint32_t xc_fullpath(int wide) {
    char raw[520], out[560]; uint64_t max = ARG64(2);
    if (!ARG(1)) { char t[560]; uint32_t n = w32_fs_cwd_text(t); return xc_result_string(t, n, ARG(0), max, wide); }
    if (!xc_path(ARG(1), wide, raw, sizeof raw)) { xc_set(34); return 0; }
    uint32_t error, n = w32_fs_fullpath(raw, out, sizeof out, &error);
    if (!n) { xc_set(error ? w32_errno_from_win32(error) : 34); return 0; }
    return xc_result_string(out, n, ARG(0), max, wide);
}
static uint32_t xc_getdrive(void) { return 3; }
static uint32_t xc_chdrive(void) { return ARG(0) == 3 ? 0 : xc_set(13); }

#define XC_STAT(sym, wide, kind) static uint32_t xc_##sym(void) { return xc_do_stat(wide, kind); }
#define XC_FSTAT(sym, kind) static uint32_t xc_##sym(void) { return xc_do_fstat(kind); }
#define XC_FIND(sym, wide, kind) static uint32_t xc_##sym(void) { return xc_do_findfirst(wide, kind); }
#define XC_NEXT(sym, wide, kind) static uint32_t xc_##sym(void) { return xc_do_findnext(wide, kind); }
#define W_(a, b) (W32_64 ? (b) : (a))
XC_STAT(stat32, 0, 0) XC_STAT(stat32i64, 0, 1) XC_STAT(stat64i32, 0, 2) XC_STAT(stat64, 0, 3)
XC_STAT(stat, 0, W_(0, 2)) XC_STAT(stati64, 0, W_(1, 3))
XC_STAT(wstat32, 1, 0) XC_STAT(wstat32i64, 1, 1) XC_STAT(wstat64i32, 1, 2) XC_STAT(wstat64, 1, 3)
XC_STAT(wstat, 1, W_(0, 2)) XC_STAT(wstati64, 1, W_(1, 3))
XC_FSTAT(fstat32, 0) XC_FSTAT(fstat32i64, 1) XC_FSTAT(fstat64i32, 2) XC_FSTAT(fstat64, 3)
XC_FSTAT(fstat, W_(0, 2)) XC_FSTAT(fstati64, W_(1, 3))
XC_FIND(findfirst32, 0, 0) XC_FIND(findfirst32i64, 0, 1) XC_FIND(findfirst64i32, 0, 2) XC_FIND(findfirst64, 0, 3)
XC_FIND(findfirst, 0, W_(0, 2)) XC_FIND(findfirsti64, 0, W_(1, 3))
XC_FIND(wfindfirst32, 1, 0) XC_FIND(wfindfirst32i64, 1, 1) XC_FIND(wfindfirst64i32, 1, 2) XC_FIND(wfindfirst64, 1, 3)
XC_FIND(wfindfirst, 1, W_(0, 2)) XC_FIND(wfindfirsti64, 1, W_(1, 3))
XC_NEXT(findnext32, 0, 0) XC_NEXT(findnext32i64, 0, 1) XC_NEXT(findnext64i32, 0, 2) XC_NEXT(findnext64, 0, 3)
XC_NEXT(findnext, 0, W_(0, 2)) XC_NEXT(findnexti64, 0, W_(1, 3))
XC_NEXT(wfindnext32, 1, 0) XC_NEXT(wfindnext32i64, 1, 1) XC_NEXT(wfindnext64i32, 1, 2) XC_NEXT(wfindnext64, 1, 3)
XC_NEXT(wfindnext, 1, W_(0, 2)) XC_NEXT(wfindnexti64, 1, W_(1, 3))
static uint32_t xc_access(void) { return xc_access_impl(0, 0); }
static uint32_t xc_waccess(void) { return xc_access_impl(1, 0); }
static uint32_t xc_access_s(void) { return xc_access_impl(0, 1); }
static uint32_t xc_waccess_s(void) { return xc_access_impl(1, 1); }
static uint32_t xc_mkdir(void) { return xc_path_op(0, w32_fs_mkdir); }
static uint32_t xc_wmkdir(void) { return xc_path_op(1, w32_fs_mkdir); }
static uint32_t xc_rmdir(void) { return xc_path_op(0, w32_fs_rmdir); }
static uint32_t xc_wrmdir(void) { return xc_path_op(1, w32_fs_rmdir); }
static uint32_t xc_chdir(void) { return xc_path_op(0, w32_fs_chdir); }
static uint32_t xc_wchdir(void) { return xc_path_op(1, w32_fs_chdir); }
static uint32_t xc_remove(void) { return xc_path_op(0, w32_fs_delete); }
static uint32_t xc_wremove(void) { return xc_path_op(1, w32_fs_delete); }
static uint32_t xc_rename_a(void) { return xc_rename(0); }
static uint32_t xc_rename_w(void) { return xc_rename(1); }
static uint32_t xc_getcwd_a(void) { return xc_getcwd(0); }
static uint32_t xc_getcwd_w(void) { return xc_getcwd(1); }
static uint32_t xc_getdcwd_a(void) { return xc_getdcwd(0); }
static uint32_t xc_getdcwd_w(void) { return xc_getdcwd(1); }
static uint32_t xc_fullpath_a(void) { return xc_fullpath(0); }
static uint32_t xc_fullpath_w(void) { return xc_fullpath(1); }
