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
    static char block[512], defaults[512], log[4096];
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
        /* Profile default block: meta vec4 + 1023 vec4 = 16384 bytes, plus one sampler swizzle vec4. */
        snprintf(defaults, sizeof defaults, "#version 330 core\nout vec4 c; uniform vec4 u[1023]; uniform sampler2D t;"
            "void main(){c=u[1022]+texture(t,vec2(0.5));}");
        uint32_t linked = link_fragment(defaults, log, sizeof log);
        CHECK(k ? linked : !linked && strstr(log, "active uniforms exceed GL_MAX_UNIFORM_BLOCK_SIZE")); error = 0;
    }
    native_uniform_limit = 65536;
    CHECK(w32_gl_frontend_bytes == 0);
    puts("uniform limits follow device 16384/65536: GetIntegerv, std140 block and default block link OK");
}
