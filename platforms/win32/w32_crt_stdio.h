/* Guest FILE tokens and Windows va_list adapters; musl does numeric formatting/parsing. MIT. */
typedef struct {
    uint32_t handle, data, capacity, size, pos;
    int open, write, eof, error, pushback, temporary;
    char name[512];
} crt_file_t;
static crt_file_t cfiles[64];
static uint32_t iob_base;
static char stdout_line[4096];
static unsigned stdout_n;
uint32_t crt_iob_base(void) {
    if (!iob_base) {
        iob_base = w32_misc_alloc(64 * 48);
        for (unsigned i = 0; i < 3; i++) { cfiles[i].open = 1; cfiles[i].pushback = -1; }
    }
    return iob_base;
}
uint64_t crt_iob(void) { return ARG(0) < 3 ? crt_iob_base() + ARG(0) * 48 : 0; }
static crt_file_t *cfile(uint32_t token) {
    uint32_t base = crt_iob_base();
    if (token < base || token >= base + 64 * 48 || (token - base) % 48) return 0;
    crt_file_t *f = &cfiles[(token - base) / 48];
    return f->open ? f : 0;
}
static void flush_stdout(void) {
    if (stdout_n) { stdout_line[stdout_n] = 0; w32_logf2("guest CRT stdout: ", stdout_line); stdout_n = 0; }
}
static void log_bytes(const char *s, uint32_t n) {
    for (uint32_t i = 0; i < n; i++) {
        char c = s[i];
        if (c == '\n') flush_stdout();
        else {
            if (stdout_n == sizeof stdout_line - 1) flush_stdout();
            stdout_line[stdout_n++] = c;
        }
    }
}
static uint32_t file_write(crt_file_t *f, const uint8_t *src, uint32_t n) {
    if (!f) { crt_errno(9); return 0; }
    if (f == &cfiles[1] || f == &cfiles[2]) { log_bytes((const char *)src, n); return n; }
    if (!f->write) { f->error = 1; crt_errno(13); return 0; }
    if ((uint64_t)f->pos + n > UINT32_MAX - 16) { f->error = 1; crt_errno(27); return 0; }
    uint32_t end = f->pos + n;
    if (end > f->capacity) {
        uint32_t capacity = end < 4096 ? 4096 : end;
        uint32_t data = w32_heap_realloc(f->data, capacity);
        if (!data) { f->error = 1; crt_errno(12); return 0; }
        f->data = data; f->capacity = capacity;
    }
    if (f->pos > f->size) memset(cmem(f->data + f->size, f->pos - f->size), 0, f->pos - f->size);
    if (n) memcpy(cmem(f->data + f->pos, n), src, n);
    f->pos = end;
    if (f->size < end) f->size = end;
    return n;
}
static uint32_t file_read(crt_file_t *f, uint8_t *dst, uint32_t n) {
    if (!f) { crt_errno(9); return 0; }
    uint32_t got = 0;
    if (n && f->pushback >= 0) { *dst++ = (uint8_t)f->pushback; f->pushback = -1; got++; }
    if (f->handle) {
        uint32_t count = 0;
        if (!w32_file_read_buf(f->handle, dst, n - got, &count)) { f->error = 1; crt_errno(5); }
        got += count;
    } else if (f->data) {
        uint32_t count = f->pos < f->size ? f->size - f->pos : 0;
        if (count > n - got) count = n - got;
        if (count) memcpy(dst, cmem(f->data + f->pos, count), count);
        f->pos += count; got += count;
    }
    if (got < n) f->eof = 1;
    return got;
}
static uint64_t file_open(int wide, int temporary) {
    crt_iob_base();
    char name[512] = "", mode[32] = "w+b";
    if (!temporary) {
        w32_gstr(ARG(0), wide, name, sizeof name); w32_gstr(ARG(1), wide, mode, sizeof mode);
    }
    int write = mode[0] == 'w' || mode[0] == 'a' || strchr(mode, '+') != 0;
    if (mode[0] != 'r' && mode[0] != 'w' && mode[0] != 'a') { crt_errno(22); return 0; }
    unsigned slot = 64;
    for (unsigned i = 3; i < 64; i++) {
        if (!cfiles[i].open && !temporary && *name && !strcmp(cfiles[i].name, name)) { slot = i; break; }
        if (slot == 64 && !cfiles[i].open && !cfiles[i].name[0]) slot = i;
    }
    if (slot == 64) { crt_errno(24); return 0; }
    crt_file_t *f = &cfiles[slot];
    if (temporary || mode[0] == 'w') { w32_heap_free(f->data); memset(f, 0, sizeof *f); }
    if (!f->data && mode[0] == 'r') {
        f->handle = w32_file_open_str(name, 0);
        if (!f->handle) { crt_errno(2); return 0; }
        if (write) { w32_file_close_h(f->handle); f->handle = 0; crt_errno(13); return 0; }
    }
    strcpy(f->name, name); f->open = 1; f->write = write; f->eof = f->error = 0;
    f->pushback = -1; f->temporary = temporary; f->pos = mode[0] == 'a' ? f->size : 0;
    return iob_base + slot * 48;
}
static uint64_t c_fopen(void) { return file_open(0, 0); }
static uint64_t c_wfopen(void) { return file_open(1, 0); }
static uint64_t c_tmpfile(void) { return file_open(0, 1); }
static uint64_t c_fclose(void) {
    crt_file_t *f = cfile(ARG(0));
    if (!f) { crt_errno(9); return UINT64_MAX; }
    flush_stdout();
    if (f->handle) w32_file_close_h(f->handle);
    f->handle = 0; f->open = 0;
    if (f->temporary) { w32_heap_free(f->data); memset(f, 0, sizeof *f); }
    return 0;
}
static uint64_t c_fflush(void) { flush_stdout(); return 0; }
static uint64_t c_fwrite(void) {
    uint64_t size = ARG64(1), count = ARG64(2);
    if (!size || !count) return 0;
    if (size > UINT32_MAX / count) { crt_errno(22); return 0; }
    uint32_t n = (uint32_t)(size * count);
    return file_write(cfile(ARG(3)), cmem(ARG(0), n), n) / size;
}
static uint64_t c_fread(void) {
    uint64_t size = ARG64(1), count = ARG64(2);
    if (!size || !count) return 0;
    if (size > UINT32_MAX / count) { crt_errno(22); return 0; }
    uint32_t n = (uint32_t)(size * count);
    return file_read(cfile(ARG(3)), cmem(ARG(0), n), n) / size;
}
static uint64_t c_fputc(void) {
    uint8_t c = (uint8_t)ARG(0);
    return file_write(cfile(ARG(1)), &c, 1) ? c : UINT64_MAX;
}
static uint64_t c_putchar(void) {
    uint8_t c = (uint8_t)ARG(0); crt_iob_base(); file_write(&cfiles[1], &c, 1); return c;
}
static uint64_t c_fputs(void) {
    char *s = cstr(ARG(0)); uint32_t n = (uint32_t)strlen(s);
    return file_write(cfile(ARG(1)), (const uint8_t *)s, n) == n ? 0 : UINT64_MAX;
}
static uint64_t c_puts(void) {
    crt_iob_base(); char *s = cstr(ARG(0)); log_bytes(s, (uint32_t)strlen(s)); log_bytes("\n", 1); return 0;
}
static uint64_t c_fgetc(void) {
    uint8_t c;
    return file_read(cfile(ARG(0)), &c, 1) == 1 ? c : UINT64_MAX;
}
static uint64_t c_ungetc(void) {
    crt_file_t *f = cfile(ARG(1));
    if (!f || f->pushback >= 0 || ARG(0) == UINT32_MAX) return UINT64_MAX;
    f->pushback = (int)(ARG(0) & 255); f->eof = 0; return (uint64_t)f->pushback;
}
static uint64_t c_fgets(void) {
    uint32_t dst = ARG(0), cap = ARG(1), n = 0;
    crt_file_t *f = cfile(ARG(2));
    if ((int32_t)cap <= 0) return 0;
    while (n + 1 < cap) {
        uint8_t c;
        if (file_read(f, &c, 1) != 1) break;
        x86_wr8(dst + n++, c);
        if (c == '\n') break;
    }
    if (!n && cap > 1) return 0;
    x86_wr8(dst + n, 0); return dst;
}
static uint64_t c_feof(void) { crt_file_t *f = cfile(ARG(0)); return f ? (uint64_t)f->eof : 0; }
static uint64_t c_ferror(void) { crt_file_t *f = cfile(ARG(0)); return f ? (uint64_t)f->error : 1; }
static uint64_t c_clearerr(void) {
    crt_file_t *f = cfile(ARG(0)); if (f) f->eof = f->error = 0; return 0;
}
static uint64_t file_tell(crt_file_t *f) {
    if (!f) { crt_errno(9); return UINT64_MAX; }
    uint64_t pos = f->pos;
    if (f->handle && !w32_file_seek_pos(f->handle, 0, 1, &pos)) return UINT64_MAX;
    if (f->pushback >= 0 && pos) pos--;
    return pos;
}
static uint64_t c_ftell(void) { return file_tell(cfile(ARG(0))); }
static int file_seek(crt_file_t *f, int64_t delta, uint32_t method) {
    if (!f || method > 2) { crt_errno(22); return -1; }
    if (f->handle) {
        if (method == 1 && f->pushback >= 0) delta--;
        if (!w32_file_seek_pos(f->handle, delta, method, 0)) { crt_errno(22); return -1; }
    } else {
        uint64_t base = method == 0 ? 0 : method == 1 ? file_tell(f) : f->size;
        if ((delta < 0 && (uint64_t)(-(delta + 1)) + 1 > base) ||
            (delta >= 0 && (uint64_t)delta + base > UINT32_MAX)) { crt_errno(22); return -1; }
        f->pos = (uint32_t)(base + (uint64_t)delta);
    }
    f->eof = 0; f->pushback = -1; return 0;
}
static uint64_t c_fseek(void) { return (uint64_t)file_seek(cfile(ARG(0)), (int32_t)ARG(1), ARG(2)); }
static uint64_t c_fseeki64(void) { return (uint64_t)file_seek(cfile(ARG(0)), (int64_t)ARG64(1), ARG(2)); }
static uint64_t c_rewind(void) {
    crt_file_t *f = cfile(ARG(0)); file_seek(f, 0, 0); if (f) f->error = 0; return 0;
}
static uint64_t c_setvbuf(void) { return cfile(ARG(0)) ? 0 : UINT64_MAX; } /* always unbuffered except log lines */
static uint64_t c_fgetpos(void) {
    uint64_t p = file_tell(cfile(ARG(0))); if (p == UINT64_MAX) return UINT64_MAX;
    x86_wr64(ARG(1), p); return 0;
}
static uint64_t c_fsetpos(void) {
    return (uint64_t)file_seek(cfile(ARG(0)), (int64_t)x86_rd64(ARG(1)), 0);
}

