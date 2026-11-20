/* Original CC0-1.0. K51: guest-visible uniform-block limits follow the active GPU namespace, never a
 * fixed 65536 claim. 16384 is ANGLE Metal's (and the WebGL2/GL 3.3 minimum) MAX_UNIFORM_BLOCK_SIZE. */
static uint32_t link_fragment(const char *fragment, char *log, uint32_t cap) {
    uint32_t v = compile(vertex, 0x8b31), f = compile(fragment, 0x8b30), p = call(api_CreateProgram, 0, 0, 0, 0); CHECK(p);
    call(api_AttachShader, p, v, 0, 0); call(api_AttachShader, p, f, 0, 0); call(api_LinkProgram, p, 0, 0, 0);
    uint32_t linked = programs[p].linked;
    snprintf(log, cap, "%s|%s", shaders[f].log, programs[p].log);
    call(api_DeleteShader, v, 0, 0, 0); call(api_DeleteShader, f, 0, 0, 0); drop(p);
    return linked;
}
static void uniform_limit_cases(void) {
    static char block[512], defaults[1024], log[4096];
    const uint32_t limits[] = {16384, 65536};
    for (uint32_t k = 0; k < 2; k++) {
        native_uniform_limit = limits[k]; uint32_t vec4s = limits[k] / 16, queries = native_limit_queries;
        x86_wr32(4096, 0); call(api_GetIntegerv, 0x8a30, 4096, 0, 0); CHECK(!error && x86_rd32(4096) == limits[k]);
        CHECK(native_limit_queries == queries + 1);
        /* Exactly the limit links; one more std140 vec4 does not, with an explicit limit log. */
        snprintf(block, sizeof block, "#version 330 core\nout vec4 c; layout(std140) uniform Big { vec4 v[%u]; vec4 tail; };"
            "void main(){c=v[%u]+tail;}", vec4s - 1, vec4s - 2);
        CHECK(link_fragment(block, log, sizeof log));
        snprintf(block, sizeof block, "#version 330 core\nout vec4 c; layout(std140) uniform Big { vec4 v[%u]; vec4 tail; };"
            "void main(){c=v[%u]+tail;}", vec4s, vec4s - 1);
        CHECK(!link_fragment(block, log, sizeof log) && strstr(log, "GL_MAX_UNIFORM_BLOCK_SIZE")); error = 0;
        /* Default uniforms GL accepts (ANGLE Metal: 4096 components = 16384 bytes) must link even though the
         * profile's own meta/swizzle words do not fit beside them: they move to a split internal block. */
        static const char *const accepted[] = {
            "#version 330 core\nout vec4 c; uniform vec4 u[1023]; uniform sampler2D t;void main(){c=u[1022]+texture(t,vec2(0.5));}",
            "#version 330 core\nout vec4 c; uniform vec4 u[1024];void main(){c=u[0]+u[1023];}"};
        for (uint32_t a = 0; a < 2; a++) {
            uint32_t v = compile(vertex, 0x8b31), f = compile(accepted[a], 0x8b30), p = call(api_CreateProgram, 0, 0, 0, 0);
            call(api_AttachShader, p, v, 0, 0); call(api_AttachShader, p, f, 0, 0); call(api_LinkProgram, p, 0, 0, 0);
            if (!programs[p].linked) fprintf(stderr, "%s|%s\n", shaders[f].log, programs[p].log);
            CHECK(programs[p].linked);
            const Gp *g = programs[p].info;
            /* Inline only where meta + uniforms + swizzles fit the device block; otherwise split. */
            CHECK(g->split == (k == 0 || a == 1)); CHECK(g->ubytes <= limits[k]);
            if (g->split) CHECK(g->meta_slot == 1 && g->meta_off % 256 == 0 && g->meta_off >= g->ubytes && g->usize == g->meta_off + 16 + 16 * g->nslots);
            call(api_DeleteShader, v, 0, 0, 0); call(api_DeleteShader, f, 0, 0, 0); drop(p);
        }
        /* 7 user blocks leave no binding for a split profile block: where the inline default block does not fit
         * (16384) the link fails explicitly, never overflowing silently; where it fits (65536) it links inline. */
        snprintf(defaults, sizeof defaults, "#version 330 core\nout vec4 c; uniform vec4 u[1023]; uniform sampler2D t;"
            "layout(std140) uniform B0{vec4 b0;}; layout(std140) uniform B1{vec4 b1;}; layout(std140) uniform B2{vec4 b2;};"
            "layout(std140) uniform B3{vec4 b3;}; layout(std140) uniform B4{vec4 b4;}; layout(std140) uniform B5{vec4 b5;};"
            "layout(std140) uniform B6{vec4 b6;}; void main(){c=u[1022]+texture(t,vec2(0.5))+b0+b1+b2+b3+b4+b5+b6;}");
        uint32_t seven = link_fragment(defaults, log, sizeof log);
        CHECK(k ? seven : !seven && strstr(log, "no free binding") && strstr(log, "GL_MAX_UNIFORM_BLOCK_SIZE")); error = 0;
        /* One vec4 beyond the 16384-byte default-uniform storage still fails, on every device. */
        snprintf(defaults, sizeof defaults, "#version 330 core\nout vec4 c; uniform vec4 u[1025];void main(){c=u[0]+u[1024];}");
        CHECK(!link_fragment(defaults, log, sizeof log) && strstr(log, "GL_MAX_UNIFORM_BLOCK_SIZE")); error = 0;
    }
    native_uniform_limit = 65536;
    CHECK(w32_gl_frontend_bytes == 0);
    puts("uniform limits follow device 16384/65536: GetIntegerv, std140 block and default block link OK");
}
