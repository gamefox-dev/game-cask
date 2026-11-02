/* GL 3.3 transform feedback: program declarations, bindings, lifecycle and deterministic primitive queries.
 * SPDX-License-Identifier: MIT */
static int tf_unique_name(GsUnit *vs, const char *base, char *name) {
    uint32_t len = w32_slen(base);
    for (uint32_t suffix = 0; suffix < 1000; suffix++) {
        copy(name, base, len + 1);
        if (suffix) { name[len] = '_'; name[len + 1] = (char)('0' + suffix / 100);
            name[len + 2] = (char)('0' + suffix / 10 % 10); name[len + 3] = (char)('0' + suffix % 10); name[len + 4] = 0; }
        int used = 0;
        for (uint32_t j = 0; j < vs->nvars; j++) if (eq(vs->vars[j].name, name)) used = 1;
        for (uint32_t j = 0; j < vs->nfuncs; j++) if (eq(vs->funcs[j].name, name)) used = 1;
        for (uint32_t j = 0; j < vs->nmembers; j++) if (eq(vs->members[j].name, name)) used = 1;
        Lx lx = {vs->src, 0, vs->srclen, 1}; Tk tk;
        while ((tk = lx_next(&lx)).kind) if (tk.kind == 'i' && tk_is(&tk, name)) used = 1;
        if (!used) return 1;
    }
    return 0;
}
static int tf_link(Program *p, GsUnit *vs, GsLog *log) {
    if (!tf_unique_name(vs, "bgt_tf_position", p->tf_builtin_names[0]) ||
        !tf_unique_name(vs, "bgt_tf_point_size", p->tf_builtin_names[1])) {
        gs_put(log, "error: captured builtin symbol capacity exhausted\n"); return 0;
    }
    zero(p->tf_stride, sizeof p->tf_stride); p->tf_link_count = 0;
    for (uint32_t i = 0; i < p->tf_count; i++) {
        const GsType *t = 0; uint32_t arr = 0;
        if (eq(p->tf_names[i], "gl_Position")) t = &gs_types[gs_type_find(vs, "vec4", 4)];
        else if (eq(p->tf_names[i], "gl_PointSize")) t = &gs_types[gs_type_find(vs, "float", 5)];
        else for (uint32_t j = 0; j < vs->nvars; j++) {
            GsVar *v = &vs->vars[j];
            if (v->storage == GS_OUT && eq(v->name, p->tf_names[i])) {
                if (v->type < GS_STRUCT_BASE) t = &gs_types[v->type]; arr = v->arr; break;
            }
        }
        for (uint32_t j = 0; j < i; j++) if (eq(p->tf_names[i], p->tf_names[j])) t = 0;
        if (!t || arr || t->dim || t->cols != 1 || (t->kind != 'f' && t->kind != 'i' && t->kind != 'u')) {
            gs_put(log, "error: transform feedback requires distinct declared scalar/vector outputs (arrays/matrices unavailable): ");
            gs_put(log, p->tf_names[i]); gs_put(log, "\n"); return 0;
        }
        p->tf_format[i] = (t->kind == 'f' ? 0u : t->kind == 'i' ? 5u : 9u) + t->rows - 1;
        p->tf_type[i] = t->gl;
        uint32_t slot = p->tf_separate ? i : 0; p->tf_stride[slot] += t->rows * 4;
        if (p->tf_stride[slot] > (p->tf_separate ? 16u : 256u)) {
            gs_put(log, "error: transform feedback component limit exceeded\n"); return 0;
        }
    }
    p->tf_link_count = p->tf_count; p->tf_link_separate = p->tf_separate;
    copy(p->tf_link_names, p->tf_names, sizeof p->tf_names); return 1;
}
static uint32_t api_TransformFeedbackVaryings(void) {
    uint32_t id = ARG(0), count = ARG(1), mode = ARG(3);
    if (!id || id >= N || !programs[id].used) { fail(BAD_VALUE); return 0; }
    if (mode != 0x8c8c && mode != 0x8c8d) { fail(BAD_ENUM); return 0; }
    if ((int32_t)count < 0 || count > 16 || (mode == 0x8c8d && count > 4)) { fail(BAD_VALUE); return 0; }
    if (tf_active && id == program) { fail(BAD_OP); return 0; }
    char names[16][GS_NAME]; zero(names, sizeof names);
    for (uint32_t i = 0; i < count; i++) {
        uint32_t ptr = (uint32_t)w32_rdptr(ARG(2) + i * w32_ptr_size());
        w32_gstr(ptr, 0, names[i], GS_NAME);
        if (!names[i][0] || names[i][GS_NAME - 2]) { fail(BAD_VALUE); return 0; }
    }
    Program *p = &programs[id]; p->tf_count = count; p->tf_separate = mode == 0x8c8d;
    copy(p->tf_names, names, sizeof names); return 0;
}
static uint32_t api_GetTransformFeedbackVarying(void) {
    uint32_t id = ARG(0), i = ARG(1), cap = ARG(2);
    if (!id || id >= N || !programs[id].used) { fail(BAD_VALUE); return 0; }
    Program *p = &programs[id];
    if (!p->linked) { fail(BAD_OP); return 0; }
    if (i >= p->tf_link_count || (int32_t)cap < 0) { fail(BAD_VALUE); return 0; }
    uint32_t n = w32_pstr(ARG(6), cap, 0, p->tf_link_names[i]);
    if (ARG(3)) x86_wr32(ARG(3), n);
    if (ARG(4)) x86_wr32(ARG(4), 1);
    if (ARG(5)) x86_wr32(ARG(5), p->tf_type[i]); return 0;
}
static uint32_t api_BeginTransformFeedback(void) {
    uint32_t mode = ARG(0);
    if (mode != 0 && mode != 1 && mode != 4) { fail(BAD_ENUM); return 0; }
    if (tf_active || !program || !programs[program].info || !programs[program].tf_link_count) { fail(BAD_OP); return 0; }
    Program *p = &programs[program]; uint32_t slots = p->tf_link_separate ? p->tf_link_count : 1;
    for (uint32_t i = 0; i < slots; i++) {
        uint32_t id = tf_bound[i];
        if (!id || !buffers[id].gpu || !(tf_whole[i] ? buffers[id].size : tf_size[i])) { fail(BAD_OP); return 0; }
        for (uint32_t j = 0; j < i; j++) if (tf_bound[j] == id) { fail(BAD_OP); return 0; }
    }
    zero(tf_cursor, sizeof tf_cursor); tf_mode = mode; tf_active = 1; return 0;
}
static uint32_t api_EndTransformFeedback(void) {
    if (!tf_active) fail(BAD_OP); else tf_active = 0; return 0;
}
static uint32_t api_GetIntegeri_v(void) {
    uint32_t key = ARG(0), i = ARG(1), value;
    if (key == 0x8c8f || key == 0x8c84 || key == 0x8c85) {
        if (i >= 4) { fail(BAD_VALUE); return 0; }
        value = key == 0x8c8f ? tf_bound[i] : key == 0x8c84 ? tf_offset[i] : tf_whole[i] ? 0 : tf_size[i];
    } else if (key == 0x8a28 || key == 0x8a29 || key == 0x8a2a) {
        if (i >= 8) { fail(BAD_VALUE); return 0; }
        value = key == 0x8a28 ? ubo[i] : key == 0x8a29 ? ubo_offset[i] : ubo_whole[i] ? 0 : ubo_size[i];
    } else { fail(BAD_ENUM); return 0; }
    x86_wr32(ARG(2), value); return 0;
}
static uint32_t api_GenQueries(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) x86_wr32(ARG(1) + 4 * i, alloc_name(gl_queries, sizeof(GlQuery))); return 0;
}
static uint32_t api_DeleteQueries(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = x86_rd32(ARG(1) + 4 * i);
        if (id && id < N) { if (tf_query == id) tf_query = 0; zero(&gl_queries[id], sizeof(GlQuery)); } } return 0;
}
static uint32_t api_IsQuery(void) { return ARG(0) && ARG(0) < N && gl_queries[ARG(0)].target != 0; }
static uint32_t api_BeginQuery(void) {
    uint32_t id = ARG(1);
    if (ARG(0) != 0x8c88) { fail(BAD_ENUM); return 0; }
    if (!id || id >= N || !gl_queries[id].used || tf_query) { fail(BAD_OP); return 0; }
    GlQuery *q = &gl_queries[id]; q->target = ARG(0); q->result = 0; q->active = 1; tf_query = id; return 0;
}
static uint32_t api_EndQuery(void) {
    if (ARG(0) != 0x8c88) fail(BAD_ENUM);
    else if (!tf_query) fail(BAD_OP);
    else { gl_queries[tf_query].active = 0; tf_query = 0; } return 0;
}
static uint32_t api_GetQueryiv(void) {
    if (ARG(0) != 0x8c88) { fail(BAD_ENUM); return 0; }
    if (ARG(1) != 0x8864 && ARG(1) != 0x8865) { fail(BAD_ENUM); return 0; }
    x86_wr32(ARG(2), ARG(1) == 0x8864 ? 32 : tf_query); return 0;
}
static uint32_t api_GetQueryObjectuiv(void) {
    uint32_t id = ARG(0), key = ARG(1);
    if (!id || id >= N || !gl_queries[id].target || gl_queries[id].active) { fail(BAD_OP); return 0; }
    if (key != 0x8866 && key != 0x8867) { fail(BAD_ENUM); return 0; }
    x86_wr32(ARG(2), key == 0x8867 ? 1 : gl_queries[id].result); return 0;
}
static uint32_t api_GetQueryObjectiv(void) { return api_GetQueryObjectuiv(); }
/* Declare the linked capture interface on a newly materialized immutable pipeline. */
static void tf_pipeline(Program *p, uint32_t pipe) {
    char names[4096]; uint32_t n = 0;
    for (uint32_t i = 0; i < p->tf_link_count; i++) {
        const char *s = eq(p->tf_link_names[i], "gl_Position") ? p->tf_builtin_names[0] :
            eq(p->tf_link_names[i], "gl_PointSize") ? p->tf_builtin_names[1] : p->tf_link_names[i]; for (uint32_t j = 0; s[j]; j++) names[n++] = s[j];
        names[n++] = ' '; uint32_t f = p->tf_format[i];
        if (f >= 10) names[n++] = '1'; names[n++] = (char)('0' + f % 10); names[n++] = '\n';
    }
    SEND(0x61, pipe, p->tf_link_separate, p->tf_link_count, PTR(names), n);
}
