/* One shared CRT for UCRT API sets, ucrtbase and msvcrt. MIT.
 * Floating math, decimal parsing, formatting and UTC calendar routines reuse Zig's WASI musl.
 * No guest pointer, va_list, FILE, wchar_t or Windows long is passed through as a host layout. */
#include "w32_crt_internal.h"
#ifdef X86_FLAT_GUEST

/* musl's allocator must never grow across the flat guest window. Host blocks live in x86_alloc's
 * bounded 64 MiB arena. Free blocks are reusable; guest malloc uses the separate guest heap. */
typedef struct host_block { struct host_block *next; uint32_t size, used, reserved; } host_block_t;
static host_block_t *host_blocks;
void *malloc(size_t n) {
    if (n > UINT32_MAX - 32) return 0;
    n = (n + 15u) & ~15u;
    if (!n) n = 16;
    for (host_block_t *b = host_blocks; b; b = b->next) if (!b->used && b->size >= n) {
        b->used = 1; return b + 1;
    }
    host_block_t *b = x86_alloc((uint32_t)n + sizeof *b);
    if (!b) return 0;
    b->size = n; b->used = 1; b->next = host_blocks; host_blocks = b;
    return b + 1;
}
void free(void *p) { if (p) ((host_block_t *)p - 1)->used = 0; }
void *calloc(size_t a, size_t b) {
    if (b && a > SIZE_MAX / b) return 0;
    void *p = malloc(a * b);
    if (p) memset(p, 0, a * b);
    return p;
}
void *realloc(void *p, size_t n) {
    if (!p) return malloc(n);
    if (!n) { free(p); return 0; }
    host_block_t *b = (host_block_t *)p - 1;
    if (b->size >= n) return p;
    void *q = malloc(n);
    if (q) { memcpy(q, p, b->size); free(p); }
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
#else
const w32_crt_entry_t *w32_find_crt(const char *name) { (void)name; return 0; }
#endif
