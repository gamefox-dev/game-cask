/* One shared CRT for UCRT API sets, ucrtbase and msvcrt. MIT.
 * Floating math, decimal parsing, formatting and UTC calendar routines reuse Zig's WASI musl.
 * No guest pointer, va_list, FILE, wchar_t or Windows long is passed through as a host layout. */
#include "w32_crt_internal.h"
#include "w32_handles.h"
#ifdef X86_FLAT_GUEST

/* Host libc and FILE buffers share reusable spans with GL, never musl's growing heap
 * across the guest window. Guest malloc still uses the separate Windows guest heap. */
void *malloc(size_t n) {
    void *p = x86_host_alloc(XH_CRT, n);
    if (!p) errno = ENOMEM;
    return p;
}
void free(void *p) { x86_host_free(p); }
void *calloc(size_t a, size_t b) {
    if (b && a > SIZE_MAX / b) { x86_host_alloc(XH_CRT, UINT64_MAX); errno = ENOMEM; return 0; }
    return malloc(a * b); /* host spans are explicitly zeroed on every reuse */
}
void *realloc(void *p, size_t n) {
    void *q = x86_host_realloc(p, n);
    if (!q && n) errno = ENOMEM;
    return q;
}

/* WASI is a link-time libc backend, never an additional browser capability. No wall clock,
 * randomness, host file descriptors, environment or process exit is exposed to the guest. */
__wasi_errno_t __wasi_random_get(uint8_t *buf, __wasi_size_t len) {
    static uint32_t seed = 1;
    for (uint32_t i = 0; i < len; i++) { seed = seed * 1664525u + 1013904223u; buf[i] = (uint8_t)(seed >> 24); }
    return 0;
}
__wasi_errno_t __wasi_fd_close(__wasi_fd_t fd) { (void)fd; return __WASI_ERRNO_BADF; }
__wasi_errno_t __wasi_fd_seek(__wasi_fd_t fd, __wasi_filedelta_t off, __wasi_whence_t whence,
                             __wasi_filesize_t *out) {
    (void)fd; (void)off; (void)whence; (void)out; return __WASI_ERRNO_BADF;
}
__wasi_errno_t __wasi_fd_fdstat_get(__wasi_fd_t fd, __wasi_fdstat_t *out) {
    (void)fd; (void)out; return __WASI_ERRNO_BADF;
}
__wasi_errno_t __wasi_fd_write(__wasi_fd_t fd, const __wasi_ciovec_t *iov, __wasi_size_t count,
                              __wasi_size_t *out) {
    (void)fd; (void)iov; (void)count; *out = 0; return __WASI_ERRNO_BADF;
}
__wasi_errno_t __wasi_fd_read(__wasi_fd_t fd, const __wasi_iovec_t *iov, __wasi_size_t count,
                             __wasi_size_t *out) {
    (void)fd; (void)iov; (void)count; *out = 0; return __WASI_ERRNO_BADF;
}

#include "w32_crt_string.h"
#include "w32_crt_runtime.h"
#include "w32_crt_locale.h"
#include "w32_crt_math.h"
#include "w32_crt_stdio.h"
#include "w32_crt_extra.h"

uint32_t w32_crt_data(const char *name) {
    args_init();
    if (!strcmp(name, "_iob")) return crt_iob_base();
    if (!strcmp(name, "__argc")) return (uint32_t)c_argc();
    if (!strcmp(name, "__argv")) return (uint32_t)c_argv();
    if (!strcmp(name, "_environ") || !strcmp(name, "__initenv")) return (uint32_t)c_environ();
    if (!strcmp(name, "_fmode")) return (uint32_t)c_fmode();
    if (!strcmp(name, "_commode")) return (uint32_t)c_commode();
    if (!strcmp(name, "_acmdln") || !strcmp(name, "_wcmdln")) {
        uint32_t p = cell(!strcmp(name, "_acmdln") ? 80 : 88);
        x86_wr64(p, w32_get_cmdline(!strcmp(name, "_wcmdln")));
        return p;
    }
    return 0;
}
#define CRT(name, group, fn) {name, group, fn, 0},
#define DATA(name) {name, "startup", 0, 1},
const w32_crt_entry_t w32_crt_table[] = {
#include "crt.def"
};
#undef CRT
#undef DATA
const uint32_t w32_crt_table_n = sizeof w32_crt_table / sizeof w32_crt_table[0];
const w32_crt_entry_t *w32_find_crt(const char *name) {
    if (!X.mode64) return 0;
    for (uint32_t i = 0; i < w32_crt_table_n; i++) if (!strcmp(name, w32_crt_table[i].name)) return &w32_crt_table[i];
    return 0;
}
/* Audited leaf set: guest heap allocation with flags=0 never raises SEH, and these
 * string primitives neither allocate host buffers nor call guest code. No generic
 * CRT function pointer is invoked from this signature's call graph. */
#define CRT_LEAVES(X) \
 X(c_malloc) X(c_free) X(c_calloc) X(c_realloc) \
 X(c_strlen) X(c_wcslen) X(c_strcmp) X(c_wcscmp) X(c_strncmp) X(c_wcsncmp)
#define LEAF_WRAP(fn) static uint64_t leaf_##fn(uint32_t unused) {(void)unused;return fn();}
CRT_LEAVES(LEAF_WRAP)
#undef LEAF_WRAP
w32_leaf_fn w32_crt_leaf(const w32_crt_entry_t *entry) {
    if(!entry)return 0;
#define LEAF_MATCH(impl) if(entry->fn==impl)return leaf_##impl;
    CRT_LEAVES(LEAF_MATCH)
#undef LEAF_MATCH
    return 0;
}
#undef CRT_LEAVES
#else
w32_leaf_fn w32_crt_leaf(const w32_crt_entry_t *entry) {(void)entry;return 0;}
const w32_crt_entry_t *w32_find_crt(const char *name) { (void)name; return 0; }
#endif
