/*
 * Win32 profile: KERNEL32, the MSVC runtime (msvcrt / ucrt api-sets), ADVAPI32 registry,
 * SHELL32/COMCTL32 basics. Behaviour follows the documented Win32 API; anything a game needs
 * beyond this is a kit gap (unimplemented imports fault with their name).
 *
 * Determinism: time sources derive from the BGT frame counter and ?seed, never the wall clock.
 *
 * SPDX-License-Identifier: MIT
 */
#include "w32_int.h"

#define DATA 255 /* nargs marker: data import (IAT slot points at a variable, not a thunk) */
static uint32_t last_error;
static uint32_t rng_state = 1;

/* ------------------------------------------------------------------ formatted output (wsprintf/sprintf) */
/* Formats from a guest format string with guest varargs starting at `va`. Supports
 * %[-0][width][.prec][l|h]{d,i,u,x,X,c,s,S,p,%}. */
static uint32_t gformat(uint32_t fmt, int wide_fmt, uint32_t va, char *out, uint32_t cap) {
    uint32_t n = 0, i = 0;
    for (;;) {
        uint32_t c = wide_fmt ? x86_rd16(fmt + 2 * i) : x86_rd8(fmt + i);
        i++;
        if (!c) break;
        if (c != '%') { if (n + 1 < cap) out[n++] = (char)c; continue; }
        int left = 0, zero = 0, width = 0, prec = -1, lng = 0, int64_fmt=0, length_l=0;
        for (;;) {
            c = wide_fmt ? x86_rd16(fmt + 2 * i) : x86_rd8(fmt + i);
            if (c == '-') { left = 1; i++; } else if (c == '0') { zero = 1; i++; } else if (c == '#' || c == '+' || c == ' ') i++; else break;
        }
        while ((c = wide_fmt ? x86_rd16(fmt + 2 * i) : x86_rd8(fmt + i)) >= '0' && c <= '9') { width = width * 10 + (int)(c - '0'); i++; }
        if (c == '.') { i++; prec = 0; while ((c = wide_fmt ? x86_rd16(fmt + 2 * i) : x86_rd8(fmt + i)) >= '0' && c <= '9') { prec = prec * 10 + (int)(c - '0'); i++; } }
        if(c=='I'){i++;uint32_t d=wide_fmt?x86_rd16(fmt+2*i):x86_rd8(fmt+i);if(d=='6'){i+=2;int64_fmt=1;}c=wide_fmt?x86_rd16(fmt+2*i):x86_rd8(fmt+i);}
        while (c == 'l' || c == 'h' || c == 'w') { if(c=='l')length_l++;lng = c == 'w' || c=='l'; i++; c = wide_fmt ? x86_rd16(fmt + 2 * i) : x86_rd8(fmt + i); }
        int64_fmt|=length_l>=2;
        i++;
        char tmp[64];
        uint32_t tn = 0;
        if (c == 'd' || c == 'i' || c == 'u' || c == 'x' || c == 'X' || c == 'p') {
            int wide_int=int64_fmt || (W32_64 && c=='p');
            uint64_t v=wide_int?x86_rd64(va):x86_rd32(va);va+=W32_64?8:wide_int?8:4;
            int neg = (c == 'd' || c == 'i') && (wide_int?(int64_t)v<0:(int32_t)v<0);
            uint64_t u=neg?(wide_int?0ull-v:(uint32_t)(0u-(uint32_t)v)):v;uint32_t base = (c == 'x' || c == 'X' || c == 'p') ? 16 : 10;
            if (c == 'p') { width = W32_64?16:8; zero = 1; }
            char d[32]; int dn = 0;
            do { uint32_t r = (uint32_t)(u % base); d[dn++] = (char)(r < 10 ? '0' + r : (c == 'X' || c == 'p' ? 'A' : 'a') + r - 10); u /= base; } while (u);
            while (prec > dn && dn < 31) d[dn++] = '0';
            if (neg) tmp[tn++] = '-';
            int pad = width - dn - (int)tn;
            if (zero && !left) while (pad-- > 0 && tn < 40) tmp[tn++] = '0';
            while (dn) tmp[tn++] = d[--dn];
            if (!zero || left) { /* space padding handled below */ }
        } else if (c == 'c') {
            tmp[tn++] = (char)(x86_rd32(va) & 0x7f); va += w32_ptr_size();
        } else if (c == 's' || c == 'S') {
            uint32_t p = x86_rd32(va); va += w32_ptr_size();
            int ws = (c == 'S') ? !wide_fmt : wide_fmt;
            if (lng) ws = 1;
            char s[512];
            uint32_t sl = p ? w32_gstrn(p, prec >= 0 ? prec : -1, ws, s, sizeof s) : (uint32_t)0;
            if (!p) { const char *nul = "(null)"; sl = 0; while (nul[sl]) { s[sl] = nul[sl]; sl++; } s[sl] = 0; }
            int pad = width - (int)sl;
            if (!left) while (pad-- > 0 && n + 1 < cap) out[n++] = ' ';
            for (uint32_t k = 0; k < sl && n + 1 < cap; k++) out[n++] = s[k];
            if (left) while (pad-- > 0 && n + 1 < cap) out[n++] = ' ';
            continue;
        } else if (c == '%') {
            tmp[tn++] = '%';
        } else {
            continue; /* unsupported conversion: skipped */
        }
        int pad = width - (int)tn;
        if (!left && !zero) while (pad-- > 0 && n + 1 < cap) out[n++] = ' ';
        for (uint32_t k = 0; k < tn && n + 1 < cap; k++) out[n++] = tmp[k];
        if (left) while (pad-- > 0 && n + 1 < cap) out[n++] = ' ';
    }
    out[n] = 0;
    return n;
}
uint32_t w32_format_to_guest(uint32_t dst, uint32_t cap, int wide, uint32_t fmt, uint32_t va) {
    static char buf[2048];
    uint32_t n = gformat(fmt, wide, va, buf, sizeof buf);
    w32_pstr(dst, cap, wide, buf);
    return n < cap ? n : cap - 1;
}

/* ------------------------------------------------------------------ KERNEL32 */
/* Module resolution (Win32 semantics): a name is a shipped pipeline module (game.json) first, then a system DLL the
 * profile implements (platforms/win32/dlls.json). Anything else does not exist: LoadLibrary returns NULL with
 * ERROR_MOD_NOT_FOUND, so programs take their own error path instead of calling a thunk that aborts. */
