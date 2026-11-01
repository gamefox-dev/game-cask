/* Original CC0-1.0 fixture. Real -O2/CRT Win64 program; no BGT imports or overrides.
 * Eight tiles exercise GLSL preprocessing, GL 3.3 reflection and the translation to both browser backends.
 * Reflection is asserted inside the guest against GL 3.3 rules; pixels are asserted by the browser tests. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "glsl_entries.h"

static void check(int ok, const char *message) {
    if (!ok) { OutputDebugStringA(message); ExitProcess(10); }
}
static char *load(const char *name) {
    HANDLE file = CreateFileA(name, GENERIC_READ, FILE_SHARE_READ, 0, OPEN_EXISTING, 0, 0);
    check(file != INVALID_HANDLE_VALUE, name);
    char *text = malloc(65536); DWORD got = 0;
    check(text && ReadFile(file, text, 65535, &got, 0), "asset read failed");
    text[got] = 0; CloseHandle(file); return text;
}
static GLuint compile(GLenum stage, int count, const char **src, int expect_ok, const char *needle) {
    GLuint id = glCreateShader(stage); glShaderSource(id, count, src, 0); glCompileShader(id);
    GLint ok = 0; char log[2048]; glGetShaderiv(id, GL_COMPILE_STATUS, &ok);
    glGetShaderInfoLog(id, sizeof log, 0, log);
    if (ok != expect_ok) { OutputDebugStringA(log); }
    check(ok == expect_ok, expect_ok ? "shader failed to compile" : "shader unexpectedly compiled");
    if (needle) { if (!strstr(log, needle)) OutputDebugStringA(log); check(strstr(log, needle) != 0, "info log lacks the expected text"); }
    return id;
}
static GLuint link_program(GLuint vs, GLuint fs, int expect_ok, const char *needle, GLuint existing) {
    GLuint p = existing ? existing : glCreateProgram();
    glAttachShader(p, vs); glAttachShader(p, fs); glLinkProgram(p);
    GLint ok = 0; char log[2048]; glGetProgramiv(p, GL_LINK_STATUS, &ok); glGetProgramInfoLog(p, sizeof log, 0, log);
    if (ok != expect_ok) OutputDebugStringA(log);
    check(ok == expect_ok, expect_ok ? "program failed to link" : "program unexpectedly linked");
    if (needle) { if (!strstr(log, needle)) OutputDebugStringA(log); check(strstr(log, needle) != 0, "link log lacks the expected text"); }
    return p;
}
static int active_uniform(GLuint p, const char *name, GLenum *type, GLint *size) {
    GLint n = 0; glGetProgramiv(p, GL_ACTIVE_UNIFORMS, &n);
    for (GLint i = 0; i < n; i++) {
        char buf[128]; GLsizei len = 0; GLint sz = 0; GLenum ty = 0;
        glGetActiveUniform(p, (GLuint)i, sizeof buf, &len, &sz, &ty, buf);
        check((GLsizei)strlen(buf) == len, "active uniform length mismatch");
        if (!strcmp(buf, name)) { *type = ty; *size = sz; return i; }
    }
    return -1;
}
static void expect_uniform(GLuint p, const char *name, GLenum type, GLint size) {
    GLenum ty = 0; GLint sz = 0; int index = active_uniform(p, name, &ty, &sz);
    if (index < 0) OutputDebugStringA(name);
    check(index >= 0, "expected active uniform is missing");
    if (ty != type || sz != size) OutputDebugStringA(name);
    check(ty == type && sz == size, "active uniform type or size is wrong");
}
static void put_f(unsigned char *b, int off, float v) { memcpy(b + off, &v, 4); }
static void put_u(unsigned char *b, int off, unsigned v) { memcpy(b + off, &v, 4); }

int main(void) {
    WNDCLASSA cls = {0}; cls.lpfnWndProc = DefWindowProcA; cls.lpszClassName = "GLSLFixture";
    RegisterClassA(&cls);
    HWND window = CreateWindowExA(0, cls.lpszClassName, "OpenGL", WS_VISIBLE | WS_POPUP, 0, 0, 320, 200, 0, 0, 0, 0);
    HDC dc = GetDC(window); PIXELFORMATDESCRIPTOR desc = {0}; desc.nSize = sizeof desc; desc.nVersion = 1;
    desc.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    desc.cColorBits = 32; desc.cDepthBits = 24; desc.cStencilBits = 8;
    int format = ChoosePixelFormat(dc, &desc);
    check(format && SetPixelFormat(dc, format, &desc), "pixel format failed");
    HGLRC context = wglCreateContext(dc);
    if (!context) { OutputDebugStringA("x64-glsl GPU unavailable (requires GLSL330 command backend)"); for (;;) Sleep(16); }
    check(wglMakeCurrent(dc, context), "make current failed"); load_gl();

    char *quad = load("quad.vert"), *t0 = load("tile0.frag"), *t1 = load("tile1.frag"), *t2 = load("tile2.frag");
    char *t3 = load("tile3.frag"), *v4 = load("tile4.vert"), *t4 = load("tile4.frag"), *var = load("variant.frag");
    char *t7 = load("tile7.frag");
    const char *head = "#version 330 core\n";

    /* ---- diagnostics with GL semantics: compile and link failures report through info logs */
    const char *bad_error[] = {"#version 330 core\n#ifdef GL_core_profile\n#error core profile reached\n#endif\nvoid main(){}\n"};
    compile(GL_FRAGMENT_SHADER, 1, bad_error, 0, "#error");
    const char *bad_if[] = {"#version 330 core\n#if 1\nvoid main(){}\n"};
    compile(GL_FRAGMENT_SHADER, 1, bad_if, 0, "unterminated");
    const char *bad_type[] = {"#version 330 core\nuniform nosuchtype x;\nvoid main(){}\n"};
    compile(GL_FRAGMENT_SHADER, 1, bad_type, 0, "unknown type");
    const char *bad_macro[] = {"#version 330 core\n#define F(a,b) a+b\nint x = F(1);\nvoid main(){}\n"};
    compile(GL_FRAGMENT_SHADER, 1, bad_macro, 0, "arguments");
    const char *no_version[] = {"void main(){}\n"};
    compile(GL_FRAGMENT_SHADER, 1, no_version, 0, "#version");
    const char *late_version[] = {"#define A 1\n", "#version 330 core\nvoid main(){}\n"};
    compile(GL_FRAGMENT_SHADER, 2, late_version, 0, "#version must occur first");
    const char *mismatch_fs[] = {"#version 330 core\nin vec3 tc;\nout vec4 c;\nvoid main(){c=vec4(tc,1.0);}\n"};
    const char *mismatch_uf[] = {"#version 330 core\nuniform vec3 shift;\nin vec2 tc;\nout vec4 c;\nvoid main(){c=vec4(tc,shift.x,1.0);}\n"};
    const char *vs_src[] = {quad};
    GLuint good_vs = compile(GL_VERTEX_SHADER, 1, vs_src, 1, 0);
    GLuint mm1 = compile(GL_FRAGMENT_SHADER, 1, mismatch_fs, 1, 0);
    link_program(good_vs, mm1, 0, "types differ", 0);
    GLuint mm2 = compile(GL_FRAGMENT_SHADER, 1, mismatch_uf, 1, 0);
    link_program(good_vs, mm2, 0, "different types", 0);
    const char *unsup[] = {"#version 330 core\nuniform sampler3D volume;\nout vec4 c;\nvoid main(){c=texture(volume, vec3(0.5));}\n"};
    compile(GL_FRAGMENT_SHADER, 1, unsup, 0, "not supported");   /* active sampler3D: BGT has only 2D textures */
    OutputDebugStringA("x64-glsl diagnostics ok");

    /* ---- the tile programs */
    GLuint fs0 = compile(GL_FRAGMENT_SHADER, 1, (const char *[]){t0}, 1, 0);
    GLuint fs1 = compile(GL_FRAGMENT_SHADER, 1, (const char *[]){t1}, 1, 0);
    GLuint fs2 = compile(GL_FRAGMENT_SHADER, 1, (const char *[]){t2}, 1, 0);
    GLuint fs3 = compile(GL_FRAGMENT_SHADER, 1, (const char *[]){t3}, 1, 0);
    GLuint fs7 = compile(GL_FRAGMENT_SHADER, 1, (const char *[]){t7}, 1, 0);
    GLuint vs4 = compile(GL_VERTEX_SHADER, 1, (const char *[]){v4}, 1, 0);
    GLuint fs4 = compile(GL_FRAGMENT_SHADER, 1, (const char *[]){t4}, 1, 0);
    GLuint fs5 = compile(GL_FRAGMENT_SHADER, 3, (const char *[]){head, "#define VARIANT 2\n", var}, 1, 0);
    GLuint fs6 = compile(GL_FRAGMENT_SHADER, 3, (const char *[]){head, "#define VARIANT 1\n", var}, 1, 0);
    GLuint p0 = link_program(good_vs, fs0, 1, 0, 0), p1 = link_program(good_vs, fs1, 1, 0, 0);
    GLuint p2 = link_program(good_vs, fs2, 1, 0, 0), p3 = link_program(good_vs, fs3, 1, 0, 0);
    GLuint p5 = link_program(good_vs, fs5, 1, 0, 0), p6 = link_program(good_vs, fs6, 1, 0, 0);
    GLuint p7 = link_program(good_vs, fs7, 1, 0, 0);
    GLuint p4 = glCreateProgram();
    glBindAttribLocation(p4, 3, "pos"); glBindAttribLocation(p4, 1, "coord");
    glBindFragDataLocation(p4, 0, "shade");
    link_program(vs4, fs4, 1, 0, p4);

    /* ---- reflection against GL 3.3 rules */
    GLint count = 0;
    glGetProgramiv(p0, GL_ACTIVE_UNIFORMS, &count); check(count == 12, "tile0 active uniform count");
    expect_uniform(p0, "selector", GL_INT, 1); expect_uniform(p0, "shift", GL_FLOAT_VEC2, 1);
    expect_uniform(p0, "extent", GL_FLOAT_VEC2, 1);
    expect_uniform(p0, "lights[0].color", GL_FLOAT_VEC3, 1); expect_uniform(p0, "lights[2].weight", GL_FLOAT, 1);
    expect_uniform(p0, "gains[0]", GL_FLOAT, 4); expect_uniform(p0, "boost", GL_BOOL, 1);
    expect_uniform(p0, "swap_rb", GL_FLOAT_MAT3, 1);
    check(glGetUniformLocation(p0, "never_used") == -1 && glGetUniformLocation(p0, "unused_gain") == -1, "inactive uniforms");
    GLint gains = glGetUniformLocation(p0, "gains"), gains0 = glGetUniformLocation(p0, "gains[0]");
    check(gains >= 0 && gains == gains0, "array base location");
    check(glGetUniformLocation(p0, "gains[3]") == gains + 3 && glGetUniformLocation(p0, "gains[4]") == -1, "array element locations");
    GLint l1pos = glGetUniformLocation(p0, "lights[1].color"), l1w = glGetUniformLocation(p0, "lights[1].weight");
    check(l1pos >= 0 && l1w >= 0 && l1pos != l1w, "structure member locations");
    GLuint idx[2]; const char *names[2] = {"lights[1].weight", "nonexistent"};
    glGetUniformIndices(p0, 2, names, idx); check(idx[0] != GL_INVALID_INDEX && idx[1] == GL_INVALID_INDEX, "uniform indices");
    GLint na = 0, nb = 0; glGetProgramiv(p0, GL_ACTIVE_ATTRIBUTES, &na); glGetProgramiv(p0, GL_ACTIVE_UNIFORM_BLOCKS, &nb);
    check(na == 2 && nb == 0, "tile0 attribute and block counts");
    GLint pos_loc = glGetAttribLocation(p0, "position"), uv_loc = glGetAttribLocation(p0, "uv");
    check(pos_loc == 0 && uv_loc == 1, "attribute locations (explicit layout, then lowest free)");
    { char nm[32]; GLsizei l; GLint sz; GLenum ty; glGetActiveAttrib(p0, 0, sizeof nm, &l, &sz, &ty, nm);
      check(!strcmp(nm, "position") && ty == GL_FLOAT_VEC2 && sz == 1, "active attribute"); }

    glGetProgramiv(p1, GL_ACTIVE_UNIFORM_BLOCKS, &nb); check(nb == 1, "tile1 block count");
    GLuint block = glGetUniformBlockIndex(p1, "Params");
    check(block != GL_INVALID_INDEX && glGetUniformBlockIndex(p1, "params") == GL_INVALID_INDEX, "block names use the block name");
    GLint block_size = 0, block_members = 0, block_binding = -1;
    glGetActiveUniformBlockiv(p1, block, GL_UNIFORM_BLOCK_DATA_SIZE, &block_size);
    glGetActiveUniformBlockiv(p1, block, GL_UNIFORM_BLOCK_ACTIVE_UNIFORMS, &block_members);
    glGetActiveUniformBlockiv(p1, block, GL_UNIFORM_BLOCK_BINDING, &block_binding);
    check(block_size == 128 && block_members == 6 && block_binding == 0, "std140 block size, members, default binding");
    {
        const char *member[] = {"Params.tint", "Params.coef[0]", "Params.ramp.range", "Params.ramp.bias", "Params.enabled", "Params.m2"};
        const GLint want[] = {0, 16, 64, 72, 80, 96};
        GLuint mi[6]; glGetUniformIndices(p1, 6, member, mi);
        GLint off[6], stride[6], mstride[6], blk[6], type[6], size[6];
        for (int i = 0; i < 6; i++) check(mi[i] != GL_INVALID_INDEX, "block member index");
        glGetActiveUniformsiv(p1, 6, mi, GL_UNIFORM_OFFSET, off); glGetActiveUniformsiv(p1, 6, mi, GL_UNIFORM_ARRAY_STRIDE, stride);
        glGetActiveUniformsiv(p1, 6, mi, GL_UNIFORM_MATRIX_STRIDE, mstride); glGetActiveUniformsiv(p1, 6, mi, GL_UNIFORM_BLOCK_INDEX, blk);
        glGetActiveUniformsiv(p1, 6, mi, GL_UNIFORM_TYPE, type); glGetActiveUniformsiv(p1, 6, mi, GL_UNIFORM_SIZE, size);
        for (int i = 0; i < 6; i++) { if (off[i] != want[i]) OutputDebugStringA(member[i]); check(off[i] == want[i], "std140 offset"); }
        check(stride[1] == 16 && size[1] == 3 && type[1] == GL_FLOAT, "std140 scalar array stride");
        check(mstride[5] == 16 && type[5] == GL_FLOAT_MAT2 && type[4] == GL_BOOL, "mat2 matrix stride");
        check(blk[0] == (GLint)block && stride[0] == 0, "block membership");
        GLint default_off; GLuint di; const char *dn[] = {"shift"}; glGetUniformIndices(p1, 1, dn, &di);
        glGetActiveUniformsiv(p1, 1, &di, GL_UNIFORM_OFFSET, &default_off);
        check(default_off == -1 && glGetUniformLocation(p1, "Params.tint") == -1, "default-block queries");
    }
    check(glGetAttribLocation(p4, "pos") == 3 && glGetAttribLocation(p4, "coord") == 1, "glBindAttribLocation");
    check(glGetAttribLocation(p4, "unused_attr") == -1, "inactive attribute");
    check(glGetFragDataLocation(p4, "shade") == 0, "glBindFragDataLocation");
    glGetProgramiv(p4, GL_ACTIVE_ATTRIBUTES, &na); check(na == 2, "tile4 attribute count");
    glGetProgramiv(p3, GL_ACTIVE_UNIFORMS, &count); expect_uniform(p3, "pair[0]", GL_SAMPLER_2D, 2);
    check(glGetUniformLocation(p3, "ghost") == -1, "inactive sampler");
    { GLint mx = 0; glGetProgramiv(p0, GL_ACTIVE_UNIFORM_MAX_LENGTH, &mx); check(mx == 17, "max uniform name length (lights[0].weight)"); }
    OutputDebugStringA("x64-glsl reflection ok");

    /* ---- geometry: position (x, y) and uv, interleaved */
    const GLfloat quad_data[] = {-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1};
    GLuint vao_a, vao_b, vbo; glGenVertexArrays(1, &vao_a); glGenBuffers(1, &vbo);
    glBindBuffer(GL_ARRAY_BUFFER, vbo); glBufferData(GL_ARRAY_BUFFER, sizeof quad_data, quad_data, GL_STATIC_DRAW);
    glBindVertexArray(vao_a);
    glVertexAttribPointer((GLuint)pos_loc, 2, GL_FLOAT, GL_FALSE, 16, 0); glEnableVertexAttribArray((GLuint)pos_loc);
    glVertexAttribPointer((GLuint)uv_loc, 2, GL_FLOAT, GL_FALSE, 16, (void *)8); glEnableVertexAttribArray((GLuint)uv_loc);
    glGenVertexArrays(1, &vao_b); glBindVertexArray(vao_b); glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glVertexAttribPointer(3, 2, GL_FLOAT, GL_FALSE, 16, 0); glEnableVertexAttribArray(3);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 16, (void *)8); glEnableVertexAttribArray(1);

    /* ---- uniform state */
    GLuint programs[8] = {p0, p1, p2, p3, p4, p5, p6, p7};
    for (int i = 0; i < 8; i++) if (i != 4) {
        glUseProgram(programs[i]);
        glUniform2f(glGetUniformLocation(programs[i], "extent"), 1, 1); glUniform2f(glGetUniformLocation(programs[i], "shift"), 0, 0);
        glUniform1i(glGetUniformLocation(programs[i], "selector"), i == 2 ? 3 : 0);
    }
    glUseProgram(p0);
    { const GLfloat colors[] = {1,0,0, 0,1,0, 0,0,1}, weights[] = {0.25f, 0.5f, 0.75f};
      for (int i = 0; i < 3; i++) {
          char n[32]; snprintf(n, sizeof n, "lights[%d].color", i); glUniform3f(glGetUniformLocation(p0, n), colors[i*3], colors[i*3+1], colors[i*3+2]);
          snprintf(n, sizeof n, "lights[%d].weight", i); glUniform1f(glGetUniformLocation(p0, n), weights[i]);
      }
      const GLfloat g[] = {0.1f, 0.2f, 0.5f, 0.9f}; glUniform1fv(gains, 4, g);
      glUniform1i(glGetUniformLocation(p0, "boost"), 1);
      const GLfloat swap[] = {0,0,1, 0,1,0, 1,0,0}; glUniformMatrix3fv(glGetUniformLocation(p0, "swap_rb"), 1, GL_FALSE, swap);
      GLfloat back[4]; glGetUniformfv(p0, gains + 2, back); check(back[0] == 0.5f, "uniform read-back");
      glGetUniformfv(p0, glGetUniformLocation(p0, "boost"), back); check(back[0] == 1.0f, "bool read-back");
    }
    glUseProgram(p2); glUniform2f(glGetUniformLocation(p2, "origin"), 160, 100);
    unsigned char ubo_data[128]; memset(ubo_data, 0, sizeof ubo_data);
    { const GLfloat tint[] = {0.5f, 0.25f, 0.0f, 1.0f};
      for (int i = 0; i < 4; i++) put_f(ubo_data, i * 4, tint[i]);
      put_f(ubo_data, 16, 0.25f); put_f(ubo_data, 32, 0.5f); put_f(ubo_data, 48, 1.0f);
      put_f(ubo_data, 64, 0.1f); put_f(ubo_data, 68, 0.2f); put_f(ubo_data, 72, 0.3f);
      put_u(ubo_data, 80, 1);
      put_f(ubo_data, 96, 0.0f); put_f(ubo_data, 100, 1.0f); put_f(ubo_data, 112, 1.0f); put_f(ubo_data, 116, 0.0f); }
    GLuint ubo; glGenBuffers(1, &ubo); glBindBuffer(GL_UNIFORM_BUFFER, ubo);
    glBufferData(GL_UNIFORM_BUFFER, sizeof ubo_data, ubo_data, GL_DYNAMIC_DRAW);
    glUniformBlockBinding(p1, block, 2); glBindBufferBase(GL_UNIFORM_BUFFER, 2, ubo);
    { GLint binding = -1; glGetActiveUniformBlockiv(p1, block, GL_UNIFORM_BLOCK_BINDING, &binding); check(binding == 2, "block binding"); }
    { const unsigned char a[] = {200,0,0,255, 200,0,0,255, 200,0,0,255, 200,0,0,255};
      const unsigned char b[] = {0,100,0,255, 0,100,0,255, 0,100,0,255, 0,100,0,255};
      GLuint tex[2]; glGenTextures(2, tex); glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
      for (int i = 0; i < 2; i++) {
          glActiveTexture(GL_TEXTURE0 + (i ? 5 : 3)); glBindTexture(GL_TEXTURE_2D, tex[i]);
          glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, i ? b : a);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
      }
      glUseProgram(p3);
      GLint units[2] = {3, 5}, pair = glGetUniformLocation(p3, "pair");
      check(pair >= 0 && glGetUniformLocation(p3, "pair[1]") == pair + 1, "sampler array locations");
      glUniform1iv(pair, 2, units);
      GLint back[2]; glGetUniformiv(p3, pair + 1, back); check(back[0] == 5, "sampler unit read-back");
    }
    glDisable(GL_DEPTH_TEST); glDisable(GL_BLEND); glClearColor(0.05f, 0.05f, 0.1f, 1);
    check(glGetError() == GL_NO_ERROR, "setup produced a GL error");
    OutputDebugStringA("x64-glsl PASS tiles=8 reflection=1 diagnostics=1");
    unsigned frame = 0;
    for (;;) {
        glViewport(0, 0, 320, 200); glClear(GL_COLOR_BUFFER_BIT);
        for (int i = 0; i < 8; i++) {
            glViewport((i % 4) * 80, i < 4 ? 100 : 0, 80, 100);
            glUseProgram(programs[i]); glBindVertexArray(i == 4 ? vao_b : vao_a);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        }
        check(glGetError() == GL_NO_ERROR, "unexpected GL error"); frame++; SwapBuffers(dc);
    }
}