/* Win64 variadic arguments occupy 8-byte slots, including promoted doubles. */
static uint64_t va_next(uint32_t *va) { uint64_t v = x86_rd64(*va); *va += 8; return v; }
static uint32_t direct_va(unsigned first) { return (uint32_t)X.r[ESP] + 8 + first * 8; }
typedef struct { char *bytes; size_t n, capacity; int error; } format_out_t;
static void out_add(format_out_t *o, const char *s, size_t n) {
    if (o->error || n > INT_MAX || o->n > INT_MAX - n) { o->error = 1; return; }
    if (o->n + n + 1 > o->capacity) {
        size_t capacity = (o->n + n + 1) * 2;
        char *p = realloc(o->bytes, capacity);
        if (!p) { o->error = 1; return; }
        o->bytes = p; o->capacity = capacity;
    }
    memcpy(o->bytes + o->n, s, n); o->n += n; o->bytes[o->n] = 0;
}
static char *utf16_string(uint32_t p, int limit) {
    format_out_t o = {0};
    for (int i = 0; limit < 0 || i < limit; i++) {
        unsigned c = x86_rd16(p + (uint32_t)i * 2);
        if (!c) break;
        char s[4]; unsigned n;
        if (c < 128) { s[0] = (char)c; n = 1; }
        else if (c < 2048) { s[0] = (char)(192 | (c >> 6)); s[1] = (char)(128 | (c & 63)); n = 2; }
        else { s[0] = (char)(224 | (c >> 12)); s[1] = (char)(128 | ((c >> 6) & 63));
            s[2] = (char)(128 | (c & 63)); n = 3; }
        out_add(&o, s, n);
    }
    if (!o.bytes) o.bytes = calloc(1, 1);
    return o.bytes;
}
static void store_count(uint32_t dst, unsigned size, uint64_t n) {
    if (size == 8) x86_wr64(dst, n);
    else if (size == 2) x86_wr16(dst, (uint32_t)n);
    else if (size == 1) x86_wr8(dst, (uint32_t)n);
    else x86_wr32(dst, (uint32_t)n);
}
static format_out_t format_guest(uint32_t fmt, uint32_t va, int wide, uint64_t options) {
    format_out_t o = {0};
    unsigned step = wide ? 2 : 1;
    for (uint32_t p = fmt; sch(p, (unsigned)wide);) {
        unsigned ch = sch(p, (unsigned)wide); p += step;
        if (ch != '%') { char c = (char)ch; out_add(&o, &c, 1); continue; }
        if (sch(p, (unsigned)wide) == '%') { out_add(&o, "%", 1); p += step; continue; }
        char spec[96] = "%"; unsigned sn = 1;
        while (strchr("-+ #0", (int)sch(p, (unsigned)wide)) && sch(p, (unsigned)wide)) {
            if (sn == 16) { o.error = 1; break; }
            spec[sn++] = (char)sch(p, (unsigned)wide); p += step;
        }
        if (sch(p, (unsigned)wide) == '*') {
            int width = (int32_t)va_next(&va); p += step;
            sn += (unsigned)snprintf(spec + sn, sizeof spec - sn, "%d", width);
        } else while (sch(p, (unsigned)wide) >= '0' && sch(p, (unsigned)wide) <= '9' && sn < 40) {
            spec[sn++] = (char)sch(p, (unsigned)wide); p += step;
        }
        int precision = -1;
        if (sch(p, (unsigned)wide) == '.') {
            p += step; precision = 0;
            if (sch(p, (unsigned)wide) == '*') { precision = (int32_t)va_next(&va); p += step; }
            else while (sch(p, (unsigned)wide) >= '0' && sch(p, (unsigned)wide) <= '9') {
                if (precision > 1000000) { o.error = 1; break; }
                precision = precision * 10 + (int)sch(p, (unsigned)wide) - '0'; p += step;
            }
            if (precision >= 0) sn += (unsigned)snprintf(spec + sn, sizeof spec - sn, ".%d", precision);
        }
        unsigned size = 4, length = 0;
        unsigned c = sch(p, (unsigned)wide);
        if (c == 'l' || c == 'h') {
            length = c; p += step;
            if (sch(p, (unsigned)wide) == c) { p += step; size = c == 'l' ? 8 : 1; length += 256; }
            else size = c == 'h' ? 2 : 4;
        } else if (c == 'z' || c == 't' || c == 'j' || c == 'I') {
            p += step; size = 8;
            if (c == 'I' && sch(p, (unsigned)wide) == '6') p += 2 * step;
            else if (c == 'I' && sch(p, (unsigned)wide) == '3') { p += 2 * step; size = 4; }
        } else if (c == 'L') { p += step; length = 'L'; }
        c = sch(p, (unsigned)wide); p += step;
        uint64_t v = va_next(&va);
        char *temp = 0, *text = 0; char local[256]; int n = -1;
        spec[sn] = 0;
        if (strchr("diuoxX", (int)c) && c) {
            int sign = c == 'd' || c == 'i';
            if (size < 8) {
                if (size == 1) v = sign ? (uint64_t)(int64_t)(int8_t)v : (uint8_t)v;
                else if (size == 2) v = sign ? (uint64_t)(int64_t)(int16_t)v : (uint16_t)v;
                else v = sign ? (uint64_t)(int64_t)(int32_t)v : (uint32_t)v;
            }
            spec[sn++] = 'l'; spec[sn++] = 'l'; spec[sn++] = (char)c; spec[sn] = 0;
            n = sign ? snprintf(0, 0, spec, (long long)v) : snprintf(0, 0, spec, (unsigned long long)v);
            if (n >= 0) {
                temp = malloc((size_t)n + 1);
                if (temp) {
                    if (sign) snprintf(temp, (size_t)n + 1, spec, (long long)v);
                    else snprintf(temp, (size_t)n + 1, spec, (unsigned long long)v);
                }
            }
        } else if (strchr("fFeEgGaA", (int)c) && c) {
            double d; memcpy(&d, &v, 8);
            spec[sn++] = (char)c; spec[sn] = 0;
            n = snprintf(0, 0, spec, d);
            if (n >= 0) { temp = malloc((size_t)n + 1); if (temp) snprintf(temp, (size_t)n + 1, spec, d); }
        } else if (c == 's' || c == 'S') {
            int source_wide = length == 'l' || (wide && length != 'h' && (options & 4));
            if (c == 'S') source_wide = !source_wide;
            text = source_wide && v ? utf16_string(cp(v), precision) : 0;
            const char *s = !v ? "(null)" : source_wide ? text : cstr(cp(v));
            spec[sn++] = 's'; spec[sn] = 0;
            n = s ? snprintf(0, 0, spec, s) : -1;
            if (n >= 0) { temp = malloc((size_t)n + 1); if (temp) snprintf(temp, (size_t)n + 1, spec, s); }
        } else if (c == 'c' || c == 'C') {
            spec[sn++] = 'c'; spec[sn] = 0;
            n = snprintf(local, sizeof local, spec, (int)v); temp = 0;
        } else if (c == 'p') {
            n = snprintf(local, sizeof local, "%016llX", (unsigned long long)v); temp = 0;
        } else if (c == 'n') { store_count(cp(v), size, o.n); n = 0; }
        else { o.error = 1; }
        if (n < 0 || (n >= (int)sizeof local && !temp)) o.error = 1;
        else out_add(&o, temp ? temp : local, (size_t)n);
        free(temp); free(text);
        if (o.error) break;
    }
    return o;
}
uint64_t crt_vformat(uint32_t dst, uint64_t cap, uint32_t fmt, uint32_t va, int wide, uint64_t options) {
    format_out_t o = format_guest(fmt, va, wide, options);
    if (o.error) { free(o.bytes); crt_errno(22); return UINT64_MAX; }
    uint64_t copied = o.n < cap ? o.n : cap ? cap - 1 : 0;
    if (dst && cap) {
        if (!wide) { if (copied) memcpy(cmem(dst, (uint32_t)copied), o.bytes, (size_t)copied); }
        else for (uint32_t i = 0; i < copied; i++) x86_wr16(dst + i * 2, (uint8_t)o.bytes[i]);
        swr(dst + (uint32_t)copied * (wide ? 2 : 1), (unsigned)wide, 0);
    }
    uint64_t result = o.n;
    if (!(options & 2) && o.n >= cap) result = UINT64_MAX;
    free(o.bytes);
    return result;
}
static uint64_t print_file(uint32_t token, uint32_t fmt, uint32_t va, uint64_t options) {
    format_out_t o = format_guest(fmt, va, 0, options);
    uint64_t n = o.error ? UINT64_MAX : file_write(cfile(token), (const uint8_t *)o.bytes, (uint32_t)o.n);
    free(o.bytes); return n;
}
static uint64_t c_printf(void) { return print_file(crt_iob_base() + 48, ARG(0), direct_va(1), 0); }
static uint64_t c_vprintf(void) { return print_file(crt_iob_base() + 48, ARG(0), ARG(1), 0); }
static uint64_t c_fprintf(void) { return print_file(ARG(0), ARG(1), direct_va(2), 0); }
static uint64_t c_vfprintf(void) { return print_file(ARG(0), ARG(1), ARG(2), 0); }
static uint64_t c_sprintf(void) { return crt_vformat(ARG(0), UINT32_MAX, ARG(1), direct_va(2), 0, 2); }
static uint64_t c_vsprintf(void) { return crt_vformat(ARG(0), UINT32_MAX, ARG(1), ARG(2), 0, 2); }
static uint64_t c_snprintf(void) { return crt_vformat(ARG(0), ARG64(1), ARG(2), direct_va(3), 0, 2); }
static uint64_t c_vsnprintf(void) { return crt_vformat(ARG(0), ARG64(1), ARG(2), ARG(3), 0, 2); }
static uint64_t c_legacy_snprintf(void) { return crt_vformat(ARG(0), ARG64(1), ARG(2), direct_va(3), 0, 0); }
static uint64_t c_legacy_vsnprintf(void) { return crt_vformat(ARG(0), ARG64(1), ARG(2), ARG(3), 0, 0); }
static uint64_t c_common_vsprintf(void) { return crt_vformat(ARG(1), ARG64(2), ARG(3), ARG(5), 0, ARG64(0)); }
static uint64_t c_common_vswprintf(void) { return crt_vformat(ARG(1), ARG64(2), ARG(3), ARG(5), 1, ARG64(0)); }
static uint64_t c_common_vfprintf(void) { return print_file(ARG(1), ARG(2), ARG(4), ARG64(0)); }
static uint64_t c_common_vfwprintf(void) {
    format_out_t o = format_guest(ARG(2), ARG(4), 1, ARG64(0));
    uint64_t n = o.error ? UINT64_MAX : file_write(cfile(ARG(1)), (const uint8_t *)o.bytes, (uint32_t)o.n);
    free(o.bytes); return n;
}
static uint64_t c_fputwc(void) {
    unsigned c = ARG(0);
    if (c > 127) { crt_errno(42); return 65535; }
    uint8_t b = (uint8_t)c;
    return file_write(cfile(ARG(1)), &b, 1) ? c : 65535;
}
static uint64_t c_fgetwc(void) {
    uint8_t c;
    if (file_read(cfile(ARG(0)), &c, 1) != 1) return 65535;
    if (c > 127) { crt_errno(42); return 65535; }
    return c;
}
static uint64_t c_ungetwc(void) {
    crt_file_t *f = cfile(ARG(1));
    if (!f || f->pushback >= 0 || ARG(0) > 127) return 65535;
    f->pushback = (int)ARG(0); f->eof = 0; return ARG(0);
}
static uint64_t c_swprintf(void) { return crt_vformat(ARG(0), ARG64(1), ARG(2), direct_va(3), 1, 2); }
static uint64_t c_vswprintf(void) { return crt_vformat(ARG(0), ARG64(1), ARG(2), ARG(3), 1, 2); }