#define ERROR_INVALID_HANDLE 6u
#define ERROR_MOD_NOT_FOUND 126u
#define ERROR_PROC_NOT_FOUND 127u
static uint32_t module_handle(const char *raw, int load) {
    char n[64];
    w32_module_name(raw, n, sizeof n);
    for (uint32_t i = 0; i < w32_nmods; i++) if (w32_streqi(w32_mods[i].name, n)) return w32_mods[i].base;
    uint32_t h = w32_sysdll_handle(n, load);
    if (!h) last_error = ERROR_MOD_NOT_FOUND;
    return h;
}
static uint32_t k_GetModuleHandle(int wide) {
    uint32_t p = ARG(0);
    if (!p) return w32_mod_by_handle(0)->base;
    char n[64];
    w32_gstr(p, wide, n, sizeof n);
    return module_handle(n, 0); /* only modules that are loaded (statically imported or LoadLibrary'd) */
}
static uint32_t k_GetModuleHandleA(void) { return k_GetModuleHandle(0); }
static uint32_t k_GetModuleHandleW(void) { return k_GetModuleHandle(1); }
static uint32_t k_LoadLibrary(int wide) {
    char n[64];
    if (!ARG(0)) { last_error = 87; return 0; } /* ERROR_INVALID_PARAMETER */
    w32_gstr(ARG(0), wide, n, sizeof n);
    return module_handle(n, 1);
}
static uint32_t k_LoadLibraryA(void) { return k_LoadLibrary(0); }
static uint32_t k_LoadLibraryW(void) { return k_LoadLibrary(1); }
static uint32_t k_FreeLibrary(void) {
    uint32_t h = ARG(0);
    if (w32_mod_by_handle(h) && h) return 1;
    if (w32_sysdll_name(h)) return 1;
    last_error = ERROR_INVALID_HANDLE;
    return 0;
}
static uint32_t k_GetProcAddress(void) {
    uint32_t h = ARG(0), p = ARG(1), addr = 0;
    char n[64];
    int by_ord = p < 0x10000u;
    if (!by_ord) w32_gstr(p, 0, n, sizeof n);
    w32_module_t *m = 0;
    for (uint32_t i = 0; i < w32_nmods; i++) if (w32_mods[i].base == h) m = &w32_mods[i];
    const char *dll = w32_sysdll_name(h);
    if (m) addr = w32_export_addr(m, by_ord ? 0 : n, p);
    else if (dll) addr = by_ord ? 0 : w32_resolve_api(dll, n); /* the profile implements names, not ordinals */
    else { last_error = ERROR_MOD_NOT_FOUND; return 0; }       /* INFERRED: error code for an invalid module handle */
    if (!addr) last_error = ERROR_PROC_NOT_FOUND;
    return addr;
}
static uint32_t k_GetModuleFileName(int wide) {
    w32_module_t *m = w32_mod_by_handle(ARG(0));
    char path[96] = "C:\\GAME\\";
    uint32_t k = 8;
    for (const char *s = m ? m->name : "game.exe"; *s && k < 90; s++) path[k++] = *s;
    path[k] = 0;
    return w32_pstr(ARG(1), ARG(2), wide, path);
}
static uint32_t k_GetModuleFileNameA(void) { return k_GetModuleFileName(0); }
static uint32_t k_GetModuleFileNameW(void) { return k_GetModuleFileName(1); }
static uint32_t k_ExitProcess(void) {
    w32_exited = 1;
    w32_exit_code = ARG(0);
    w32_log("win32 profile: ExitProcess");
    for (;;) w32_wait_frame();
    return 0;
}
static uint32_t cmdline_a, cmdline_w;
static void ensure_cmdline(void) {
    if (cmdline_a) return;
    w32_module_t *m = w32_mod_by_handle(0);
    char buf[256];
    uint32_t k = 0;
    for (const char *s = m ? m->name : "game.exe"; *s && k < 120; s++) buf[k++] = *s;
    buf[k] = 0;
    cmdline_a = w32_misc_alloc(256);
    cmdline_w = w32_misc_alloc(512);
    w32_pstr(cmdline_a, 256, 0, buf);
    w32_pstr(cmdline_w, 256, 1, buf);
}
static uint32_t k_GetCommandLineA(void) { ensure_cmdline(); return cmdline_a; }
static uint32_t k_GetCommandLineW(void) { ensure_cmdline(); return cmdline_w; }
static uint32_t k_GetStartupInfo(void) { uint32_t p = ARG(0); for (uint32_t i = 0; i < (X.mode64?104u:68u); i++) x86_wr8(p + i, 0); x86_wr32(p, X.mode64?104:68); return 0; }
static uint32_t k_GetVersion(void) { return 0x0a280105u; } /* Windows XP 5.1 build 2600 */
static uint32_t k_GetVersionEx(void) {
    uint32_t p = ARG(0);
    x86_wr32(p + 4, 5); x86_wr32(p + 8, 1); x86_wr32(p + 12, 2600); x86_wr32(p + 16, 2);
    return 1;
}
static uint32_t k_GetTickCount(void) { return w32_now_ms(); }
static uint32_t k_QueryPerformanceCounter(void) { uint64_t t = (uint64_t)w32_now_ms() * 1000u; x86_wr32(ARG(0), (uint32_t)t); x86_wr32(ARG(0) + 4, (uint32_t)(t >> 32)); return 1; }
static uint32_t k_QueryPerformanceFrequency(void) { x86_wr32(ARG(0), 1000000u); x86_wr32(ARG(0) + 4, 0); return 1; }
static uint64_t filetime_now(void) {
    /* INFERRED: deterministic clock = 2001-10-25 00:00 UTC + ?seed days + elapsed frames */
    uint64_t unix = 1003968000ull + (uint64_t)(w32_io ? w32_io->seed : 0) * 86400ull + w32_now_ms() / 1000u;
    return (unix + 11644473600ull) * 10000000ull + (uint64_t)(w32_now_ms() % 1000u) * 10000ull;
}
static uint32_t k_GetSystemTimeAsFileTime(void) { uint64_t t = filetime_now(); x86_wr32(ARG(0), (uint32_t)t); x86_wr32(ARG(0) + 4, (uint32_t)(t >> 32)); return 0; }
static void systemtime(uint32_t p) {
    uint64_t secs = filetime_now() / 10000000ull - 11644473600ull;
    uint32_t days = (uint32_t)(secs / 86400ull), rem = (uint32_t)(secs % 86400ull);
    /* civil-from-days (Howard Hinnant's algorithm, public domain) */
    int32_t z = (int32_t)days + 719468, era = z / 146097;
    uint32_t doe = (uint32_t)(z - era * 146097), yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    int32_t y = (int32_t)yoe + era * 400;
    uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100), mp = (5 * doy + 2) / 153, d = doy - (153 * mp + 2) / 5 + 1, m = mp < 10 ? mp + 3 : mp - 9;
    x86_wr16(p, (uint32_t)(y + (m <= 2))); x86_wr16(p + 2, m); x86_wr16(p + 4, (days + 4) % 7); x86_wr16(p + 6, d);
    x86_wr16(p + 8, rem / 3600); x86_wr16(p + 10, rem / 60 % 60); x86_wr16(p + 12, rem % 60); x86_wr16(p + 14, w32_now_ms() % 1000u);
}
static uint32_t k_GetSystemTime(void) { systemtime(ARG(0)); return 0; }
static uint32_t k_Sleep(void) {
    w32_sleep_ms(ARG(0));
    return 0;
}
static uint32_t k_GetLastError(void) { return last_error; }
static uint32_t k_SetLastError(void) { last_error = ARG(0); return 0; }
static uint32_t k_one(void) { return 1; }
static uint32_t k_zero(void) { return 0; }
static uint32_t k_GetCurrentProcess(void) { return 0xffffffffu; }
static uint32_t k_GetCurrentThread(void) { return 0xfffffffeu; }
static uint32_t tls[64];
static uint32_t tls_used;
static uint32_t k_TlsAlloc(void) { for (uint32_t i = 0; i < 64; i++) if (!(tls_used & (1u << (i & 31))) && i < 32) { tls_used |= 1u << i; return i; } return 0xffffffffu; }
static uint32_t k_TlsFree(void) { if (ARG(0) < 32) tls_used &= ~(1u << ARG(0)); return 1; }
static uint32_t k_TlsGetValue(void) { return ARG(0) < 64 ? tls[ARG(0)] : 0; }
static uint32_t k_TlsSetValue(void) { if (ARG(0) < 64) tls[ARG(0)] = ARG(1); return 1; }
static uint32_t k_InterlockedIncrement(void) { uint32_t v = x86_rd32(ARG(0)) + 1; x86_wr32(ARG(0), v); return v; }
static uint32_t k_InterlockedDecrement(void) { uint32_t v = x86_rd32(ARG(0)) - 1; x86_wr32(ARG(0), v); return v; }
static uint32_t k_InterlockedExchange(void) { uint32_t v = x86_rd32(ARG(0)); x86_wr32(ARG(0), ARG(1)); return v; }
static uint32_t k_InterlockedCompareExchange(void) { uint32_t v = x86_rd32(ARG(0)); if (v == ARG(2)) x86_wr32(ARG(0), ARG(1)); return v; }
/* heaps: one guest heap serves all (HeapCreate returns a pseudo handle) */
static uint32_t k_HeapCreate(void) { return H_HEAP + 1; }
static uint32_t k_GetProcessHeap(void) { return H_HEAP; }
static uint32_t k_HeapAlloc(void) { return w32_heap_alloc(ARG(2), (ARG(1) & 8u) != 0); }
static uint32_t k_HeapFree(void) { w32_heap_free(ARG(2)); return 1; }
static uint32_t k_HeapReAlloc(void) { return w32_heap_realloc(ARG(2), ARG(3)); }
static uint32_t k_HeapSize(void) { return w32_heap_size(ARG(2)); }
static uint32_t k_LocalAlloc(void) { return w32_heap_alloc(ARG(1), (ARG(0) & 0x40u) != 0); }
static uint32_t k_LocalFree(void) { w32_heap_free(ARG(0)); return 0; }
static uint32_t k_LocalReAlloc(void) { return w32_heap_realloc(ARG(0), ARG(1)); }
static uint32_t k_Lock(void) { return ARG(0); }
static uint32_t k_Size(void) { return w32_heap_size(ARG(0)); }
static uint32_t k_VirtualAlloc(void) {
    uint32_t want = ARG(0), size = ARG(1);
    if (want && x86_mapped(want, size)) return want;
    return w32_heap_alloc(size, 1); /* contents zeroed as committed pages are */
}
static uint32_t k_VirtualFree(void) { return 1; }
static uint32_t k_lstrlen(int wide) { uint32_t p = ARG(0), n = 0; if (!p) return 0; while ((wide ? x86_rd16(p + 2 * n) : x86_rd8(p + n)) && n < 1u << 20) n++; return n; }
static uint32_t k_lstrlenA(void) { return k_lstrlen(0); }
static uint32_t k_lstrlenW(void) { return k_lstrlen(1); }
static uint32_t k_lstrcpyn(int wide, int32_t max) {
    uint32_t d = ARG(0), s = ARG(1), sz = wide ? 2 : 1, i = 0;
    for (; max < 0 || i + 1 < (uint32_t)max; i++) {
        uint32_t c = wide ? x86_rd16(s + i * sz) : x86_rd8(s + i);
        if (wide) x86_wr16(d + i * 2, c); else x86_wr8(d + i, c);
        if (!c) return d;
    }
    if (wide) x86_wr16(d + i * 2, 0); else x86_wr8(d + i, 0);
    return d;
}
static uint32_t k_lstrcpyA(void) { return k_lstrcpyn(0, -1); }
static uint32_t k_lstrcpyW(void) { return k_lstrcpyn(1, -1); }
static uint32_t k_lstrcpynA(void) { return k_lstrcpyn(0, (int32_t)ARG(2)); }
static uint32_t k_lstrcpynW(void) { return k_lstrcpyn(1, (int32_t)ARG(2)); }
static uint32_t k_lstrcat(int wide) {
    uint32_t d = ARG(0), s = ARG(1), sz = wide ? 2 : 1, n = 0, i = 0;
    while (wide ? x86_rd16(d + n * sz) : x86_rd8(d + n)) n++;
    for (;; i++) { uint32_t c = wide ? x86_rd16(s + i * sz) : x86_rd8(s + i); if (wide) x86_wr16(d + (n + i) * 2, c); else x86_wr8(d + n + i, c); if (!c) break; }
    return d;
}
static uint32_t k_lstrcatA(void) { return k_lstrcat(0); }
static uint32_t k_lstrcatW(void) { return k_lstrcat(1); }
static uint32_t k_lstrcmp(int wide, int ci) {
    uint32_t a = ARG(0), b = ARG(1), sz = wide ? 2 : 1;
    for (uint32_t i = 0;; i++) {
        uint32_t x = wide ? x86_rd16(a + i * sz) : x86_rd8(a + i), y = wide ? x86_rd16(b + i * sz) : x86_rd8(b + i);
        if (ci) { if (x >= 'a' && x <= 'z') x -= 32; if (y >= 'a' && y <= 'z') y -= 32; }
        if (x != y) return x < y ? 0xffffffffu : 1;
        if (!x) return 0;
    }
}
static uint32_t k_lstrcmpA(void) { return k_lstrcmp(0, 0); }
static uint32_t k_lstrcmpW(void) { return k_lstrcmp(1, 0); }
static uint32_t k_lstrcmpiA(void) { return k_lstrcmp(0, 1); }
static uint32_t k_lstrcmpiW(void) { return k_lstrcmp(1, 1); }
static uint32_t k_MulDiv(void) {
    int64_t a = (int32_t)ARG(0), b = (int32_t)ARG(1), c = (int32_t)ARG(2);
    if (!c) return 0xffffffffu;
    int64_t p = a * b, q = (p + (((p < 0) != (c < 0)) ? -c / 2 : c / 2)) / c;
    return (uint32_t)(int32_t)q;
}
static uint32_t k_GetACP(void) { return 1252; }
static uint32_t k_MultiByteToWideChar(void) {
    uint32_t src = ARG(2), n = ARG(3), dst = ARG(4), cap = ARG(5), len = 0;
    if ((int32_t)n < 0) { while (x86_rd8(src + len)) len++; len++; } else len = n;
    if (!cap) return len;
    uint32_t k = 0;
    for (; k < len && k < cap; k++) x86_wr16(dst + 2 * k, x86_rd8(src + k));
    return k;
}
static uint32_t k_WideCharToMultiByte(void) {
    uint32_t src = ARG(2), n = ARG(3), dst = ARG(4), cap = ARG(5), len = 0;
    if ((int32_t)n < 0) { while (x86_rd16(src + 2 * len)) len++; len++; } else len = n;
    if (!cap) return len;
    uint32_t k = 0;
    for (; k < len && k < cap; k++) { uint32_t c = x86_rd16(src + 2 * k); x86_wr8(dst + k, c < 256 ? c : '?'); }
    return k;
}
static uint32_t k_OutputDebugStringA(void) { char b[200]; w32_gstr(ARG(0), 0, b, sizeof b); w32_logf2("guest: ", b); return 0; }
static uint32_t k_OutputDebugStringW(void) { char b[200]; w32_gstr(ARG(0), 1, b, sizeof b); w32_logf2("guest: ", b); return 0; }
static uint32_t k_RaiseException(void) { x86_fault("guest RaiseException (structured exceptions are not supported)", ARG(0)); }
static uint32_t k_GetSystemInfo(void) { uint32_t p = ARG(0); for (int i = 0; i < 36; i++) x86_wr8(p + (uint32_t)i, 0); x86_wr32(p + 4, 4096); x86_wr32(p + 20, 1); x86_wr32(p + 24, 586); x86_wr32(p + 28, 65536); return 0; }
/* HRSRC = address of the IMAGE_RESOURCE_DATA_ENTRY; string resource types are not supported */
static uint32_t k_FindResource(int wide) { return ARG(2) < 0x10000u ? w32_res_entry(ARG(0), ARG(2), ARG(1), wide) : 0; }
static uint32_t k_FindResourceA(void) { return k_FindResource(0); }
static uint32_t k_FindResourceW(void) { return k_FindResource(1); }
static uint32_t k_LoadResource(void) {
    w32_module_t *m = w32_mod_by_handle(ARG(0));
    return ARG(1) && m ? m->base + x86_rd32(ARG(1)) : 0;
}
static uint32_t k_LockResource(void) { return ARG(0); }
static uint32_t k_SizeofResource(void) { return ARG(1) ? x86_rd32(ARG(1) + 4) : 0; }
static uint32_t k_GetStdHandle(void) { return 0x100u + (ARG(0) & 0xff); }
static uint32_t k_WriteFile(void) {
    if (ARG(0) != 0x1f5u && ARG(0) != 0x1f4u) { if(ARG(3))x86_wr32(ARG(3),0);last_error=ARG(0)>0x90000u&&ARG(0)<0x90040u?5:6;return 0; }
    char b[256];
    uint32_t n = ARG(2) < 255 ? ARG(2) : 255;
    w32_gstrn(ARG(1), (int32_t)n, 0, b, sizeof b);
    w32_logf2("guest stdout: ", b);
    if (ARG(3)) x86_wr32(ARG(3), ARG(2));
    return 1;
}
#define H_FILE 0x00090000u
static struct { uint32_t asset; uint64_t pos, size; } files[64];
static uint32_t file_index(uint32_t h) { return h > H_FILE && h < H_FILE + 64 && files[h-H_FILE].asset ? h-H_FILE : 0; }
static int32_t open_file_asset(int wide) {
    char raw[512], path[512]; w32_gstr(ARG(0),wide,raw,sizeof raw);
    const char *s=raw;
    if ((s[0]=='C'||s[0]=='c') && s[1]==':' && (s[2]=='\\' || s[2]=='/')) { s+=3; if (w32_slen(s)>=5 && (s[0]=='G'||s[0]=='g')&&(s[1]=='A'||s[1]=='a')&&(s[2]=='M'||s[2]=='m')&&(s[3]=='E'||s[3]=='e')&&(s[4]=='\\'||s[4]=='/'))s+=5; }
    uint32_t k=0;while(*s && k+1<sizeof path){char c=*s++;path[k++]=c=='\\'?'/':(c>='A'&&c<='Z'?c+32:c);}path[k]=0;
    int32_t asset=-5;
    for(uint32_t i=0;i<w32_nmods;i++)if(w32_streqi(path,w32_mods[i].name)){
        char module[64]="modules/";uint32_t j=8;for(const char *c=w32_mods[i].name;*c&&j<63;c++)module[j++]=*c;module[j]=0;
        asset=bgt_asset_open(module,j);break;
    }
    if(asset<0)asset=bgt_asset_open(path,w32_slen(path));
    return asset;
}
static uint32_t create_file(int wide) {
    if ((ARG(1) & 0x40000000u) || ARG(4) != 3) { last_error=5; return 0xffffffffu; } /* read-only OPEN_EXISTING */
    int32_t asset=open_file_asset(wide);
    if(asset<0){last_error=2;return 0xffffffffu;}
    for(uint32_t i=1;i<64;i++)if(!files[i].asset){uint64_t size=0;if(bgt_asset_size64((uint32_t)asset,&size)<0)break;files[i].asset=(uint32_t)asset;files[i].size=size;files[i].pos=0;last_error=0;return H_FILE+i;}
    bgt_asset_close((uint32_t)asset);last_error=4;return 0xffffffffu;
}
static uint32_t k_CreateFileA(void){return create_file(0);}
static uint32_t k_CreateFileW(void){return create_file(1);}
static uint32_t k_CloseHandle(void){uint32_t i=file_index(ARG(0));if(!i){last_error=6;return 0;}bgt_asset_close(files[i].asset);files[i].asset=0;return 1;}
static uint32_t k_ReadFile(void){
    uint32_t i=file_index(ARG(0)),dst=ARG(1),want=ARG(2),got=0,out=ARG(3);
    if(out)x86_wr32(out,0);
    if(!i||ARG(4)){last_error=i?87:6;return 0;}
    if((uint64_t)dst+want>0x100000000ull || !x86_mapped(dst,want)){last_error=998;return 0;}
    static uint8_t buffer[65536];
    while(got<want && files[i].pos<files[i].size){
        uint32_t n=want-got;if(n>sizeof buffer)n=sizeof buffer;
        if(n>files[i].size-files[i].pos)n=(uint32_t)(files[i].size-files[i].pos);
        int32_t request=bgt_asset_range_request(files[i].asset,(uint32_t)files[i].pos,(uint32_t)(files[i].pos>>32),n);
        if(request<0){last_error=30;return 0;}
        int32_t status;while((status=bgt_request_status((uint32_t)request))==0)w32_wait_frame();
        int32_t count=status==1?bgt_request_read((uint32_t)request,buffer,sizeof buffer):status;
        bgt_request_close((uint32_t)request);
        if(count<0){last_error=30;return 0;}
        for(int32_t j=0;j<count;j++)x86_wr8(dst+got+(uint32_t)j,buffer[j]);
        got+=(uint32_t)count;files[i].pos+=(uint32_t)count;if(!count)break;
    }
    if(out)x86_wr32(out,got);return 1;
}
static uint32_t k_GetFileSize(void){uint32_t i=file_index(ARG(0));if(!i){last_error=6;return 0xffffffffu;}if(ARG(1))x86_wr32(ARG(1),(uint32_t)(files[i].size>>32));return (uint32_t)files[i].size;}
static uint32_t k_GetFileSizeEx(void){uint32_t i=file_index(ARG(0));if(!i){last_error=6;return 0;}x86_wr32(ARG(1),(uint32_t)files[i].size);x86_wr32(ARG(1)+4,(uint32_t)(files[i].size>>32));return 1;}
static int seek_file(uint32_t i,int64_t delta,uint32_t method){
    if(!i){last_error=6;return 0;}
    uint64_t base=method==0?0:method==1?files[i].pos:files[i].size;
    if(method>2 || (delta<0 && (uint64_t)(-(delta+1))+1>base) || (delta>0 && (uint64_t)delta>0x7fffffffffffffffull-base)){last_error=87;return 0;}
    files[i].pos=base+(uint64_t)delta;last_error=0;return 1;
}
static uint32_t k_SetFilePointer(void){uint32_t i=file_index(ARG(0));int64_t d=(int32_t)ARG(1);if(ARG(2))d=(int64_t)(((uint64_t)x86_rd32(ARG(2))<<32)|ARG(1));if(!seek_file(i,d,ARG(3)))return 0xffffffffu;if(ARG(2))x86_wr32(ARG(2),(uint32_t)(files[i].pos>>32));return (uint32_t)files[i].pos;}
static uint32_t k_SetFilePointerEx(void){uint32_t i=file_index(ARG(0)),out=ARG(W32_64?2:3),method=ARG(W32_64?3:4);int64_t d=W32_64?(int64_t)ARG64(1):(int64_t)(((uint64_t)ARG(2)<<32)|ARG(1));if(!seek_file(i,d,method))return 0;if(out){x86_wr32(out,(uint32_t)files[i].pos);x86_wr32(out+4,(uint32_t)(files[i].pos>>32));}return 1;}
static uint32_t get_file_attributes(int wide) { int32_t asset=open_file_asset(wide);if(asset<0){last_error=2;return 0xffffffffu;}bgt_asset_close((uint32_t)asset);return 0x21u; /* READONLY|ARCHIVE */ }
static uint32_t k_GetFileAttributesA(void) { return get_file_attributes(0); }
static uint32_t k_GetFileAttributesW(void) { return get_file_attributes(1); }
static uint32_t k_GetWindowsDirectory(int wide) { return w32_pstr(ARG(0), ARG(1), wide, "C:\\WINDOWS"); }
static uint32_t k_GetWindowsDirectoryA(void) { return k_GetWindowsDirectory(0); }
static uint32_t k_GetWindowsDirectoryW(void) { return k_GetWindowsDirectory(1); }

