/* GLSL 3.30 objects: preprocessing, reflection, canonical BGT translation, link and uniform state.
 * Included once by w32_gl.c; the language work lives in w32_glsl.h. SPDX-License-Identifier: MIT — LANE-K6b */
#define GL_INVALID_INDEX 0xffffffffu
static int eq_n(const char *a, const char *b, uint32_t n) { for (uint32_t i = 0; i < n; i++) if (a[i] != b[i]) return 0; return 1; }

static uint32_t shader_handle(void) {
    for (uint32_t id = 1; id <= 1023; id++) {
        uint32_t i;
        for (i = 1; i < N; i++)
            if (shaders[i].gpu == id || programs[i].vgpu == id || programs[i].fgpu == id) break;
        if (i == N) return id;
    }
    fail(OOM); return 0;
}
static int shader_ok(uint32_t id) { return id && id < N && shaders[id].used; }
static int program_ok(uint32_t id) { return id && id < N && programs[id].used; }

/* Send one translated stage to the backend and wait for its compile result; appends the backend log. */
static int send_module(const char *src, uint32_t len, uint32_t stage, uint32_t *gpu, GsLog *log) {
    *gpu = shader_handle(); if (!*gpu) { gs_put(log, "out of GPU shader handles\n"); return 0; }
    uint32_t req = ++request_id;
    SEND(0x48, *gpu, stage, 1, PTR(src), len, req);
    char text[4096]; int ok = wait_request(req, text, sizeof text);
    if (text[0]) { gs_put(log, text); if (text[w32_slen(text) - 1] != '\n') gs_put(log, "\n"); }
    if (!ok) { log->errors++; SEND(0x49, *gpu); *gpu = 0; }
    return ok;
}
static void shader_free_front(Shader *s) {
    if (s->unit) { glp_free(s->unit, sizeof(GsUnit)); s->unit = 0; }
    if (s->pp.text) { glp_free(s->pp.text, s->pp.cap); s->pp.text = 0; }
}
static void shader_strings(Shader *s, const char **ptr, int32_t *len) {
    uint32_t at = 0;
    for (uint32_t i = 0; i < s->nstr; i++) { ptr[i] = s->source + at; len[i] = (int32_t)s->str_len[i]; at += s->str_len[i]; }
}
static int shader_front(Shader *s, GsLog *log) {
    static const char *ptr[1024]; static int32_t len[1024];
    shader_free_front(s);
    shader_strings(s, ptr, len);
    if (!gs_preprocess(ptr, len, (int)s->nstr, &s->pp, log)) return 0;
    if (!s->pp.has_version) {
        gs_diag(log, 1, 0, 1, 1, "a #version directive is required: GLSL 1.10 is not available in the OpenGL 3.3 core profile", 0);
        return 0;
    }
    s->unit = glp_alloc(sizeof(GsUnit)); if (!s->unit) { fail(OOM); return 0; }
    if (!gs_parse(s->unit, s->type == 0x8b31 ? 1 : 2, s->pp.text, s->pp.len, log)) return 0;
    gs_analyze(s->unit);
    return gs_policy(s->unit, log);
}
/* Translate and compile one stage against a layout (`g`); on failure the info log has the reason. */
static int stage_module(GsUnit *u, GsUnit *vs, GsUnit *fs, Gp *g, uint32_t *gpu, GsLog *log) {
    uint32_t len, cap; char *src = gs_emit(u, vs, fs, g, log, &len, &cap);
    if (!src) { if (!log->errors) log->errors++; return 0; }
    int ok = send_module(src, len, u->stage, gpu, log); glp_free(src, cap); return ok;
}
static uint32_t api_CreateShader(void) {
    if (ARG(0) != 0x8b31 && ARG(0) != 0x8b30) { fail(BAD_ENUM); return 0; }
    uint32_t id = alloc_name(shaders, sizeof(Shader)); shaders[id].type = ARG(0); return id;
}
static uint32_t api_ShaderSource(void) {
    uint32_t id = ARG(0); if (!shader_ok(id)) { fail(BAD_VALUE); return 0; }
    int32_t count = (int32_t)ARG(1); if (count < 0 || count > 1024) { fail(BAD_VALUE); return 0; }
    uint32_t total = 0;
    for (int32_t i = 0; i < count; i++) {
        uint32_t a = (uint32_t)w32_rdptr(ARG(2) + i * w32_ptr_size());
        int32_t len = ARG(3) ? (int32_t)x86_rd32(ARG(3) + i * 4) : -1;
        if (len < 0) { len = 0; while (len < 1048576 && x86_rd8(a + (uint32_t)len)) len++; }
        if ((uint32_t)len > 1048576 - total) { fail(BAD_VALUE); return 0; } total += (uint32_t)len;
    }
    char *source = glp_alloc(total + 1); uint32_t *lens = glp_alloc((uint32_t)(count ? count : 1) * 4);
    if (!source || !lens) { if (source) glp_free(source, total + 1); if (lens) glp_free(lens, (uint32_t)(count ? count : 1) * 4); fail(OOM); return 0; }
    uint32_t at = 0;
    for (int32_t i = 0; i < count; i++) {
        uint32_t a = (uint32_t)w32_rdptr(ARG(2) + i * w32_ptr_size());
        int32_t len = ARG(3) ? (int32_t)x86_rd32(ARG(3) + i * 4) : -1;
        if (len < 0) { len = 0; while (len < 1048576 && x86_rd8(a + (uint32_t)len)) len++; }
        for (int32_t j = 0; j < len; j++) source[at++] = (char)x86_rd8(a + j);
        lens[i] = (uint32_t)len;
    }
    source[at] = 0; Shader *s = &shaders[id];
    if (s->source) glp_free(s->source, s->source_len + 1);
    if (s->str_len) glp_free(s->str_len, (s->nstr ? s->nstr : 1) * 4);
    s->source = source; s->source_len = at; s->str_len = lens; s->nstr = (uint32_t)count; s->compiled = 0; return 0;
}
static uint32_t api_CompileShader(void) {
    uint32_t id = ARG(0); if (!shader_ok(id)) { fail(BAD_VALUE); return 0; }
    Shader *s = &shaders[id]; GsLog log = {s->log, sizeof s->log, 0, 0};
    s->log[0] = 0; s->compiled = 0;
    if (s->gpu) { SEND(0x49, s->gpu); s->gpu = 0; }
    if (!s->source) { gs_put(&log, "0:1(1): error: no source has been supplied\n"); return 0; }
    if (!shader_front(s, &log)) { if (!log.errors) gs_put(&log, "0:1(1): error: shader failed to compile\n"); return 0; }
    /* Provisional layout for this stage alone: full program layout is decided at link time. */
    Gp *g = glp_alloc(sizeof(Gp)); if (!g) { fail(OOM); return 0; }
    GsUnit *vs = s->type == 0x8b31 ? s->unit : 0, *fs = s->type == 0x8b31 ? 0 : s->unit;
    if (gp_link(g, vs, fs, 0, 0, 0, 0, &log)) s->compiled = (uint32_t)stage_module(s->unit, vs, fs, g, &s->gpu, &log);
    glp_free(g, sizeof(Gp)); if (!s->compiled && !log.errors) log.errors++;
    return 0;
}
static uint32_t api_GetShaderiv(void) {
    uint32_t id = ARG(0), key = ARG(1), value = 0;
    if (!shader_ok(id)) { fail(BAD_VALUE); return 0; }
    Shader *s = &shaders[id];
    if (key == 0x8b81) value = s->compiled; else if (key == 0x8b80) value = s->deleted;
    else if (key == 0x8b84) value = s->log[0] ? w32_slen(s->log) + 1 : 0;
    else if (key == 0x8b4f) value = s->type; else if (key == 0x8b88) value = s->source ? s->source_len + 1 : 0;
    else { fail(BAD_ENUM); return 0; } x86_wr32(ARG(2), value); return 0;
}
static uint32_t put_string(uint32_t buf_size, uint32_t len_ptr, uint32_t buf, const char *s) {
    if ((int32_t)buf_size < 0) { fail(BAD_VALUE); return 0; }
    uint32_t n = buf ? w32_pstr(buf, buf_size, 0, s) : 0; if (len_ptr) x86_wr32(len_ptr, n); return n;
}
static uint32_t info_log(const char *log) { return put_string(ARG(1), ARG(2), ARG(3), log); }
static uint32_t api_GetShaderInfoLog(void) {
    if (!shader_ok(ARG(0))) { fail(BAD_VALUE); return 0; }
    return info_log(shaders[ARG(0)].log);
}
static uint32_t api_GetShaderSource(void) {
    if (!shader_ok(ARG(0))) { fail(BAD_VALUE); return 0; }
    return put_string(ARG(1), ARG(2), ARG(3), shaders[ARG(0)].source ? shaders[ARG(0)].source : "");
}
static uint32_t api_CreateProgram(void) { return alloc_name(programs, sizeof(Program)); }
static uint32_t api_AttachShader(void) {
    uint32_t p = ARG(0), s = ARG(1);
    if (!program_ok(p) || !shader_ok(s)) fail(BAD_VALUE);
    else if ((shaders[s].type == 0x8b31 ? programs[p].vs : programs[p].fs) == s) fail(BAD_OP);
    else if (shaders[s].type == 0x8b31) programs[p].vs = s; else programs[p].fs = s; return 0;
}
static uint32_t api_GetAttachedShaders(void) {
    uint32_t id = ARG(0), max = ARG(1), n = 0;
    if (!program_ok(id) || (int32_t)max < 0) { fail(BAD_VALUE); return 0; }
    if (programs[id].vs && n < max) x86_wr32(ARG(3) + 4 * n++, programs[id].vs);
    if (programs[id].fs && n < max) x86_wr32(ARG(3) + 4 * n++, programs[id].fs);
    if (ARG(2)) x86_wr32(ARG(2), n); return 0;
}
static void invalidate_pipelines(void) {
    for (uint32_t i = 0; i < pipeline_count; i++) if (pipelines[i].used) {
        SEND(0x4b, pipelines[i].id); pipelines[i].used = 0;
    }
    pipeline_count = 0;
}
static void program_free_link(Program *p) {
    if (p->info) { glp_free(p->info, sizeof(Gp)); p->info = 0; }
    if (p->values) { glp_free(p->values, p->usize); p->values = 0; }
    p->nb = p->nslots = p->ndef = 0;
}
static uint32_t api_LinkProgram(void) {
    uint32_t id = ARG(0); if (!program_ok(id)) { fail(BAD_VALUE); return 0; }
    Program *p = &programs[id]; GsLog log = {p->log, sizeof p->log, 0, 0};
    p->linked = 0; p->log[0] = 0; program_free_link(p);
    if (!p->vs || !p->fs || !shaders[p->vs].compiled || !shaders[p->fs].compiled) {
        gs_put(&log, "error: both a vertex and a fragment shader must be attached and compiled before link\n"); return 0;
    }
    invalidate_pipelines();
    if (p->vgpu) SEND(0x49, p->vgpu); if (p->fgpu) SEND(0x49, p->fgpu); p->vgpu = p->fgpu = 0;
    Gp *g = glp_alloc(sizeof(Gp)); if (!g) { fail(OOM); return 0; }
    GsUnit *vs = shaders[p->vs].unit, *fs = shaders[p->fs].unit;
    if (!gp_link(g, vs, fs, p->abind, p->nab, p->obind, p->nob, &log) ||
        !stage_module(vs, vs, fs, g, &p->vgpu, &log) || !stage_module(fs, vs, fs, g, &p->fgpu, &log)) {
        if (p->vgpu) { SEND(0x49, p->vgpu); p->vgpu = 0; }
        glp_free(g, sizeof(Gp)); if (!log.errors) gs_put(&log, "error: program failed to link\n"); return 0;
    }
    p->values = glp_alloc(g->usize); if (!p->values) { glp_free(g, sizeof(Gp)); fail(OOM); return 0; }
    if (p->ubuf && p->usize != g->usize) { SEND(0x42, p->ubuf); p->ubuf = 0; }
    p->usize = g->usize;
    if (!p->ubuf) { p->ubuf = 700 + id; SEND(0x40, p->ubuf, 4, p->usize, 0, 0); }
    p->info = g; p->nb = g->nb; p->nslots = g->nslots; p->ndef = 0;
    while (p->ndef < g->nu && g->u[p->ndef].block < 0) p->ndef++;
    for (uint32_t i = 0; i < 8; i++) p->slot_unit[i] = 0;
    for (uint32_t i = 0; i < 7; i++) p->block[i].binding = 0;
    p->dirty = 1; p->linked = 1; return 0;
}
static uint32_t api_ValidateProgram(void) {
    if (!program_ok(ARG(0))) { fail(BAD_VALUE); return 0; }
    programs[ARG(0)].validated = programs[ARG(0)].linked; return 0;
}
static uint32_t api_GetProgramiv(void) {
    uint32_t id = ARG(0), key = ARG(1), value = 0;
    if (!program_ok(id)) { fail(BAD_VALUE); return 0; }
    Program *p = &programs[id]; Gp *g = p->linked ? p->info : 0;
    switch (key) {
    case 0x8b82: value = p->linked; break;
    case 0x8b83: value = p->validated; break;
    case 0x8b80: value = p->deleted; break;
    case 0x8b84: value = p->log[0] ? w32_slen(p->log) + 1 : 0; break;
    case 0x8b85: value = (p->vs != 0) + (p->fs != 0); break;
    case 0x8b86: value = g ? g->nu : 0; break;
    case 0x8b87: value = g ? g->uniform_max : 0; break;
    case 0x8b89: value = g ? g->na : 0; break;
    case 0x8b8a: value = g ? g->attr_max : 0; break;
    case 0x8a36: value = g ? g->nb : 0; break;
    case 0x8a35: value = g ? g->block_max : 0; break;
    default: fail(BAD_ENUM); return 0;
    }
    x86_wr32(ARG(2), value); return 0;
}
static uint32_t api_GetProgramInfoLog(void) {
    if (!program_ok(ARG(0))) { fail(BAD_VALUE); return 0; }
    return info_log(programs[ARG(0)].log);
}
static uint32_t api_UseProgram(void) {
    uint32_t id = ARG(0);
    if (id >= N || (id && !programs[id].linked)) fail(BAD_OP); else program = id; return 0;
}

