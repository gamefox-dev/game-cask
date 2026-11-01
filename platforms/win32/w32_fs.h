/* Process-local VFS index: the single metadata source for KERNEL32 and every CRT path function.
 * Shipped entries come from the build manifest (read-only); everything else is process memory. MIT. */
typedef struct fs_node {
    struct fs_node *next;
    char name[512];   /* lower-case '/' key below the volume root */
    char *disp;       /* last component in its original case */
    uint64_t size, created, accessed, written; /* FILETIMEs from the virtual clock */
    uint32_t attributes;
    int live, shipped;
} fs_node_t;
static fs_node_t *fs_nodes, *fs_tail;
static int fs_ready;
static char fs_cwd[512]; /* typed-case path below C:\GAME, '\\' separated; empty = the volume root */
static uint64_t filetime_now(void);
static uint64_t filetime_origin(void);

/* ------------------------------------------------------------------ path resolution */
typedef struct {
    char key[512];  /* lower-case '/' path below the root ("" = root); foreign drives are "x:/..." */
    char rel[512];  /* typed-case path below the root, '\\' separated */
    char text[560]; /* typed-case full path, e.g. C:\GAME\Dir\file */
    unsigned key_parent, rel_last; /* length of the parent part of key / offset of the last rel component */
    int trailing, wildcard, invalid, toolong, foreign, maxpath, empty;
} fs_path_t;
typedef struct { char work[1100]; uint16_t off[160], len[160]; unsigned n, w; int toolong; } fs_walk_t;
static fs_walk_t fs_scratch; /* resolution never yields, so one scratch walk is enough */
static void fs_push(fs_walk_t *k, const char *s, unsigned len) {
    if (k->n >= 160 || k->w + len + 1 >= sizeof k->work) { k->toolong = 1; return; }
    k->off[k->n] = (uint16_t)k->w; k->len[k->n] = (uint16_t)len;
    for (unsigned i = 0; i < len; i++) k->work[k->w++] = s[i];
    k->work[k->w++] = 0; k->n++;
}
static void fs_feed(fs_walk_t *k, const char *s) {
    while (*s) {
        while (*s == '/' || *s == '\\') s++;
        const char *b = s;
        while (*s && *s != '/' && *s != '\\') s++;
        unsigned len = (unsigned)(s - b);
        if (!len || (len == 1 && b[0] == '.')) continue;
        if (len == 2 && b[0] == '.' && b[1] == '.') { if (k->n) { k->n--; k->w = k->off[k->n]; } continue; }
        fs_push(k, b, len);
    }
}
static char fs_lower(char c) { return c >= 'A' && c <= 'Z' ? (char)(c + 32) : c; }
static void fs_resolve(const char *raw, fs_path_t *p) {
    fs_walk_t *k = &fs_scratch;
    for (unsigned i = 0; i < sizeof *p; i++) ((char *)p)[i] = 0;
    p->empty = !raw[0];
    k->n = k->w = 0; k->toolong = 0;
    const char *s = raw; char drive = 'C';
    if (((s[0] | 32) >= 'a' && (s[0] | 32) <= 'z') && s[1] == ':') { drive = (char)(s[0] & ~32); s += 2; }
    p->foreign = drive != 'C';
    int rooted = *s == '/' || *s == '\\';
    if (!rooted && !p->foreign) { fs_push(k, "GAME", 4); fs_feed(k, fs_cwd); }
    unsigned tail = 0;
    for (const char *c = s; *c; c++) {
        tail++;
        if (*c == '*' || *c == '?') p->wildcard = 1;
        if ((unsigned char)*c < 32 || *c == '<' || *c == '>' || *c == '"' || *c == '|' || *c == ':') p->invalid = 1;
    }
    p->trailing = tail && (s[tail - 1] == '/' || s[tail - 1] == '\\');
    fs_feed(k, s);
    unsigned first = (!p->foreign && k->n && k->len[0] == 4 && fs_lower(k->work[k->off[0]]) == 'g' && fs_lower(k->work[k->off[0] + 1]) == 'a'
        && fs_lower(k->work[k->off[0] + 2]) == 'm' && fs_lower(k->work[k->off[0] + 3]) == 'e') ? 1u : 0u;
    unsigned kn = 0, rn = 0, tn = 0;
    p->text[tn++] = drive; p->text[tn++] = ':'; p->text[tn++] = '\\';
    if (p->foreign) { p->key[kn++] = fs_lower(drive); p->key[kn++] = ':'; }
    int text_has = 0;
    if (first) { for (unsigned j = 0; j < 4; j++) p->text[tn++] = k->work[k->off[0] + j]; text_has = 1; }
    for (unsigned i = first; i < k->n; i++) {
        const char *c = k->work + k->off[i];
        if (kn + k->len[i] + 2 >= sizeof p->key || rn + k->len[i] + 2 >= sizeof p->rel || tn + k->len[i] + 2 >= sizeof p->text) { p->toolong = 1; break; }
        if (kn) p->key[kn++] = '/';
        if (rn) p->rel[rn++] = '\\';
        if (text_has) p->text[tn++] = '\\';
        text_has = 1; p->rel_last = rn;
        for (unsigned j = 0; j < k->len[i]; j++) { p->key[kn++] = fs_lower(c[j]); p->rel[rn++] = c[j]; p->text[tn++] = c[j]; }
    }
    p->key[kn] = 0; p->rel[rn] = 0; p->text[tn] = 0;
    if (k->toolong) p->toolong = 1;
    p->maxpath = tn >= 260;
    unsigned last = 0; int found = 0;
    for (unsigned i = 0; i < kn; i++) if (p->key[i] == '/') { last = i; found = 1; }
    p->key_parent = found ? last : (p->foreign ? 2u : 0u);
}
static void fs_text_root(char *out) { const char *r = "C:\\GAME"; unsigned i = 0; while (r[i]) { out[i] = r[i]; i++; } out[i] = 0; }
static unsigned fs_cwd_text(char *out) { /* C:\GAME[\cwd] */
    fs_text_root(out); unsigned n = 7;
    if (fs_cwd[0]) { out[n++] = '\\'; for (unsigned i = 0; fs_cwd[i] && n < 540; i++) out[n++] = fs_cwd[i]; }
    out[n] = 0; return n;
}
void w32_fs_normalize(const char *raw, char *out) {
    fs_path_t pv, *p = &pv;
    fs_resolve(raw, p);
    unsigned i = 0; do { out[i] = p->key[i]; } while (p->key[i++]);
}

