/* Queries and WGL. SPDX-License-Identifier: MIT — LANE-GL */
/* K60: latch_fix is a deferred call's error that preceded the latched validation error (see fail()). */
static uint32_t api_GetError(void) { flush_pending(); uint32_t e = latch_fix ? latch_fix : error; error = latch_fix = 0; return e; }
static uint32_t string_guest(const char *s) {
    uint32_t n = w32_slen(s) + 1, p = w32_misc_alloc(n);
    for (uint32_t i = 0; i < n; i++) x86_wr8(p + i, (uint8_t)s[i]);
    return p;
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
    case 0x8872: v[0] = 8; break;                       /* MAX_TEXTURE_IMAGE_UNITS: §13 sampler slots per pipeline */
    case 0x8b4d: v[0] = GL_TEXTURE_UNITS; break;        /* K62: MAX_COMBINED_TEXTURE_IMAGE_UNITS (glActiveTexture units) */
    case 0x8a2f: v[0] = GL_UBO_BINDINGS; break;         /* K62: MAX_UNIFORM_BUFFER_BINDINGS (binding points) */
    case 0x8a34: v[0] = 256; break; case 0x8a30: v[0] = (int32_t)gl_uniform_limit(); break;
    case 0x8cdf: case 0x8824: v[0] = 4; break;
    case 0x8073: case 0x88ff: v[0] = 256; break; case 0x84e8: v[0] = 4096; break;
    case 0x84fd: case 0x8d57: case 0x910e: case 0x910f: case 0x9110: v[0] = 0; break;
    case 0x806a: v[0] = (int32_t)NAME(textures, tex_bind[1][active_unit]); break;
    case 0x8c1d: v[0] = (int32_t)NAME(textures, tex_bind[2][active_unit]); break;
    case 0x8caa: v[0] = (int32_t)NAME(fbos, fbo_read); break;
    case 0xc01: v[0] = (int32_t)(fbo ? fbos[fbo].draw[0] : dfb_draw); break;
    case 0x8825: case 0x8826: case 0x8827: case 0x8828:
        v[0] = (int32_t)(fbo ? fbos[fbo].draw[key - 0x8825] : key == 0x8825 ? dfb_draw : 0); break;
    case 0xc02: v[0] = (int32_t)(fbo_read ? fbos[fbo_read].read : dfb_read); break;
    case 0xd52: case 0xd53: case 0xd54: case 0xd55: case 0xd56: case 0xd57: {
        /* Bits of the currently bound draw framebuffer's buffers. */
        Target tg; resolve_fbo(fbo, 0, &tg);
        if (!fbo) { v[0] = key == 0xd56 ? 24 : key == 0xd57 ? 8 : 8; break; }
        v[0] = 0;
        if (tg.status == 0x8cd5 && key <= 0xd55 && tg.ncolor && tg.color[0].fmt) v[0] = tg.color[0].fmt->bits[key - 0xd52];
        else if (tg.status == 0x8cd5 && key == 0xd56 && tg.has_depth && tg.ds.fmt) v[0] = tg.ds.fmt->bits[4];
        else if (tg.status == 0x8cd5 && key == 0xd57 && tg.has_stencil && tg.ds.fmt) v[0] = tg.ds.fmt->bits[5];
        break; }
    case 0x8b8d: v[0] = (int32_t)NAME(programs, program); break; case 0x85b5: v[0] = (int32_t)NAME(vaos, vao); break;
    case 0x8f36: v[0] = (int32_t)NAME(buffers, copy_read); break; case 0x8f37: v[0] = (int32_t)NAME(buffers, copy_write); break;
    case 0x88ed: v[0] = (int32_t)NAME(buffers, pixel_pack); break; case 0x88ef: v[0] = (int32_t)NAME(buffers, pixel_unpack); break;
    case 0x8c2a: v[0] = (int32_t)NAME(buffers, texture_buffer); break;
    case 0x8894: v[0] = (int32_t)NAME(buffers, array); break; case 0x8895: v[0] = (int32_t)NAME(buffers, vaos[vao].element); break;
    case 0x8c8f: v[0] = (int32_t)NAME(buffers, tf_buffer); break;
    case 0x8c8a: v[0] = 64; break;
    case 0x8c8b: v[0] = 4; break;
    case 0x8c80: v[0] = 4; break;
    case 0x8a28: v[0] = (int32_t)NAME(buffers, uniform); break; case 0x8069: v[0] = (int32_t)NAME(textures, tex_bind[0][active_unit]); break;
    case 0x8919: v[0] = (int32_t)NAME(samplers, samp[active_unit]); break;
    case 0x84e0: v[0] = (int32_t)active_unit + 0x84c0; break; case 0x8ca6: v[0] = (int32_t)NAME(fbos, fbo); break;
    case 0x8ca7: v[0] = (int32_t)NAME(rbos, rbo); break; case 0xcf5: v[0] = (int32_t)unpack_st.align; break;
    case 0xd05: v[0] = (int32_t)pack_st.align; break; case 0xcf2: v[0] = (int32_t)unpack_st.row_length; break;
    case 0xd02: v[0] = (int32_t)pack_st.row_length; break; case 0xd03: v[0] = (int32_t)pack_st.skip_rows; break;
    case 0xd04: v[0] = (int32_t)pack_st.skip_pixels; break; case 0x806d: v[0] = (int32_t)unpack_st.skip_images; break;
    case 0x806e: v[0] = (int32_t)unpack_st.image_height; break; case 0x806b: v[0] = (int32_t)pack_st.skip_images; break;
    case 0x806c: v[0] = (int32_t)pack_st.image_height; break;
    case 0xcf0: v[0] = (int32_t)unpack_st.swap; break; case 0xcf1: v[0] = (int32_t)unpack_st.lsb; break;
    case 0xd00: v[0] = (int32_t)pack_st.swap; break; case 0xd01: v[0] = (int32_t)pack_st.lsb; break;
    case 0xba2: copy(v, viewport, 16); return 4; case 0xc10: copy(v, scissor, 16); return 4;
    case 0xb74: v[0] = (int32_t)depth_compare + 0x200; break;
    case 0x80c9: case 0x80cb: {
        static const int32_t enums[] = {0,1,0x300,0x301,0x306,0x307,0x302,0x303,0x304,0x305,0x8001,0x8002};
        v[0] = enums[key == 0x80c9 ? src_rgb : src_alpha]; break;
    }
    case 0xb72: v[0] = (int32_t)depth_write; break;
    case 0xb91: v[0] = (int32_t)clear_stencil; break;
    case 0xcf3: v[0] = (int32_t)unpack_st.skip_rows; break; case 0xcf4: v[0] = (int32_t)unpack_st.skip_pixels; break;
    /* K61: state and limits engines query at start-up or per frame (all previously GL_INVALID_ENUM). */
    case 0x80c8: case 0x80ca: {
        static const int32_t enums[] = {0,1,0x300,0x301,0x306,0x307,0x302,0x303,0x304,0x305,0x8001,0x8002};
        v[0] = enums[key == 0x80c8 ? dst_rgb : dst_alpha]; break;
    }
    case 0x8009: case 0x883d: {
        static const int32_t ops[] = {0x8006, 0x800a, 0x800b, 0x8007, 0x8008};
        v[0] = ops[key == 0x8009 ? blend_op_rgb : blend_op_alpha]; break;
    }
    case 0xc23: for (uint32_t i = 0; i < 4; i++) v[i] = (int32_t)((color_masks[0] >> i) & 1); return 4;
    case 0xb45: v[0] = cull_face == 1 ? 0x404 : cull_face == 2 ? 0x405 : 0x408; break;
    case 0xb46: v[0] = front_face ? 0x900 : 0x901; break;
    case 0xb92: v[0] = (int32_t)stencil_compare + 0x200; break; case 0x8800: v[0] = (int32_t)back_compare + 0x200; break;
    case 0xb93: v[0] = (int32_t)stencil_read; break; case 0x8ca4: v[0] = (int32_t)back_read; break;
    case 0xb97: v[0] = (int32_t)stencil_ref; break; case 0x8ca3: v[0] = (int32_t)back_ref; break;
    case 0xb98: v[0] = (int32_t)stencil_write; break; case 0x8ca5: v[0] = (int32_t)back_write; break;
    case 0xb94: case 0xb95: case 0xb96: case 0x8801: case 0x8802: case 0x8803: {
        static const int32_t ops[] = {0x1e00, 0, 0x1e01, 0x1e02, 0x1e03, 0x150a, 0x8507, 0x8508};
        uint32_t o = key == 0xb94 ? stencil_fail : key == 0xb95 ? stencil_zfail : key == 0xb96 ? stencil_pass :
            key == 0x8801 ? back_fail : key == 0x8802 ? back_zfail : back_pass;
        v[0] = ops[o]; break;
    }
    case 0xb40: v[0] = v[1] = (int32_t)polygon_mode; return 2;
    case 0xc52: case 0xc53: case 0x84ef: case 0x8b8b: v[0] = (int32_t)hints[hint_slot(key)]; break;
    case 0x8f9e: v[0] = (int32_t)restart_index; break;
    case 0x846e: case 0xb22: case 0xb12: v[0] = v[1] = 1; return 2; /* ALIASED/SMOOTH_LINE_WIDTH_RANGE, POINT_SIZE_RANGE */
    case 0xb23: case 0xb13: v[0] = 0; break;                       /* line width / point size granularity */
    /* K62: viewports may exceed the target (both backends clip exactly); glViewport clamps to this. */
    case 0xd3a: v[0] = v[1] = GL_MAX_VIEWPORT; return 2;            /* MAX_VIEWPORT_DIMS */
    /* K62: cube-map and rectangle targets are not implemented (glBindTexture/glTexImage2D raise GL_INVALID_ENUM),
     * so no size is supported: 0, below GL 3.3's 1024 (documented gap, see docs/handoff/K62.md). */
    case 0x851c: case 0x84f8: v[0] = 0; break;                      /* MAX_CUBE_MAP_TEXTURE_SIZE, MAX_RECTANGLE_TEXTURE_SIZE */
    case 0x8514: v[0] = 0; break;                                    /* TEXTURE_BINDING_CUBE_MAP (no cube maps bound) */
    case 0x80e8: case 0x80e9: v[0] = 1 << 20; break;                /* MAX_ELEMENTS_VERTICES/INDICES (advisory) */
    case 0x8b4a: case 0x8b49: v[0] = (int32_t)(gl_uniform_limit() / 4); break; /* MAX_*_UNIFORM_COMPONENTS */
    case 0x8dfb: case 0x8dfd: v[0] = (int32_t)(gl_uniform_limit() / 16); break; /* MAX_*_UNIFORM_VECTORS */
    case 0x8a2b: case 0x8a2d: v[0] = 7; break; case 0x8a2e: v[0] = 7; break; /* MAX_VERTEX/FRAGMENT/COMBINED_UNIFORM_BLOCKS */
    case 0x8b4c: v[0] = 8; break;                                    /* MAX_VERTEX_TEXTURE_IMAGE_UNITS */
    /* K62: the backend's guaranteed varying capacity (packed on WebGPU, GLSL ES rows on WebGL 2); the vertex outputs
     * and fragment inputs add gl_Position / gl_FragCoord. Links above it fail with an info log. */
    case 0x8b4b: v[0] = (int32_t)gl_varying_limit(); break;          /* MAX_VARYING_COMPONENTS */
    case 0x9122: case 0x9125: v[0] = (int32_t)gl_varying_limit() + 4; break; /* MAX_VERTEX_OUTPUT / FRAGMENT_INPUT_COMPONENTS */
    case 0x8a31: case 0x8a33:                                         /* MAX_COMBINED_VERTEX/FRAGMENT_UNIFORM_COMPONENTS */
        v[0] = (int32_t)(2 * gl_uniform_limit()); break;              /* 7 blocks x limit/4 + limit/4 default */
    case 0xd50: v[0] = 4; break;                                     /* SUBPIXEL_BITS: the floor of every backend */
    case 0x8c2b: v[0] = 0; break;                                    /* MAX_TEXTURE_BUFFER_SIZE: no buffer textures */
    case 0x8e59: v[0] = 0; break;                                    /* MAX_SAMPLE_MASK_WORDS: single-sampled */
    case 0x8904: case 0x8905: v[0] = 0; break;                       /* MIN/MAX_PROGRAM_TEXEL_OFFSET: offset lookups untranslated */
    case 0x8e4f: v[0] = provoking_first ? 0x8e4d : 0x8e4e; break;    /* K62: PROVOKING_VERTEX */
    case 0xd32: v[0] = 8; break;                                     /* MAX_CLIP_DISTANCES (enabling one is a counted approximation) */
    case 0x88fc: v[0] = 0; break;                                    /* MAX_DUAL_SOURCE_DRAW_BUFFERS */
    case 0x86a2: v[0] = 0; break;                                    /* NUM_COMPRESSED_TEXTURE_FORMATS */
    case 0x821e: v[0] = 0; break;                                    /* CONTEXT_FLAGS */
    case 0x80a8: case 0x80a9: v[0] = 0; break;                       /* SAMPLE_BUFFERS, SAMPLES: single-sampled */
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
    if (ARG(0) == 0xc22) { for (uint32_t i = 0; i < 4; i++) x86_wr32(ARG(1) + i * 4, bits(clear_color[i])); return 0; }
    if (ARG(0) == 0xb73) { x86_wr32(ARG(1), bits(clear_depth)); return 0; }
    /* K61: float state */
    if (ARG(0) == 0x8005) { for (uint32_t i = 0; i < 4; i++) x86_wr32(ARG(1) + i * 4, bits(blend_color[i])); return 0; }
    if (ARG(0) == 0xb70) { x86_wr32(ARG(1), bits(range_min)); x86_wr32(ARG(1) + 4, bits(range_max)); return 0; }
    if (ARG(0) == 0xb21) { x86_wr32(ARG(1), bits(line_width)); return 0; }
    if (ARG(0) == 0xb11) { x86_wr32(ARG(1), bits(point_size)); return 0; }
    if (ARG(0) == 0x8038) { x86_wr32(ARG(1), bits(offset_factor)); return 0; }
    if (ARG(0) == 0x2a00) { x86_wr32(ARG(1), bits(offset_units)); return 0; }
    int32_t v[4]; uint32_t n = query(ARG(0), v);
    for (uint32_t i = 0; i < n; i++) x86_wr32(ARG(1) + i * 4, bits((float)v[i]));
    return 0;
}
static uint32_t api_GetDoublev(void) {
    int32_t v[4]; uint32_t n = query(ARG(0), v);
    for (uint32_t i = 0; i < n; i++) { union { double d; uint64_t u; } d = {(double)v[i]};
        x86_wr64(ARG(1) + i * 8, d.u); } return 0;
}
static int buffer_parameter(uint32_t *v) {
    Buffer *b = bound_buffer(ARG(0)); if (!b) return 0;
    if (ARG(1) == 0x8764) *v = b->size;
    else if (ARG(1) == 0x8765) *v = 0x88e4;
    else if (ARG(1) == 0x88bc) *v = !!b->map;
    else if (ARG(1) == 0x88bb) *v = b->map_access ? b->map_access : 0x88ba;
    else if (ARG(1) == 0x911f) *v = b->map_flags;
    else if (ARG(1) == 0x9120) *v = b->map_size;
    else if (ARG(1) == 0x9121) *v = b->map_offset;
    else { fail(BAD_ENUM); return 0; }
    return 1;
}
static uint32_t api_GetBufferParameteriv(void) { uint32_t v; if (buffer_parameter(&v)) x86_wr32(ARG(2), v); return 0; }
static uint32_t api_GetBufferParameteri64v(void) { uint32_t v; if (buffer_parameter(&v)) x86_wr64(ARG(2), v); return 0; }
static uint32_t api_GetInteger64v(void) {
    if (ARG(0) == 0x9111) { x86_wr64(ARG(1), 0); return 0; } /* MAX_SERVER_WAIT_TIMEOUT */
    int32_t v[4]; uint32_t n = query(ARG(0), v);
    for (uint32_t i = 0; i < n; i++) x86_wr64(ARG(1) + i * 8, (uint64_t)(int64_t)v[i]);
    return 0;
}
/* K61: sync objects (GL 3.3 §5.2). The profile's command stream is ordered and every guest-visible result
 * (readbacks, query results, buffer reads) is produced in stream order when the guest asks for it, so every
 * command before a fence is complete as far as the guest can observe: a fence is signaled when created. */