/* ------------------------------------------------------------------- reflection queries */
static Gp *linked_info(uint32_t id) {
    if (!program_ok(id)) { fail(BAD_VALUE); return 0; }
    if (!programs[id].linked) { fail(BAD_OP); return 0; }
    return programs[id].info;
}
/* Resolve `name`, `name[0]` or `name[k]` to a uniform index (and element k). */
static int find_uniform(Gp *g, const char *name, uint32_t *elem, int include_blocks) {
    uint32_t n = w32_slen(name);
    for (uint32_t i = 0; i < g->nu; i++) {
        GpUniform *u = &g->u[i]; if (!include_blocks && u->block >= 0) continue;
        const char *un = gp_name(g, u->name); uint32_t ul = w32_slen(un);
        if (eq(name, un)) { *elem = 0; return (int)i; }
        if (u->size > 1 || (ul > 3 && un[ul - 3] == '[' && un[ul - 2] == '0')) {
            uint32_t base = ul - 3;
            if (n == base && eq_n(name, un, base)) { *elem = 0; return (int)i; }
            if (n > base + 2 && eq_n(name, un, base) && name[base] == '[' && name[n - 1] == ']') {
                uint32_t k = 0, d = base + 1; int ok = d < n - 1;
                for (; d < n - 1; d++) { if (name[d] < '0' || name[d] > '9') { ok = 0; break; } k = k * 10 + (uint32_t)(name[d] - '0'); }
                if (ok && k < (uint32_t)u->size) { *elem = k; return (int)i; }
            }
        }
    }
    return -1;
}
static uint32_t api_GetUniformLocation(void) {
    uint32_t id = ARG(0); char name[160]; w32_gstr(ARG(1), 0, name, sizeof name);
    if (!program_ok(id)) { fail(BAD_VALUE); return 0xffffffffu; }
    if (!programs[id].linked) { fail(BAD_OP); return 0xffffffffu; }
    uint32_t k; int i = find_uniform(programs[id].info, name, &k, 0);
    return i < 0 ? 0xffffffffu : (uint32_t)(programs[id].info->u[i].location + (int32_t)k);
}
static uint32_t api_GetUniformIndices(void) {
    Gp *g = linked_info(ARG(0)); int32_t n = (int32_t)ARG(1); if (!g) return 0;
    if (n < 0) { fail(BAD_VALUE); return 0; }
    for (int32_t i = 0; i < n; i++) {
        char name[160]; w32_gstr((uint32_t)w32_rdptr(ARG(2) + i * w32_ptr_size()), 0, name, sizeof name);
        uint32_t k; int idx = find_uniform(g, name, &k, 1);
        x86_wr32(ARG(3) + 4 * i, idx >= 0 && k == 0 ? (uint32_t)idx : GL_INVALID_INDEX);
    }
    return 0;
}
static uint32_t api_GetActiveUniform(void) {
    Gp *g = linked_info(ARG(0)); if (!g) return 0;
    if ((int32_t)ARG(2) < 0) { fail(BAD_VALUE); return 0; }
    if (ARG(1) >= g->nu) { fail(BAD_VALUE); return 0; }
    GpUniform *u = &g->u[ARG(1)];
    if (ARG(4)) x86_wr32(ARG(4), (uint32_t)u->size); if (ARG(5)) x86_wr32(ARG(5), u->gl_type);
    put_string(ARG(2), ARG(3), ARG(6), gp_name(g, u->name)); return 0;
}
static uint32_t api_GetActiveUniformName(void) {
    Gp *g = linked_info(ARG(0)); if (!g) return 0;
    if (ARG(1) >= g->nu || (int32_t)ARG(2) < 0) { fail(BAD_VALUE); return 0; }
    put_string(ARG(2), ARG(3), ARG(4), gp_name(g, g->u[ARG(1)].name)); return 0;
}
static uint32_t api_GetActiveUniformsiv(void) {
    Gp *g = linked_info(ARG(0)); int32_t n = (int32_t)ARG(1); uint32_t key = ARG(3); if (!g) return 0;
    if (n < 0) { fail(BAD_VALUE); return 0; }
    if (key < 0x8a37 || key > 0x8a3e) { fail(BAD_ENUM); return 0; }
    for (int32_t i = 0; i < n; i++) if (x86_rd32(ARG(2) + 4 * i) >= g->nu) { fail(BAD_VALUE); return 0; }
    for (int32_t i = 0; i < n; i++) {
        GpUniform *u = &g->u[x86_rd32(ARG(2) + 4 * i)]; int32_t v = 0;
        switch (key) {
        case 0x8a37: v = (int32_t)u->gl_type; break; case 0x8a38: v = u->size; break;
        case 0x8a39: v = (int32_t)w32_slen(gp_name(g, u->name)) + 1; break; case 0x8a3a: v = u->block; break;
        case 0x8a3b: v = u->block >= 0 ? (int32_t)u->offset : -1; break;
        case 0x8a3c: v = u->block >= 0 ? (int32_t)u->stride : -1; break;
        case 0x8a3d: v = u->block >= 0 ? (int32_t)u->mstride : -1; break;
        case 0x8a3e: v = 0; break;
        }
        x86_wr32(ARG(4) + 4 * i, (uint32_t)v);
    }
    return 0;
}
static uint32_t api_GetUniformBlockIndex(void) {
    uint32_t id = ARG(0); char name[GS_NAME]; w32_gstr(ARG(1), 0, name, sizeof name);
    Gp *g = linked_info(id); if (!g) return GL_INVALID_INDEX;
    for (uint32_t i = 0; i < g->nb; i++) if (eq(name, gp_name(g, g->b[i].name))) return i;
    return GL_INVALID_INDEX;
}
static uint32_t api_GetActiveUniformBlockiv(void) {
    Gp *g = linked_info(ARG(0)); uint32_t key = ARG(2); if (!g) return 0;
    if (ARG(1) >= g->nb) { fail(BAD_VALUE); return 0; }
    GpBlock *b = &g->b[ARG(1)]; Program *p = &programs[ARG(0)];
    switch (key) {
    case 0x8a3f: x86_wr32(ARG(3), p->block[ARG(1)].binding); break;
    case 0x8a40: x86_wr32(ARG(3), b->size); break;
    case 0x8a41: x86_wr32(ARG(3), w32_slen(gp_name(g, b->name)) + 1); break;
    case 0x8a42: x86_wr32(ARG(3), b->nmembers); break;
    case 0x8a43: for (uint32_t i = 0; i < b->nmembers; i++) x86_wr32(ARG(3) + 4 * i, b->first + i); break;
    case 0x8a44: x86_wr32(ARG(3), !!(b->stages & 1)); break;
    case 0x8a46: x86_wr32(ARG(3), !!(b->stages & 2)); break;
    case 0x8a45: x86_wr32(ARG(3), 0); break;
    default: fail(BAD_ENUM); break;
    }
    return 0;
}
static uint32_t api_GetActiveUniformBlockName(void) {
    Gp *g = linked_info(ARG(0)); if (!g) return 0;
    if (ARG(1) >= g->nb || (int32_t)ARG(2) < 0) { fail(BAD_VALUE); return 0; }
    put_string(ARG(2), ARG(3), ARG(4), gp_name(g, g->b[ARG(1)].name)); return 0;
}
static uint32_t api_UniformBlockBinding(void) {
    uint32_t id = ARG(0);
    if (!program_ok(id)) fail(BAD_VALUE); else if (!programs[id].linked) fail(BAD_OP);
    else if (ARG(1) >= programs[id].nb || ARG(2) >= 8) fail(BAD_VALUE);
    else programs[id].block[ARG(1)].binding = ARG(2); return 0;
}
static uint32_t api_GetActiveAttrib(void) {
    Gp *g = linked_info(ARG(0)); if (!g) return 0;
    if (ARG(1) >= g->na || (int32_t)ARG(2) < 0) { fail(BAD_VALUE); return 0; }
    GpAttrib *a = &g->a[ARG(1)];
    if (ARG(4)) x86_wr32(ARG(4), (uint32_t)a->size); if (ARG(5)) x86_wr32(ARG(5), a->gl_type);
    put_string(ARG(2), ARG(3), ARG(6), gp_name(g, a->name)); return 0;
}
static uint32_t api_GetAttribLocation(void) {
    char name[GS_NAME]; w32_gstr(ARG(1), 0, name, sizeof name);
    Gp *g = linked_info(ARG(0)); if (!g) return 0xffffffffu;
    for (uint32_t i = 0; i < g->na; i++) if (eq(name, gp_name(g, g->a[i].name))) return (uint32_t)g->a[i].location;
    return 0xffffffffu;
}
static void set_binding(GpBinding *list, uint32_t *count, const char *name, uint32_t loc) {
    for (uint32_t i = 0; i < *count; i++) if (eq(list[i].name, name)) { list[i].loc = loc; return; }
    if (*count == GP_MAX_BINDINGS) { fail(OOM); return; }
    copy(list[*count].name, name, w32_slen(name) + 1); list[*count].loc = loc; (*count)++;
}
static uint32_t api_BindAttribLocation(void) {
    char name[GS_NAME]; w32_gstr(ARG(2), 0, name, sizeof name);
    if (!program_ok(ARG(0)) || ARG(1) >= 16) { fail(BAD_VALUE); return 0; }
    if (name[0] == 'g' && name[1] == 'l' && name[2] == '_') { fail(BAD_OP); return 0; }
    set_binding(programs[ARG(0)].abind, &programs[ARG(0)].nab, name, ARG(1)); return 0;
}
static uint32_t api_BindFragDataLocation(void) {
    char name[GS_NAME]; w32_gstr(ARG(2), 0, name, sizeof name);
    if (!program_ok(ARG(0)) || ARG(1) >= 8) { fail(BAD_VALUE); return 0; }
    if (name[0] == 'g' && name[1] == 'l' && name[2] == '_') { fail(BAD_OP); return 0; }
    set_binding(programs[ARG(0)].obind, &programs[ARG(0)].nob, name, ARG(1)); return 0;
}
static uint32_t api_GetFragDataLocation(void) {
    char name[GS_NAME]; w32_gstr(ARG(1), 0, name, sizeof name);
    Gp *g = linked_info(ARG(0)); if (!g) return 0xffffffffu;
    for (uint32_t i = 0; i < g->no; i++) if (eq(name, gp_name(g, g->o[i].name))) return (uint32_t)g->o[i].location;
    return 0xffffffffu;
}