/* ---- profile strings / registry on bgt_storage */
static uint32_t fnv(const char *s, uint32_t h) { for (; *s; s++) { char c = *s; if (c >= 'A' && c <= 'Z') c = (char)(c + 32); h = (h ^ (uint8_t)c) * 16777619u; } return h; }
static void storage_key(char *dst, const char *kind, const char *a, const char *b) {
    uint32_t h = fnv(b, fnv("\\", fnv(a, 2166136261u)));
    uint32_t n = 0;
    while (*kind) dst[n++] = *kind++;
    dst[n++] = '.';
    static const char HX[] = "0123456789abcdef";
    for (int i = 7; i >= 0; i--) dst[n++] = HX[(h >> (i * 4)) & 15u];
    dst[n] = 0;
}
static uint32_t k_GetPrivateProfileInt(int wide) {
    char sec[64], key[64], k[32], buf[32];
    w32_gstr(ARG(0), wide, sec, sizeof sec); w32_gstr(ARG(1), wide, key, sizeof key);
    storage_key(k, "ini", sec, key);
    int32_t n = bgt_storage_read(k, w32_slen(k), buf, sizeof buf - 1);
    if (n <= 0) return ARG(2);
    buf[n < 31 ? n : 31] = 0;
    int32_t v = 0, neg = buf[0] == '-';
    for (char *c = buf + neg; *c >= '0' && *c <= '9'; c++) v = v * 10 + (*c - '0');
    return (uint32_t)(neg ? -v : v);
}
static uint32_t k_GetPrivateProfileIntA(void) { return k_GetPrivateProfileInt(0); }
static uint32_t k_GetPrivateProfileIntW(void) { return k_GetPrivateProfileInt(1); }
static uint32_t k_GetPrivateProfileString(int wide) {
    char sec[64], key[64], k[32], buf[256];
    w32_gstr(ARG(0), wide, sec, sizeof sec); w32_gstr(ARG(1), wide, key, sizeof key);
    storage_key(k, "ini", sec, key);
    int32_t n = bgt_storage_read(k, w32_slen(k), buf, sizeof buf - 1);
    if (n <= 0) { w32_gstr(ARG(2), wide, buf, sizeof buf); return w32_pstr(ARG(3), ARG(4), wide, buf); }
    buf[n < 255 ? n : 255] = 0;
    return w32_pstr(ARG(3), ARG(4), wide, buf);
}
static uint32_t k_GetPrivateProfileStringA(void) { return k_GetPrivateProfileString(0); }
static uint32_t k_GetPrivateProfileStringW(void) { return k_GetPrivateProfileString(1); }
static uint32_t k_WritePrivateProfileString(int wide) {
    char sec[64], key[64], k[32], val[256];
    w32_gstr(ARG(0), wide, sec, sizeof sec); w32_gstr(ARG(1), wide, key, sizeof key); w32_gstr(ARG(2), wide, val, sizeof val);
    storage_key(k, "ini", sec, key);
    return bgt_storage_write(k, w32_slen(k), val, w32_slen(val)) == BGT_OK;
}
static uint32_t k_WritePrivateProfileStringA(void) { return k_WritePrivateProfileString(0); }
static uint32_t k_WritePrivateProfileStringW(void) { return k_WritePrivateProfileString(1); }