/* ------------------------------------------------------------------ node storage */
static fs_node_t *fs_lookup(const char *name) { for (fs_node_t *n = fs_nodes; n; n = n->next) if (n->live && w32_streqi(n->name, name)) return n; return 0; }
static char *fs_dup(const char *s) {
    unsigned n = 0; while (s[n]) n++;
    char *d = x86_alloc(n + 1); if (!d) x86_fault("VFS index exhausted", 0);
    for (unsigned i = 0; i <= n; i++) d[i] = s[i];
    return d;
}
/* Create (or revive) a node with fresh timestamps. */
static fs_node_t *fs_make(const char *key, const char *disp, uint64_t size, uint32_t attr, int shipped, uint64_t when) {
    fs_node_t *n = 0;
    for (fs_node_t *c = fs_nodes; c; c = c->next) if (w32_streqi(c->name, key)) { n = c; break; }
    if (!n) {
        n = x86_alloc(sizeof *n); if (!n) x86_fault("VFS index exhausted", 0);
        unsigned i = 0; do { n->name[i] = key[i]; } while (key[i++]);
        n->next = 0; if (fs_tail) fs_tail->next = n; else fs_nodes = n; fs_tail = n;
        n->disp = 0;
    }
    n->disp = fs_dup(disp);
    n->size = size; n->attributes = attr; n->live = 1; n->shipped = shipped;
    n->created = n->accessed = n->written = when;
    return n;
}
/* Ensure the directory chain of `p` (excluding the leaf) exists, then create/update the leaf. */
static fs_node_t *fs_add_path(const fs_path_t *p, uint64_t size, uint32_t attr, int shipped, uint64_t when, int touch) {
    char key[512]; unsigned kn = 0, rn = 0; const char *rel = p->rel;
    while (rel[rn]) {
        unsigned b = rn; while (rel[rn] && rel[rn] != '\\') rn++;
        if (kn) key[kn++] = '/';
        for (unsigned i = b; i < rn; i++) key[kn++] = fs_lower(rel[i]);
        key[kn] = 0;
        char disp[260]; unsigned dn = 0; for (unsigned i = b; i < rn && dn < 259; i++) disp[dn++] = rel[i]; disp[dn] = 0;
        int leaf = !rel[rn];
        fs_node_t *n = fs_lookup(key);
        if (leaf) {
            if (n) { n->size = size; if (touch) n->written = when; return n; }
            return fs_make(key, disp, size, attr, shipped, when);
        }
        if (!n) fs_make(key, disp, 0, 0x10, shipped, when);
        if (rel[rn]) rn++;
    }
    return 0;
}
static void fs_add(const char *raw, uint64_t size, uint32_t attr, int shipped) {
    fs_path_t pv, *p = &pv;
    fs_resolve(raw, p);
    if (!p->key[0] || p->foreign) return;
    fs_add_path(p, size, attr, shipped, shipped ? filetime_origin() : filetime_now(), !shipped);
}
static void fs_init(void) {
    if (fs_ready) return; fs_ready = 1;
    const char *path = "bgt-file-index.txt"; int32_t h = bgt_asset_open(path, w32_slen(path)); if (h < 0) return;
    char line[560]; unsigned used = 0; uint8_t buf[1024]; int32_t count;
    while ((count = bgt_asset_read(h, buf, sizeof buf)) > 0) for (int32_t i = 0; i < count; i++) {
        if (buf[i] == '\n') { line[used] = 0; uint64_t size = 0; unsigned j = 0; while (line[j] >= '0' && line[j] <= '9') size = size * 10 + (unsigned)(line[j++] - '0'); if (line[j] == '\t') fs_add(line + j + 1, size, 0x21, 1); used = 0; }
        else if (used + 1 < sizeof line) line[used++] = (char)buf[i];
    }
    bgt_asset_close(h);
}
static void fs_touch_parent(const fs_path_t *p);
void w32_fs_update(const char *raw, uint64_t size) {
    fs_init(); fs_path_t p; fs_resolve(raw, &p);
    int created = !fs_lookup(p.key);
    fs_add(raw, size, 0x20, 0);
    if (created) fs_touch_parent(&p);
}
/* Key-addressed variants for owners that hold a normalized key (independent of the current directory). */
void w32_fs_update_key(const char *key, uint64_t size) { fs_node_t *n = fs_lookup(key); if (n && !(n->attributes & 0x10)) { n->size = size; n->written = filetime_now(); } }
uint64_t w32_fs_now(void) { return filetime_now(); }
uint64_t w32_fs_origin(void) { return filetime_origin(); }
void w32_fs_remove(const char *raw) { fs_init(); char path[512]; w32_fs_normalize(raw, path); fs_node_t *n = fs_lookup(path); if (n && !n->shipped) n->live = 0; }

