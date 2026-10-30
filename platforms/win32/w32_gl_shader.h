/* GLSL330 binding lowering. Included once by w32_gl.c. SPDX-License-Identifier: MIT — LANE-GL */
static int ident(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') || c == '_'; }
static const char *token(const char *s, char *out, uint32_t cap) {
    for (;;) {
        while (*s && (uint8_t)*s <= 32) s++;
        if (s[0] == '/' && s[1] == '/') { while (*s && *s != '\n') s++; }
        else if (s[0] == '/' && s[1] == '*') {
            s += 2; while (*s && !(s[0] == '*' && s[1] == '/')) s++; if (*s) s += 2;
        } else break;
    }
    uint32_t n = 0;
    if (ident(*s)) { while (ident(*s)) { if (n + 1 < cap) out[n++] = *s; s++; } }
    else if (*s) out[n++] = *s++;
    out[n] = 0; return s;
}
static void text(char *dst, uint32_t *n, const char *s) {
    while (*s && *n < 1048500) dst[(*n)++] = *s++;
}
static void number(char *dst, uint32_t *n, uint32_t v) {
    char buf[12]; uint32_t k = 0; do { buf[k++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (k) dst[(*n)++] = buf[--k];
}
static uint32_t type_size(const char *type) {
    if (eq(type, "float") || eq(type, "int") || eq(type, "uint") || eq(type, "bool")) return 4;
    if (eq(type, "vec2") || eq(type, "ivec2") || eq(type, "uvec2")) return 8;
    if (eq(type, "mat2")) return 32; if (eq(type, "mat3")) return 48; if (eq(type, "mat4")) return 64;
    if (eq(type, "vec3") || eq(type, "vec4") || eq(type, "ivec3") || eq(type, "ivec4") ||
        eq(type, "uvec3") || eq(type, "uvec4")) return 16;
    return 0;
}
static int collect(Program *p, const char *src) {
    char t[128], type[32], name[64], next[8]; const char *s = src;
    while (*s) {
        s = token(s, t, sizeof t); if (!eq(t, "uniform")) continue;
        s = token(s, type, sizeof type); s = token(s, name, sizeof name);
        if (eq(name, "{")) {
            uint32_t i; for (i = 0; i < p->nb && !eq(p->block[i].name, type); i++);
            if (i == p->nb) { if (p->nb == 7) return 0; copy(p->block[i].name, type, w32_slen(type) + 1);
                p->block[i].binding = i; p->nb++; }
            continue;
        }
        uint32_t i; for (i = 0; i < p->nu && !eq(p->u[i].name, name); i++);
        if (i < p->nu) { if (!eq(p->u[i].type, type)) return 0; continue; }
        if (p->nu == 64 || !ident(name[0])) return 0;
        s = token(s, next, sizeof next);
        /* Arrays/structs need full GLSL reflection; reject rather than fabricate a layout. */
        if (!eq(next, ";")) return 0;
        Uniform *u = &p->u[p->nu++]; copy(u->name, name, w32_slen(name) + 1);
        copy(u->type, type, w32_slen(type) + 1);
        if (eq(type, "sampler2D") || eq(type, "sampler2DShadow")) {
            uint32_t slot = 0; for (uint32_t j = 0; j < i; j++) if (p->u[j].sampler) slot++;
            if (slot == 8) return 0; u->sampler = slot + 1;
        } else {
            u->size = type_size(type); if (!u->size) return 0;
            uint32_t off = 16;
            for (uint32_t j = 0; j < i; j++) if (!p->u[j].sampler) off = p->u[j].offset + p->u[j].size;
            uint32_t align = u->size < 16 ? u->size : 16;
            u->offset = (off + align - 1) & ~(align - 1); if (u->offset + u->size > 4096) return 0;
        }
    } return 1;
}
static char *translate(Program *p, Shader *shader) {
    char *out = x86_alloc(1048576); if (!out) return 0; uint32_t n = 0;
    const char *s = shader->source; char t[128], type[32], name[64];
    if (!s) return 0;
    text(out, &n, "#version 330 core\nlayout(std140) uniform bgt_u0 { vec4 bgt_gl_meta;\n");
    for (uint32_t i = 0; i < p->nu; i++) if (!p->u[i].sampler) {
        text(out, &n, p->u[i].type); text(out, &n, " "); text(out, &n, p->u[i].name); text(out, &n, ";\n");
        if (eq(p->u[i].type, "vec3") || eq(p->u[i].type, "ivec3") || eq(p->u[i].type, "uvec3")) {
            text(out, &n, "float bgt_gl_pad"); number(out, &n, i); text(out, &n, ";\n");
        }
    }
    text(out, &n, "};\n");
    for (uint32_t i = 0; i < p->nu; i++) if (p->u[i].sampler) {
        text(out, &n, "uniform "); text(out, &n, p->u[i].type); text(out, &n, " bgt_t");
        number(out, &n, p->u[i].sampler - 1); text(out, &n, ";\n");
    }
    text(out, &n, "#define texture(S,U) texture(S,vec2((U).x,1.0-(U).y))\n");
    text(out, &n, "#define textureLod(S,U,L) textureLod(S,vec2((U).x,1.0-(U).y),L)\n");
    while (*s && (uint8_t)*s <= 32) s++;
    if (*s == '#') { while (*s && *s != '\n') s++; }
    while (*s) {
        /* Preserve punctuation/whitespace verbatim: splitting numeric literals or += changes GLSL. */
        if ((s[0] == '/' && (s[1] == '/' || s[1] == '*')) || *s == '#') {
            const char *end = s;
            if (s[0] == '/' && s[1] == '*') {
                end += 2; while (*end && !(end[0] == '*' && end[1] == '/')) end++;
                if (*end) end += 2;
            } else { while (*end && *end != '\n') end++; }
            while (s < end && n < 1048500) out[n++] = *s++;
            continue;
        }
        if (!ident(*s)) { if (n < 1048500) out[n++] = *s; s++; continue; }
        s = token(s, t, sizeof t); if (!t[0]) break;
        if (eq(t, "uniform")) {
            const char *end = token(s, type, sizeof type); end = token(end, name, sizeof name);
            if (!eq(name, "{")) { while (*end && *end != ';') end++; if (*end) end++; s = end; continue; }
        }
        if (eq(t, "gl_VertexID")) text(out, &n, "int(bgt_vertex_index)");
        else if (eq(t, "gl_InstanceID")) text(out, &n, "int(bgt_instance_index)");
        else if (eq(t, "gl_FragCoord"))
            text(out, &n, "vec4(bgt_frag_coord.x,bgt_gl_meta.x-bgt_frag_coord.y,bgt_frag_coord.zw)");
        else if (eq(t, "main") && shader->type == 0x8b31) text(out, &n, "bgt_gl_main");
        else {
            int replaced = 0;
            for (uint32_t i = 0; i < p->nu; i++) if (p->u[i].sampler && eq(t, p->u[i].name)) {
                text(out, &n, "bgt_t"); number(out, &n, p->u[i].sampler - 1); replaced = 1; break;
            }
            for (uint32_t i = 0; !replaced && i < p->nb; i++) if (eq(t, p->block[i].name)) {
                text(out, &n, "bgt_u"); number(out, &n, i + 1); replaced = 1;
            }
            if (!replaced) text(out, &n, t);
        }
        /* The next original character supplies token separation, not an injected space. */
    }
    if (shader->type == 0x8b31)
        text(out, &n, "\nvoid main(){bgt_gl_main();gl_Position.z=(gl_Position.z+gl_Position.w)*0.5;}\n");
    out[n] = 0; return out;
}
static uint32_t shader_handle(void) {
    for (uint32_t id = 1; id <= 1023; id++) {
        uint32_t i;
        for (i = 1; i < N; i++)
            if (shaders[i].gpu == id || programs[i].vgpu == id || programs[i].fgpu == id) break;
        if (i == N) return id;
    }
    fail(OOM); return 0;
}
static int compile_module(Program *p, Shader *s, uint32_t *gpu, char *log) {
    char *source = translate(p, s); if (!source) { fail(OOM); return 0; }
    *gpu = shader_handle(); if (!*gpu) return 0; uint32_t req = ++request_id;
    SEND(0x48, *gpu, s->type == 0x8b31 ? 1 : 2, 1, PTR(source), w32_slen(source), req);
    return wait_request(req, log, 4096);
}
static uint32_t api_CreateShader(void) {
    if (ARG(0) != 0x8b31 && ARG(0) != 0x8b30) { fail(BAD_ENUM); return 0; }
    uint32_t id = alloc_name(shaders, sizeof(Shader)); shaders[id].type = ARG(0); return id;
}
static uint32_t api_ShaderSource(void) {
    uint32_t id = ARG(0); if (!id || id >= N || !shaders[id].used) { fail(BAD_VALUE); return 0; }
    int32_t count = (int32_t)ARG(1); if (count < 0 || count > 1024) { fail(BAD_VALUE); return 0; }
    uint32_t total = 0;
    for (int32_t i = 0; i < count; i++) {
        uint32_t a = (uint32_t)w32_rdptr(ARG(2) + i * w32_ptr_size());
        int32_t len = ARG(3) ? (int32_t)x86_rd32(ARG(3) + i * 4) : -1;
        if (len < 0) { len = 0; while (len < 1048576 && x86_rd8(a + (uint32_t)len)) len++; }
        if ((uint32_t)len > 1048576 - total) { fail(BAD_VALUE); return 0; } total += (uint32_t)len;
    }
    char *source = x86_alloc(total + 1); if (!source) { fail(OOM); return 0; } uint32_t at = 0;
    for (int32_t i = 0; i < count; i++) {
        uint32_t a = (uint32_t)w32_rdptr(ARG(2) + i * w32_ptr_size());
        int32_t len = ARG(3) ? (int32_t)x86_rd32(ARG(3) + i * 4) : -1;
        if (len < 0) { len = 0; while (x86_rd8(a + (uint32_t)len)) len++; }
        for (int32_t j = 0; j < len; j++) source[at++] = (char)x86_rd8(a + j);
    }
    source[at] = 0; shaders[id].source = source; shaders[id].compiled = 0; return 0;
}
static uint32_t api_CompileShader(void) {
    uint32_t id = ARG(0); if (!id || id >= N || !shaders[id].used) { fail(BAD_VALUE); return 0; }
    Shader *s = &shaders[id]; static Program temp; zero(&temp, sizeof temp);
    if (!s->source || !collect(&temp, s->source)) {
        copy(s->log, "Unsupported GLSL uniform declaration", 36); s->compiled = 0; return 0;
    }
    if (s->gpu) SEND(0x49, s->gpu); s->gpu = 0;
    s->compiled = (uint32_t)compile_module(&temp, s, &s->gpu, s->log); return 0;
}
static uint32_t api_GetShaderiv(void) {
    uint32_t id = ARG(0), key = ARG(1), value = 0;
    if (!id || id >= N || !shaders[id].used) { fail(BAD_VALUE); return 0; }
    Shader *s = &shaders[id];
    if (key == 0x8b81) value = s->compiled; else if (key == 0x8b80) value = s->deleted;
    else if (key == 0x8b84) value = w32_slen(s->log) + 1;
    else if (key == 0x8b4f) value = s->type; else if (key == 0x8b88) value = s->source ? w32_slen(s->source) + 1 : 0;
    else { fail(BAD_ENUM); return 0; } x86_wr32(ARG(2), value); return 0;
}
static uint32_t info_log(const char *log) {
    if ((int32_t)ARG(1) < 0) { fail(BAD_VALUE); return 0; }
    uint32_t n = w32_pstr(ARG(3), ARG(1), 0, log); if (ARG(2)) x86_wr32(ARG(2), n); return 0;
}
static uint32_t api_GetShaderInfoLog(void) {
    if (!ARG(0) || ARG(0) >= N || !shaders[ARG(0)].used) { fail(BAD_VALUE); return 0; }
    return info_log(shaders[ARG(0)].log);
}
static uint32_t api_CreateProgram(void) { return alloc_name(programs, sizeof(Program)); }
static uint32_t api_AttachShader(void) {
    uint32_t p = ARG(0), s = ARG(1);
    if (!p || p >= N || !programs[p].used || !s || s >= N || !shaders[s].used) fail(BAD_VALUE);
    else if (shaders[s].type == 0x8b31) programs[p].vs = s; else programs[p].fs = s; return 0;
}
static void invalidate_pipelines(void) {
    for (uint32_t i = 0; i < pipeline_count; i++) if (pipelines[i].used) {
        SEND(0x4b, pipelines[i].id); pipelines[i].used = 0;
    }
    pipeline_count = 0;
}
static uint32_t api_LinkProgram(void) {
    uint32_t id = ARG(0); if (!id || id >= N || !programs[id].used) { fail(BAD_VALUE); return 0; }
    Program *p = &programs[id]; p->linked = 0; p->nu = p->nb = 0; p->log[0] = 0;
    zero(p->u, sizeof p->u); zero(p->block, sizeof p->block);
    if (!p->vs || !p->fs || !shaders[p->vs].compiled || !shaders[p->fs].compiled) {
        copy(p->log, "Vertex and fragment shaders must compile before link", 53); return 0;
    }
    if (!collect(p, shaders[p->vs].source) || !collect(p, shaders[p->fs].source)) {
        copy(p->log, "Unsupported or inconsistent uniform layout", 42); return 0;
    }
    invalidate_pipelines();
    if (p->vgpu) SEND(0x49, p->vgpu); if (p->fgpu) SEND(0x49, p->fgpu); p->vgpu = p->fgpu = 0;
    if (!compile_module(p, &shaders[p->vs], &p->vgpu, p->log) ||
        !compile_module(p, &shaders[p->fs], &p->fgpu, p->log)) return 0;
    if (!p->ubuf) { p->ubuf = 700 + id; SEND(0x40, p->ubuf, 4, 4096, 0, 0); }
    zero(p->values, sizeof p->values); p->dirty = 1; p->linked = 1; return 0;
}
static uint32_t api_GetProgramiv(void) {
    uint32_t id = ARG(0), key = ARG(1), value;
    if (!id || id >= N || !programs[id].used) { fail(BAD_VALUE); return 0; }
    Program *p = &programs[id];
    if (key == 0x8b82 || key == 0x8b83) value = p->linked;
    else if (key == 0x8b84) value = w32_slen(p->log) + 1; else if (key == 0x8b86) value = p->nu;
    else if (key == 0x8a36) value = p->nb; else if (key == 0x8b85) value = 2;
    else { fail(BAD_ENUM); return 0; } x86_wr32(ARG(2), value); return 0;
}
static uint32_t api_GetProgramInfoLog(void) {
    if (!ARG(0) || ARG(0) >= N || !programs[ARG(0)].used) { fail(BAD_VALUE); return 0; }
    return info_log(programs[ARG(0)].log);
}
static uint32_t api_UseProgram(void) {
    uint32_t id = ARG(0);
    if (id >= N || (id && !programs[id].linked)) fail(BAD_OP); else program = id; return 0;
}
static uint32_t api_GetUniformLocation(void) {
    uint32_t id = ARG(0); char name[64]; w32_gstr(ARG(1), 0, name, sizeof name);
    if (!id || id >= N || !programs[id].linked) { fail(BAD_OP); return 0xffffffffu; }
    for (uint32_t i = 0; i < programs[id].nu; i++) if (eq(name, programs[id].u[i].name)) return i;
    return 0xffffffffu;
}
static uint32_t api_GetUniformBlockIndex(void) {
    uint32_t id = ARG(0); char name[64]; w32_gstr(ARG(1), 0, name, sizeof name);
    if (!id || id >= N || !programs[id].linked) { fail(BAD_OP); return 0xffffffffu; }
    for (uint32_t i = 0; i < programs[id].nb; i++) if (eq(name, programs[id].block[i].name)) return i;
    return 0xffffffffu;
}
static uint32_t api_UniformBlockBinding(void) {
    uint32_t id = ARG(0); if (!id || id >= N || !programs[id].linked) fail(BAD_OP);
    else if (ARG(1) >= programs[id].nb || ARG(2) >= 8) fail(BAD_VALUE);
    else programs[id].block[ARG(1)].binding = ARG(2); return 0;
}
static uint32_t uniform_value(uint32_t components, int pointer, int integer, int matrix) {
    int32_t loc = (int32_t)ARG(0); if (loc == -1) return 0;
    if (!program || !programs[program].linked || loc < 0 || (uint32_t)loc >= programs[program].nu) {
        fail(BAD_OP); return 0;
    }
    Program *p = &programs[program]; Uniform *u = &p->u[loc];
    if (pointer && ARG(1) != 1) { if ((int32_t)ARG(1) < 0) fail(BAD_VALUE); else if (ARG(1)) fail(BAD_OP);
        return 0; }
    uint32_t value[16]; zero(value, sizeof value);
    for (uint32_t i = 0; i < components; i++) value[i] = pointer ?
        x86_rd32(ARG(matrix ? 3 : 2) + i * 4) : integer ? ARG(i + 1) : bits(argf(i + 1));
    if (u->sampler) {
        if (!integer || components != 1) fail(BAD_OP);
        else if (value[0] >= 8) fail(BAD_VALUE); else u->unit = value[0]; return 0;
    }
    uint32_t expected = eq(u->type, "mat2") ? 4 : eq(u->type, "mat3") ? 9 : eq(u->type, "mat4") ? 16 :
        eq(u->type, "vec3") || eq(u->type, "ivec3") || eq(u->type, "uvec3") ? 3 : u->size / 4;
    int is_matrix = u->type[0] == 'm';
    int is_integer = u->type[0] == 'i' || u->type[0] == 'u' || eq(u->type, "bool");
    if (components != expected || matrix != is_matrix || integer != is_integer) { fail(BAD_OP); return 0; }
    if (matrix) {
        uint32_t side = components == 4 ? 2 : components == 9 ? 3 : 4;
        for (uint32_t c = 0; c < side; c++) for (uint32_t r = 0; r < side; r++) {
            uint32_t index = ARG(2) ? r * side + c : c * side + r;
            copy(p->values + u->offset + c * 16 + r * 4, &value[index], 4);
        }
    } else copy(p->values + u->offset, value, components * 4);
    p->dirty = 1; return 0;
}
#define UV(name, count, ptr, integer, matrix) \
    static uint32_t api_##name(void) { return uniform_value(count, ptr, integer, matrix); }
UV(Uniform1f,1,0,0,0) UV(Uniform2f,2,0,0,0) UV(Uniform3f,3,0,0,0) UV(Uniform4f,4,0,0,0)
UV(Uniform1i,1,0,1,0) UV(Uniform2i,2,0,1,0) UV(Uniform3i,3,0,1,0) UV(Uniform4i,4,0,1,0)
UV(Uniform1ui,1,0,1,0) UV(Uniform2ui,2,0,1,0) UV(Uniform3ui,3,0,1,0) UV(Uniform4ui,4,0,1,0)
UV(Uniform1fv,1,1,0,0) UV(Uniform2fv,2,1,0,0) UV(Uniform3fv,3,1,0,0) UV(Uniform4fv,4,1,0,0)
UV(Uniform1iv,1,1,1,0) UV(Uniform2iv,2,1,1,0) UV(Uniform3iv,3,1,1,0) UV(Uniform4iv,4,1,1,0)
UV(Uniform1uiv,1,1,1,0) UV(Uniform2uiv,2,1,1,0) UV(Uniform3uiv,3,1,1,0) UV(Uniform4uiv,4,1,1,0)
UV(UniformMatrix2fv,4,1,0,1) UV(UniformMatrix3fv,9,1,0,1) UV(UniformMatrix4fv,16,1,0,1)
#undef UV
static void release_shader(uint32_t id) {
    if (!id || !shaders[id].deleted) return;
    for (uint32_t i = 1; i < N; i++)
        if (programs[i].used && (programs[i].vs == id || programs[i].fs == id)) return;
    if (shaders[id].gpu) SEND(0x49, shaders[id].gpu);
    zero(&shaders[id], sizeof(Shader));
}
static uint32_t api_DetachShader(void) {
    uint32_t p = ARG(0), s = ARG(1);
    if (!p || p >= N || !programs[p].used || !s || s >= N || !shaders[s].used) fail(BAD_VALUE);
    else if (programs[p].vs != s && programs[p].fs != s) fail(BAD_OP);
    else { if (programs[p].vs == s) programs[p].vs = 0; else programs[p].fs = 0; release_shader(s); }
    return 0;
}
static uint32_t api_DeleteShader(void) {
    uint32_t id = ARG(0); if (!id) return 0;
    if (id >= N || !shaders[id].used) { fail(BAD_VALUE); return 0; }
    shaders[id].deleted = 1; release_shader(id); return 0;
}
static uint32_t api_DeleteProgram(void) {
    uint32_t id = ARG(0); if (!id) return 0;
    if (id >= N || !programs[id].used) { fail(BAD_VALUE); return 0; }
    invalidate_pipelines(); Program *p = &programs[id];
    if (p->vgpu) SEND(0x49, p->vgpu); if (p->fgpu) SEND(0x49, p->fgpu);
    uint32_t vs = p->vs, fs = p->fs;
    if (p->ubuf) SEND(0x42, p->ubuf); zero(p, sizeof *p); release_shader(vs); release_shader(fs);
    if (program == id) program = 0; return 0;
}