/* registry: open keys are paths; values live in storage as [u32 type][data] */
static char keys[64][160];
static uint32_t nkeys;
static const char *key_path(uint32_t h) {
    if (h == 0x80000000u) return "HKCR";
    if (h == 0x80000001u) return "HKCU";
    if (h == 0x80000002u) return "HKLM";
    if (h == 0x80000003u) return "HKU";
    if (h >= H_KEY && h < H_KEY + nkeys) return keys[h - H_KEY];
    return 0;
}
static uint32_t reg_open(int wide, uint32_t parent, uint32_t sub, uint32_t out) {
    const char *pp = key_path(parent);
    if (!pp) return 6; /* ERROR_INVALID_HANDLE */
    char s[128], full[160];
    w32_gstr(sub, wide, s, sizeof s);
    uint32_t n = 0;
    for (const char *c = pp; *c && n < 150; c++) full[n++] = *c;
    if (s[0]) { full[n++] = '\\'; for (const char *c = s; *c && n < 159; c++) full[n++] = *c; }
    full[n] = 0;
    for (uint32_t i = 0; i < nkeys; i++) if (w32_streqi(keys[i], full)) { w32_wrptr(out, H_KEY + i); return 0; }
    if (nkeys >= 64) return 8;
    for (uint32_t i = 0; i <= n; i++) keys[nkeys][i] = full[i];
    w32_wrptr(out, H_KEY + nkeys++);
    return 0;
}
static uint32_t r_RegOpenKeyExA(void) { return reg_open(0, ARG(0), ARG(1), ARG(4)); }
static uint32_t r_RegOpenKeyExW(void) { return reg_open(1, ARG(0), ARG(1), ARG(4)); }
static uint32_t r_RegOpenKeyA(void) { return reg_open(0, ARG(0), ARG(1), ARG(2)); }
static uint32_t r_RegOpenKeyW(void) { return reg_open(1, ARG(0), ARG(1), ARG(2)); }
static uint32_t r_RegCreateKeyEx(int wide) { uint32_t rc = reg_open(wide, ARG(0), ARG(1), ARG(7)); if (!rc && ARG(8)) x86_wr32(ARG(8), 2); return rc; }
static uint32_t r_RegCreateKeyExA(void) { return r_RegCreateKeyEx(0); }
static uint32_t r_RegCreateKeyExW(void) { return r_RegCreateKeyEx(1); }
static uint32_t r_RegCloseKey(void) { return 0; }
static uint32_t r_RegQueryValueEx(int wide) {
    const char *kp = key_path(ARG(0));
    if (!kp) return 6;
    char name[96], k[32];
    w32_gstr(ARG(1), wide, name, sizeof name);
    storage_key(k, "reg", kp, name);
    static uint8_t buf[4096];
    int32_t n = bgt_storage_read(k, w32_slen(k), buf, sizeof buf);
    if (n < 4) return 2; /* ERROR_FILE_NOT_FOUND */
    uint32_t type = (uint32_t)buf[0] | ((uint32_t)buf[1] << 8) | ((uint32_t)buf[2] << 16) | ((uint32_t)buf[3] << 24);
    uint32_t len = (uint32_t)n - 4, pcb = ARG(5);
    if (ARG(3)) x86_wr32(ARG(3), type);
    if (!pcb) return 0;
    uint32_t cap = x86_rd32(pcb);
    x86_wr32(pcb, len);
    if (!ARG(4)) return 0;
    if (cap < len) return 234; /* ERROR_MORE_DATA */
    for (uint32_t i = 0; i < len; i++) x86_wr8(ARG(4) + i, buf[4 + i]);
    return 0;
}
static uint32_t r_RegQueryValueExA(void) { return r_RegQueryValueEx(0); }
static uint32_t r_RegQueryValueExW(void) { return r_RegQueryValueEx(1); }
static uint32_t r_RegSetValueEx(int wide) {
    const char *kp = key_path(ARG(0));
    if (!kp) return 6;
    char name[96], k[32];
    w32_gstr(ARG(1), wide, name, sizeof name);
    storage_key(k, "reg", kp, name);
    static uint8_t buf[4096];
    uint32_t len = ARG(5) > sizeof buf - 4 ? sizeof buf - 4 : ARG(5), type = ARG(3);
    buf[0] = (uint8_t)type; buf[1] = (uint8_t)(type >> 8); buf[2] = (uint8_t)(type >> 16); buf[3] = (uint8_t)(type >> 24);
    for (uint32_t i = 0; i < len; i++) buf[4 + i] = (uint8_t)x86_rd8(ARG(4) + i);
    return bgt_storage_write(k, w32_slen(k), buf, len + 4) == BGT_OK ? 0 : 8;
}
static uint32_t r_RegSetValueExA(void) { return r_RegSetValueEx(0); }
static uint32_t r_RegSetValueExW(void) { return r_RegSetValueEx(1); }
static uint32_t r_RegDeleteValue(void) { return 0; }