/* --------------------------------------------------------------------- uniform values */
static GpUniform *uniform_at(Program *p, int32_t loc, uint32_t *elem) {
    uint32_t lo = 0, hi = p->ndef;
    while (lo < hi) {
        uint32_t mid = (lo + hi) / 2; GpUniform *u = &p->info->u[mid];
        if (loc < u->location) hi = mid; else if (loc >= u->location + u->size) lo = mid + 1;
        else { *elem = (uint32_t)(loc - u->location); return u; }
    }
    return 0;
}
/* kind: 0 float, 1 int, 2 uint. components counts scalars per element (matrix: cols * rows). */
static uint32_t uniform_value(uint32_t components, int pointer, int kind, int matrix) {
    int32_t loc = (int32_t)ARG(0); if (loc == -1) return 0;
    if (!program || !programs[program].linked) { fail(BAD_OP); return 0; }
    Program *p = &programs[program]; uint32_t first;
    GpUniform *u = loc < 0 ? 0 : uniform_at(p, loc, &first);
    if (!u) { fail(BAD_OP); return 0; }
    int32_t count = pointer ? (int32_t)ARG(1) : 1; if (count < 0) { fail(BAD_VALUE); return 0; }
    uint32_t src = ARG(pointer ? (matrix ? 3 : 2) : 1);
    int sampler = u->dim != 0, is_bool = u->kind == 'b';
    int ok = sampler ? (kind == 1 && components == 1 && !matrix) :
        matrix ? (u->cols > 1 && u->cols == u->rows && components == (uint32_t)u->cols * u->rows) :
        (u->cols == 1 && components == u->rows && !matrix &&
         (is_bool || (kind == 0 && u->kind == 'f') || (kind == 1 && u->kind == 'i') || (kind == 2 && u->kind == 'u')));
    if (!ok) { fail(BAD_OP); return 0; }
    if (count > 1 && u->size == 1) { fail(BAD_OP); return 0; }
    if (!count) return 0;
    uint32_t n = (uint32_t)count; if (n > (uint32_t)u->size - first) n = (uint32_t)u->size - first;
    for (uint32_t e = 0; e < n; e++) {
        uint32_t value[16]; zero(value, sizeof value);
        for (uint32_t i = 0; i < components; i++) value[i] = pointer ? x86_rd32(src + (e * components + i) * 4) :
            kind ? ARG(i + 1) : bits(argf(i + 1));
        if (sampler) {
            if (value[0] >= 8) { fail(BAD_VALUE); return 0; }
            p->slot_unit[u->slot - 1 + first + e] = value[0]; continue;
        }
        if (is_bool) for (uint32_t i = 0; i < components; i++)
            value[i] = kind == 0 ? ((value[i] << 1) != 0) : (value[i] != 0);
        uint8_t *dst = p->values + u->offset + (first + e) * u->stride;
        if (matrix) {
            uint32_t side = u->cols;
            for (uint32_t c = 0; c < side; c++) for (uint32_t r = 0; r < side; r++) {
                uint32_t index = ARG(2) ? r * side + c : c * side + r;
                copy(dst + c * 16 + r * 4, &value[index], 4);
            }
        } else copy(dst, value, components * 4);
    }
    p->dirty = 1; return 0;
}
#define UV(name, count, ptr, kind, matrix) \
    static uint32_t api_##name(void) { return uniform_value(count, ptr, kind, matrix); }
