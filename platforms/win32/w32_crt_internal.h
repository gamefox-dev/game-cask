/* Shared Win64 CRT bridge. Guest LLP64, UTF-16 and va_list never use host layouts. MIT. */
#ifndef W32_CRT_INTERNAL_H
#define W32_CRT_INTERNAL_H
#include "w32_int.h"
#ifdef X86_FLAT_GUEST
#include <ctype.h>
#include <errno.h>
#include <float.h>
#include <limits.h>
#include <locale.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <wasi/api.h>

static inline uint32_t cp(uint64_t p) { return x86_address(p); }
static inline void *cmem(uint32_t p, uint32_t n) {
    if (n && !x86_mapped(p, n)) x86_fault("CRT buffer crosses unmapped guest memory", p);
    return n ? x86_flat_at(p, n) : 0;
}
static void flush_stdout(void);
static inline char *cstr(uint32_t p) {
    uint32_t n = 0;
    while (x86_rd8(p + n)) n++;
    return (char *)cmem(p, n + 1);
}
static inline double cd(unsigned n) { return X.xmm[n].f64[0]; }
static inline float cf(unsigned n) { return X.xmm[n].f32[0]; }
static inline uint64_t rd(double d) { X.xmm[0].f64[0] = d; return 0; }
static inline uint64_t rf(float f) { X.xmm[0].f32[0] = f; return 0; }
uint64_t crt_callback(uint32_t fn, unsigned n, const uint64_t *args);
uint32_t crt_errno_cell(void);
void crt_errno(int e);
void crt_exit_handlers(void);
uint32_t crt_iob_base(void);
uint64_t crt_iob(void);
uint64_t crt_vformat(uint32_t dst, uint64_t cap, uint32_t fmt, uint32_t va, int wide, uint64_t options);
uint64_t crt_vscan(uint32_t src, uint64_t len, uint32_t fmt, uint32_t va, int wide);
#endif
#endif