/* ------------------------------------------------------------------ MSVC runtime (cdecl) */
#define CARG(n) ARG(n)
static uint32_t c_malloc(void) { return w32_heap_alloc(CARG(0), 0); }
static uint32_t c_calloc(void) { return w32_heap_alloc(CARG(0) * CARG(1), 1); }
static uint32_t c_realloc(void) { return w32_heap_realloc(CARG(0), CARG(1)); }
static uint32_t c_free(void) { w32_heap_free(CARG(0)); return 0; }
static uint32_t c_msize(void) { return w32_heap_size(CARG(0)); }
static uint32_t c_memset(void) { for (uint32_t i = 0; i < CARG(2); i++) x86_wr8(CARG(0) + i, CARG(1)); return CARG(0); }
static uint32_t c_memcpy(void) {
    uint32_t d = CARG(0), s = CARG(1), n = CARG(2);
    if (d > s && d < s + n) for (uint32_t i = n; i > 0; i--) x86_wr8(d + i - 1, x86_rd8(s + i - 1));
    else for (uint32_t i = 0; i < n; i++) x86_wr8(d + i, x86_rd8(s + i));
    return d;
}
static uint32_t c_memcmp(void) { for (uint32_t i = 0; i < CARG(2); i++) { uint32_t a = x86_rd8(CARG(0) + i), b = x86_rd8(CARG(1) + i); if (a != b) return a < b ? 0xffffffffu : 1; } return 0; }
static uint32_t c_strlen(void) { uint32_t n = 0; while (x86_rd8(CARG(0) + n)) n++; return n; }
static uint32_t c_wcslen(void) { uint32_t n = 0; while (x86_rd16(CARG(0) + 2 * n)) n++; return n; }
static uint32_t c_strcpy(void) { uint32_t i = 0, c; do { c = x86_rd8(CARG(1) + i); x86_wr8(CARG(0) + i, c); i++; } while (c); return CARG(0); }
static uint32_t c_wcscpy(void) { uint32_t i = 0, c; do { c = x86_rd16(CARG(1) + 2 * i); x86_wr16(CARG(0) + 2 * i, c); i++; } while (c); return CARG(0); }
static uint32_t c_strcmp(void) { for (uint32_t i = 0;; i++) { uint32_t a = x86_rd8(CARG(0) + i), b = x86_rd8(CARG(1) + i); if (a != b) return a < b ? 0xffffffffu : 1; if (!a) return 0; } }
static uint32_t c_strchr(void) { for (uint32_t p = CARG(0);; p++) { uint32_t c = x86_rd8(p); if (c == (CARG(1) & 0xff)) return p; if (!c) return 0; } }
static uint32_t c_atoi(void) {
    uint32_t p = CARG(0);
    while (x86_rd8(p) == ' ') p++;
    int neg = x86_rd8(p) == '-';
    if (neg || x86_rd8(p) == '+') p++;
    int32_t v = 0;
    for (uint32_t c; (c = x86_rd8(p)) >= '0' && c <= '9'; p++) v = v * 10 + (int32_t)(c - '0');
    return (uint32_t)(neg ? -v : v);
}
static uint32_t c_abs(void) { int32_t v = (int32_t)CARG(0); return (uint32_t)(v < 0 ? -v : v); }
static uint32_t c_srand(void) { rng_state = CARG(0); return 0; }
/* documented MSVC runtime generator: holdrand = holdrand * 214013 + 2531011 */
static uint32_t c_rand(void) { rng_state = rng_state * 214013u + 2531011u; return (rng_state >> 16) & 0x7fffu; }
static uint32_t c_time(void) {
    uint32_t t = (uint32_t)(filetime_now() / 10000000ull - 11644473600ull);
    if (CARG(0)) x86_wr32(CARG(0), t);
    return t;
}
static uint32_t c_clock(void) { return w32_now_ms(); }
static uint32_t c_exit(void) { return k_ExitProcess(); }
static uint32_t c_sprintf(void) { return w32_format_to_guest(CARG(0), 4096, 0, CARG(1), (uint32_t)X.r[ESP]+(X.mode64?24:12)); }
static uint32_t c_swprintf(void) { return w32_format_to_guest(CARG(0), 4096, 1, CARG(1), (uint32_t)X.r[ESP]+(X.mode64?24:12)); }
static uint32_t c_snprintf(void) { return w32_format_to_guest(CARG(0), CARG(1), 0, CARG(2), (uint32_t)X.r[ESP]+(X.mode64?32:16)); }
static uint32_t c_initterm(void) {
    /* call each non-null function pointer in [begin, end) */
    uint32_t b = CARG(0), e = CARG(1);
    for (uint32_t p = b; p < e; p += w32_ptr_size()) { uint32_t fn = (uint32_t)w32_rdptr(p); if (fn) x86_callback(fn, 0, 0); }
    return 0;
}
static uint32_t c_initterm_e(void) {
    uint32_t b = CARG(0), e = CARG(1);
    for (uint32_t p = b; p < e; p += w32_ptr_size()) { uint32_t fn = (uint32_t)w32_rdptr(p); if (fn) { uint32_t r = x86_callback(fn, 0, 0); if (r) return r; } }
    return 0;
}
static uint32_t argv_cell, envp_cell;
static void ensure_args(void) {
    if (argv_cell) return;
    ensure_cmdline();
    argv_cell = w32_misc_alloc(16); envp_cell = w32_misc_alloc(16);
    w32_wrptr(argv_cell, cmdline_a); w32_wrptr(envp_cell, 0);
}
static uint32_t c_getmainargs(void) {
    ensure_args();
    x86_wr32(CARG(0), 1); w32_wrptr(CARG(1), argv_cell); w32_wrptr(CARG(2), envp_cell);
    return 0;
}
static uint32_t fmode_cell, commode_cell, adjust_fdiv_cell, argc_cell;
static uint32_t c_p_fmode(void) { if (!fmode_cell) fmode_cell = w32_misc_alloc(4); return fmode_cell; }
static uint32_t c_p_commode(void) { if (!commode_cell) commode_cell = w32_misc_alloc(4); return commode_cell; }
static uint32_t c_p_argc(void) { if (!argc_cell) { argc_cell = w32_misc_alloc(4); x86_wr32(argc_cell, 1); } return argc_cell; }
static uint32_t c_p_argv(void) { ensure_args(); uint32_t c = w32_misc_alloc(8); w32_wrptr(c, argv_cell); return c; }
static uint32_t c_controlfp(void) { return 0x9001fu; }
static uint32_t c_except_handler(void) { return 1; } /* ExceptionContinueSearch */
static uint32_t c_XcptFilter(void) { return 0; }  /* EXCEPTION_CONTINUE_SEARCH */
static uint32_t c_onexit_table(void) { return 0; }
/* data imports get a zeroed cell; a few have meaningful initial values */
uint32_t w32_data_import(const char *name) {
    uint32_t c = w32_misc_alloc(16);
    if (w32_streqi(name, "__argc")) x86_wr32(c, 1);
    if (w32_streqi(name, "__argv")) { ensure_args(); x86_wr32(c, argv_cell); }
    if (w32_streqi(name, "_acmdln")) { ensure_cmdline(); x86_wr32(c, cmdline_a); }
    if (w32_streqi(name, "_wcmdln")) { ensure_cmdline(); x86_wr32(c, cmdline_w); }
    if (w32_streqi(name, "_adjust_fdiv")) adjust_fdiv_cell = c;
    return c;
}