#define SYNC_TAG 0x5c000000u
static uint8_t syncs[4096]; static uint32_t sync_next;
static uint32_t sync_slot(uint64_t h) {
    if ((h & ~(uint64_t)0xfffu) != SYNC_TAG) return 0;
    uint32_t i = (uint32_t)h & 0xfffu; return i && syncs[i] ? i : 0;
}
static uint32_t api_FenceSync(void) {
    if (ARG(0) != 0x9117) { fail(BAD_ENUM); return 0; }
    if (ARG(1)) { fail(BAD_VALUE); return 0; }
    for (uint32_t n = 0; n < 4095; n++) {
        uint32_t i = 1 + (sync_next + n) % 4095;
        if (!syncs[i]) { syncs[i] = 1; sync_next = i; return SYNC_TAG | i; }
    }
    fail(OOM); return 0;
}
static uint32_t api_IsSync(void) { return sync_slot(ARG64(0)) != 0; }
static uint32_t api_DeleteSync(void) {
    uint64_t h = ARG64(0); if (!h) return 0;
    uint32_t i = sync_slot(h); if (!i) fail(BAD_VALUE); else syncs[i] = 0;
    return 0;
}
static uint32_t api_ClientWaitSync(void) {
    if (!sync_slot(ARG64(0)) || (ARG(1) & ~1u)) { fail(BAD_VALUE); return 0x911d; } /* WAIT_FAILED */
    return 0x911a; /* ALREADY_SIGNALED */
}
static uint32_t api_WaitSync(void) {
    uint64_t timeout = W32_64 ? ARG64(2) : ((uint64_t)ARG(3) << 32 | ARG(2));
    if (!sync_slot(ARG64(0)) || ARG(1) || timeout != ~(uint64_t)0) fail(BAD_VALUE);
    return 0;
}
static uint32_t api_GetSynciv(void) {
    if (!sync_slot(ARG64(0))) { fail(BAD_VALUE); return 0; }
    uint32_t v;
    switch (ARG(1)) { case 0x9112: v = 0x9116; break; case 0x9113: v = 0x9117; break;
        case 0x9114: v = 0x9119; break; case 0x9115: v = 0; break; default: fail(BAD_ENUM); return 0; }
    int32_t cap = (int32_t)ARG(2); uint32_t length = ARG(3), values = ARG(4);
    if (cap < 0) { fail(BAD_VALUE); return 0; }
    if (cap >= 1) x86_wr32(values, v);
    if (length) x86_wr32(length, cap >= 1 ? 1 : 0);
    return 0;
}
static uint32_t api_GetBufferSubData(void) {
    Buffer *b = bound_buffer(ARG(0)); if (!b) return 0;
    if (b->map) { fail(BAD_OP); return 0; }
    uint64_t offset = ARG64(1), size = ARG64(2);
    if (offset + size < offset || offset + size > b->size) { fail(BAD_VALUE); return 0; }
    if (!size) return 0;
    if (tf_active) for (uint32_t i = 0; i < 4; i++) if (tf_bound[i] == (uint32_t)(b - buffers)) { fail(BAD_OP); return 0; }
    if (b->generated) {
        uint32_t req = ++request_id; SEND(0x63, b->gpu, (uint32_t)offset, (uint32_t)size, req);
        int status; while ((status = request_status(req)) == 0) w32_wait_transport();
        uint8_t *data = glp_alloc((uint32_t)size);
        int n = data && status > 0 ? bgt_request_read(req, data, (uint32_t)size) : -1; bgt_request_close(req);
        if (n != (int)size) fail(BAD_OP);
        else for (uint32_t i = 0; i < size; i++) x86_wr8(ARG(3) + i, data[i]);
        glp_free(data, (uint32_t)size);
    } else for (uint32_t i = 0; i < size; i++) x86_wr8(ARG(3) + i, b->data[offset + i]); return 0;
}
static uint32_t api_IsBuffer(void) { return SLOT(buffers, ARG(0)) < BN && buffers[SLOT(buffers, ARG(0))].bound != 0; }
static uint32_t api_IsTexture(void) { return SLOT(textures, ARG(0)) && SLOT(textures, ARG(0)) < N && textures[SLOT(textures, ARG(0))].kind1 != 0; }
static uint32_t api_IsVertexArray(void) { return SLOT(vaos, ARG(0)) < VN && vaos[SLOT(vaos, ARG(0))].bound != 0; }
static uint32_t api_IsShader(void) { return SLOT(shaders, ARG(0)) < N && shaders[SLOT(shaders, ARG(0))].used != 0; }
static uint32_t api_IsProgram(void) { return SLOT(programs, ARG(0)) < N && programs[SLOT(programs, ARG(0))].used != 0; }
static uint32_t api_IsFramebuffer(void) { return SLOT(fbos, ARG(0)) && SLOT(fbos, ARG(0)) < N && fbos[SLOT(fbos, ARG(0))].bound != 0; }
static uint32_t api_IsRenderbuffer(void) { return SLOT(rbos, ARG(0)) < N && rbos[SLOT(rbos, ARG(0))].bound != 0; }
static uint32_t api_IsSampler(void) { return SLOT(samplers, ARG(0)) < N && samplers[SLOT(samplers, ARG(0))].used != 0; }
static uint32_t api_ChoosePixelFormat(void) { return ARG(0) && ARG(1) ? 1 : 0; }
static uint32_t api_SetPixelFormat(void) {
    if (!ARG(0) || ARG(1) != 1 || pixel_format) return 0;
    pixel_format = 1; return 1;
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
    if (limits.gpu_budget_bytes) upload_budget = limits.gpu_budget_bytes;
    if (context) { missing("multiple WGL contexts"); return 0; }
    if ((w32_io->caps & BGT_CAP_GPU_BUFFER_HANDLES) && bgt_gpu_buffer_handles() == 0) buffer_handles_enabled = 1;
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
    if (context) return context;
    return api_wglCreateContext();
}
static uint32_t api_wglMakeCurrent(void) {
    if (!ARG(0) && !ARG(1)) { current = dc = 0; return 1; }
    if (!ARG(0) || !context || ARG(1) != context) return 0;
    if (!current) w32_gdi_flush_and_present();
    current = context; dc = ARG(0); return 1;
}
static uint32_t api_wglGetCurrentContext(void) { return current; }
static uint32_t api_wglGetCurrentDC(void) { return dc; }
static uint32_t api_wglDeleteContext(void) {
    if (!context || ARG(0) != context || current == context) return 0;
    invalidate_pipelines(); context = 0; return 1;
}
static uint32_t api_SwapBuffers(void) {
    if (!current || ARG(0) != dc) return 0;
    if (!interval) { present_interval0(); return 1; }
    flush_pending(); /* I17: K53's batch joins the ordered queue (journal first if deferring) before the present */
    if (journal_len && !journal_fits_frame()) w32_wait_transport(); /* resume submits it */
    journal_submit(); exposed = 0; deferring = 0; guest_frame = (gpu_usage_t){0};
    w32_clock_present(interval); w32_guest_present(1); w32_wait_present(); return 1;
}
static uint32_t api_wglSwapIntervalEXT(void) {
    if (!current || (int32_t)ARG(0) < 0) return 0;
    interval = ARG(0); return 1;
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