UV(Uniform1f,1,0,0,0) UV(Uniform2f,2,0,0,0) UV(Uniform3f,3,0,0,0) UV(Uniform4f,4,0,0,0)
UV(Uniform1i,1,0,1,0) UV(Uniform2i,2,0,1,0) UV(Uniform3i,3,0,1,0) UV(Uniform4i,4,0,1,0)
UV(Uniform1ui,1,0,2,0) UV(Uniform2ui,2,0,2,0) UV(Uniform3ui,3,0,2,0) UV(Uniform4ui,4,0,2,0)
UV(Uniform1fv,1,1,0,0) UV(Uniform2fv,2,1,0,0) UV(Uniform3fv,3,1,0,0) UV(Uniform4fv,4,1,0,0)
UV(Uniform1iv,1,1,1,0) UV(Uniform2iv,2,1,1,0) UV(Uniform3iv,3,1,1,0) UV(Uniform4iv,4,1,1,0)
UV(Uniform1uiv,1,1,2,0) UV(Uniform2uiv,2,1,2,0) UV(Uniform3uiv,3,1,2,0) UV(Uniform4uiv,4,1,2,0)
UV(UniformMatrix2fv,4,1,0,1) UV(UniformMatrix3fv,9,1,0,1) UV(UniformMatrix4fv,16,1,0,1)
#undef UV
/* glGetUniform{f,i,ui}v: current value of one default-block uniform element. */
static uint32_t get_uniform(int kind) {
    Gp *g = linked_info(ARG(0)); (void)g; if (!g) return 0;
    Program *p = &programs[ARG(0)]; uint32_t first; int32_t loc = (int32_t)ARG(1);
    GpUniform *u = loc < 0 ? 0 : uniform_at(p, loc, &first);
    if (!u) { fail(BAD_OP); return 0; }
    uint32_t comps = u->dim != 0 ? 1 : u->cols > 1 ? u->cols * u->rows : u->rows, out = ARG(2);
    for (uint32_t i = 0; i < comps; i++) {
        uint32_t w;
        if (u->dim != 0) w = p->slot_unit[u->slot - 1 + first];
        else {
            uint32_t col = u->cols > 1 ? i / u->rows : 0, row = u->cols > 1 ? i % u->rows : i;
            copy(&w, p->values + u->offset + first * u->stride + col * 16 + row * 4, 4);
        }
        char k = u->dim ? 'i' : u->kind;         /* the element kind of a sampler is its unit number (int) */
        if (k == 'f') { union { uint32_t u; float f; } c = {w};
            x86_wr32(out + 4 * i, kind == 0 ? w : (uint32_t)(int32_t)c.f); }
        else if (kind == 0) { float f = k == 'u' ? (float)w : (float)(int32_t)w; x86_wr32(out + 4 * i, bits(f)); }
        else x86_wr32(out + 4 * i, w);
    }
    return 0;
}
static uint32_t api_GetUniformfv(void) { return get_uniform(0); }
static uint32_t api_GetUniformiv(void) { return get_uniform(1); }
static uint32_t api_GetUniformuiv(void) { return get_uniform(2); }