/* ------------------------------------------------------------------ SHELL32 / COMCTL32 */
static uint32_t s_ShellAboutA(void) { return w32_shell_about(0); }
static uint32_t s_ShellAboutW(void) { return w32_shell_about(1); }

#define API(n, a, f) {n, a, 0, f}
#define CAPI(n, f) {n, 0, 1, f}
#define STUB(n, a) {n, a, 0, 0}
#define CSTUB(n) {n, 0, 1, 0}
#define DATAI(n) {n, DATA, 1, 0}
const w32_api_t w32_api_kernel[] = {
    API("GetModuleHandleA", 1, k_GetModuleHandleA), API("GetModuleHandleW", 1, k_GetModuleHandleW),
    API("LoadLibraryA", 1, k_LoadLibraryA), API("LoadLibraryW", 1, k_LoadLibraryW),
    API("LoadLibraryExA", 3, k_LoadLibraryA), API("LoadLibraryExW", 3, k_LoadLibraryW), API("FreeLibrary", 1, k_FreeLibrary),
    API("GetProcAddress", 2, k_GetProcAddress),
    API("GetModuleFileNameA", 3, k_GetModuleFileNameA), API("GetModuleFileNameW", 3, k_GetModuleFileNameW),
    API("ExitProcess", 1, k_ExitProcess), API("TerminateProcess", 2, k_ExitProcess),
    API("GetCommandLineA", 0, k_GetCommandLineA), API("GetCommandLineW", 0, k_GetCommandLineW),
    API("GetStartupInfoA", 1, k_GetStartupInfo), API("GetStartupInfoW", 1, k_GetStartupInfo),
    API("GetVersion", 0, k_GetVersion), API("GetVersionExA", 1, k_GetVersionEx), API("GetVersionExW", 1, k_GetVersionEx),
    API("GetTickCount", 0, k_GetTickCount), API("timeGetTime", 0, k_GetTickCount),
    API("QueryPerformanceCounter", 1, k_QueryPerformanceCounter), API("QueryPerformanceFrequency", 1, k_QueryPerformanceFrequency),
    API("GetSystemTimeAsFileTime", 1, k_GetSystemTimeAsFileTime), API("GetSystemTime", 1, k_GetSystemTime), API("GetLocalTime", 1, k_GetSystemTime),
    API("Sleep", 1, k_Sleep),
    API("GetLastError", 0, k_GetLastError), API("SetLastError", 1, k_SetLastError),
    API("GetCurrentProcessId", 0, k_one), API("GetCurrentThreadId", 0, k_one),
    API("GetCurrentProcess", 0, k_GetCurrentProcess), API("GetCurrentThread", 0, k_GetCurrentThread),
    API("TlsAlloc", 0, k_TlsAlloc), API("TlsFree", 1, k_TlsFree), API("TlsGetValue", 1, k_TlsGetValue), API("TlsSetValue", 2, k_TlsSetValue),
    STUB("InitializeCriticalSection", 1), API("InitializeCriticalSectionAndSpinCount", 2, k_one),
    STUB("EnterCriticalSection", 1), STUB("LeaveCriticalSection", 1), STUB("DeleteCriticalSection", 1),
    API("InterlockedIncrement", 1, k_InterlockedIncrement), API("InterlockedDecrement", 1, k_InterlockedDecrement),
    API("InterlockedExchange", 2, k_InterlockedExchange), API("InterlockedCompareExchange", 3, k_InterlockedCompareExchange),
    API("HeapCreate", 3, k_HeapCreate), API("HeapDestroy", 1, k_one), API("GetProcessHeap", 0, k_GetProcessHeap),
    API("HeapAlloc", 3, k_HeapAlloc), API("HeapFree", 3, k_HeapFree), API("HeapReAlloc", 4, k_HeapReAlloc), API("HeapSize", 3, k_HeapSize),
    API("LocalAlloc", 2, k_LocalAlloc), API("LocalFree", 1, k_LocalFree), API("LocalReAlloc", 3, k_LocalReAlloc),
    API("LocalLock", 1, k_Lock), API("LocalUnlock", 1, k_one), API("LocalSize", 1, k_Size),
    API("GlobalAlloc", 2, k_LocalAlloc), API("GlobalFree", 1, k_LocalFree), API("GlobalReAlloc", 3, k_LocalReAlloc),
    API("GlobalLock", 1, k_Lock), API("GlobalUnlock", 1, k_one), API("GlobalSize", 1, k_Size),
    API("VirtualAlloc", 4, k_VirtualAlloc), API("VirtualFree", 3, k_VirtualFree),
    API("lstrlenA", 1, k_lstrlenA), API("lstrlenW", 1, k_lstrlenW), API("lstrcpyA", 2, k_lstrcpyA), API("lstrcpyW", 2, k_lstrcpyW),
    API("lstrcpynA", 3, k_lstrcpynA), API("lstrcpynW", 3, k_lstrcpynW), API("lstrcatA", 2, k_lstrcatA), API("lstrcatW", 2, k_lstrcatW),
    API("lstrcmpA", 2, k_lstrcmpA), API("lstrcmpW", 2, k_lstrcmpW), API("lstrcmpiA", 2, k_lstrcmpiA), API("lstrcmpiW", 2, k_lstrcmpiW),
    API("MulDiv", 3, k_MulDiv), API("GetACP", 0, k_GetACP), API("GetOEMCP", 0, k_GetACP),
    API("MultiByteToWideChar", 6, k_MultiByteToWideChar), API("WideCharToMultiByte", 8, k_WideCharToMultiByte),
    API("OutputDebugStringA", 1, k_OutputDebugStringA), API("OutputDebugStringW", 1, k_OutputDebugStringW),
    API("RaiseException", 4, k_RaiseException), API("IsDebuggerPresent", 0, k_zero),
    API("SetUnhandledExceptionFilter", 1, k_zero), API("UnhandledExceptionFilter", 1, k_zero), API("SetErrorMode", 1, k_zero),
    API("GetSystemInfo", 1, k_GetSystemInfo), STUB("FlushInstructionCache", 3),
    API("FindResourceA", 3, k_FindResourceA), API("FindResourceW", 3, k_FindResourceW),
    API("LoadResource", 2, k_LoadResource), API("LockResource", 1, k_LockResource), API("SizeofResource", 2, k_SizeofResource), API("FreeResource", 1, k_one),
    API("GetStdHandle", 1, k_GetStdHandle), API("WriteFile", 5, k_WriteFile), API("CloseHandle", 1, k_CloseHandle),
    API("ReadFile",5,k_ReadFile), API("GetFileSize",2,k_GetFileSize), API("GetFileSizeEx",2,k_GetFileSizeEx),
    API("SetFilePointer",4,k_SetFilePointer), API("SetFilePointerEx",5,k_SetFilePointerEx),
    API("CreateFileA", 7, k_CreateFileA), API("CreateFileW", 7, k_CreateFileW),
    API("GetFileAttributesA", 1, k_GetFileAttributesA), API("GetFileAttributesW", 1, k_GetFileAttributesW),
    API("GetWindowsDirectoryA", 2, k_GetWindowsDirectoryA), API("GetWindowsDirectoryW", 2, k_GetWindowsDirectoryW),
    API("GetPrivateProfileIntA", 4, k_GetPrivateProfileIntA), API("GetPrivateProfileIntW", 4, k_GetPrivateProfileIntW),
    API("GetPrivateProfileStringA", 6, k_GetPrivateProfileStringA), API("GetPrivateProfileStringW", 6, k_GetPrivateProfileStringW),
    API("WritePrivateProfileStringA", 4, k_WritePrivateProfileStringA), API("WritePrivateProfileStringW", 4, k_WritePrivateProfileStringW),
    /* ADVAPI32 */
    API("RegOpenKeyExA", 5, r_RegOpenKeyExA), API("RegOpenKeyExW", 5, r_RegOpenKeyExW),
    API("RegOpenKeyA", 3, r_RegOpenKeyA), API("RegOpenKeyW", 3, r_RegOpenKeyW),
    API("RegCreateKeyExA", 9, r_RegCreateKeyExA), API("RegCreateKeyExW", 9, r_RegCreateKeyExW),
    API("RegCloseKey", 1, r_RegCloseKey),
    API("RegQueryValueExA", 6, r_RegQueryValueExA), API("RegQueryValueExW", 6, r_RegQueryValueExW),
    API("RegSetValueExA", 6, r_RegSetValueExA), API("RegSetValueExW", 6, r_RegSetValueExW),
    API("RegDeleteValueA", 2, r_RegDeleteValue), API("RegDeleteValueW", 2, r_RegDeleteValue),
    /* SHELL32 / COMCTL32 */
    API("ShellAboutA", 4, s_ShellAboutA), API("ShellAboutW", 4, s_ShellAboutW),
    STUB("InitCommonControls", 0), API("InitCommonControlsEx", 1, k_one),
    /* MSVC runtime: msvcrt.dll and the ucrt api-sets share names */
    CAPI("malloc", c_malloc), CAPI("calloc", c_calloc), CAPI("realloc", c_realloc), CAPI("free", c_free), CAPI("_msize", c_msize),
    CAPI("memset", c_memset), CAPI("memcpy", c_memcpy), CAPI("memmove", c_memcpy), CAPI("memcmp", c_memcmp),
    CAPI("strlen", c_strlen), CAPI("wcslen", c_wcslen), CAPI("strcpy", c_strcpy), CAPI("wcscpy", c_wcscpy),
    CAPI("strcmp", c_strcmp), CAPI("strchr", c_strchr), CAPI("atoi", c_atoi), CAPI("abs", c_abs),
    CAPI("rand", c_rand), CAPI("srand", c_srand), CAPI("time", c_time), CAPI("_time32", c_time), CAPI("clock", c_clock),
    CAPI("exit", c_exit), CAPI("_exit", c_exit), CSTUB("_cexit"), CSTUB("_c_exit"),
    CAPI("sprintf", c_sprintf), CAPI("swprintf", c_swprintf), CAPI("_snprintf", c_snprintf),
    CAPI("_initterm", c_initterm), CAPI("_initterm_e", c_initterm_e),
    CAPI("__getmainargs", c_getmainargs), CAPI("__wgetmainargs", c_getmainargs),
    CSTUB("__set_app_type"), CSTUB("_set_app_type"), CSTUB("__setusermatherr"), CSTUB("_setusermatherr"),
    CAPI("__p__fmode", c_p_fmode), CAPI("__p__commode", c_p_commode), CAPI("__p___argc", c_p_argc), CAPI("__p___argv", c_p_argv),
    CAPI("_controlfp", c_controlfp), CAPI("_controlfp_s", c_onexit_table), CAPI("_except_handler3", c_except_handler),
    CAPI("_except_handler4_common", c_except_handler), CAPI("_XcptFilter", c_XcptFilter), CAPI("_seh_filter_exe", c_XcptFilter),
    CAPI("_initialize_narrow_environment", c_onexit_table), CAPI("_configure_narrow_argv", c_onexit_table),
    CAPI("_initialize_onexit_table", c_onexit_table), CAPI("_register_onexit_function", c_onexit_table),
    CAPI("_execute_onexit_table", c_onexit_table), CAPI("_crt_atexit", c_onexit_table), CAPI("atexit", c_onexit_table),
    CAPI("_set_fmode", c_onexit_table), CAPI("_configthreadlocale", c_onexit_table),
    DATAI("_adjust_fdiv"), DATAI("__argc"), DATAI("__argv"), DATAI("_acmdln"), DATAI("_wcmdln"), DATAI("_environ"),
    DATAI("_fmode"), DATAI("_commode"), DATAI("__initenv"), DATAI("_iob"),
};
const uint32_t w32_api_kernel_n = sizeof w32_api_kernel / sizeof w32_api_kernel[0];
