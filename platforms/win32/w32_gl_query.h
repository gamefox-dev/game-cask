/* Queries and WGL. SPDX-License-Identifier: MIT — LANE-GL */
static uint32_t api_GetError(void) { uint32_t e = error; error = 0; return e; }
static uint32_t string_guest(const char *s) {
    uint32_t n = w32_slen(s) + 1, p = w32_misc_alloc(n);
    for (uint32_t i = 0; i < n; i++) x86_wr8(p + i, (uint8_t)s[i]); return p;
}
static uint32_t api_GetString(void) {
    static uint32_t vendor, renderer, version, shading, extensions;
    if (!vendor) { vendor = string_guest("Game Cask"); renderer = string_guest("BGT v0.3 GL profile");
        version = string_guest("3.3 core Game Cask"); shading = string_guest("3.30");
        extensions = string_guest("GL_ARB_vertex_array_object GL_ARB_instanced_arrays GL_ARB_framebuffer_object"); }
    switch (ARG(0)) { case 0x1f00: return vendor; case 0x1f01: return renderer; case 0x1f02: return version;
        case 0x8b8c: return shading; case 0x1f03: return extensions; default: fail(BAD_ENUM); return 0; }
}
static uint32_t api_GetStringi(void) {
    static uint32_t ext[3];
    if (ARG(0) != 0x1f03) fail(BAD_ENUM); else if (ARG(1) >= 3) fail(BAD_VALUE);
    else { if (!ext[0]) { ext[0] = string_guest("GL_ARB_vertex_array_object");
            ext[1] = string_guest("GL_ARB_instanced_arrays"); ext[2] = string_guest("GL_ARB_framebuffer_object"); }
        return ext[ARG(1)]; } return 0;
}
static uint32_t query(uint32_t key, int32_t *v) {
    switch (key) {
    case 0x821b: v[0] = 3; break; case 0x821c: v[0] = 3; break; case 0x821d: v[0] = 3; break;
    case 0x9126: v[0] = 1; break; case 0xd33: v[0] = 4096; break; case 0x8869: v[0] = 16; break;
    case 0x8b4d: case 0x8872: case 0x8a2f: v[0] = 8; break;
    case 0x8a34: v[0] = 256; break; case 0x8a30: v[0] = 65536; break;
    case 0x8cdf: case 0x8824: v[0] = 1; break;
    case 0x8b8d: v[0] = (int32_t)program; break; case 0x85b5: v[0] = (int32_t)vao; break;
    case 0x8894: v[0] = (int32_t)array; break; case 0x8895: v[0] = (int32_t)vaos[vao].element; break;
    case 0x8a28: v[0] = (int32_t)uniform; break; case 0x8069: v[0] = (int32_t)tex[active_unit]; break;
    case 0x84e0: v[0] = (int32_t)active_unit + 0x84c0; break; case 0x8ca6: v[0] = (int32_t)fbo; break;
    case 0x8ca7: v[0] = (int32_t)rbo; break; case 0xcf5: v[0] = (int32_t)unpack; break;
    case 0xd05: v[0] = (int32_t)pack; break; case 0xcf2: v[0] = (int32_t)row_length; break;
    case 0xba2: copy(v, viewport, 16); return 4; case 0xc10: copy(v, scissor, 16); return 4;
    case 0xd56: v[0] = 24; break; case 0xd57: v[0] = 8; break;
    case 0xb74: v[0] = (int32_t)depth_compare + 0x200; break;
    case 0x80c9: case 0x80cb: {
        static const int32_t enums[] = {0,1,0x300,0x301,0x306,0x307,0x302,0x303,0x304,0x305,0x8001,0x8002};
        v[0] = enums[key == 0x80c9 ? src_rgb : src_alpha]; break;
    }
    case 0xb72: v[0] = (int32_t)depth_write; break;
    case 0xb91: v[0] = (int32_t)clear_stencil; break;
    case 0xcf3: v[0] = (int32_t)skip_rows; break; case 0xcf4: v[0] = (int32_t)skip_pixels; break;
    default: { uint32_t *p = capability(key); if (!p) { fail(BAD_ENUM); return 0; } v[0] = (int32_t)*p; }
    } return 1;
}
static uint32_t api_GetIntegerv(void) {
    int32_t v[4]; uint32_t n = query(ARG(0), v); for (uint32_t i = 0; i < n; i++) x86_wr32(ARG(1) + i * 4, v[i]);
    return 0;
}
static uint32_t api_GetBooleanv(void) {
    int32_t v[4]; uint32_t n = query(ARG(0), v); for (uint32_t i = 0; i < n; i++) x86_wr8(ARG(1) + i, !!v[i]);
    return 0;
}
static uint32_t api_GetFloatv(void) {
    int32_t v[4]; uint32_t n = query(ARG(0), v);
    for (uint32_t i = 0; i < n; i++) x86_wr32(ARG(1) + i * 4, bits((float)v[i])); return 0;
}
static uint32_t api_GetDoublev(void) {
    int32_t v[4]; uint32_t n = query(ARG(0), v);
    for (uint32_t i = 0; i < n; i++) { union { double d; uint64_t u; } d = {(double)v[i]};
        x86_wr64(ARG(1) + i * 8, d.u); } return 0;
}
static uint32_t api_GetBufferParameteriv(void) {
    Buffer *b = bound_buffer(ARG(0)); if (!b) return 0;
    if (ARG(1) == 0x8764) x86_wr32(ARG(2), b->size);
    else if (ARG(1) == 0x8765) x86_wr32(ARG(2), 0x88e4); else fail(BAD_ENUM); return 0;
}
static uint32_t api_GetBufferSubData(void) {
    Buffer *b = bound_buffer(ARG(0)); if (!b) return 0;
    if ((uint64_t)ARG(1) + ARG(2) > b->size) fail(BAD_VALUE);
    else for (uint32_t i = 0; i < ARG(2); i++) x86_wr8(ARG(3) + i, b->data[ARG(1) + i]); return 0;
}
static uint32_t api_IsBuffer(void) { return ARG(0) < N && buffers[ARG(0)].gpu != 0; }
static uint32_t api_IsTexture(void) { return ARG(0) < N && textures[ARG(0)].gpu != 0; }
static uint32_t api_IsVertexArray(void) { return ARG(0) < N && vaos[ARG(0)].used != 0; }
static uint32_t api_IsShader(void) { return ARG(0) < N && shaders[ARG(0)].used != 0; }
static uint32_t api_IsProgram(void) { return ARG(0) < N && programs[ARG(0)].used != 0; }
static uint32_t api_IsFramebuffer(void) { return ARG(0) < N && fbos[ARG(0)].used != 0; }
static uint32_t api_IsRenderbuffer(void) { return ARG(0) < N && rbos[ARG(0)].used != 0; }
static uint32_t api_IsSampler(void) { return ARG(0) < N && samplers[ARG(0)].used != 0; }
static uint32_t api_ChoosePixelFormat(void) { return ARG(0) && ARG(1) ? 1 : 0; }
static uint32_t api_SetPixelFormat(void) {
    if (!ARG(0) || ARG(1) != 1 || pixel_format) return 0; pixel_format = 1; return 1;
}
static uint32_t api_GetPixelFormat(void) { return pixel_format; }
static uint32_t api_DescribePixelFormat(void) {
    if (ARG(1) != 1) return 0;
    if (ARG(3) && ARG(2) >= 40) { uint32_t p = ARG(3);
        for (uint32_t i = 0; i < 40; i++) x86_wr8(p + i, 0);
        x86_wr16(p, 40); x86_wr16(p + 2, 1); x86_wr32(p + 4, 0x25);
        x86_wr8(p + 9, 32); x86_wr8(p + 10, 8); x86_wr8(p + 12, 8); x86_wr8(p + 14, 8);
        x86_wr8(p + 16, 8); x86_wr8(p + 23, 24); x86_wr8(p + 24, 8);
    } return 1;
}
static uint32_t api_wglCreateContext(void) {
    bgt_gpu_limits_v3_t limits;
    zero(&limits, sizeof limits); bgt_gpu_limits(&limits.base, sizeof limits);
    if (!ARG(0) || !pixel_format || !limits.gpu_supported || !(limits.shader_languages & 2)) return 0;
    if (context) { missing("multiple WGL contexts"); return 0; }
    context = 0x474c0001; viewport[2] = scissor[2] = (int32_t)width();
    viewport[3] = scissor[3] = (int32_t)height(); return context;
}
static uint32_t api_wglCreateContextAttribsARB(void) {
    if (ARG(1)) { missing("WGL context sharing"); return 0; }
    uint32_t p = ARG(2); if (p) for (uint32_t i = 0; i < 64; i++) {
        uint32_t key = x86_rd32(p + i * 8), value = x86_rd32(p + i * 8 + 4); if (!key) break;
        if ((key == 0x2091 && value > 3) || (key == 0x2092 && value > 3) ||
            (key != 0x2091 && key != 0x2092 && key != 0x2094 && key != 0x9126)) return 0;
    }
    /* Upgrade an existing legacy context without allocating a second GPU namespace. */
    if (context) return context; return api_wglCreateContext();
}
static uint32_t api_wglMakeCurrent(void) {
    if (!ARG(0) && !ARG(1)) { current = dc = 0; return 1; }
    if (!ARG(0) || !context || ARG(1) != context) return 0;
    if (!current) w32_gdi_flush_and_present(); current = context; dc = ARG(0); return 1;
}
static uint32_t api_wglGetCurrentContext(void) { return current; }
static uint32_t api_wglGetCurrentDC(void) { return dc; }
static uint32_t api_wglDeleteContext(void) {
    if (!context || ARG(0) != context || current == context) return 0;
    invalidate_pipelines(); context = 0; return 1;
}
static uint32_t api_SwapBuffers(void) { if (!current || ARG(0) != dc) return 0; w32_wait_frame(); return 1; }
static uint32_t api_wglSwapIntervalEXT(void) {
    if (!current || (int32_t)ARG(0) < 0) return 0; interval = ARG(0); return 1;
}
static uint32_t api_wglGetSwapIntervalEXT(void) { return interval; }
static uint32_t api_wglGetExtensionsStringARB(void) {
    static uint32_t s; if (!s) s = string_guest("WGL_ARB_create_context WGL_EXT_swap_control"); return s;
}
static uint32_t api_wglGetProcAddress(void) {
    char name[256]; w32_gstr(ARG(0), 0, name, sizeof name);
    for (uint32_t i = 0; i < w32_api_gl_n; i++)
        if (eq(w32_api_gl[i].name, name)) return w32_thunk_for("opengl32.dll", name);
    uint32_t n = w32_slen(name);
    if (n > 3 && (eq(name + n - 3, "ARB") || eq(name + n - 3, "EXT"))) {
        name[n - 3] = 0;
        for (uint32_t i = 0; i < w32_api_gl_n; i++)
            if (eq(w32_api_gl[i].name, name)) return w32_thunk_for("opengl32.dll", name);
        name[n - 3] = ARG(0) ? (char)x86_rd8(ARG(0) + n - 3) : 0;
    }
    missing(name); return 0;
}