static uint32_t scan_consumed;
uint64_t crt_vscan(uint32_t src, uint64_t len, uint32_t fmt, uint32_t va, int wide) {
    scan_consumed = 0;
    char *input = wide ? utf16_string(src, len > INT_MAX ? -1 : (int)len) : cstr(src);
    char *format = wide ? utf16_string(fmt, -1) : cstr(fmt);
    if (!input || !format) { crt_errno(12); return UINT64_MAX; }
    char *bounded = 0;
    if (len < strlen(input)) {
        bounded = malloc((size_t)len + 1);
        if (!bounded) { crt_errno(12); return UINT64_MAX; }
        memcpy(bounded, input, (size_t)len); bounded[len] = 0;
    }
    const char *s = bounded ? bounded : input, *start = s, *f = format;
    int assigned = 0;
    while (*f) {
        if (isspace((unsigned char)*f)) { while (isspace((unsigned char)*s)) s++; f++; continue; }
        if (*f != '%') { if (*s != *f) break; s++; f++; continue; }
        f++;
        if (*f == '%') { if (*s != '%') break; s++; f++; continue; }
        int suppress = *f == '*'; if (suppress) f++;
        unsigned width = 0;
        while (isdigit((unsigned char)*f)) { if (width > 1000000) break; width = width * 10 + (unsigned)(*f++ - '0'); }
        unsigned size = 4, length = 0;
        if (*f == 'h' || *f == 'l') {
            length = (unsigned)*f++;
            if ((unsigned)*f == length) { f++; size = length == 'l' ? 8 : 1; length += 256; }
            else size = length == 'h' ? 2 : 4;
        } else if (*f == 'z' || *f == 'j' || *f == 't') { size = 8; f++; }
        else if (*f == 'I') { f++; size = 8; if (!strncmp(f, "64", 2)) f += 2; }
        else if (*f == 'L') { f++; length = 'L'; size = 8; }
        char c = *f++;
        uint32_t dst = suppress ? 0 : cp(va_next(&va));
        if (c == 'n') { if (dst) store_count(dst, size, (uint64_t)(s - start)); continue; }
        if (c != 'c' && c != '[') while (isspace((unsigned char)*s)) s++;
        if (!*s) { if (!assigned) assigned = -1; break; }
        char spec[128]; int used = -1, result = 0;
        unsigned long long integer = 0; double real = 0;
        if (strchr("diuoxX", c)) {
            /* Normalize Windows LLP64 lengths to the backend's long long. */
            unsigned n = 1; spec[0] = '%';
            if (width) n += (unsigned)snprintf(spec + n, sizeof spec - n, "%u", width);
            snprintf(spec + n, sizeof spec - n, "ll%c%%n", c);
            result = sscanf(s, spec, &integer, &used);
            if (result == 1 && dst) store_count(dst, size, integer);
        } else if (strchr("fFeEgGaA", c)) {
            unsigned n = 1; spec[0] = '%';
            if (width) n += (unsigned)snprintf(spec + n, sizeof spec - n, "%u", width);
            strcpy(spec + n, "lf%n");
            result = sscanf(s, spec, &real, &used);
            if (result == 1 && dst) {
                if (length == 'l' || size == 8) memcpy(cmem(dst, 8), &real, 8);
                else { float v = (float)real; memcpy(cmem(dst, 4), &v, 4); }
            }
        } else if (c == 's' || c == 'c' || c == '[') {
            size_t available = strlen(s);
            if (!width) width = c == 'c' ? 1 : (unsigned)available;
            if (width > available) width = (unsigned)available;
            char *text = malloc((size_t)width + 1);
            if (!text) { crt_errno(12); break; }
            unsigned n = (unsigned)snprintf(spec, sizeof spec, "%%%u", width);
            spec[n++] = c;
            if (c == '[') {
                if (*f == '^' && n < 100) spec[n++] = *f++;
                if (*f == ']' && n < 100) spec[n++] = *f++;
                while (*f && *f != ']' && n < 100) spec[n++] = *f++;
                if (*f == ']') spec[n++] = *f++;
            }
            strcpy(spec + n, "%n");
            result = sscanf(s, spec, text, &used);
            if (result == 1 && dst) {
                int out_wide = length == 'l' || (wide && length != 'h');
                for (int i = 0; i < used; i++) swr(dst + (uint32_t)i * (out_wide ? 2 : 1),
                                                  (unsigned)out_wide, (uint8_t)text[i]);
                if (c != 'c') swr(dst + (uint32_t)used * (out_wide ? 2 : 1), (unsigned)out_wide, 0);
            }
            free(text);
        } else { crt_errno(22); break; }
        if (result != 1 || used < 0) break;
        s += used; if (!suppress) assigned++;
    }
    scan_consumed = (uint32_t)(s - start);
    free(bounded); if (wide) { free(input); free(format); }
    return (uint64_t)(int64_t)assigned;
}
static uint64_t scan_file(uint32_t token, uint32_t fmt, uint32_t va) {
    crt_file_t *f = cfile(token);
    if (!f) { crt_errno(9); return UINT64_MAX; }
    uint64_t pos = file_tell(f);
    format_out_t input = {0};
    uint8_t buf[4096];
    for (;;) {
        uint32_t n = file_read(f, buf, sizeof buf);
        out_add(&input, (const char *)buf, n);
        if (n < sizeof buf || input.error) break;
    }
    if (input.error) { free(input.bytes); crt_errno(12); return UINT64_MAX; }
    uint32_t guest = w32_heap_alloc((uint32_t)input.n + 1, 0);
    if (!guest) { free(input.bytes); crt_errno(12); return UINT64_MAX; }
    if (input.n) memcpy(cmem(guest, (uint32_t)input.n), input.bytes, input.n);
    x86_wr8(guest + (uint32_t)input.n, 0);
    uint64_t result = crt_vscan(guest, input.n, fmt, va, 0);
    file_seek(f, (int64_t)(pos + scan_consumed), 0);
    w32_heap_free(guest); free(input.bytes); return result;
}
static uint64_t c_scanf(void) { return scan_file(crt_iob_base(), ARG(0), direct_va(1)); }
static uint64_t c_fscanf(void) { return scan_file(ARG(0), ARG(1), direct_va(2)); }
static uint64_t c_vfscanf(void) { return scan_file(ARG(0), ARG(1), ARG(2)); }
static uint64_t c_common_vfscanf(void) { return scan_file(ARG(1), ARG(2), ARG(4)); }
static uint64_t c_sscanf(void) { return crt_vscan(ARG(0), UINT64_MAX, ARG(1), direct_va(2), 0); }
static uint64_t c_vsscanf(void) { return crt_vscan(ARG(0), UINT64_MAX, ARG(1), ARG(2), 0); }
static uint64_t c_swscanf(void) { return crt_vscan(ARG(0), UINT64_MAX, ARG(1), direct_va(2), 1); }
static uint64_t c_common_vsscanf(void) { return crt_vscan(ARG(1), ARG64(2), ARG(3), ARG(5), 0); }
static uint64_t c_common_vswscanf(void) { return crt_vscan(ARG(1), ARG64(2), ARG(3), ARG(5), 1); }
