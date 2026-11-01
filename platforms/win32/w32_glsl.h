/* GLSL front end for the GL profile: bounded preprocessor, declaration parser, GL 3.3 reflection,
 * std140 layout and canonical BGT §13.5 emission. Libc-free C99; included by w32_gl_shader.h (guest)
 * and by tests/native/glsl_driver.c (host, for known-answer tests). SPDX-License-Identifier: MIT — LANE-K6b
 *
 * The host defines GS_ALLOC(n) (zeroed memory) and GS_FREE(p, n) before including this file. */
#ifndef W32_GLSL_H
#define W32_GLSL_H
#include <stdint.h>
#if defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic ignored "-Wunused-function"
#endif

#define GS_NAME 64
#define GS_MAX_SOURCE 1048576u

static uint32_t gs_len(const char *s) { uint32_t n = 0; while (s[n]) n++; return n; }
static int gs_eq(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
static int gs_eqn(const char *a, uint32_t n, const char *b) {
    uint32_t i = 0; for (; i < n; i++) if (!b[i] || a[i] != b[i]) return 0; return !b[i];
}
static void gs_copy(void *d, const void *s, uint32_t n) {
    uint8_t *a = (uint8_t *)d; const uint8_t *b = (const uint8_t *)s;
    if (a < b) for (uint32_t i = 0; i < n; i++) a[i] = b[i]; else for (uint32_t i = n; i-- > 0;) a[i] = b[i];
}
static void gs_zero(void *d, uint32_t n) { for (uint32_t i = 0; i < n; i++) ((uint8_t *)d)[i] = 0; }
static int gs_alpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; }
static int gs_digit(char c) { return c >= '0' && c <= '9'; }
static int gs_idc(char c) { return gs_alpha(c) || gs_digit(c); }
static int gs_space(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\v' || c == '\f'; }
static int gs_fnv(const char *s, uint32_t n) {
    uint32_t h = 2166136261u; for (uint32_t i = 0; i < n; i++) h = (h ^ (uint8_t)s[i]) * 16777619u; return (int)h;
}

/* ------------------------------------------------------------------------------------- info log */
typedef struct { char *buf; uint32_t cap, len; int errors; } GsLog;
static void gs_put(GsLog *l, const char *s) {
    while (*s && l->len + 1 < l->cap) l->buf[l->len++] = *s++;
    if (l->cap) l->buf[l->len] = 0;
}
static void gs_putn(GsLog *l, uint32_t v) {
    char b[12]; uint32_t k = 0; do { b[k++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (k) { char c[2] = {b[--k], 0}; gs_put(l, c); }
}
/* Mesa-style `string:line(column): error: message 'argument'`. */
static void gs_diag(GsLog *l, int error, uint32_t str, uint32_t line, uint32_t col, const char *msg, const char *arg) {
    if (!l) return;
    if (error) l->errors++;
    gs_putn(l, str); gs_put(l, ":"); gs_putn(l, line); gs_put(l, "("); gs_putn(l, col); gs_put(l, "): ");
    gs_put(l, error ? "error: " : "warning: "); gs_put(l, msg);
    if (arg && *arg) { gs_put(l, " `"); gs_put(l, arg); gs_put(l, "'"); }
    gs_put(l, "\n");
}

/* ----------------------------------------------------------------------------- preprocessor
 * Stage 1 strips comments and line continuations (line counts are preserved by deferring the newlines)
 * and marks source-string boundaries with \x01. Stage 2 interprets directives and expands macros. */
#define PP_MACROS 384
#define PP_POOL 98304
#define PP_PARAMS 16
#define PP_COND 64
#define PP_ARENA (1u << 20)
typedef struct { uint32_t name, body, blen; int8_t params; uint32_t pnames[PP_PARAMS]; uint8_t builtin; } PpMacro;
typedef struct {
    PpMacro m[PP_MACROS]; uint32_t nm;
    char pool[PP_POOL]; uint32_t pool_len;
    char *a; uint32_t alen, acap;       /* expansion arena (stack discipline) */
    char *out; uint32_t olen, ocap;
    GsLog *log; uint32_t str, line, col; int failed;
    const char *act[32]; uint32_t nact;
} Pp;

typedef struct {
    char *text; uint32_t len;          /* preprocessed source, NUL-terminated (GS_ALLOC'd, size `cap`) */
    uint32_t cap, version; int es, core, has_version;
    uint32_t extensions;               /* bit set of enabled extensions */
} GsPreprocessed;

static const char *const gs_known_ext[] = {"GL_ARB_explicit_attrib_location", "GL_ARB_uniform_buffer_object",
    "GL_ARB_shader_texture_lod", "GL_ARB_separate_shader_objects_unsupported_marker", 0};

static void pp_err(Pp *p, const char *msg, const char *arg) { p->failed = 1; gs_diag(p->log, 1, p->str, p->line, p->col, msg, arg); }
static void pp_warn(Pp *p, const char *msg, const char *arg) { gs_diag(p->log, 0, p->str, p->line, p->col, msg, arg); }

static uint32_t pp_pool(Pp *p, const char *s, uint32_t n) {
    if (p->pool_len + n + 1 > PP_POOL) { pp_err(p, "macro storage exhausted", 0); return 0; }
    uint32_t at = p->pool_len; gs_copy(p->pool + at, s, n); p->pool[at + n] = 0; p->pool_len += n + 1; return at;
}
static PpMacro *pp_find(Pp *p, const char *s, uint32_t n) {
    for (uint32_t i = 0; i < p->nm; i++) if (p->m[i].name != 0xffffffffu && gs_eqn(s, n, p->pool + p->m[i].name)) return &p->m[i];
    return 0;
}
static void pp_define(Pp *p, const char *name, const char *body, int builtin) {
    if (p->nm == PP_MACROS) { pp_err(p, "too many macros", 0); return; }
    PpMacro *m = &p->m[p->nm++]; gs_zero(m, sizeof *m);
    m->name = pp_pool(p, name, gs_len(name)); m->body = pp_pool(p, body, gs_len(body)); m->blen = gs_len(body);
    m->params = -1; m->builtin = (uint8_t)builtin;
}
static void pp_undef(Pp *p, const char *s, uint32_t n) {
    PpMacro *m = pp_find(p, s, n); if (m) m->name = 0xffffffffu;
}

/* Output helpers over the arena (aput) and the final buffer (oput). */
static void pp_aput(Pp *p, const char *s, uint32_t n) {
    if (p->alen + n >= p->acap) { if (!p->failed) pp_err(p, "macro expansion too large", 0); p->failed = 1; return; }
    gs_copy(p->a + p->alen, s, n); p->alen += n;
}
static void pp_aputc(Pp *p, char c) { pp_aput(p, &c, 1); }
static void pp_oput(Pp *p, const char *s, uint32_t n) {
    if (p->olen + n + 1 >= p->ocap) { if (!p->failed) pp_err(p, "preprocessed source too large", 0); p->failed = 1; return; }
    gs_copy(p->out + p->olen, s, n); p->olen += n;
}

static void pp_number_u32(char *b, uint32_t v) {
    char t[12]; uint32_t k = 0, n = 0; do { t[k++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (k) b[n++] = t[--k]; b[n] = 0;
}

static void pp_expand(Pp *p, const char *s, uint32_t n, int in_if);

/* Collect function-like macro arguments starting at s[i] == '('. Returns index after ')' or 0 on failure. */
static uint32_t pp_args(const char *s, uint32_t n, uint32_t i, uint32_t *a0, uint32_t *a1, uint32_t *count,
    uint32_t *newlines) {
    uint32_t depth = 0, start = i + 1; *count = 0;
    for (; i < n; i++) {
        char c = s[i];
        if (c == '\n') (*newlines)++;
        if (c == '(') depth++;
        else if (c == ')') {
            if (--depth == 0) {
                if (*count >= PP_PARAMS) return 0;
                a0[*count] = start; a1[(*count)++] = i; return i + 1;
            }
        } else if (c == ',' && depth == 1) {
            if (*count >= PP_PARAMS) return 0;
            a0[*count] = start; a1[(*count)++] = i; start = i + 1;
        }
    }
    return 0;
}

static uint32_t pp_skip_ws(const char *s, uint32_t n, uint32_t i, uint32_t *nl) {
    while (i < n && (gs_space(s[i]) || s[i] == '\n')) { if (s[i] == '\n' && nl) (*nl)++; i++; }
    return i;
}

/* Expand macros in s[0..n) appending to the arena. Newlines inside consumed invocations are re-emitted. */
static void pp_expand(Pp *p, const char *s, uint32_t n, int in_if) {
    uint32_t i = 0;
    while (i < n && !p->failed) {
        char c = s[i];
        if (c == '\n') { p->line++; pp_aputc(p, c); i++; continue; }
        if (gs_digit(c) || (c == '.' && i + 1 < n && gs_digit(s[i + 1]))) {
            uint32_t j = i + 1;
            while (j < n && (gs_idc(s[j]) || s[j] == '.' || ((s[j] == '+' || s[j] == '-') &&
                (s[j - 1] == 'e' || s[j - 1] == 'E') && !(s[i] == '0' && j > i + 1 && (s[i + 1] == 'x' || s[i + 1] == 'X'))))) j++;
            pp_aput(p, s + i, j - i); i = j; continue;
        }
        if (!gs_alpha(c)) { pp_aputc(p, c); i++; continue; }
        uint32_t j = i + 1; while (j < n && gs_idc(s[j])) j++;
        uint32_t len = j - i;
        PpMacro *m = pp_find(p, s + i, len);
        int active = 0;
        for (uint32_t k = 0; m && k < p->nact; k++) if (gs_eqn(s + i, len, p->act[k])) active = 1;
        if (!m || active) {
            if (in_if && gs_eqn(s + i, len, "__LINE__")) { char b[12]; pp_number_u32(b, p->line); pp_aput(p, b, gs_len(b)); }
            else pp_aput(p, s + i, len);
            i = j; continue;
        }
        if (m->params < 0) {                          /* object-like */
            if (m->builtin == 1) { char b[12]; pp_number_u32(b, p->line); pp_aput(p, b, gs_len(b)); }
            else if (m->builtin == 2) { char b[12]; pp_number_u32(b, p->str); pp_aput(p, b, gs_len(b)); }
            else {
                if (p->nact == 32) { pp_err(p, "macro nesting too deep", 0); return; }
                uint32_t mark = p->alen, b0;
                p->act[p->nact++] = p->pool + m->name;
                /* body lives in the pool; paste operators in object-like macros */
                const char *body = p->pool + m->body; uint32_t bl = m->blen;
                b0 = p->alen;
                for (uint32_t k = 0; k < bl; k++) {
                    if (body[k] == '#' && k + 1 < bl && body[k + 1] == '#') {
                        while (p->alen > b0 && gs_space(p->a[p->alen - 1])) p->alen--;
                        k++; while (k + 1 < bl && gs_space(body[k + 1])) k++;
                    } else pp_aputc(p, body[k]);
                }
                uint32_t b1 = p->alen;
                pp_expand(p, p->a + b0, b1 - b0, in_if);       /* result appended after b1 */
                uint32_t r = p->alen - b1;
                gs_copy(p->a + mark, p->a + b1, r); p->alen = mark + r;
                p->nact--;
            }
            i = j; continue;
        }
        /* function-like: needs '(' */
        uint32_t nl = 0, k = pp_skip_ws(s, n, j, &nl);
        if (k >= n || s[k] != '(') { pp_aput(p, s + i, len); i = j; continue; }
        uint32_t a0[PP_PARAMS], a1[PP_PARAMS], cnt = 0, newlines = nl;
        uint32_t end = pp_args(s, n, k, a0, a1, &cnt, &newlines);
        if (!end) { pp_err(p, "unterminated or oversized macro argument list", p->pool + m->name); return; }
        if (m->params == 0 && cnt == 1) {
            uint32_t q = a0[0]; while (q < a1[0] && (gs_space(s[q]) || s[q] == '\n')) q++;
            if (q == a1[0]) cnt = 0;
        }
        if (cnt != (uint32_t)m->params) { pp_err(p, "macro invoked with the wrong number of arguments", p->pool + m->name); return; }
        if (p->nact == 32) { pp_err(p, "macro nesting too deep", 0); return; }
        uint32_t mark = p->alen;
        uint32_t ex0[PP_PARAMS], ex1[PP_PARAMS];
        uint32_t saved_line = p->line;
        for (uint32_t q = 0; q < cnt; q++) {              /* fully expanded arguments, stored on the arena */
            ex0[q] = p->alen; pp_expand(p, s + a0[q], a1[q] - a0[q], in_if); ex1[q] = p->alen;
            for (uint32_t z = ex0[q]; z < ex1[q]; z++) if (p->a[z] == '\n') p->a[z] = ' ';
        }
        p->line = saved_line;
        uint32_t b0 = p->alen; const char *body = p->pool + m->body; uint32_t bl = m->blen;
        for (uint32_t q = 0; q < bl; q++) {
            if (body[q] == '#' && q + 1 < bl && body[q + 1] == '#') {
                while (p->alen > b0 && gs_space(p->a[p->alen - 1])) p->alen--;
                q++; while (q + 1 < bl && gs_space(body[q + 1])) q++;
                continue;
            }
            if (gs_alpha(body[q])) {
                uint32_t e = q + 1; while (e < bl && gs_idc(body[e])) e++;
                int which = -1;
                for (int pi = 0; pi < m->params; pi++) if (gs_eqn(body + q, e - q, p->pool + m->pnames[pi])) which = pi;
                if (which >= 0) {
                    uint32_t before = q; while (before > 0 && gs_space(body[before - 1])) before--;
                    uint32_t after = e; while (after < bl && gs_space(body[after])) after++;
                    int paste = (before >= 2 && body[before - 1] == '#' && body[before - 2] == '#') ||
                        (after + 1 < bl && body[after] == '#' && body[after + 1] == '#');
                    if (paste) { uint32_t z0 = p->alen, r0 = a0[which], r1 = a1[which];
                        while (r0 < r1 && (gs_space(s[r0]) || s[r0] == '\n')) r0++;
                        while (r1 > r0 && (gs_space(s[r1 - 1]) || s[r1 - 1] == '\n')) r1--;
                        pp_aput(p, s + r0, r1 - r0);
                        for (uint32_t z = z0; z < p->alen; z++) if (p->a[z] == '\n') p->a[z] = ' '; }
                    else {
                        uint32_t r0 = ex0[which], r1 = ex1[which];
                        while (r0 < r1 && gs_space(p->a[r0])) r0++;
                        while (r1 > r0 && gs_space(p->a[r1 - 1])) r1--;
                        pp_aput(p, p->a + r0, r1 - r0);
                    }
                    q = e - 1; continue;
                }
                pp_aput(p, body + q, e - q); q = e - 1; continue;
            }
            pp_aputc(p, body[q]);
        }
        uint32_t b1 = p->alen;
        p->act[p->nact++] = p->pool + m->name;
        pp_expand(p, p->a + b0, b1 - b0, in_if);
        p->nact--;
        uint32_t r = p->alen - b1;
        gs_copy(p->a + mark, p->a + b1, r); p->alen = mark + r;
        for (uint32_t q = 0; q < newlines; q++) pp_aputc(p, '\n');
        p->line = saved_line + newlines;
        i = end;
    }
}

/* ---------------------------------------------------------------- #if expression evaluation */
typedef struct { const char *s; uint32_t i, n; Pp *p; int err; } PpEval;
static void ev_ws(PpEval *e) { while (e->i < e->n && (gs_space(e->s[e->i]) || e->s[e->i] == '\n')) e->i++; }
static int64_t ev_expr(PpEval *e, int prec);
static int64_t ev_unary(PpEval *e) {
    ev_ws(e);
    if (e->i >= e->n) { e->err = 1; return 0; }
    char c = e->s[e->i];
    if (c == '(') { e->i++; int64_t v = ev_expr(e, 0); ev_ws(e);
        if (e->i < e->n && e->s[e->i] == ')') e->i++; else e->err = 1; return v; }
    if (c == '-') { e->i++; return -ev_unary(e); }
    if (c == '+') { e->i++; return ev_unary(e); }
    if (c == '~') { e->i++; return ~ev_unary(e); }
    if (c == '!') { e->i++; return !ev_unary(e); }
    if (gs_digit(c)) {
        int64_t v = 0; uint32_t base = 10;
        if (c == '0' && e->i + 1 < e->n && (e->s[e->i + 1] == 'x' || e->s[e->i + 1] == 'X')) { base = 16; e->i += 2; }
        else if (c == '0') base = 8;
        for (; e->i < e->n && gs_idc(e->s[e->i]); e->i++) {
            char d = e->s[e->i]; int64_t x;
            if (gs_digit(d)) x = d - '0'; else if (d >= 'a' && d <= 'f') x = 10 + d - 'a';
            else if (d >= 'A' && d <= 'F') x = 10 + d - 'A'; else if (d == 'u' || d == 'U') continue; else { e->err = 1; return 0; }
            if (x >= (int64_t)base) { e->err = 1; return 0; }
            v = v * base + x;
        }
        return v;
    }
    if (gs_alpha(c)) {
        uint32_t j = e->i; while (j < e->n && gs_idc(e->s[j])) j++;
        char name[GS_NAME]; uint32_t len = j - e->i < GS_NAME - 1 ? j - e->i : GS_NAME - 1;
        gs_copy(name, e->s + e->i, len); name[len] = 0; e->i = j;
        pp_warn(e->p, "undefined identifier in preprocessor expression, treated as 0", name);
        return 0;
    }
    e->err = 1; return 0;
}
static int ev_op(PpEval *e, int *prec, int *len) {
    ev_ws(e);
    if (e->i >= e->n) return 0;
    char a = e->s[e->i], b = e->i + 1 < e->n ? e->s[e->i + 1] : 0;
    *len = 2;
    if (a == '|' && b == '|') { *prec = 1; return 1; } if (a == '&' && b == '&') { *prec = 2; return 2; }
    if (a == '=' && b == '=') { *prec = 6; return 3; } if (a == '!' && b == '=') { *prec = 6; return 4; }
    if (a == '<' && b == '=') { *prec = 7; return 5; } if (a == '>' && b == '=') { *prec = 7; return 6; }
    if (a == '<' && b == '<') { *prec = 8; return 7; } if (a == '>' && b == '>') { *prec = 8; return 8; }
    *len = 1;
    switch (a) { case '|': *prec = 3; return 9; case '^': *prec = 4; return 10; case '&': *prec = 5; return 11;
        case '<': *prec = 7; return 12; case '>': *prec = 7; return 13; case '+': *prec = 9; return 14;
        case '-': *prec = 9; return 15; case '*': *prec = 10; return 16; case '/': *prec = 10; return 17;
        case '%': *prec = 10; return 18; default: return 0; }
}
static int64_t ev_expr(PpEval *e, int minp) {
    int64_t l = ev_unary(e);
    for (;;) {
        int prec, len, op = ev_op(e, &prec, &len);
        if (!op || prec < minp) break;
        e->i += (uint32_t)len;
        int64_t r = ev_expr(e, prec + 1);
        switch (op) {
        case 1: l = l || r; break; case 2: l = l && r; break; case 3: l = l == r; break; case 4: l = l != r; break;
        case 5: l = l <= r; break; case 6: l = l >= r; break; case 7: l = (r < 0 || r > 62) ? 0 : l << r; break;
        case 8: l = (r < 0 || r > 62) ? 0 : l >> r; break; case 9: l |= r; break; case 10: l ^= r; break;
        case 11: l &= r; break; case 12: l = l < r; break; case 13: l = l > r; break; case 14: l += r; break;
        case 15: l -= r; break; case 16: l *= r; break;
        case 17: case 18:
            if (!r) { pp_err(e->p, "division by zero in preprocessor expression", 0); e->err = 1; return 0; }
            l = op == 17 ? l / r : l % r; break;
        }
    }
    return l;
}
/* Evaluate the text of an #if/#elif line: defined() first, then macro expansion. */
static int pp_if_value(Pp *p, const char *line, uint32_t n) {
    uint32_t mark = p->alen, i = 0, b0 = p->alen;
    while (i < n) {
        if (gs_alpha(line[i])) {
            uint32_t j = i + 1; while (j < n && gs_idc(line[j])) j++;
            if (gs_eqn(line + i, j - i, "defined")) {
                uint32_t k = j; while (k < n && gs_space(line[k])) k++;
                int paren = k < n && line[k] == '('; if (paren) { k++; while (k < n && gs_space(line[k])) k++; }
                uint32_t s0 = k; while (k < n && gs_idc(line[k])) k++;
                if (k == s0) { pp_err(p, "operator defined requires an identifier", 0); return 0; }
                int d = pp_find(p, line + s0, k - s0) != 0;
                if (paren) { while (k < n && gs_space(line[k])) k++;
                    if (k < n && line[k] == ')') k++; else { pp_err(p, "missing ) after defined(", 0); return 0; } }
                pp_aputc(p, d ? '1' : '0'); i = k; continue;
            }
            pp_aput(p, line + i, j - i); i = j; continue;
        }
        pp_aputc(p, line[i]); i++;
    }
    uint32_t b1 = p->alen;
    pp_expand(p, p->a + b0, b1 - b0, 1);
    PpEval e = {p->a + b1, 0, p->alen - b1, p, 0};
    int64_t v = ev_expr(&e, 0); ev_ws(&e);
    if (!p->failed && (e.err || e.i < e.n)) { pp_err(p, "syntax error in preprocessor expression", 0); v = 0; }
    p->alen = mark; return v != 0;
}

/* ------------------------------------------------------------------------------- stage 1 */
static int pp_strip(const char *const *str, const int32_t *lens, int count, char *dst, uint32_t cap, uint32_t *out_len,
    GsLog *log) {
    uint32_t n = 0, defer = 0; int ok = 1, bol = 1, directive = 0;
    for (int si = 0; si < count; si++) {
        const char *s = str[si]; uint32_t len = lens && lens[si] >= 0 ? (uint32_t)lens[si] : gs_len(s);
        if (si && n + 1 < cap) dst[n++] = '\x01';
        for (uint32_t i = 0; i < len; i++) {
            char c = s[i];
            if (n + defer + 4 >= cap) { gs_diag(log, 1, 0, 0, 0, "shader source too large", 0); return 0; }
            if (c == 0) { gs_diag(log, 1, (uint32_t)si, 0, 0, "source contains a NUL character", 0); ok = 0; continue; }
            if (c == '\\' && i + 1 < len && (s[i + 1] == '\n' || (s[i + 1] == '\r' && i + 2 < len && s[i + 2] == '\n'))) {
                i += s[i + 1] == '\r' ? 2 : 1; defer++; continue;
            }
            if (c == '/' && i + 1 < len && s[i + 1] == '/') {
                while (i < len && s[i] != '\n') i++;
                i--; dst[n++] = ' '; continue;
            }
            if (c == '/' && i + 1 < len && s[i + 1] == '*') {
                uint32_t j = i + 2; int closed = 0;
                dst[n++] = ' ';
                while (j + 1 < len) {
                    if (s[j] == '*' && s[j + 1] == '/') { closed = 1; break; }
                    if (s[j] == '\n') { if (directive) defer++; else if (n + defer + 4 < cap) dst[n++] = '\n'; }
                    j++;
                }
                if (!closed) { gs_diag(log, 1, (uint32_t)si, 0, 0, "unterminated comment", 0); ok = 0; i = len; continue; }
                i = j + 1; continue;
            }
            if (c == '\n') { bol = 1; directive = 0; } else if (bol && !gs_space(c)) { bol = 0; directive = c == '#'; }
            dst[n++] = c;
            if (c == '\n') while (defer) { dst[n++] = '\n'; defer--; }
        }
    }
    while (defer && n + 1 < cap) { dst[n++] = '\n'; defer--; }
    dst[n] = 0; *out_len = n; return ok;
}

/* ------------------------------------------------------------------------------- stage 2 */
static int pp_ext_supported(const char *name, uint32_t n) {
    for (int i = 0; gs_known_ext[i]; i++) if (gs_eqn(name, n, gs_known_ext[i])) return i + 1;
    return 0;
}

static int gs_preprocess(const char *const *str, const int32_t *lens, int count, GsPreprocessed *res, GsLog *log) {
    gs_zero(res, sizeof *res);
    uint32_t total = 0; for (int i = 0; i < count; i++) total += lens && lens[i] >= 0 ? (uint32_t)lens[i] : gs_len(str[i]);
    if (total > GS_MAX_SOURCE) { gs_diag(log, 1, 0, 0, 0, "shader source exceeds 1 MiB", 0); return 0; }
    uint32_t cap = total + (uint32_t)count + 8, clen = 0;
    char *clean = (char *)GS_ALLOC(cap);
    Pp *p = (Pp *)GS_ALLOC(sizeof(Pp));
    if (!clean || !p) { if (clean) GS_FREE(clean, cap); if (p) GS_FREE(p, sizeof(Pp)); gs_diag(log, 1, 0, 0, 0, "out of memory", 0); return 0; }
    int ok = pp_strip(str, lens, count, clean, cap, &clen, log);
    p->log = log;
    p->acap = total * 4 + 65536; if (p->acap > PP_ARENA) p->acap = PP_ARENA;
    p->ocap = total * 4 + 65536; if (p->ocap > GS_MAX_SOURCE) p->ocap = GS_MAX_SOURCE;
    p->a = (char *)GS_ALLOC(p->acap); p->out = (char *)GS_ALLOC(p->ocap);
    if (!p->a || !p->out) {
        if (p->a) GS_FREE(p->a, p->acap); if (p->out) GS_FREE(p->out, p->ocap);
        GS_FREE(clean, cap); GS_FREE(p, sizeof(Pp)); gs_diag(log, 1, 0, 0, 0, "out of memory", 0); return 0;
    }
    p->failed = !ok; p->line = 1;
    pp_define(p, "__LINE__", "", 0); p->m[p->nm - 1].builtin = 1;
    pp_define(p, "__FILE__", "", 0); p->m[p->nm - 1].builtin = 2;
    uint8_t group_active[PP_COND], group_taken[PP_COND], group_else[PP_COND];
    uint32_t depth = 0, skip = 0;          /* skip: depth of the first inactive group (0 = active) */
    int seen_text = 0, version_seen = 0;
    uint32_t version = 110; int es = 0, core = 0; uint32_t ext_mask = 0;
    uint32_t i = 0;
    while (i < clen && !(p->failed && log && log->errors > 20)) {
        if (clean[i] == '\x01') { p->str++; p->line = 1; i++; continue; }
        uint32_t ls = i, le = i; while (le < clen && clean[le] != '\n' && clean[le] != '\x01') le++;
        uint32_t k = ls; while (k < le && gs_space(clean[k])) k++;
        p->col = k - ls + 1;
        if (k < le && clean[k] == '#') {
            k++; while (k < le && gs_space(clean[k])) k++;
            uint32_t d0 = k; while (k < le && gs_idc(clean[k])) k++;
            const char *dn = clean + d0; uint32_t dl = k - d0;
            while (k < le && gs_space(clean[k])) k++;
            const char *rest = clean + k; uint32_t rl = le - k; while (rl && gs_space(rest[rl - 1])) rl--;
            int is_if = gs_eqn(dn, dl, "if"), is_ifdef = gs_eqn(dn, dl, "ifdef"), is_ifndef = gs_eqn(dn, dl, "ifndef");
            if (is_if || is_ifdef || is_ifndef) {
                if (depth == PP_COND) pp_err(p, "conditional nesting too deep", 0);
                else {
                    int take = 0;
                    if (!skip) {
                        if (is_if) take = pp_if_value(p, rest, rl);
                        else { uint32_t e = 0; while (e < rl && gs_idc(rest[e])) e++;
                            if (!e) pp_err(p, "macro name missing", dn); else take = (pp_find(p, rest, e) != 0) == is_ifdef; }
                    }
                    group_else[depth] = 0;
                    if (skip) { group_active[depth] = 0; group_taken[depth] = 1; }
                    else { group_active[depth] = (uint8_t)take; group_taken[depth] = (uint8_t)take; if (!take) skip = depth + 1; }
                    depth++;
                }
            } else if (gs_eqn(dn, dl, "elif") || gs_eqn(dn, dl, "else")) {
                int is_else = dn[2] == 's';
                if (!depth) pp_err(p, "#elif/#else without #if", 0);
                else if (group_else[depth - 1]) pp_err(p, "#elif/#else after #else", 0);
                else {
                    uint32_t g = depth - 1;
                    if (is_else) group_else[g] = 1;
                    if (skip && skip != depth) { /* nested inside an inactive outer group */ }
                    else if (!skip) { skip = depth; }               /* previous branch was taken: now inactive */
                    else if (!group_taken[g]) {
                        int take = is_else ? 1 : pp_if_value(p, rest, rl);
                        if (take) { skip = 0; group_taken[g] = 1; group_active[g] = 1; }
                    }
                }
            } else if (gs_eqn(dn, dl, "endif")) {
                if (!depth) pp_err(p, "#endif without #if", 0);
                else { depth--; if (skip == depth + 1) skip = 0; }
            } else if (!skip) {
                if (dl == 0) { /* null directive */ }
                else if (gs_eqn(dn, dl, "version")) {
                    if (seen_text || version_seen) pp_err(p, "#version must occur first in the shader and only once", 0);
                    else {
                        uint32_t q = 0, v = 0; while (q < rl && gs_digit(rest[q])) v = v * 10 + (uint32_t)(rest[q++] - '0');
                        while (q < rl && gs_space(rest[q])) q++;
                        const char *prof = rest + q; uint32_t pl = rl - q;
                        if (v == 0) pp_err(p, "invalid #version", 0);
                        else if (v == 300 && gs_eqn(prof, pl, "es")) { es = 1; version = v; version_seen = 1; }
                        else if (pl == 0 || gs_eqn(prof, pl, "core") || gs_eqn(prof, pl, "compatibility")) {
                            if (v < 130 || v > 330 || (v > 150 && v < 330)) pp_err(p, "GLSL version is not supported by this OpenGL 3.3 profile", 0);
                            else if (pl && v < 150) pp_err(p, "profile qualifier requires GLSL 1.50 or later", 0);
                            else { version = v; version_seen = 1; core = v >= 150 && !gs_eqn(prof, pl, "compatibility"); }
                        } else pp_err(p, "invalid #version profile", 0);
                    }
                    if (version_seen && !p->failed) {
                        char b[12]; pp_number_u32(b, version);
                        pp_define(p, "__VERSION__", b, 0);
                        if (es) { pp_define(p, "GL_ES", "1", 0); pp_define(p, "GL_FRAGMENT_PRECISION_HIGH", "1", 0); }
                        if (core) pp_define(p, "GL_core_profile", "1", 0);
                        if (!es && version >= 150 && !core) pp_define(p, "GL_compatibility_profile", "1", 0);
                        for (int e = 0; gs_known_ext[e]; e++)
                            if (e < 3) pp_define(p, gs_known_ext[e], "1", 0);
                    }
                } else if (gs_eqn(dn, dl, "define")) {
                    uint32_t q = 0; while (q < rl && gs_idc(rest[q])) q++;
                    if (!q || gs_digit(rest[0])) pp_err(p, "macro name expected after #define", 0);
                    else if ((q >= 3 && rest[0] == 'G' && rest[1] == 'L' && rest[2] == '_') || gs_eqn(rest, q, "defined") ||
                        gs_eqn(rest, q, "__LINE__") || gs_eqn(rest, q, "__FILE__") || gs_eqn(rest, q, "__VERSION__"))
                        { char nm[GS_NAME]; uint32_t nl = q < GS_NAME - 1 ? q : GS_NAME - 1; gs_copy(nm, rest, nl); nm[nl] = 0;
                          pp_err(p, "illegal definition of reserved macro name", nm); }
                    else {
                        PpMacro nm; gs_zero(&nm, sizeof nm); nm.params = -1;
                        uint32_t name_end = q, b = q;
                        if (q < rl && rest[q] == '(') {
                            int ps = 0; b = q + 1; nm.params = 0;
                            while (b < rl && rest[b] != ')' && !ps) {
                                while (b < rl && gs_space(rest[b])) b++;
                                uint32_t e = b; while (e < rl && gs_idc(rest[e])) e++;
                                if (e == b || nm.params == PP_PARAMS) { ps = 1; break; }
                                nm.pnames[nm.params++] = pp_pool(p, rest + b, e - b); b = e;
                                while (b < rl && gs_space(rest[b])) b++;
                                if (b < rl && rest[b] == ',') b++; else if (b >= rl || rest[b] != ')') ps = 1;
                            }
                            if (ps || b >= rl) { pp_err(p, "invalid macro parameter list", 0); b = rl; } else b++;
                        }
                        while (b < rl && gs_space(rest[b])) b++;
                        uint32_t bl = rl - b;
                        PpMacro *old = pp_find(p, rest, name_end);
                        if (old) {
                            int same = old->params == nm.params && old->blen == bl && gs_eqn(rest + b, bl, p->pool + old->body);
                            for (int pi = 0; same && pi < nm.params; pi++)
                                same = gs_eq(p->pool + nm.pnames[pi], p->pool + old->pnames[pi]);
                            if (!same) { char nn[GS_NAME]; uint32_t l2 = name_end < GS_NAME - 1 ? name_end : GS_NAME - 1;
                                gs_copy(nn, rest, l2); nn[l2] = 0; pp_err(p, "redefinition of macro", nn); }
                        } else if (!p->failed || p->nm < PP_MACROS) {
                            if (p->nm == PP_MACROS) pp_err(p, "too many macros", 0);
                            else {
                                PpMacro *m = &p->m[p->nm++]; *m = nm;
                                m->name = pp_pool(p, rest, name_end); m->body = pp_pool(p, rest + b, bl); m->blen = bl;
                            }
                        }
                    }
                } else if (gs_eqn(dn, dl, "undef")) {
                    uint32_t q = 0; while (q < rl && gs_idc(rest[q])) q++;
                    if (!q) pp_err(p, "macro name expected after #undef", 0);
                    else if ((q >= 3 && rest[0] == 'G' && rest[1] == 'L' && rest[2] == '_') || rest[0] == '_')
                        pp_err(p, "illegal #undef of reserved macro name", 0);
                    else pp_undef(p, rest, q);
                } else if (gs_eqn(dn, dl, "error")) {
                    char msg[160]; uint32_t ml = rl < sizeof msg - 1 ? rl : (uint32_t)sizeof msg - 1;
                    gs_copy(msg, rest, ml); msg[ml] = 0; pp_err(p, "#error", msg);
                } else if (gs_eqn(dn, dl, "pragma")) { /* optimize/debug/STDGL pragmas have no effect */ }
                else if (gs_eqn(dn, dl, "extension")) {
                    uint32_t q = 0; while (q < rl && (gs_idc(rest[q]))) q++;
                    const char *name = rest; uint32_t nl = q;
                    while (q < rl && gs_space(rest[q])) q++;
                    if (q < rl && rest[q] == ':') q++; else if (nl) { pp_err(p, "#extension requires `name : behavior'", 0); nl = 0; }
                    while (q < rl && gs_space(rest[q])) q++;
                    const char *beh = rest + q; uint32_t bl = rl - q;
                    int known = pp_ext_supported(name, nl);
                    char nm[GS_NAME]; uint32_t cl = nl < GS_NAME - 1 ? nl : GS_NAME - 1; gs_copy(nm, name, cl); nm[cl] = 0;
                    if (!nl) { /* already reported */ }
                    else if (!(gs_eqn(beh, bl, "require") || gs_eqn(beh, bl, "enable") || gs_eqn(beh, bl, "warn") || gs_eqn(beh, bl, "disable")))
                        pp_err(p, "invalid #extension behavior", 0);
                    else if (gs_eqn(name, nl, "all")) {
                        if (gs_eqn(beh, bl, "require") || gs_eqn(beh, bl, "enable")) pp_err(p, "#extension all supports only warn and disable", 0);
                    } else if (!known) {
                        if (gs_eqn(beh, bl, "require")) pp_err(p, "required extension is not supported", nm);
                        else if (!gs_eqn(beh, bl, "disable")) pp_warn(p, "extension is not supported", nm);
                    } else if (gs_eqn(beh, bl, "require") || gs_eqn(beh, bl, "enable")) ext_mask |= 1u << (known - 1);
                } else if (gs_eqn(dn, dl, "line")) {
                    uint32_t q = 0, v = 0, sn = p->str; int have = 0;
                    while (q < rl && gs_digit(rest[q])) { v = v * 10 + (uint32_t)(rest[q++] - '0'); have = 1; }
                    while (q < rl && gs_space(rest[q])) q++;
                    if (q < rl && gs_digit(rest[q])) { sn = 0; while (q < rl && gs_digit(rest[q])) sn = sn * 10 + (uint32_t)(rest[q++] - '0'); }
                    if (!have || q < rl) pp_err(p, "#line requires a line number and an optional source string number", 0);
                    else { p->line = v - 1; p->str = sn; }
                } else { char nm[GS_NAME]; uint32_t nl = dl < GS_NAME - 1 ? dl : GS_NAME - 1; gs_copy(nm, dn, nl); nm[nl] = 0;
                    pp_err(p, "unknown preprocessor directive", nm); }
                if (!version_seen && !gs_eqn(dn, dl, "version") && dl && !gs_eqn(dn, dl, "extension") &&
                    !gs_eqn(dn, dl, "pragma")) seen_text = 1;
            }
            pp_oput(p, "\n", 1); p->line++;
            i = le; if (i < clen && clean[i] == '\n') i++;
            continue;
        }
        /* text run: consecutive non-directive lines expand together (macro calls may span lines) */
        uint32_t re = ls;
        for (;;) {
            uint32_t e = re; while (e < clen && clean[e] != '\n' && clean[e] != '\x01') e++;
            uint32_t t = re; while (t < e && gs_space(clean[t])) t++;
            if (re != ls && t < e && clean[t] == '#') break;
            re = e < clen && clean[e] == '\n' ? e + 1 : e;
            if (e >= clen || clean[e] == '\x01') break;
        }
        int blank = 1; for (uint32_t q = ls; q < re; q++) if (!gs_space(clean[q]) && clean[q] != '\n') blank = 0;
        if (!blank) seen_text = 1;
        if (skip) { for (uint32_t q = ls; q < re; q++) if (clean[q] == '\n') { pp_oput(p, "\n", 1); p->line++; } }
        else {
            p->alen = 0;
            uint32_t line0 = p->line;
            pp_expand(p, clean + ls, re - ls, 0);
            pp_oput(p, p->a, p->alen); p->line = line0;
            for (uint32_t q = ls; q < re; q++) if (clean[q] == '\n') p->line++;
        }
        i = re;
    }
    if (depth && !p->failed) pp_err(p, "unterminated #if/#ifdef", 0);
    int success = !p->failed && (!log || log->errors == 0);
    if (success) {
        uint32_t rc = p->olen + 1; if (rc < 64) rc = 64;
        char *r = (char *)GS_ALLOC(rc);
        if (!r) { gs_diag(log, 1, 0, 0, 0, "out of memory", 0); success = 0; }
        else {
            gs_copy(r, p->out, p->olen); r[p->olen] = 0;
            res->text = r; res->len = p->olen; res->cap = rc; res->version = version; res->es = es; res->core = core;
            res->has_version = version_seen; res->extensions = ext_mask;
        }
    }
    GS_FREE(p->a, p->acap); GS_FREE(p->out, p->ocap); GS_FREE(clean, cap); GS_FREE(p, sizeof(Pp));
    return success;
}


/* ===================================================================== types and declarations */
typedef struct { const char *name; uint16_t gl; char kind; uint8_t cols, rows, dim, shadow; } GsType;
#define GT(n, gl, k, c, r) {n, gl, k, c, r, 0, 0}
#define GSAMP(n, gl, ek, dim, sh) {n, gl, ek, 0, 0, dim, sh}
enum { GD_1D = 1, GD_2D, GD_3D, GD_CUBE, GD_RECT, GD_1DA, GD_2DA, GD_BUF, GD_MS, GD_MSA };
static const GsType gs_types[] = {
    GT("void", 0, 'v', 0, 0),
    GT("float", 0x1406, 'f', 1, 1), GT("vec2", 0x8b50, 'f', 1, 2), GT("vec3", 0x8b51, 'f', 1, 3), GT("vec4", 0x8b52, 'f', 1, 4),
    GT("int", 0x1404, 'i', 1, 1), GT("ivec2", 0x8b53, 'i', 1, 2), GT("ivec3", 0x8b54, 'i', 1, 3), GT("ivec4", 0x8b55, 'i', 1, 4),
    GT("uint", 0x1405, 'u', 1, 1), GT("uvec2", 0x8dc6, 'u', 1, 2), GT("uvec3", 0x8dc7, 'u', 1, 3), GT("uvec4", 0x8dc8, 'u', 1, 4),
    GT("bool", 0x8b56, 'b', 1, 1), GT("bvec2", 0x8b57, 'b', 1, 2), GT("bvec3", 0x8b58, 'b', 1, 3), GT("bvec4", 0x8b59, 'b', 1, 4),
    GT("mat2", 0x8b5a, 'f', 2, 2), GT("mat3", 0x8b5b, 'f', 3, 3), GT("mat4", 0x8b5c, 'f', 4, 4),
    GT("mat2x2", 0x8b5a, 'f', 2, 2), GT("mat3x3", 0x8b5b, 'f', 3, 3), GT("mat4x4", 0x8b5c, 'f', 4, 4),
    GT("mat2x3", 0x8b65, 'f', 2, 3), GT("mat2x4", 0x8b66, 'f', 2, 4), GT("mat3x2", 0x8b67, 'f', 3, 2),
    GT("mat3x4", 0x8b68, 'f', 3, 4), GT("mat4x2", 0x8b69, 'f', 4, 2), GT("mat4x3", 0x8b6a, 'f', 4, 3),
    GSAMP("sampler1D", 0x8b5d, 'f', GD_1D, 0), GSAMP("sampler2D", 0x8b5e, 'f', GD_2D, 0), GSAMP("sampler3D", 0x8b5f, 'f', GD_3D, 0),
    GSAMP("samplerCube", 0x8b60, 'f', GD_CUBE, 0), GSAMP("sampler1DShadow", 0x8b61, 'f', GD_1D, 1),
    GSAMP("sampler2DShadow", 0x8b62, 'f', GD_2D, 1), GSAMP("sampler2DRect", 0x8b63, 'f', GD_RECT, 0),
    GSAMP("sampler2DRectShadow", 0x8b64, 'f', GD_RECT, 1), GSAMP("sampler1DArray", 0x8dc0, 'f', GD_1DA, 0),
    GSAMP("sampler2DArray", 0x8dc1, 'f', GD_2DA, 0), GSAMP("samplerBuffer", 0x8dc2, 'f', GD_BUF, 0),
    GSAMP("sampler1DArrayShadow", 0x8dc3, 'f', GD_1DA, 1), GSAMP("sampler2DArrayShadow", 0x8dc4, 'f', GD_2DA, 1),
    GSAMP("samplerCubeShadow", 0x8dc5, 'f', GD_CUBE, 1),
    GSAMP("isampler1D", 0x8dc9, 'i', GD_1D, 0), GSAMP("isampler2D", 0x8dca, 'i', GD_2D, 0), GSAMP("isampler3D", 0x8dcb, 'i', GD_3D, 0),
    GSAMP("isamplerCube", 0x8dcc, 'i', GD_CUBE, 0), GSAMP("isampler2DRect", 0x8dcd, 'i', GD_RECT, 0),
    GSAMP("isampler1DArray", 0x8dce, 'i', GD_1DA, 0), GSAMP("isampler2DArray", 0x8dcf, 'i', GD_2DA, 0),
    GSAMP("isamplerBuffer", 0x8dd0, 'i', GD_BUF, 0),
    GSAMP("usampler1D", 0x8dd1, 'u', GD_1D, 0), GSAMP("usampler2D", 0x8dd2, 'u', GD_2D, 0), GSAMP("usampler3D", 0x8dd3, 'u', GD_3D, 0),
    GSAMP("usamplerCube", 0x8dd4, 'u', GD_CUBE, 0), GSAMP("usampler2DRect", 0x8dd5, 'u', GD_RECT, 0),
    GSAMP("usampler1DArray", 0x8dd6, 'u', GD_1DA, 0), GSAMP("usampler2DArray", 0x8dd7, 'u', GD_2DA, 0),
    GSAMP("usamplerBuffer", 0x8dd8, 'u', GD_BUF, 0),
    GSAMP("sampler2DMS", 0x9108, 'f', GD_MS, 0), GSAMP("isampler2DMS", 0x9109, 'i', GD_MS, 0), GSAMP("usampler2DMS", 0x910a, 'u', GD_MS, 0),
    GSAMP("sampler2DMSArray", 0x910b, 'f', GD_MSA, 0), GSAMP("isampler2DMSArray", 0x910c, 'i', GD_MSA, 0),
    GSAMP("usampler2DMSArray", 0x910d, 'u', GD_MSA, 0),
};
#define GS_NTYPES ((int)(sizeof gs_types / sizeof gs_types[0]))
#define GS_STRUCT_BASE 0x100

#define GS_MAX_STRUCTS 32
#define GS_MAX_MEMBERS 384
#define GS_MAX_VARS 192
#define GS_MAX_BLOCKS 16
#define GS_MAX_FUNCS 128
#define GS_MAX_SPANS 384
#define GS_MAX_CONSTS 64
typedef struct { char name[GS_NAME]; uint16_t type, arr; uint32_t offset; } GsMember;
typedef struct { char name[GS_NAME]; uint16_t first, count; uint32_t align, size; uint8_t laid, inline_decl; uint32_t s0, s1; } GsStruct;
enum { GS_NONE, GS_UNIFORM, GS_IN, GS_OUT };
enum { GI_SMOOTH, GI_FLAT, GI_NOPERSP };
typedef struct { char name[GS_NAME]; uint16_t type, arr; uint8_t storage, interp, used, line; int32_t loc; uint32_t decl_line; } GsVar;
typedef struct { char name[GS_NAME], inst[GS_NAME]; uint16_t first, count; uint8_t used; uint32_t size, align, decl_line; } GsBlock;
typedef struct { char name[GS_NAME]; uint32_t b0, b1; uint8_t reach, scanned; } GsFunc;
typedef struct { uint32_t a, b; } GsSpan;
typedef struct { char name[GS_NAME]; int64_t v; } GsConst;
typedef struct {
    uint32_t stage;                    /* 1 vertex, 2 fragment */
    const char *src; uint32_t srclen;
    uint32_t nstructs, nmembers, nvars, nblocks, nfuncs, nspans, nconsts;
    GsStruct structs[GS_MAX_STRUCTS]; GsMember members[GS_MAX_MEMBERS]; GsVar vars[GS_MAX_VARS];
    GsBlock blocks[GS_MAX_BLOCKS]; GsFunc funcs[GS_MAX_FUNCS]; GsSpan spans[GS_MAX_SPANS]; GsConst consts[GS_MAX_CONSTS];
    int has_main;
} GsUnit;

static int gs_type_find(const GsUnit *u, const char *s, uint32_t n) {
    for (int i = 1; i < GS_NTYPES; i++) if (gs_eqn(s, n, gs_types[i].name)) return i;
    if (gs_eqn(s, n, "void")) return 0;
    for (uint32_t i = 0; i < u->nstructs; i++) if (gs_eqn(s, n, u->structs[i].name)) return GS_STRUCT_BASE + (int)i;
    return -1;
}
static const char *gs_type_name(const GsUnit *u, uint32_t t) { return t >= GS_STRUCT_BASE ? u->structs[t - GS_STRUCT_BASE].name : gs_types[t].name; }
static int gs_is_sampler(uint32_t t) { return t < GS_STRUCT_BASE && gs_types[t].kind != 'v' && gs_types[t].dim != 0; }
static uint32_t gs_roundup(uint32_t v, uint32_t a) { return (v + a - 1) / a * a; }

/* std140 base alignment, size and (for arrays) stride of a type. */
static void gs_layout_struct(GsUnit *u, uint32_t si);
static void gs_std140(GsUnit *u, uint32_t type, uint32_t arr, uint32_t *align, uint32_t *size, uint32_t *stride) {
    uint32_t a, s;
    if (type >= GS_STRUCT_BASE) { gs_layout_struct(u, type - GS_STRUCT_BASE); a = u->structs[type - GS_STRUCT_BASE].align; s = u->structs[type - GS_STRUCT_BASE].size; }
    else {
        const GsType *t = &gs_types[type];
        if (t->cols > 1) { a = 16; s = t->cols * 16; }
        else if (t->rows == 1) { a = 4; s = 4; } else if (t->rows == 2) { a = 8; s = 8; }
        else if (t->rows == 3) { a = 16; s = 12; } else { a = 16; s = 16; }
    }
    if (stride) *stride = 0;
    if (arr) { uint32_t st = gs_roundup(s, 16); if (stride) *stride = st; a = gs_roundup(a, 16); s = st * arr; }
    *align = a; *size = s;
}
static void gs_layout_struct(GsUnit *u, uint32_t si) {
    GsStruct *st = &u->structs[si]; if (st->laid) return;
    uint32_t off = 0, al = 0;
    for (uint32_t i = 0; i < st->count; i++) {
        GsMember *m = &u->members[st->first + i]; uint32_t a, s;
        gs_std140(u, m->type, m->arr, &a, &s, 0);
        off = gs_roundup(off, a); m->offset = off; off += s; if (a > al) al = a;
    }
    if (al < 16) al = 16;
    st->align = al; st->size = gs_roundup(off, al); st->laid = 1;
}

/* ------------------------------------------------------------------------------- lexer */
typedef struct { const char *s; uint32_t pos, end, line; } Lx;
typedef struct { const char *p; uint32_t len, off, line; char kind; } Tk;     /* kind: 0 eof, i, n, p */
static Tk lx_next(Lx *l) {
    Tk t; t.kind = 0; t.p = l->s + l->pos; t.len = 0; t.off = l->pos; t.line = l->line;
    while (l->pos < l->end && (gs_space(l->s[l->pos]) || l->s[l->pos] == '\n')) { if (l->s[l->pos] == '\n') l->line++; l->pos++; }
    t.p = l->s + l->pos; t.off = l->pos; t.line = l->line;
    if (l->pos >= l->end) return t;
    char c = l->s[l->pos]; uint32_t j = l->pos + 1;
    if (gs_alpha(c)) { while (j < l->end && gs_idc(l->s[j])) j++; t.kind = 'i'; }
    else if (gs_digit(c) || (c == '.' && j < l->end && gs_digit(l->s[j]))) {
        while (j < l->end && (gs_idc(l->s[j]) || l->s[j] == '.' || ((l->s[j] == '+' || l->s[j] == '-') &&
            (l->s[j - 1] == 'e' || l->s[j - 1] == 'E')))) j++;
        t.kind = 'n';
    } else {
        t.kind = 'p';
        if (j < l->end) { char d = l->s[j];
            if ((c == '<' && (d == '<' || d == '=')) || (c == '>' && (d == '>' || d == '=')) || (c == '=' && d == '=') ||
                (c == '!' && d == '=') || (c == '&' && d == '&') || (c == '|' && d == '|') || (c == '^' && d == '^') ||
                (c == '+' && (d == '+' || d == '=')) || (c == '-' && (d == '-' || d == '=')) ||
                ((c == '*' || c == '/' || c == '%' || c == '&' || c == '|' || c == '^') && d == '=')) j++; }
    }
    t.len = j - l->pos; l->pos = j; return t;
}
static Tk lx_peek(const Lx *l) { Lx c = *l; return lx_next(&c); }
static int tk_is(const Tk *t, const char *s) { return t->kind && gs_eqn(t->p, t->len, s); }
static void tk_copy(const Tk *t, char *dst) { uint32_t n = t->len < GS_NAME - 1 ? t->len : GS_NAME - 1; gs_copy(dst, t->p, n); dst[n] = 0; }

typedef struct { GsUnit *u; GsLog *log; int failed; } GsPs;
static void ps_err(GsPs *ps, const Tk *t, const char *msg, const char *arg) {
    if (!ps->failed) gs_diag(ps->log, 1, 0, t ? t->line : 0, 1, msg, arg);
    ps->failed = 1;
}
static void ps_errt(GsPs *ps, const Tk *t, const char *msg) {
    char nm[GS_NAME]; if (t && t->kind) tk_copy(t, nm); else nm[0] = 0;
    ps_err(ps, t, msg, nm);
}

/* Constant integer expression over tokens; stops at ',' ')' ']' ';' '}' ':' at depth 0. */
static int64_t cx_expr(GsPs *ps, Lx *l, int minp, int *ok);
static int64_t cx_unary(GsPs *ps, Lx *l, int *ok) {
    Tk t = lx_next(l);
    if (t.kind == 'n') {
        int64_t v = 0; uint32_t i = 0, base = 10;
        if (t.len > 1 && t.p[0] == '0' && (t.p[1] == 'x' || t.p[1] == 'X')) { base = 16; i = 2; } else if (t.len > 1 && t.p[0] == '0') base = 8;
        for (; i < t.len; i++) {
            char d = t.p[i]; int64_t x;
            if (gs_digit(d)) x = d - '0'; else if (base == 16 && d >= 'a' && d <= 'f') x = 10 + d - 'a';
            else if (base == 16 && d >= 'A' && d <= 'F') x = 10 + d - 'A'; else if ((d == 'u' || d == 'U') && i == t.len - 1) break;
            else { *ok = 0; return 0; }
            if (x >= (int64_t)base) { *ok = 0; return 0; }
            v = v * base + x;
        }
        return v;
    }
    if (t.kind == 'i') {
        if (tk_is(&t, "true")) return 1; if (tk_is(&t, "false")) return 0;
        for (uint32_t i = 0; i < ps->u->nconsts; i++) if (gs_eqn(t.p, t.len, ps->u->consts[i].name)) return ps->u->consts[i].v;
        Tk n = lx_peek(l);
        if ((tk_is(&t, "int") || tk_is(&t, "uint")) && tk_is(&n, "(")) {
            lx_next(l); int64_t v = cx_expr(ps, l, 0, ok); Tk c = lx_next(l); if (!tk_is(&c, ")")) *ok = 0; return v;
        }
        *ok = 0; return 0;
    }
    if (tk_is(&t, "(")) { int64_t v = cx_expr(ps, l, 0, ok); Tk c = lx_next(l); if (!tk_is(&c, ")")) *ok = 0; return v; }
    if (tk_is(&t, "-")) return -cx_unary(ps, l, ok);
    if (tk_is(&t, "+")) return cx_unary(ps, l, ok);
    if (tk_is(&t, "~")) return ~cx_unary(ps, l, ok);
    if (tk_is(&t, "!")) return !cx_unary(ps, l, ok);
    *ok = 0; return 0;
}
static int64_t cx_expr(GsPs *ps, Lx *l, int minp, int *ok) {
    int64_t a = cx_unary(ps, l, ok);
    for (;;) {
        Tk t = lx_peek(l); int prec = 0;
        if (t.kind != 'p') break;
        if (tk_is(&t, "||")) prec = 1; else if (tk_is(&t, "&&")) prec = 2; else if (tk_is(&t, "|")) prec = 3;
        else if (tk_is(&t, "^")) prec = 4; else if (tk_is(&t, "&")) prec = 5; else if (tk_is(&t, "==") || tk_is(&t, "!=")) prec = 6;
        else if (tk_is(&t, "<") || tk_is(&t, ">") || tk_is(&t, "<=") || tk_is(&t, ">=")) prec = 7;
        else if (tk_is(&t, "<<") || tk_is(&t, ">>")) prec = 8; else if (tk_is(&t, "+") || tk_is(&t, "-")) prec = 9;
        else if (tk_is(&t, "*") || tk_is(&t, "/") || tk_is(&t, "%")) prec = 10;
        if (!prec || prec < minp) break;
        lx_next(l); int64_t b = cx_expr(ps, l, prec + 1, ok);
        if (tk_is(&t, "||")) a = a || b; else if (tk_is(&t, "&&")) a = a && b; else if (tk_is(&t, "|")) a |= b;
        else if (tk_is(&t, "^")) a ^= b; else if (tk_is(&t, "&")) a &= b; else if (tk_is(&t, "==")) a = a == b;
        else if (tk_is(&t, "!=")) a = a != b; else if (tk_is(&t, "<")) a = a < b; else if (tk_is(&t, ">")) a = a > b;
        else if (tk_is(&t, "<=")) a = a <= b; else if (tk_is(&t, ">=")) a = a >= b;
        else if (tk_is(&t, "<<")) a = b < 0 || b > 62 ? 0 : a << b; else if (tk_is(&t, ">>")) a = b < 0 || b > 62 ? 0 : a >> b;
        else if (tk_is(&t, "+")) a += b; else if (tk_is(&t, "-")) a -= b; else if (tk_is(&t, "*")) a *= b;
        else { if (!b) { *ok = 0; return 0; } a = tk_is(&t, "/") ? a / b : a % b; }
    }
    return a;
}
static int cx_const(GsPs *ps, Lx *l, const Tk *at, int64_t *v) {
    int ok = 1; *v = cx_expr(ps, l, 0, &ok);
    if (!ok) { ps_err(ps, at, "constant integer expression expected", 0); return 0; }
    return 1;
}

/* Skip to the matching closer for an opener already consumed; returns 0 at EOF. */
static int ps_skip_group(Lx *l, char open, char close) {
    int depth = 1;
    while (depth) {
        Tk t = lx_next(l); if (!t.kind) return 0;
        if (t.kind == 'p' && t.len == 1) { if (t.p[0] == open) depth++; else if (t.p[0] == close) depth--; }
    }
    return 1;
}
static void ps_span(GsPs *ps, uint32_t a, uint32_t b) {
    if (ps->u->nspans == GS_MAX_SPANS) { ps_err(ps, 0, "too many global declarations", 0); return; }
    ps->u->spans[ps->u->nspans].a = a; ps->u->spans[ps->u->nspans++].b = b;
}

typedef struct { int storage, interp, loc, is_const, row_major, std140, invariant, line; } GsQuals;

static int ps_layout(GsPs *ps, Lx *l, GsQuals *q) {
    Tk t = lx_next(l);
    if (!tk_is(&t, "(")) { ps_errt(ps, &t, "expected ( after layout"); return 0; }
    for (;;) {
        Tk id = lx_next(l); char nm[GS_NAME];
        if (id.kind != 'i') { ps_errt(ps, &id, "layout qualifier expected"); return 0; }
        tk_copy(&id, nm); int64_t v = 0; int has = 0;
        Tk n = lx_peek(l);
        if (tk_is(&n, "=")) { lx_next(l); if (!cx_const(ps, l, &id, &v)) return 0; has = 1; }
        if (gs_eq(nm, "location")) { if (!has || v < 0) { ps_err(ps, &id, "layout location requires a non-negative value", 0); return 0; } q->loc = (int)v; }
        else if (gs_eq(nm, "std140") || gs_eq(nm, "shared") || gs_eq(nm, "packed")) q->std140 = 1;
        else if (gs_eq(nm, "row_major")) q->row_major = 1;
        else if (gs_eq(nm, "column_major")) q->row_major = 0;
        else if (gs_eq(nm, "binding") || gs_eq(nm, "std430") || gs_eq(nm, "offset") || gs_eq(nm, "index") || gs_eq(nm, "component") ||
            gs_eq(nm, "align") || gs_eq(nm, "set") || gs_eq(nm, "xfb_buffer") || gs_eq(nm, "xfb_offset"))
            { ps_err(ps, &id, "layout qualifier is not supported by this OpenGL 3.3 profile", nm); return 0; }
        else if (gs_eq(nm, "early_fragment_tests") || gs_eq(nm, "origin_upper_left") || gs_eq(nm, "pixel_center_integer") ||
            gs_eq(nm, "depth_any") || gs_eq(nm, "depth_greater") || gs_eq(nm, "depth_less") || gs_eq(nm, "depth_unchanged"))
            { ps_err(ps, &id, "fragment layout qualifier is not supported by the BGT shader translation", nm); return 0; }
        else { ps_err(ps, &id, "unknown layout qualifier", nm); return 0; }
        t = lx_next(l);
        if (tk_is(&t, ",")) continue;
        if (tk_is(&t, ")")) break;
        ps_errt(ps, &t, "expected , or ) in layout qualifier list"); return 0;
    }
    return 1;
}

/* Array suffix: [N]. Returns 1 and sets *arr (0 when absent). */
static int ps_array(GsPs *ps, Lx *l, uint32_t *arr) {
    Tk n = lx_peek(l); *arr = 0;
    if (!tk_is(&n, "[")) return 1;
    lx_next(l); int64_t v;
    Tk at = lx_peek(l);
    if (tk_is(&at, "]")) { ps_err(ps, &at, "unsized arrays are not supported in this context", 0); return 0; }
    if (!cx_const(ps, l, &at, &v)) return 0;
    Tk c = lx_next(l); if (!tk_is(&c, "]")) { ps_errt(ps, &c, "expected ]"); return 0; }
    if (v < 1 || v > 4096) { ps_err(ps, &at, "array size must be between 1 and 4096", 0); return 0; }
    *arr = (uint32_t)v; return 1;
}

static int ps_add_member(GsPs *ps, const Tk *at, const char *name, uint32_t type, uint32_t arr) {
    GsUnit *u = ps->u;
    if (u->nmembers == GS_MAX_MEMBERS) { ps_err(ps, at, "too many structure/block members", 0); return 0; }
    GsMember *m = &u->members[u->nmembers++]; gs_zero(m, sizeof *m);
    gs_copy(m->name, name, gs_len(name) + 1); m->type = (uint16_t)type; m->arr = (uint16_t)arr; return 1;
}
static int ps_is_qualword(const Tk *t) {
    static const char *const w[] = {"highp", "mediump", "lowp", "const", "flat", "smooth", "noperspective", "centroid", "invariant",
        "row_major", "column_major", "uniform", "in", "out", "layout", "sample", 0};
    for (int i = 0; w[i]; i++) if (tk_is(t, w[i])) return 1;
    return 0;
}
/* Members of a struct or interface block: after '{' up to and including '}'. Appended contiguous to u->members. */
static int ps_members(GsPs *ps, Lx *l, int in_block, uint32_t *first, uint32_t *count) {
    GsUnit *u = ps->u; *first = u->nmembers; *count = 0;
    for (;;) {
        Tk t = lx_next(l);
        if (tk_is(&t, "}")) break;
        if (!t.kind) { ps_err(ps, 0, "unexpected end of source in member list", 0); return 0; }
        int row_major = 0;
        while (ps_is_qualword(&t)) {
            if (tk_is(&t, "layout")) { GsQuals q = {0}; q.loc = -1; if (!ps_layout(ps, l, &q)) return 0;
                if (q.loc >= 0) { ps_err(ps, &t, "location qualifier is not allowed on members", 0); return 0; } row_major = q.row_major; }
            else if (tk_is(&t, "row_major")) row_major = 1;
            else if (tk_is(&t, "uniform") || tk_is(&t, "in") || tk_is(&t, "out") || tk_is(&t, "const") || tk_is(&t, "flat") ||
                tk_is(&t, "smooth") || tk_is(&t, "noperspective") || tk_is(&t, "centroid") || tk_is(&t, "invariant") || tk_is(&t, "sample")) {
                ps_errt(ps, &t, "storage or interpolation qualifier is not allowed on members"); return 0; }
            t = lx_next(l);
        }
        int ty = t.kind == 'i' ? gs_type_find(u, t.p, t.len) : -1;
        if (ty < 0 || ty == 0) { ps_errt(ps, &t, "type name expected"); return 0; }
        if (gs_is_sampler((uint32_t)ty)) { ps_err(ps, &t, "opaque types are not supported inside structures and blocks", gs_types[ty].name); return 0; }
        if (row_major && ty < GS_STRUCT_BASE && gs_types[ty].cols > 1) { ps_err(ps, &t, "row_major matrices are not supported by the BGT shader translation", 0); return 0; }
        uint32_t tarr = 0; if (!ps_array(ps, l, &tarr)) return 0;
        for (;;) {
            Tk nm = lx_next(l); char name[GS_NAME];
            if (nm.kind != 'i') { ps_errt(ps, &nm, "member name expected"); return 0; }
            tk_copy(&nm, name);
            for (uint32_t i = *first; i < u->nmembers; i++) if (gs_eq(u->members[i].name, name)) { ps_err(ps, &nm, "duplicate member", name); return 0; }
            uint32_t arr = tarr; if (!ps_array(ps, l, &arr)) return 0;
            if (!ps_add_member(ps, &nm, name, (uint32_t)ty, arr)) return 0;
            (*count)++;
            Tk e = lx_next(l);
            if (tk_is(&e, ",")) continue;
            if (tk_is(&e, ";")) break;
            ps_errt(ps, &e, "expected , or ; in member declaration"); return 0;
        }
    }
    if (!*count) { ps_err(ps, 0, in_block ? "interface block has no members" : "structure has no members", 0); return 0; }
    return 1;
}

/* Declarators after a type (or `Block {...}` instance): adds interface variables. */
static int ps_declarators(GsPs *ps, Lx *l, const GsQuals *q, uint32_t type, uint32_t tarr, uint32_t stmt0, const Tk *first, int has_stmt) {
    GsUnit *u = ps->u; Tk nm = *first;
    for (;;) {
        char name[GS_NAME];
        if (nm.kind != 'i') { ps_errt(ps, &nm, "declarator name expected"); return 0; }
        tk_copy(&nm, name);
        uint32_t arr = tarr; if (!ps_array(ps, l, &arr)) return 0;
        Tk n = lx_peek(l); int has_init = 0; Lx init_at = *l;
        if (tk_is(&n, "=")) {
            lx_next(l); has_init = 1; init_at = *l; int depth = 0;
            for (;;) {
                Tk t = lx_peek(l);
                if (!t.kind) { ps_err(ps, 0, "unexpected end of source in initializer", 0); return 0; }
                if (depth == 0 && (tk_is(&t, ",") || tk_is(&t, ";"))) break;
                lx_next(l);
                if (tk_is(&t, "(") || tk_is(&t, "[") || tk_is(&t, "{")) depth++;
                else if (tk_is(&t, ")") || tk_is(&t, "]") || tk_is(&t, "}")) depth--;
            }
        }
        if (q->storage) {
            if (has_init) { ps_err(ps, &nm, "initializers on uniform/in/out variables are not supported", name); return 0; }
            if (type == 0) { ps_err(ps, &nm, "variable cannot have type void", name); return 0; }
            for (uint32_t i = 0; i < u->nvars; i++) if (gs_eq(u->vars[i].name, name)) { ps_err(ps, &nm, "redeclaration of", name); return 0; }
            if (u->nvars == GS_MAX_VARS) { ps_err(ps, &nm, "too many interface variables", 0); return 0; }
            GsVar *v = &u->vars[u->nvars++]; gs_zero(v, sizeof *v);
            gs_copy(v->name, name, gs_len(name) + 1); v->type = (uint16_t)type; v->arr = (uint16_t)arr; v->storage = (uint8_t)q->storage;
            v->interp = (uint8_t)q->interp; v->loc = q->loc; v->decl_line = nm.line;
        } else if (q->is_const && arr == 0 && type < GS_STRUCT_BASE && has_init &&
            (gs_eq(gs_types[type].name, "int") || gs_eq(gs_types[type].name, "uint")) && u->nconsts < GS_MAX_CONSTS) {
            Lx e = init_at; int ok = 1; GsPs sub = *ps; sub.failed = 0; int64_t v = cx_expr(&sub, &e, 0, &ok);
            Tk end = lx_peek(&e);
            if (ok && (tk_is(&end, ",") || tk_is(&end, ";"))) {
                gs_copy(u->consts[u->nconsts].name, name, gs_len(name) + 1); u->consts[u->nconsts++].v = v;
            }
        }
        Tk e = lx_next(l);
        if (tk_is(&e, ",")) { nm = lx_next(l); continue; }
        if (tk_is(&e, ";")) { if (q->storage && has_stmt) ps_span(ps, stmt0, e.off + 1); return 1; }
        ps_errt(ps, &e, "expected , or ; after declaration"); return 0;
    }
}

static int ps_global(GsPs *ps, Lx *l) {
    GsUnit *u = ps->u;
    Tk t = lx_next(l);
    if (!t.kind) return 2;
    if (tk_is(&t, ";")) return 1;
    uint32_t stmt0 = t.off;
    if (tk_is(&t, "precision")) {
        for (;;) { Tk x = lx_next(l); if (!x.kind) { ps_err(ps, &t, "unterminated precision statement", 0); return 0; }
            if (tk_is(&x, ";")) { ps_span(ps, stmt0, x.off + 1); return 1; } }
    }
    if (tk_is(&t, "invariant")) {
        Lx c = *l; Tk a = lx_next(&c), b = lx_next(&c);
        if (a.kind == 'i' && tk_is(&b, ";") && !ps_is_qualword(&a) && gs_type_find(u, a.p, a.len) < 0) {
            *l = c; ps_span(ps, stmt0, b.off + 1); return 1;
        }
    }
    GsQuals q; gs_zero(&q, sizeof q); q.loc = -1;
    while (t.kind == 'i' && ps_is_qualword(&t)) {
        if (tk_is(&t, "layout")) { if (!ps_layout(ps, l, &q)) return 0; }
        else if (tk_is(&t, "const")) q.is_const = 1;
        else if (tk_is(&t, "uniform")) q.storage = GS_UNIFORM;
        else if (tk_is(&t, "in")) q.storage = GS_IN;
        else if (tk_is(&t, "out")) q.storage = GS_OUT;
        else if (tk_is(&t, "flat")) q.interp = GI_FLAT;
        else if (tk_is(&t, "smooth")) q.interp = GI_SMOOTH;
        else if (tk_is(&t, "noperspective")) q.interp = GI_NOPERSP;
        t = lx_next(l);
    }
    if (tk_is(&t, "attribute") || tk_is(&t, "varying")) {
        ps_err(ps, &t, "attribute/varying are not available in the OpenGL 3.3 core profile; use in/out", 0); return 0; }
    if (tk_is(&t, "struct")) {
        Tk nm = lx_next(l); char name[GS_NAME];
        if (nm.kind != 'i') { ps_err(ps, &nm, "structure name expected", 0); return 0; }
        tk_copy(&nm, name);
        for (uint32_t i = 0; i < u->nstructs; i++) if (gs_eq(u->structs[i].name, name)) { ps_err(ps, &nm, "redefinition of structure", name); return 0; }
        if (gs_type_find(u, name, gs_len(name)) >= 0) { ps_err(ps, &nm, "structure name conflicts with a type", name); return 0; }
        Tk b = lx_next(l); if (!tk_is(&b, "{")) { ps_errt(ps, &b, "expected { after structure name"); return 0; }
        if (u->nstructs == GS_MAX_STRUCTS) { ps_err(ps, &nm, "too many structures", 0); return 0; }
        uint32_t first, count; if (!ps_members(ps, l, 0, &first, &count)) return 0;
        uint32_t si = u->nstructs++; GsStruct *st = &u->structs[si]; gs_zero(st, sizeof *st);
        gs_copy(st->name, name, gs_len(name) + 1); st->first = (uint16_t)first; st->count = (uint16_t)count; st->s0 = stmt0;
        Tk e = lx_next(l);
        if (tk_is(&e, ";")) { st->s1 = e.off + 1; return 1; }
        st->inline_decl = 1;
        if (q.storage) { ps_err(ps, &e, "a structure definition cannot be combined with an interface declaration; declare the structure separately", 0); return 0; }
        return ps_declarators(ps, l, &q, GS_STRUCT_BASE + si, 0, stmt0, &e, 0) ? 1 : 0;
    }
    if (t.kind != 'i') { ps_errt(ps, &t, "syntax error"); return 0; }
    int ty = gs_type_find(u, t.p, t.len);
    if (ty < 0) {
        Tk n = lx_peek(l);
        if (q.storage && tk_is(&n, "{")) {                      /* interface block */
            if (q.storage != GS_UNIFORM) { ps_err(ps, &t, "in/out interface blocks are not supported by the BGT shader translation", 0); return 0; }
            lx_next(l);
            if (u->nblocks == GS_MAX_BLOCKS) { ps_err(ps, &t, "too many uniform blocks", 0); return 0; }
            GsBlock *b = &u->blocks[u->nblocks]; gs_zero(b, sizeof *b); tk_copy(&t, b->name); b->decl_line = t.line;
            for (uint32_t i = 0; i < u->nblocks; i++) if (gs_eq(u->blocks[i].name, b->name)) { ps_err(ps, &t, "redefinition of uniform block", b->name); return 0; }
            uint32_t first, count; if (!ps_members(ps, l, 1, &first, &count)) return 0;
            b->first = (uint16_t)first; b->count = (uint16_t)count; u->nblocks++;
            if (q.row_major) { ps_err(ps, &t, "row_major layout is not supported by the BGT shader translation", 0); return 0; }
            Tk e = lx_next(l);
            if (e.kind == 'i') {
                tk_copy(&e, b->inst);
                Tk a = lx_peek(l);
                if (tk_is(&a, "[")) { ps_err(ps, &a, "arrays of uniform blocks are not supported", 0); return 0; }
                e = lx_next(l);
            }
            if (!tk_is(&e, ";")) { ps_errt(ps, &e, "expected ; after uniform block"); return 0; }
            ps_span(ps, stmt0, e.off + 1);
            return 1;
        }
        ps_errt(ps, &t, "unknown type name"); return 0;
    }
    uint32_t tarr = 0; if (!ps_array(ps, l, &tarr)) return 0;
    Tk nm = lx_next(l);
    if (nm.kind != 'i') { ps_errt(ps, &nm, "declarator name expected"); return 0; }
    Tk n = lx_peek(l);
    if (tk_is(&n, "(")) {                                          /* function */
        if (q.storage) { ps_err(ps, &nm, "functions cannot have storage qualifiers", 0); return 0; }
        lx_next(l);
        Lx pl = *l;
        if (!ps_skip_group(l, '(', ')')) { ps_err(ps, &nm, "unterminated parameter list", 0); return 0; }
        for (;;) {                                                  /* sampler parameters cannot be translated */
            Tk x = lx_next(&pl); if (!x.kind || pl.pos > l->pos) break;
            int xt = x.kind == 'i' ? gs_type_find(u, x.p, x.len) : -1;
            if (xt > 0 && gs_is_sampler((uint32_t)xt)) { ps_err(ps, &x, "sampler function parameters are not supported by the BGT shader translation", 0); return 0; }
        }
        Tk b = lx_next(l);
        if (tk_is(&b, ";")) return 1;
        if (!tk_is(&b, "{")) { ps_errt(ps, &b, "expected { or ; after function header"); return 0; }
        uint32_t b0 = l->pos;
        if (!ps_skip_group(l, '{', '}')) { ps_err(ps, &nm, "unterminated function body", 0); return 0; }
        if (u->nfuncs == GS_MAX_FUNCS) { ps_err(ps, &nm, "too many functions", 0); return 0; }
        GsFunc *f = &u->funcs[u->nfuncs++]; gs_zero(f, sizeof *f); tk_copy(&nm, f->name); f->b0 = b0; f->b1 = l->pos - 1;
        if (gs_eq(f->name, "main")) u->has_main = 1;
        return 1;
    }
    return ps_declarators(ps, l, &q, (uint32_t)ty, tarr, stmt0, &nm, 1) ? 1 : 0;
}

static int gs_parse(GsUnit *u, uint32_t stage, const char *src, uint32_t n, GsLog *log) {
    gs_zero(u, sizeof *u); u->stage = stage; u->src = src; u->srclen = n;
    GsPs ps = {u, log, 0}; Lx l = {src, 0, n, 1};
    for (;;) {
        int r = ps_global(&ps, &l);
        if (r == 2) break;
        if (!r || ps.failed) { if (!ps.failed) ps_err(&ps, 0, "syntax error", 0); return 0; }
    }
    return 1;
}


/* ===================================================================== usage analysis */
typedef struct { const char *name; uint32_t len; uint8_t kind; uint16_t idx; } GsSym;
enum { SYM_VAR = 1, SYM_BLOCK, SYM_FUNC };
static GsSym gs_syms[1024]; static uint16_t gs_tab[2048]; static uint32_t gs_nsyms;
static void gs_sym_add(const char *name, uint8_t kind, uint16_t idx) {
    if (gs_nsyms == 1024) return;
    uint32_t n = gs_len(name), h = (uint32_t)gs_fnv(name, n) & 2047;
    gs_syms[gs_nsyms].name = name; gs_syms[gs_nsyms].len = n; gs_syms[gs_nsyms].kind = kind; gs_syms[gs_nsyms].idx = idx;
    while (gs_tab[h]) h = (h + 1) & 2047;
    gs_tab[h] = (uint16_t)(++gs_nsyms);
}
static void gs_scan_body(GsUnit *u, uint32_t b0, uint32_t b1, int mark_funcs) {
    const char *s = u->src;
    for (uint32_t i = b0; i < b1;) {
        char c = s[i];
        if (gs_digit(c) || (c == '.' && i + 1 < b1 && gs_digit(s[i + 1]))) {
            i++; while (i < b1 && (gs_idc(s[i]) || s[i] == '.' || ((s[i] == '+' || s[i] == '-') && (s[i - 1] == 'e' || s[i - 1] == 'E')))) i++;
            continue;
        }
        if (!gs_alpha(c)) { i++; continue; }
        uint32_t j = i + 1; while (j < b1 && gs_idc(s[j])) j++;
        uint32_t k = i; while (k > b0 && (gs_space(s[k - 1]) || s[k - 1] == '\n')) k--;
        int member = k > b0 && s[k - 1] == '.';
        if (!member) {
            uint32_t h = (uint32_t)gs_fnv(s + i, j - i) & 2047;
            while (gs_tab[h]) {
                GsSym *y = &gs_syms[gs_tab[h] - 1];
                if (y->len == j - i && gs_eqn(s + i, j - i, y->name) && y->name[y->len] == 0) {
                    if (y->kind == SYM_VAR) u->vars[y->idx].used = 1;
                    else if (y->kind == SYM_BLOCK) u->blocks[y->idx].used = 1;
                    else if (mark_funcs) for (uint32_t f = 0; f < u->nfuncs; f++) if (gs_eq(u->funcs[f].name, y->name)) u->funcs[f].reach |= 1;
                }
                h = (h + 1) & 2047;
            }
        }
        i = j;
    }
}
/* Marks variables and uniform blocks statically used by code reachable from main. */
static void gs_analyze(GsUnit *u) {
    gs_zero(gs_tab, sizeof gs_tab); gs_nsyms = 0;
    for (uint32_t i = 0; i < u->nvars; i++) gs_sym_add(u->vars[i].name, SYM_VAR, (uint16_t)i);
    for (uint32_t i = 0; i < u->nblocks; i++) {
        GsBlock *b = &u->blocks[i];
        if (b->inst[0]) gs_sym_add(b->inst, SYM_BLOCK, (uint16_t)i);
        else for (uint32_t m = 0; m < b->count; m++) gs_sym_add(u->members[b->first + m].name, SYM_BLOCK, (uint16_t)i);
    }
    for (uint32_t i = 0; i < u->nfuncs; i++) gs_sym_add(u->funcs[i].name, SYM_FUNC, (uint16_t)i);
    for (uint32_t i = 0; i < u->nfuncs; i++) if (gs_eq(u->funcs[i].name, "main")) u->funcs[i].reach |= 1;
    for (int changed = 1; changed;) {
        changed = 0;
        for (uint32_t i = 0; i < u->nfuncs; i++) if ((u->funcs[i].reach & 1) && !u->funcs[i].scanned) {
            u->funcs[i].scanned = 1; gs_scan_body(u, u->funcs[i].b0, u->funcs[i].b1, 1); changed = 1;
        }
    }
}

/* ============================================================================ program linking */
/* Reflection-only mode (host tests): report every GL type without enforcing the BGT backend subset. */
static int gs_reflect_only;
#define GP_MAX_UNIFORMS 512
#define GP_NAMES 24576
#define GP_MAX_BINDINGS 16
#define GP_BUFFER_LIMIT 16384u
typedef struct { uint32_t name, gl_type; int32_t size, location, block; uint32_t offset, stride, mstride, slot; uint8_t kind, cols, rows, dim, shadow, stages; } GpUniform;
typedef struct { uint32_t name, size, nmembers, first; int32_t unit[2]; uint8_t stages; } GpBlock;
typedef struct { uint32_t name, gl_type; int32_t size, location; } GpAttrib;
typedef struct { uint8_t stage, var; uint32_t offset, slot; } GpVar;
typedef struct { char name[GS_NAME]; uint32_t loc; } GpBinding;
typedef struct {
    uint32_t nu, nb, na, no, nloc, usize, nslots, ndv, names_len, name_max;
    GpUniform u[GP_MAX_UNIFORMS]; GpBlock b[7]; GpAttrib a[16]; GpAttrib o[8]; GpVar dv[GS_MAX_VARS];
    uint8_t slot_shadow[8]; char names[GP_NAMES];
    uint32_t attr_max, uniform_max, block_max;
} Gp;

static const char *gp_name(const Gp *g, uint32_t off) { return g->names + off; }
static int gp_intern(Gp *g, GsLog *log, const char *s, uint32_t *off) {
    uint32_t n = gs_len(s);
    if (g->names_len + n + 1 > GP_NAMES) { gs_diag(log, 1, 0, 0, 0, "too many active uniform names", 0); return 0; }
    *off = g->names_len; gs_copy(g->names + g->names_len, s, n + 1); g->names_len += n + 1; return 1;
}
static void gp_cat(char *dst, uint32_t cap, const char *s) {
    uint32_t n = gs_len(dst); uint32_t i = 0; while (s[i] && n + 1 < cap) dst[n++] = s[i++]; dst[n] = 0;
}
static void gp_cat_u(char *dst, uint32_t cap, uint32_t v) { char b[12]; pp_number_u32(b, v); gp_cat(dst, cap, b); }
static uint32_t gp_slots(const GsUnit *u, uint32_t type, uint32_t arr) {   /* attribute locations consumed */
    uint32_t n = type < GS_STRUCT_BASE && gs_types[type].cols > 1 ? gs_types[type].cols : 1; (void)u; return n * (arr ? arr : 1);
}

static int gp_leaf(Gp *g, GsLog *log, GsUnit *u, const char *name, uint32_t type, uint32_t arr, uint32_t off, int block, uint32_t stages) {
    if (g->nu == GP_MAX_UNIFORMS) { gs_diag(log, 1, 0, 0, 0, "too many active uniforms", 0); return 0; }
    GpUniform *x = &g->u[g->nu]; gs_zero(x, sizeof *x);
    char nm[160]; nm[0] = 0; gp_cat(nm, sizeof nm, name); if (arr) gp_cat(nm, sizeof nm, "[0]");
    if (!gp_intern(g, log, nm, &x->name)) return 0;
    const GsType *t = &gs_types[type];
    x->gl_type = t->gl; x->size = arr ? (int32_t)arr : 1; x->block = block; x->kind = (uint8_t)t->kind; x->cols = t->cols; x->rows = t->rows;
    x->dim = t->dim; x->shadow = t->shadow; x->stages = (uint8_t)stages;
    uint32_t n = gs_len(nm); if (n + 1 > g->uniform_max) g->uniform_max = n + 1;
    if (t->dim) {
        if (block >= 0) { gs_diag(log, 1, 0, 0, 0, "opaque types are not allowed in uniform blocks", name); return 0; }
        x->location = (int32_t)g->nloc; g->nloc += x->size; x->offset = 0;
        x->slot = g->nslots + 1;
        for (int32_t e = 0; e < x->size; e++) {
            if (g->nslots == 8 && !gs_reflect_only) { gs_diag(log, 1, 0, 0, 0, "too many active texture samplers (BGT supports 8 slots)", name); return 0; }
            if (g->nslots < 8) g->slot_shadow[g->nslots++] = t->shadow;
        }
    } else {
        uint32_t a, s, st; gs_std140(u, type, arr, &a, &s, &st);
        x->offset = off; x->stride = arr ? st : 0; x->mstride = t->cols > 1 ? 16 : 0;
        if (block < 0) { x->location = (int32_t)g->nloc; g->nloc += x->size; } else x->location = -1;
    }
    g->nu++; return 1;
}
static int gp_flatten(Gp *g, GsLog *log, GsUnit *u, const char *name, uint32_t type, uint32_t arr, uint32_t off, int block, uint32_t stages) {
    if (type < GS_STRUCT_BASE) return gp_leaf(g, log, u, name, type, arr, off, block, stages);
    GsStruct *st = &u->structs[type - GS_STRUCT_BASE]; gs_layout_struct(u, type - GS_STRUCT_BASE);
    uint32_t count = arr ? arr : 1;
    for (uint32_t e = 0; e < count; e++) for (uint32_t m = 0; m < st->count; m++) {
        GsMember *mm = &u->members[st->first + m]; char nm[160]; nm[0] = 0; gp_cat(nm, sizeof nm, name);
        if (arr) { gp_cat(nm, sizeof nm, "["); gp_cat_u(nm, sizeof nm, e); gp_cat(nm, sizeof nm, "]"); }
        gp_cat(nm, sizeof nm, "."); gp_cat(nm, sizeof nm, mm->name);
        if (!gp_flatten(g, log, u, nm, mm->type, mm->arr, off + e * st->size + mm->offset, block, stages)) return 0;
    }
    return 1;
}

static int gs_types_equal(GsUnit *a, uint32_t ta, uint32_t arra, GsUnit *b, uint32_t tb, uint32_t arrb) {
    if (arra != arrb) return 0;
    if ((ta >= GS_STRUCT_BASE) != (tb >= GS_STRUCT_BASE)) return 0;
    if (ta < GS_STRUCT_BASE) return ta == tb || gs_types[ta].gl == gs_types[tb].gl;
    GsStruct *x = &a->structs[ta - GS_STRUCT_BASE], *y = &b->structs[tb - GS_STRUCT_BASE];
    if (!gs_eq(x->name, y->name) || x->count != y->count) return 0;
    for (uint32_t i = 0; i < x->count; i++) {
        GsMember *m = &a->members[x->first + i], *n = &b->members[y->first + i];
        if (!gs_eq(m->name, n->name) || !gs_types_equal(a, m->type, m->arr, b, n->type, n->arr)) return 0;
    }
    return 1;
}

/* Link: the vertex and/or fragment unit (either may be NULL for single-stage provisional compiles). */
static int gp_link(Gp *g, GsUnit *vs, GsUnit *fs, const GpBinding *abind, uint32_t nabind, const GpBinding *obind, uint32_t nobind,
    GsLog *log) {
    gs_zero(g, sizeof *g);
    GsUnit *un[2] = {vs, fs};
    for (int s = 0; s < 2; s++) if (un[s] && !un[s]->has_main) {
        gs_diag(log, 1, 0, 0, 0, s ? "fragment shader does not define main" : "vertex shader does not define main", 0); return 0; }
    /* ---- default-block uniforms */
    uint32_t cursor = 16; int ok = 1;
    for (int s = 0; s < 2 && ok; s++) if (un[s]) for (uint32_t i = 0; i < un[s]->nvars && ok; i++) {
        GsVar *v = &un[s]->vars[i]; if (v->storage != GS_UNIFORM) continue;
        int o = 1 - s; GsVar *w = 0; if (un[o]) for (uint32_t j = 0; j < un[o]->nvars; j++)
            if (un[o]->vars[j].storage == GS_UNIFORM && gs_eq(un[o]->vars[j].name, v->name)) w = &un[o]->vars[j];
        if (w && !gs_types_equal(un[s], v->type, v->arr, un[o], w->type, w->arr)) {
            gs_diag(log, 1, 0, v->decl_line, 1, "uniform declared with different types in the vertex and fragment shaders", v->name); ok = 0; break; }
        if (!v->used && !(w && w->used)) continue;
        if (s == 1) { int dup = 0; for (uint32_t k = 0; k < g->ndv; k++) if (g->dv[k].stage == 0 && gs_eq(vs->vars[g->dv[k].var].name, v->name)) dup = 1; if (dup) continue; }
        uint32_t a, sz; gs_std140(un[s], v->type, v->arr, &a, &sz, 0);
        GpVar *d = &g->dv[g->ndv++]; d->stage = (uint8_t)s; d->var = (uint8_t)i;
        if (v->type < GS_STRUCT_BASE && gs_types[v->type].dim) {
            const GsType *t = &gs_types[v->type];
            if (!(t->dim == GD_2D && t->kind == 'f') && !gs_reflect_only) {
                gs_diag(log, 1, 0, v->decl_line, 1, "sampler type is not supported by the BGT texture layer (only sampler2D and sampler2DShadow)", v->name); ok = 0; break; }
            d->offset = 0;
        } else {
            cursor = gs_roundup(cursor, a); d->offset = cursor; cursor += sz;
            if (cursor > GP_BUFFER_LIMIT) { gs_diag(log, 1, 0, v->decl_line, 1, "active uniforms exceed the BGT uniform storage limit", v->name); ok = 0; break; }
        }
        int stages = (v->used ? 1 << s : 0) | (w && w->used ? 1 << o : 0);
        d->slot = g->nslots;
        if (!gp_flatten(g, log, un[s], v->name, v->type, v->arr, d->offset, -1, (uint32_t)stages)) { ok = 0; break; }
    }
    if (!ok) return 0;
    g->usize = gs_roundup(cursor, 16);
    /* ---- uniform blocks */
    for (int s = 0; s < 2 && ok; s++) if (un[s]) for (uint32_t i = 0; i < un[s]->nblocks && ok; i++) {
        GsBlock *b = &un[s]->blocks[i]; int o = 1 - s; GsBlock *w = 0;
        if (un[o]) for (uint32_t j = 0; j < un[o]->nblocks; j++) if (gs_eq(un[o]->blocks[j].name, b->name)) w = &un[o]->blocks[j];
        if (w) {
            int same = w->count == b->count;
            for (uint32_t m = 0; same && m < b->count; m++) {
                GsMember *x = &un[s]->members[b->first + m], *y = &un[o]->members[w->first + m];
                same = gs_eq(x->name, y->name) && gs_types_equal(un[s], x->type, x->arr, un[o], y->type, y->arr);
            }
            if (!same) { gs_diag(log, 1, 0, b->decl_line, 1, "uniform block declared differently in the vertex and fragment shaders", b->name); ok = 0; break; }
        }
        if (!b->used && !(w && w->used)) continue;
        uint32_t k; for (k = 0; k < g->nb; k++) if (gs_eq(gp_name(g, g->b[k].name), b->name)) break;
        if (k < g->nb) { g->b[k].unit[s] = (int32_t)i; if (b->used) g->b[k].stages |= (uint8_t)(1 << s); continue; }
        if (g->nb == 7) { gs_diag(log, 1, 0, b->decl_line, 1, "too many active uniform blocks (BGT supports 7)", b->name); ok = 0; break; }
        GpBlock *gb = &g->b[g->nb++]; gs_zero(gb, sizeof *gb); gb->unit[0] = gb->unit[1] = -1; gb->unit[s] = (int32_t)i;
        gb->stages = b->used ? (uint8_t)(1 << s) : 0;
        if (!gp_intern(g, log, b->name, &gb->name)) { ok = 0; break; }
        uint32_t nl = gs_len(b->name) + 1; if (nl > g->block_max) g->block_max = nl;
        uint32_t off = 0; gb->first = g->nu; gb->nmembers = 0;
        uint32_t u0 = g->nu;
        for (uint32_t m = 0; m < b->count; m++) {
            GsMember *mm = &un[s]->members[b->first + m]; uint32_t a, sz; gs_std140(un[s], mm->type, mm->arr, &a, &sz, 0);
            off = gs_roundup(off, a);
            char nm[160]; nm[0] = 0; gp_cat(nm, sizeof nm, b->name); gp_cat(nm, sizeof nm, "."); gp_cat(nm, sizeof nm, mm->name);
            if (!gp_flatten(g, log, un[s], nm, mm->type, mm->arr, off, (int)(g->nb - 1), 3)) { ok = 0; break; }
            off += sz;
        }
        gb->nmembers = g->nu - u0; gb->size = gs_roundup(off, 16);
        if (gb->size > 65536) { gs_diag(log, 1, 0, b->decl_line, 1, "uniform block exceeds the BGT size limit", b->name); ok = 0; }
    }
    if (!ok) return 0;
    for (uint32_t i = 0; i < g->nu; i++) { if (g->u[i].block >= 0) g->u[i].stages = g->b[g->u[i].block].stages; }
    /* ---- vertex attributes */
    if (vs) {
        uint32_t used_loc = 0;                                  /* bitmask over 16 locations */
        int32_t loc_of[GS_MAX_VARS]; for (uint32_t i = 0; i < GS_MAX_VARS; i++) loc_of[i] = -1;
        for (int pass = 0; pass < 3 && ok; pass++) for (uint32_t i = 0; i < vs->nvars && ok; i++) {
            GsVar *v = &vs->vars[i]; if (v->storage != GS_IN || !v->used) continue;
            uint32_t n = gp_slots(vs, v->type, v->arr); int32_t want = -1;
            if (pass == 0) want = v->loc;
            else if (pass == 1 && v->loc < 0) for (uint32_t k = 0; k < nabind; k++) if (gs_eq(abind[k].name, v->name)) want = (int32_t)abind[k].loc;
            if (pass < 2 && want < 0) continue;
            if (pass == 2) { if (loc_of[i] >= 0) continue; uint32_t base; for (base = 0; base + n <= 16; base++) if (!(used_loc & (((1u << n) - 1) << base))) break;
                if (base + n > 16) { gs_diag(log, 1, 0, v->decl_line, 1, "too many vertex attribute locations (max 16)", v->name); ok = 0; break; } want = (int32_t)base; }
            if (want < 0) continue;
            if ((uint32_t)want + n > 16) { gs_diag(log, 1, 0, v->decl_line, 1, "vertex attribute location out of range", v->name); ok = 0; break; }
            uint32_t mask = ((1u << n) - 1) << want;
            if (used_loc & mask) { gs_diag(log, 1, 0, v->decl_line, 1, "vertex attribute location is already in use", v->name); ok = 0; break; }
            used_loc |= mask; loc_of[i] = want;
        }
        for (uint32_t i = 0; i < vs->nvars && ok; i++) {
            GsVar *v = &vs->vars[i]; if (v->storage != GS_IN || !v->used) continue;
            GpAttrib *a = &g->a[g->na++]; if (!gp_intern(g, log, v->name, &a->name)) { ok = 0; break; }
            a->gl_type = gs_types[v->type < GS_STRUCT_BASE ? v->type : 0].gl; a->size = v->arr ? v->arr : 1; a->location = loc_of[i];
            uint32_t nl = gs_len(v->name) + 1 + (v->arr ? 3 : 0); if (nl > g->attr_max) g->attr_max = nl;
            if (v->type >= GS_STRUCT_BASE) { gs_diag(log, 1, 0, v->decl_line, 1, "vertex input cannot be a structure", v->name); ok = 0; }
        }
    }
    if (!ok) return 0;
    /* ---- fragment outputs */
    if (fs) {
        uint32_t used_loc = 0; int32_t loc_of[GS_MAX_VARS]; for (uint32_t i = 0; i < GS_MAX_VARS; i++) loc_of[i] = -1;
        for (int pass = 0; pass < 3 && ok; pass++) for (uint32_t i = 0; i < fs->nvars && ok; i++) {
            GsVar *v = &fs->vars[i]; if (v->storage != GS_OUT) continue;
            uint32_t n = gp_slots(fs, v->type, v->arr); int32_t want = -1;
            if (pass == 0) want = v->loc;
            else if (pass == 1 && v->loc < 0) for (uint32_t k = 0; k < nobind; k++) if (gs_eq(obind[k].name, v->name)) want = (int32_t)obind[k].loc;
            if (pass < 2 && want < 0) continue;
            if (pass == 2) { if (loc_of[i] >= 0) continue; uint32_t base; for (base = 0; base + n <= 8; base++) if (!(used_loc & (((1u << n) - 1) << base))) break;
                if (base + n > 8) { gs_diag(log, 1, 0, v->decl_line, 1, "too many fragment output locations (max 8)", v->name); ok = 0; break; } want = (int32_t)base; }
            if (want < 0) continue;
            if ((uint32_t)want + n > 8) { gs_diag(log, 1, 0, v->decl_line, 1, "fragment output location out of range", v->name); ok = 0; break; }
            uint32_t mask = ((1u << n) - 1) << want;
            if (used_loc & mask) { gs_diag(log, 1, 0, v->decl_line, 1, "fragment output location is already in use", v->name); ok = 0; break; }
            used_loc |= mask; loc_of[i] = want;
        }
        for (uint32_t i = 0; i < fs->nvars && ok; i++) {
            GsVar *v = &fs->vars[i]; if (v->storage != GS_OUT) continue;
            GpAttrib *a = &g->o[g->no++]; if (!gp_intern(g, log, v->name, &a->name)) { ok = 0; break; }
            a->gl_type = gs_types[v->type < GS_STRUCT_BASE ? v->type : 0].gl; a->size = v->arr ? v->arr : 1; a->location = loc_of[i];
            if (v->type >= GS_STRUCT_BASE) { gs_diag(log, 1, 0, v->decl_line, 1, "fragment output cannot be a structure", v->name); ok = 0; }
        }
    }
    if (!ok) return 0;
    /* ---- stage interface: every statically used fragment input needs a matching vertex output */
    if (vs && fs) for (uint32_t i = 0; i < fs->nvars; i++) {
        GsVar *v = &fs->vars[i]; if (v->storage != GS_IN || !v->used) continue;
        GsVar *w = 0; for (uint32_t j = 0; j < vs->nvars; j++) if (vs->vars[j].storage == GS_OUT && gs_eq(vs->vars[j].name, v->name)) w = &vs->vars[j];
        if (!w) { gs_diag(log, 1, 0, v->decl_line, 1, "fragment shader input has no matching output in the vertex shader", v->name); return 0; }
        if (!gs_types_equal(fs, v->type, v->arr, vs, w->type, w->arr)) {
            gs_diag(log, 1, 0, v->decl_line, 1, "fragment input and vertex output types differ", v->name); return 0; }
        if (v->interp != w->interp) { gs_diag(log, 1, 0, v->decl_line, 1, "fragment input and vertex output interpolation qualifiers differ", v->name); return 0; }
    }
    uint32_t mx = 0; for (uint32_t i = 0; i < g->nu; i++) { uint32_t n = gs_len(gp_name(g, g->u[i].name)) + 1; if (n > mx) mx = n; }
    g->name_max = mx;
    return 1;
}

/* Language-subset limits of the BGT interface (reported as GL compile errors, never silently translated). */
static int gs_policy(GsUnit *u, GsLog *log) {
    int ok = 1;
    if (gs_reflect_only) return 1;
    for (uint32_t i = 0; i < u->nvars; i++) {
        GsVar *v = &u->vars[i]; const GsType *t = v->type < GS_STRUCT_BASE ? &gs_types[v->type] : 0;
        if (v->storage == GS_IN && u->stage == 1 && v->used) {
            if (!t || t->dim || t->kind == 'b' || t->cols > 1 || v->arr) { gs_diag(log, 1, 0, v->decl_line, 1, "vertex input type is not supported by the BGT vertex layout (scalars and vectors of float/int/uint only)", v->name); ok = 0; }
        } else if (v->storage == GS_OUT && u->stage == 2) {
            if (!t || t->dim || t->kind != 'f' || t->cols > 1 || v->arr) { gs_diag(log, 1, 0, v->decl_line, 1, "fragment output must be float or a float vector (no arrays or matrices)", v->name); ok = 0; }
        } else if ((v->storage == GS_OUT && u->stage == 1) || (v->storage == GS_IN && u->stage == 2 && v->used)) {
            if (!t || t->dim || t->kind == 'b' || t->cols > 1 || v->arr) { gs_diag(log, 1, 0, v->decl_line, 1, "varying type is not supported by the BGT shader translation (scalars and vectors only; no arrays or matrices)", v->name); ok = 0; }
            else if (t->kind != 'f' && v->interp != GI_FLAT) { gs_diag(log, 1, 0, v->decl_line, 1, "integer varyings must be declared flat", v->name); ok = 0; }
        } else if (v->storage == GS_UNIFORM && v->used && t && t->dim) {
            if (!(t->dim == GD_2D && t->kind == 'f')) { gs_diag(log, 1, 0, v->decl_line, 1, "sampler type is not supported by the BGT texture layer (only sampler2D and sampler2DShadow)", v->name); ok = 0; }
        }
    }
    return ok;
}


/* ========================================================================= canonical emission */
typedef struct { char *p; uint32_t len, cap; int over; } Eb;
static void eb_put(Eb *e, const char *s, uint32_t n) {
    if (e->len + n + 1 > e->cap) { e->over = 1; return; }
    gs_copy(e->p + e->len, s, n); e->len += n; e->p[e->len] = 0;
}
static void eb_str(Eb *e, const char *s) { eb_put(e, s, gs_len(s)); }
static void eb_num(Eb *e, uint32_t v) { char b[12]; pp_number_u32(b, v); eb_str(e, b); }
typedef struct { GsUnit *unit; uint32_t idx; } EmStruct;
typedef struct {
    GsUnit *u; GsUnit *un[2]; Gp *g; Eb out; GsLog *log; int failed, stage;
    GsSpan spans[GS_MAX_SPANS + GS_MAX_STRUCTS]; uint32_t nspans;
    EmStruct hs[GS_MAX_STRUCTS]; uint32_t nhs;
} Em;
static void em_err(Em *em, uint32_t pos, const char *msg, const char *arg) {
    uint32_t line = 1; for (uint32_t i = 0; i < pos && i < em->u->srclen; i++) if (em->u->src[i] == '\n') line++;
    em->failed = 1; gs_diag(em->log, 1, 0, line, 1, msg, arg);
}
static int em_hoist(Em *em, GsUnit *unit, uint32_t type) {
    if (type < GS_STRUCT_BASE) return 1;
    GsStruct *st = &unit->structs[type - GS_STRUCT_BASE];
    for (uint32_t i = 0; i < em->nhs; i++) if (gs_eq(em->hs[i].unit->structs[em->hs[i].idx].name, st->name)) {
        if (!gs_types_equal(em->hs[i].unit, GS_STRUCT_BASE + em->hs[i].idx, 0, unit, type, 0)) {
            em_err(em, 0, "structure is declared differently in the vertex and fragment shaders", st->name); return 0; }
        return 1;
    }
    for (uint32_t m = 0; m < st->count; m++) if (!em_hoist(em, unit, unit->members[st->first + m].type)) return 0;
    if (st->inline_decl) { em_err(em, st->s0, "a structure declared together with a variable cannot be used in a uniform", st->name); return 0; }
    if (em->nhs == GS_MAX_STRUCTS) { em_err(em, 0, "too many structures", 0); return 0; }
    em->hs[em->nhs].unit = unit; em->hs[em->nhs++].idx = type - GS_STRUCT_BASE; return 1;
}
static void em_decl(Em *em, GsUnit *unit, uint32_t type, const char *name, uint32_t arr) {
    eb_str(&em->out, gs_type_name(unit, type)); eb_str(&em->out, " "); eb_str(&em->out, name);
    if (arr) { eb_str(&em->out, "["); eb_num(&em->out, arr); eb_str(&em->out, "]"); }
    eb_str(&em->out, ";");
}
static void em_add_span(Em *em, uint32_t a, uint32_t b) { if (em->nspans < GS_MAX_SPANS + GS_MAX_STRUCTS) { em->spans[em->nspans].a = a; em->spans[em->nspans++].b = b; } }

static const char *const gs_unsupported_tex[] = {"textureProj", "textureProjLod", "textureProjGrad", "textureOffset", "textureProjOffset",
    "textureLodOffset", "textureGradOffset", "texelFetchOffset", "textureGather", "textureGatherOffset", "textureQueryLod",
    "textureQueryLevels", "textureProjLodOffset", "textureProjGradOffset", "textureSamples", 0};

/* Resolve a sampler reference starting at identifier s[a..b); returns 1 and the slot / shadow flag / end position. */
static int em_sampler(Em *em, uint32_t a, uint32_t b, uint32_t limit, int *slot, int *shadow, uint32_t *end) {
    const char *s = em->u->src;
    for (uint32_t k = 0; k < em->g->ndv; k++) {
        GpVar *d = &em->g->dv[k]; GsUnit *pu = em->un[d->stage]; GsVar *v = &pu->vars[d->var];
        if (v->type >= GS_STRUCT_BASE || !gs_types[v->type].dim || !gs_eqn(s + a, b - a, v->name)) continue;
        uint32_t e = b, idx = 0;
        if (v->arr) {
            uint32_t q = e; while (q < limit && (gs_space(s[q]) || s[q] == '\n')) q++;
            if (q >= limit || s[q] != '[') { em_err(em, a, "sampler arrays must be indexed with a constant expression", v->name); return 0; }
            Lx l = {s, q + 1, limit, 1}; GsPs ps = {em->u, em->log, 0}; int ok = 1;
            int64_t iv = cx_expr(&ps, &l, 0, &ok); Tk c = lx_next(&l);
            if (!ok || !tk_is(&c, "]")) { em_err(em, a, "dynamic sampler-array indexing is not supported by the BGT shader translation", v->name); return 0; }
            if (iv < 0 || iv >= v->arr) { em_err(em, a, "sampler array index out of range", v->name); return 0; }
            idx = (uint32_t)iv; e = l.pos;
        }
        *slot = (int)(d->slot + idx); *shadow = gs_types[v->type].shadow; *end = e; return 1;
    }
    return 0;
}

static void em_range(Em *em, uint32_t a, uint32_t b, int top);
static void em_call_args(Em *em, uint32_t open, uint32_t limit, uint32_t *a0, uint32_t *a1, uint32_t *count, uint32_t *close) {
    const char *s = em->u->src; int depth = 0; uint32_t start = open + 1; *count = 0;
    for (uint32_t i = open; i < limit; i++) {
        char c = s[i];
        if (c == '(' || c == '[' || c == '{') depth++;
        else if (c == ')' || c == ']' || c == '}') {
            if (--depth == 0) { if (*count < 8) { a0[*count] = start; a1[*count] = i; (*count)++; } *close = i; return; }
        } else if (c == ',' && depth == 1) { if (*count < 8) { a0[*count] = start; a1[*count] = i; (*count)++; } start = i + 1; }
    }
    *close = 0;
}
static void em_wrapped(Em *em, const char *fn, uint32_t a, uint32_t b) {
    eb_str(&em->out, fn); eb_str(&em->out, "("); em_range(em, a, b, 0); eb_str(&em->out, ")");
}
static void em_range(Em *em, uint32_t a, uint32_t b, int top) {
    const char *s = em->u->src; uint32_t si = 0;
    uint32_t i = a;
    while (i < b && !em->failed) {
        if (top) {
            while (si < em->nspans && em->spans[si].b <= i) si++;
            if (si < em->nspans && em->spans[si].a <= i) {
                uint32_t e = em->spans[si].b; if (e > b) e = b;
                for (; i < e; i++) if (s[i] == '\n') eb_put(&em->out, "\n", 1);
                continue;
            }
        }
        char c = s[i];
        if (gs_digit(c) || (c == '.' && i + 1 < b && gs_digit(s[i + 1]))) {
            uint32_t j = i + 1; while (j < b && (gs_idc(s[j]) || s[j] == '.' || ((s[j] == '+' || s[j] == '-') && (s[j - 1] == 'e' || s[j - 1] == 'E')))) j++;
            eb_put(&em->out, s + i, j - i); i = j; continue;
        }
        if (!gs_alpha(c)) { eb_put(&em->out, &c, 1); i++; continue; }
        uint32_t j = i + 1; while (j < b && gs_idc(s[j])) j++;
        uint32_t len = j - i;
        uint32_t k = i; while (k > a && (gs_space(s[k - 1]) || s[k - 1] == '\n')) k--;
        if (k > a && s[k - 1] == '.') { eb_put(&em->out, s + i, len); i = j; continue; }     /* member / swizzle */
        if (gs_eqn(s + i, len, "main") && em->stage == 1) { eb_str(&em->out, "bgt_gl_main"); i = j; continue; }
        if (gs_eqn(s + i, len, "gl_VertexID")) { eb_str(&em->out, "int(bgt_vertex_index)"); i = j; continue; }
        if (gs_eqn(s + i, len, "gl_InstanceID")) { eb_str(&em->out, "int(bgt_instance_index)"); i = j; continue; }
        if (gs_eqn(s + i, len, "gl_FragCoord")) {
            eb_str(&em->out, "vec4(bgt_frag_coord.x,bgt_gl_meta.x-bgt_frag_coord.y,bgt_frag_coord.zw)"); i = j; continue; }
        if (gs_eqn(s + i, len, "gl_FragDepth") || gs_eqn(s + i, len, "gl_PointCoord") || gs_eqn(s + i, len, "gl_ClipDistance") ||
            gs_eqn(s + i, len, "gl_PrimitiveID") || gs_eqn(s + i, len, "gl_SampleID") || gs_eqn(s + i, len, "gl_FragColor")) {
            char nm[GS_NAME]; uint32_t nl = len < GS_NAME - 1 ? len : GS_NAME - 1; gs_copy(nm, s + i, nl); nm[nl] = 0;
            em_err(em, i, "built-in variable is not supported by the BGT shader translation", nm); return; }
        /* texture builtins */
        uint32_t q = j; while (q < b && (gs_space(s[q]) || s[q] == '\n')) q++;
        if (q < b && s[q] == '(' && len >= 7 && s[i] == 't' && s[i + 1] == 'e' && (s[i + 2] == 'x')) {
            int sup = 0, texfn = gs_eqn(s + i, len, "texture") || gs_eqn(s + i, len, "textureLod") || gs_eqn(s + i, len, "textureGrad") ||
                gs_eqn(s + i, len, "texelFetch") || gs_eqn(s + i, len, "textureSize");
            for (int t = 0; gs_unsupported_tex[t]; t++) if (gs_eqn(s + i, len, gs_unsupported_tex[t])) sup = 1;
            if (sup) { char nm[GS_NAME]; uint32_t nl = len < GS_NAME - 1 ? len : GS_NAME - 1; gs_copy(nm, s + i, nl); nm[nl] = 0;
                em_err(em, i, "texture function is not supported by the BGT shader translation", nm); return; }
            if (texfn) {
                uint32_t a0[8], a1[8], cnt, close; em_call_args(em, q, b, a0, a1, &cnt, &close);
                if (!close) { em_err(em, i, "unbalanced parentheses in texture call", 0); return; }
                uint32_t t0 = a0[0], t1 = a1[0]; while (t0 < t1 && (gs_space(s[t0]) || s[t0] == '\n')) t0++;
                while (t1 > t0 && (gs_space(s[t1 - 1]) || s[t1 - 1] == '\n')) t1--;
                int slot = 0, shadow = 0; uint32_t end = 0, id1 = t0; while (id1 < t1 && gs_idc(s[id1])) id1++;
                if (cnt >= 2 && id1 > t0 && em_sampler(em, t0, id1, t1, &slot, &shadow, &end) && end == t1) {
                    eb_put(&em->out, s + i, len); eb_str(&em->out, "(");
                    eb_put(&em->out, s + a0[0], t0 - a0[0]); eb_str(&em->out, "bgt_t"); eb_num(&em->out, (uint32_t)slot);
                    eb_put(&em->out, s + t1, a1[0] - t1);
                    int sample = gs_eqn(s + i, len, "texture") || gs_eqn(s + i, len, "textureLod") || gs_eqn(s + i, len, "textureGrad");
                    for (uint32_t x = 1; x < cnt; x++) {
                        eb_str(&em->out, ",");
                        if (x == 1 && sample) em_wrapped(em, shadow ? "bgt_gl_uv3" : "bgt_gl_uv", a0[x], a1[x]);
                        else if (x >= 2 && gs_eqn(s + i, len, "textureGrad")) em_wrapped(em, "bgt_gl_grad", a0[x], a1[x]);
                        else if (x == 1 && gs_eqn(s + i, len, "texelFetch")) {
                            eb_str(&em->out, "bgt_gl_fy("); em_range(em, a0[x], a1[x], 0); eb_str(&em->out, ",textureSize(bgt_t");
                            eb_num(&em->out, (uint32_t)slot); eb_str(&em->out, ",");
                            if (cnt > 2) em_range(em, a0[2], a1[2], 0); else eb_str(&em->out, "0");
                            eb_str(&em->out, "))");
                        } else em_range(em, a0[x], a1[x], 0);
                    }
                    eb_str(&em->out, ")"); i = close + 1; continue;
                }
                if (cnt >= 1 && id1 > t0 && !em_sampler(em, t0, id1, t1, &slot, &shadow, &end) && em->failed) return;
            }
        }
        int slot, shadow; uint32_t end;
        if (em_sampler(em, i, j, b, &slot, &shadow, &end)) { eb_str(&em->out, "bgt_t"); eb_num(&em->out, (uint32_t)slot); i = end; continue; }
        if (em->failed) return;
        eb_put(&em->out, s + i, len); i = j;
    }
}

/* Emit the canonical BGT source for one stage. Returns a GS_ALLOC buffer (size *cap) or NULL. */
static char *gs_emit(GsUnit *u, GsUnit *vs, GsUnit *fs, Gp *g, GsLog *log, uint32_t *len, uint32_t *cap) {
    Em *em = (Em *)GS_ALLOC(sizeof(Em)); if (!em) return 0;
    em->u = u; em->un[0] = vs; em->un[1] = fs; em->g = g; em->log = log; em->stage = (int)u->stage;
    uint32_t sidx = u->stage - 1;
    uint32_t c = u->srclen * 2 + 65536 + g->nu * 256; if (c > GS_MAX_SOURCE + 65536) c = GS_MAX_SOURCE + 65536;
    char *buf = (char *)GS_ALLOC(c); if (!buf) { GS_FREE(em, sizeof *em); return 0; }
    em->out.p = buf; em->out.cap = c;
    for (uint32_t i = 0; i < u->nspans; i++) em_add_span(em, u->spans[i].a, u->spans[i].b);
    /* structures required by program uniforms and this stage's blocks */
    for (uint32_t k = 0; k < g->ndv && !em->failed; k++) em_hoist(em, em->un[g->dv[k].stage], em->un[g->dv[k].stage]->vars[g->dv[k].var].type);
    for (uint32_t k = 0; k < g->nb && !em->failed; k++) if (g->b[k].unit[sidx] >= 0) {
        GsBlock *b = &u->blocks[g->b[k].unit[sidx]];
        for (uint32_t m = 0; m < b->count && !em->failed; m++) em_hoist(em, u, u->members[b->first + m].type);
    }
    for (uint32_t i = 0; i < u->nstructs; i++) for (uint32_t h = 0; h < em->nhs; h++)
        if (gs_eq(u->structs[i].name, em->hs[h].unit->structs[em->hs[h].idx].name)) em_add_span(em, u->structs[i].s0, u->structs[i].s1);
    for (uint32_t i = 1; i < em->nspans; i++) {                 /* insertion sort by start */
        GsSpan x = em->spans[i]; uint32_t j = i; while (j && em->spans[j - 1].a > x.a) { em->spans[j] = em->spans[j - 1]; j--; } em->spans[j] = x; }
    if (!em->failed) {
        Eb *o = &em->out;
        eb_str(o, "#version 330 core\n");
        eb_str(o, "vec2 bgt_gl_uv(vec2 uv){return vec2(uv.x,1.0-uv.y);} vec3 bgt_gl_uv3(vec3 c){return vec3(c.x,1.0-c.y,c.z);} "
            "vec2 bgt_gl_grad(vec2 g){return vec2(g.x,-g.y);} ivec2 bgt_gl_fy(ivec2 p,ivec2 n){return ivec2(p.x,n.y-1-p.y);} ");
        for (uint32_t h = 0; h < em->nhs; h++) {
            GsUnit *hu = em->hs[h].unit; GsStruct *st = &hu->structs[em->hs[h].idx];
            eb_str(o, "struct "); eb_str(o, st->name); eb_str(o, " { ");
            for (uint32_t m = 0; m < st->count; m++) { GsMember *mm = &hu->members[st->first + m]; em_decl(em, hu, mm->type, mm->name, mm->arr); eb_str(o, " "); }
            eb_str(o, "}; ");
        }
        eb_str(o, "layout(std140) uniform bgt_u0 { vec4 bgt_gl_meta; ");
        for (uint32_t k = 0; k < g->ndv; k++) {
            GsUnit *pu = em->un[g->dv[k].stage]; GsVar *v = &pu->vars[g->dv[k].var];
            if (v->type < GS_STRUCT_BASE && gs_types[v->type].dim) continue;
            em_decl(em, pu, v->type, v->name, v->arr); eb_str(o, " ");
        }
        eb_str(o, "}; ");
        for (uint32_t k = 0; k < g->nslots; k++) {
            eb_str(o, g->slot_shadow[k] ? "uniform sampler2DShadow bgt_t" : "uniform sampler2D bgt_t"); eb_num(o, k); eb_str(o, "; "); }
        for (uint32_t k = 0; k < g->nb; k++) if (g->b[k].unit[sidx] >= 0) {
            GsBlock *b = &u->blocks[g->b[k].unit[sidx]];
            eb_str(o, "layout(std140) uniform bgt_u"); eb_num(o, k + 1); eb_str(o, " { ");
            for (uint32_t m = 0; m < b->count; m++) { GsMember *mm = &u->members[b->first + m]; em_decl(em, u, mm->type, mm->name, mm->arr); eb_str(o, " "); }
            eb_str(o, "}"); if (b->inst[0]) { eb_str(o, " "); eb_str(o, b->inst); } eb_str(o, "; ");
        }
        for (uint32_t i = 0; i < u->nvars; i++) {
            GsVar *v = &u->vars[i]; if (v->storage == GS_UNIFORM) continue;
            int is_attr = v->storage == GS_IN && u->stage == 1, is_frag = v->storage == GS_OUT && u->stage == 2;
            if ((v->storage == GS_IN && !v->used)) continue;                 /* inactive inputs are removed */
            if (is_attr || is_frag) {
                int32_t loc = -1;
                if (is_attr) { for (uint32_t a = 0; a < g->na; a++) if (gs_eq(gp_name(g, g->a[a].name), v->name)) loc = g->a[a].location; }
                else for (uint32_t a = 0; a < g->no; a++) if (gs_eq(gp_name(g, g->o[a].name), v->name)) loc = g->o[a].location;
                eb_str(o, "layout(location=") ; eb_num(o, (uint32_t)(loc < 0 ? 0 : loc)); eb_str(o, ") ");
            } else if (v->interp == GI_FLAT || (v->type < GS_STRUCT_BASE && gs_types[v->type].kind != 'f')) eb_str(o, "flat ");
            else if (v->interp == GI_NOPERSP) eb_str(o, "noperspective ");
            eb_str(o, v->storage == GS_IN ? "in " : "out "); em_decl(em, u, v->type, v->name, v->arr); eb_str(o, " ");
        }
        /* The #version line is replaced; keep the first source newline so line numbers stay aligned. */
        em_range(em, u->src[0] == '\n' ? 1 : 0, u->srclen, 1);
        if (u->stage == 1) eb_str(o, "\nvoid main(){bgt_gl_main();gl_Position.z=(gl_Position.z+gl_Position.w)*0.5;}\n");
        if (o->over) { gs_diag(log, 1, 0, 0, 0, "translated shader exceeds the 1 MiB BGT source limit", 0); em->failed = 1; }
        if (o->len > GS_MAX_SOURCE) { gs_diag(log, 1, 0, 0, 0, "translated shader exceeds the 1 MiB BGT source limit", 0); em->failed = 1; }
    }
    int failed = em->failed; *len = em->out.len; *cap = c; GS_FREE(em, sizeof *em);
    if (failed) { GS_FREE(buf, c); return 0; }
    return buf;
}

#endif