/* ------------------------------------------------------------------ queries and mutations (Win32 error codes) */
static int fs_parent_is_dir(const fs_path_t *p) {
    if (p->foreign) return 0;
    if (!p->key[0]) return 1;
    char parent[512]; for (unsigned i = 0; i < p->key_parent; i++) parent[i] = p->key[i]; parent[p->key_parent] = 0;
    if (!parent[0]) return 1;
    fs_node_t *n = fs_lookup(parent); return n && (n->attributes & 0x10);
}
static int fs_has_ext(const char *key, const char *ext) {
    unsigned n = 0, e = 0; while (key[n]) n++; while (ext[e]) e++;
    if (n < e) return 0;
    for (unsigned i = 0; i < e; i++) if (key[n - e + i] != ext[i]) return 0;
    return 1;
}
static uint32_t fs_stat_path(const fs_path_t *p, w32_fs_info_t *info) {
    if (p->toolong) return 206;
    if (p->invalid || p->wildcard) return 123;
    if (p->foreign) return 3;
    fs_node_t *n = 0;
    if (p->key[0]) n = fs_lookup(p->key);
    if (p->key[0] && !n) return fs_parent_is_dir(p) ? 2 : 3;
    if (p->trailing && n && !(n->attributes & 0x10)) return 3;
    if (info) {
        if (!n) { info->attrs = 0x10; info->size = 0; info->created = info->accessed = info->written = filetime_origin(); info->shipped = 1; info->dir = 1; info->exec = 1; return 0; }
        info->attrs = n->attributes; info->size = n->size; info->created = n->created; info->accessed = n->accessed; info->written = n->written;
        info->shipped = n->shipped; info->dir = (n->attributes & 0x10) != 0;
        info->exec = info->dir || fs_has_ext(n->name, ".exe") || fs_has_ext(n->name, ".com") || fs_has_ext(n->name, ".bat") || fs_has_ext(n->name, ".cmd");
    }
    return 0;
}
uint32_t w32_fs_stat(const char *raw, w32_fs_info_t *info) {
    if (!raw[0]) return 2;
    fs_init(); fs_path_t pv, *p = &pv;
    fs_resolve(raw, p); return fs_stat_path(p, info);
}
int w32_fs_key_info(const char *key, w32_fs_info_t *info) {
    fs_node_t *n = fs_lookup(key); if (!n) return 0;
    info->attrs = n->attributes; info->size = n->size; info->created = n->created; info->accessed = n->accessed; info->written = n->written;
    info->shipped = n->shipped; info->dir = (n->attributes & 0x10) != 0; info->exec = 0; return 1;
}
int w32_fs_query(const char *raw, uint32_t *attrs) {
    w32_fs_info_t info; if (w32_fs_stat(raw, &info)) return 0;
    if (attrs) *attrs = info.attrs; return 1;
}
static void fs_touch_parent(const fs_path_t *p) {
    if (!p->key[0] || p->foreign) return;
    char parent[512]; for (unsigned i = 0; i < p->key_parent; i++) parent[i] = p->key[i]; parent[p->key_parent] = 0;
    fs_node_t *n = parent[0] ? fs_lookup(parent) : 0; if (n) n->written = filetime_now();
}
static int fs_children(const char *key) { /* any live node strictly below `key` */
    unsigned n = 0; while (key[n]) n++;
    for (fs_node_t *c = fs_nodes; c; c = c->next) {
        if (!c->live) continue;
        unsigned i = 0; while (i < n && c->name[i] == key[i]) i++;
        if (i == n && c->name[n] == '/') return 1;
    }
    return 0;
}
uint32_t w32_fs_mkdir(const char *raw) {
    if (!raw[0]) return 3;
    fs_init(); fs_path_t pv, *p = &pv;
    fs_resolve(raw, p);
    if (p->toolong || p->maxpath) return 206;
    if (p->invalid || p->wildcard) return 123;
    if (p->foreign) return 3;
    if (!p->key[0] || fs_lookup(p->key)) return 183;
    if (!fs_parent_is_dir(p)) return 3;
    fs_node_t *n = fs_make(p->key, p->rel + p->rel_last, 0, 0x10, 0, filetime_now()); (void)n;
    fs_touch_parent(p); return 0;
}
/* Hooks into the AMD64 CRT's open files; no-ops where the profile has no FILE layer. */
#ifndef X86_FLAT_GUEST
int w32_crt_files_busy(const char *key, int subtree) { (void)key; (void)subtree; return 0; }
void w32_crt_files_drop(const char *key) { (void)key; }
void w32_crt_files_rename(const char *from, const char *to) { (void)from; (void)to; }
int w32_crt_fd_stat(int fd, w32_fs_info_t *info, int *chr) {
    if (fd < 0 || fd > 2) return 0;
    for (unsigned i = 0; i < sizeof *info; i++) ((char *)info)[i] = 0;
    *chr = 1; return 1;
}
#endif
static int fs_cwd_within(const char *key) { /* is the current directory `key` or below it? */
    fs_path_t cv, *c = &cv;
    char t[560]; fs_cwd_text(t); fs_resolve(t, c);
    unsigned n = 0; while (key[n]) n++;
    if (!n) return 1;
    unsigned i = 0; while (i < n && c->key[i] == key[i]) i++;
    return i == n && (!c->key[n] || c->key[n] == '/');
}
uint32_t w32_fs_rmdir(const char *raw) {
    if (!raw[0]) return 3;
    fs_init(); fs_path_t pv, *p = &pv;
    fs_resolve(raw, p);
    uint32_t e = fs_stat_path(p, 0); if (e) return e;
    if (!p->key[0]) return 5;
    fs_node_t *n = fs_lookup(p->key);
    if (!(n->attributes & 0x10)) return 267;
    if (n->shipped) return 5;
    if (fs_cwd_within(p->key)) return 16;
    if (fs_children(p->key)) return 145;
    n->live = 0; fs_touch_parent(p); return 0;
}
uint32_t w32_fs_delete(const char *raw) {
    if (!raw[0]) return 3;
    fs_init(); fs_path_t pv, *p = &pv;
    fs_resolve(raw, p);
    uint32_t e = fs_stat_path(p, 0); if (e) return e;
    if (!p->key[0]) return 5;
    fs_node_t *n = fs_lookup(p->key);
    if ((n->attributes & 0x10) || n->shipped || (n->attributes & 1)) return 5;
    if (w32_crt_files_busy(p->key, 0)) return 32;
    w32_crt_files_drop(p->key); n->live = 0; fs_touch_parent(p); return 0;
}
static int fs_under(const char *key, const char *root) { /* key == root or below it */
    unsigned n = 0; while (root[n]) n++;
    unsigned i = 0; while (i < n && key[i] == root[i]) i++;
    return i == n && (!key[n] || key[n] == '/');
}
uint32_t w32_fs_move(const char *from, const char *to) {
    if (!from[0] || !to[0]) return 3;
    fs_init(); fs_path_t av, bv, *a = &av, *b = &bv;
    fs_resolve(from, a); fs_resolve(to, b);
    uint32_t e = fs_stat_path(a, 0); if (e) return e;
    if (b->toolong || b->maxpath) return 206;
    if (b->invalid || b->wildcard) return 123;
    if (b->foreign || !b->key[0]) return b->foreign ? 17 : 183;
    if (!a->key[0]) return 5;
    fs_node_t *src = fs_lookup(a->key);
    int same = w32_streqi(a->key, b->key);
    if (!same && fs_lookup(b->key)) return 183;
    if (!fs_parent_is_dir(b)) return 3;
    if (!same && fs_under(b->key, a->key)) return 5;
    int dir = (src->attributes & 0x10) != 0;
    if (b->trailing && !dir) return 3; /* INFERRED: a file destination cannot end in a separator */
    if (!same) {
        if (src->shipped) return 5;
        for (fs_node_t *c = fs_nodes; dir && c; c = c->next) if (c->live && c->shipped && fs_under(c->name, a->key)) return 5;
        if (w32_crt_files_busy(a->key, dir)) return 32;
        if (dir && fs_cwd_within(a->key)) return 32;
        unsigned an = 0, bn = 0; while (a->key[an]) an++; while (b->key[bn]) bn++;
        for (fs_node_t *c = fs_nodes; c; c = c->next) if (c->live && c != src && fs_under(c->name, a->key)) {
            unsigned cn = 0; while (c->name[cn]) cn++;
            if (cn - an + bn >= sizeof c->name) return 206;
        }
        for (fs_node_t *c = fs_nodes; c; c = c->next) if (c->live && c != src && fs_under(c->name, a->key)) {
            char moved[512]; unsigned m = 0;
            for (unsigned i = 0; i < bn; i++) moved[m++] = b->key[i];
            for (unsigned i = an; c->name[i]; i++) moved[m++] = c->name[i];
            moved[m] = 0; for (unsigned i = 0; i <= m; i++) c->name[i] = moved[i];
        }
        char old[512], fresh[512]; for (unsigned i = 0; i <= an; i++) old[i] = a->key[i]; for (unsigned i = 0; i <= bn; i++) fresh[i] = b->key[i];
        for (unsigned i = 0; i <= bn; i++) src->name[i] = b->key[i];
        w32_crt_files_rename(old, fresh);
        fs_touch_parent(a);
    }
    src->disp = fs_dup(b->rel + b->rel_last);
    fs_touch_parent(b); return 0;
}
uint32_t w32_fs_chdir(const char *raw) {
    if (!raw[0]) return 3;
    fs_init(); fs_path_t pv, *p = &pv;
    fs_resolve(raw, p);
    uint32_t e = fs_stat_path(p, 0); if (e) return e == 2 ? 3 : e;
    if (p->key[0]) { fs_node_t *n = fs_lookup(p->key); if (!(n->attributes & 0x10)) return 267; }
    unsigned i = 0; do { fs_cwd[i] = p->rel[i]; } while (p->rel[i++]);
    return 0;
}
/* Opening a named file through the CRT: validates the path against the index (not the data). */
uint32_t w32_fs_open_check(const char *raw, char *key_out, int *exists) {
    fs_init(); fs_path_t pv, *p = &pv;
    fs_resolve(raw, p);
    unsigned i = 0; do { key_out[i] = p->key[i]; } while (p->key[i++]);
    if (!raw[0]) return 2;
    if (p->toolong || p->maxpath) return 206;
    if (p->invalid || p->wildcard) return 123;
    if (p->foreign) return 3;
    if (!p->key[0] || p->trailing) return 5;
    fs_node_t *n = fs_lookup(p->key);
    if (exists) *exists = n != 0;
    if (n) return (n->attributes & 0x10) ? 5 : 0;
    return fs_parent_is_dir(p) ? 0 : 3;
}
uint32_t w32_fs_fullpath(const char *raw, char *out, unsigned cap) {
    fs_path_t pv, *p = &pv;
    if (!raw[0]) { fs_cwd_text(out); } else {
        fs_resolve(raw, p); if (p->toolong) return 0;
        unsigned i = 0; while (p->text[i]) i++;
        int append = p->trailing && i && p->text[i - 1] != '\\';
        if (i + (unsigned)append >= cap) return 0;
        for (unsigned j = 0; j < i; j++) out[j] = p->text[j];
        if (append) out[i++] = '\\';
        out[i] = 0;
    }
    unsigned n = 0; while (out[n]) n++; if (n >= cap) return 0;
    return n;
}
uint32_t w32_fs_cwd_text(char *out) { return fs_cwd_text(out); }