static void release_shader(uint32_t id) {
    if (!id || !shaders[id].deleted) return;
    for (uint32_t i = 1; i < N; i++)
        if (programs[i].used && (programs[i].vs == id || programs[i].fs == id)) return;
    if (shaders[id].gpu) SEND(0x49, shaders[id].gpu);
    shader_free_front(&shaders[id]);
    if (shaders[id].source) glp_free(shaders[id].source, shaders[id].source_len + 1);
    if (shaders[id].str_len) glp_free(shaders[id].str_len, (shaders[id].nstr ? shaders[id].nstr : 1) * 4);
    zero(&shaders[id], sizeof(Shader));
}
static uint32_t api_DetachShader(void) {
    uint32_t p = ARG(0), s = ARG(1);
    if (!program_ok(p) || !shader_ok(s)) fail(BAD_VALUE);
    else if (programs[p].vs != s && programs[p].fs != s) fail(BAD_OP);
    else { if (programs[p].vs == s) programs[p].vs = 0; else programs[p].fs = 0; release_shader(s); }
    return 0;
}
static uint32_t api_DeleteShader(void) {
    uint32_t id = ARG(0); if (!id) return 0;
    if (!shader_ok(id)) { fail(BAD_VALUE); return 0; }
    shaders[id].deleted = 1; release_shader(id); return 0;
}
static uint32_t api_DeleteProgram(void) {
    uint32_t id = ARG(0); if (!id) return 0;
    if (!program_ok(id)) { fail(BAD_VALUE); return 0; }
    invalidate_pipelines(); Program *p = &programs[id];
    if (p->vgpu) SEND(0x49, p->vgpu); if (p->fgpu) SEND(0x49, p->fgpu);
    uint32_t vs = p->vs, fs = p->fs;
    if (p->ubuf) SEND(0x42, p->ubuf);
    program_free_link(p); zero(p, sizeof *p); release_shader(vs); release_shader(fs);
    if (program == id) program = 0; return 0;
}