/* ------------------------------------------------------------------ KERNEL32 front ends */
static uint32_t k_path_op(int wide, uint32_t (*op)(const char *)) {
    char raw[520]; w32_gstr(ARG(0), wide, raw, sizeof raw);
    uint32_t e = op(raw); if (e) { last_error = e; return 0; } return 1;
}
static uint32_t k_CreateDirectoryW(void) { return k_path_op(1, w32_fs_mkdir); }
static uint32_t k_CreateDirectoryA(void) { return k_path_op(0, w32_fs_mkdir); }
static uint32_t k_RemoveDirectoryW(void) { return k_path_op(1, w32_fs_rmdir); }
static uint32_t k_RemoveDirectoryA(void) { return k_path_op(0, w32_fs_rmdir); }
static uint32_t k_DeleteFileW(void) { return k_path_op(1, w32_fs_delete); }
static uint32_t k_DeleteFileA(void) { return k_path_op(0, w32_fs_delete); }
static uint32_t k_SetCurrentDirectoryW(void) { return k_path_op(1, w32_fs_chdir); }
static uint32_t k_SetCurrentDirectoryA(void) { return k_path_op(0, w32_fs_chdir); }
static uint32_t k_move(int wide) {
    char a[520], b[520]; w32_gstr(ARG(0), wide, a, sizeof a); w32_gstr(ARG(1), wide, b, sizeof b);
    uint32_t e = w32_fs_move(a, b); if (e) { last_error = e; return 0; } return 1;
}
static uint32_t k_MoveFileW(void) { return k_move(1); }
static uint32_t k_MoveFileA(void) { return k_move(0); }
static uint32_t k_current_directory(int wide) {
    char t[560]; uint32_t n = fs_cwd_text(t);
    if (ARG(0) <= n) return n + 1;
    w32_pstr(ARG(1), ARG(0), wide, t); return n;
}
static uint32_t k_GetCurrentDirectoryW(void) { return k_current_directory(1); }
static uint32_t k_GetCurrentDirectoryA(void) { return k_current_directory(0); }
static uint32_t k_full_path(int wide) {
    char raw[520], out[560]; w32_gstr(ARG(0), wide, raw, sizeof raw);
    if (!raw[0]) { last_error = 3; return 0; }
    uint32_t n = w32_fs_fullpath(raw, out, sizeof out);
    if (!n) { last_error = 206; return 0; }
    if (ARG(1) <= n) return n + 1;
    w32_pstr(ARG(2), ARG(1), wide, out);
    if (ARG(3)) {
        uint32_t i = n; while (i && out[i - 1] != '\\') i--;
        w32_wrptr(ARG(3), i == n ? 0 : ARG(2) + i * (wide ? 2u : 1u));
    }
    return n;
}
static uint32_t k_GetFullPathNameW(void) { return k_full_path(1); }
static uint32_t k_GetFullPathNameA(void) { return k_full_path(0); }
static uint32_t k_attributes_ex(int wide) {
    char raw[520]; w32_gstr(ARG(0), wide, raw, sizeof raw);
    if (ARG(1) != 0) { last_error = 87; return 0; }
    w32_fs_info_t info; uint32_t e = w32_fs_stat(raw, &info); if (e) { last_error = e; return 0; }
    uint32_t o = ARG(2);
    x86_wr32(o, info.attrs);
    x86_wr32(o + 4, (uint32_t)info.created); x86_wr32(o + 8, (uint32_t)(info.created >> 32));
    x86_wr32(o + 12, (uint32_t)info.accessed); x86_wr32(o + 16, (uint32_t)(info.accessed >> 32));
    x86_wr32(o + 20, (uint32_t)info.written); x86_wr32(o + 24, (uint32_t)(info.written >> 32));
    x86_wr32(o + 28, (uint32_t)(info.size >> 32)); x86_wr32(o + 32, (uint32_t)info.size);
    return 1;
}
static uint32_t k_GetFileAttributesExW(void) { return k_attributes_ex(1); }
static uint32_t k_GetFileAttributesExA(void) { return k_attributes_ex(0); }
