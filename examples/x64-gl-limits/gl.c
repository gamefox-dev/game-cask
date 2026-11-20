/* Original CC0-1.0 (K51). Guest-visible GL_MAX_UNIFORM_BLOCK_SIZE is the device's real limit.
 * Normal Win64 PE/CRT pipeline; no BGT imports, overrides, captured bytes or engine logic.
 * One std140 block of exactly the reported limit links and draws (first/last/tail elements read);
 * one vec4 more fails with an explicit info log. An oversized glBindBufferRange is legal GL.
 * 1024 default-block vec4s (4096 components, what ANGLE Metal accepts) link and draw: the profile's own
 * meta words must not be charged to the guest's budget. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define GLFUNCS \
 X(PFNGLATTACHSHADERPROC, glAttachShader) X(PFNGLBINDBUFFERPROC, glBindBuffer) X(PFNGLBINDBUFFERRANGEPROC, glBindBufferRange) \
 X(PFNGLBINDVERTEXARRAYPROC, glBindVertexArray) X(PFNGLBUFFERDATAPROC, glBufferData) X(PFNGLCLEARPROC, glClear) \
 X(PFNGLCLEARCOLORPROC, glClearColor) X(PFNGLCOMPILESHADERPROC, glCompileShader) X(PFNGLCREATEPROGRAMPROC, glCreateProgram) \
 X(PFNGLCREATESHADERPROC, glCreateShader) X(PFNGLDRAWARRAYSPROC, glDrawArrays) X(PFNGLENABLEVERTEXATTRIBARRAYPROC, glEnableVertexAttribArray) \
 X(PFNGLGENBUFFERSPROC, glGenBuffers) X(PFNGLGENVERTEXARRAYSPROC, glGenVertexArrays) X(PFNGLGETERRORPROC, glGetError) \
 X(PFNGLGETINTEGERVPROC, glGetIntegerv) X(PFNGLGETPROGRAMIVPROC, glGetProgramiv) X(PFNGLGETSHADERIVPROC, glGetShaderiv) \
 X(PFNGLGETPROGRAMINFOLOGPROC, glGetProgramInfoLog) X(PFNGLGETSHADERINFOLOGPROC, glGetShaderInfoLog) \
 X(PFNGLGETUNIFORMBLOCKINDEXPROC, glGetUniformBlockIndex) X(PFNGLUNIFORMBLOCKBINDINGPROC, glUniformBlockBinding) \
 X(PFNGLGETACTIVEUNIFORMBLOCKIVPROC, glGetActiveUniformBlockiv) X(PFNGLLINKPROGRAMPROC, glLinkProgram) \
 X(PFNGLREADPIXELSPROC, glReadPixels) X(PFNGLSHADERSOURCEPROC, glShaderSource) X(PFNGLUSEPROGRAMPROC, glUseProgram) \
 X(PFNGLVERTEXATTRIBPOINTERPROC, glVertexAttribPointer) X(PFNGLVIEWPORTPROC, glViewport) \
 X(PFNGLGETUNIFORMLOCATIONPROC, glGetUniformLocation) X(PFNGLUNIFORM4FVPROC, glUniform4fv)
#define X(t,n) static t n;
GLFUNCS
#undef X
static unsigned failures;
static void note(const char *label, int ok) {
    char b[200]; snprintf(b, sizeof b, "x64-gl-limits %s %s", ok ? "ok" : "FAIL", label);
    OutputDebugStringA(b); if (!ok) failures++;
}
static char source[512], logbuf[1024];
/* Returns the linked program or 0; the combined compile/link info log is left in logbuf. */
static GLuint link(void);
static GLuint program(unsigned vec4s) {
    snprintf(source, sizeof source, "#version 330 core\nlayout(location=0) out vec4 c;"
        "layout(std140) uniform Big { vec4 v[%u]; vec4 tail; };void main(){c=v[0]+v[%u]+tail;}", vec4s, vec4s - 1);
    return link();
}
static GLuint link(void) {
    const char *vsrc = "#version 330 core\nlayout(location=0) in vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";
    const char *fsrc = source;
    GLuint vs = glCreateShader(GL_VERTEX_SHADER), fs = glCreateShader(GL_FRAGMENT_SHADER), p = glCreateProgram();
    glShaderSource(vs, 1, &vsrc, 0); glCompileShader(vs); glShaderSource(fs, 1, &fsrc, 0); glCompileShader(fs);
    GLint ok = 0, n = 0; logbuf[0] = 0; glGetShaderiv(fs, GL_COMPILE_STATUS, &ok);
    if (!ok) { glGetShaderInfoLog(fs, sizeof logbuf, &n, logbuf); return 0; }
    glAttachShader(p, vs); glAttachShader(p, fs); glLinkProgram(p); glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) { glGetProgramInfoLog(p, sizeof logbuf, &n, logbuf); return 0; }
    return p;
}
static const float tri[] = {-1, -1, 3, -1, -1, 3};
int main(void) {
    WNDCLASSA c = {0}; c.lpfnWndProc = DefWindowProcA; c.lpszClassName = "LimitsCC0"; RegisterClassA(&c);
    HWND win = CreateWindowExA(0, c.lpszClassName, "GL uniform limits", WS_VISIBLE | WS_POPUP, 0, 0, 32, 32, 0, 0, 0, 0);
    HDC dc = GetDC(win); PIXELFORMATDESCRIPTOR d = {0}; d.nSize = sizeof d; d.nVersion = 1;
    d.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; d.cColorBits = 32;
    SetPixelFormat(dc, ChoosePixelFormat(dc, &d), &d); HGLRC ctx = wglCreateContext(dc); wglMakeCurrent(dc, ctx);
#define X(t,n) n = (t)wglGetProcAddress(#n);
    GLFUNCS
#undef X
    GLint limit = 0; glGetIntegerv(GL_MAX_UNIFORM_BLOCK_SIZE, &limit);
    char text[96]; snprintf(text, sizeof text, "x64-gl-limits uniform-block-limit=%d", limit); OutputDebugStringA(text);
    note("limit is a GL 3.3 value", limit >= 16384 && limit % 16 == 0 && glGetError() == GL_NO_ERROR);
    unsigned n = (unsigned)limit / 16 - 1; /* v[n] + tail == exactly the limit */
    GLuint over = program(n + 1);
    note("one vec4 over the limit fails with an explicit log", !over && strstr(logbuf, "GL_MAX_UNIFORM_BLOCK_SIZE") != 0);
    if (over || !strstr(logbuf, "GL_MAX_UNIFORM_BLOCK_SIZE")) OutputDebugStringA(logbuf);
    GLuint p = program(n); note("exactly the limit links", p != 0); if (!p) OutputDebugStringA(logbuf);
    GLint size = 0; GLuint block = p ? glGetUniformBlockIndex(p, "Big") : 0;
    if (p) glGetActiveUniformBlockiv(p, block, GL_UNIFORM_BLOCK_DATA_SIZE, &size);
    note("linked block data size equals the limit", size == limit);
    /* Twice the limit: the bound range may exceed the block; GL reports no error for that. */
    float *data = calloc((size_t)limit * 2, 1);
    data[0] = 1.0f;                       /* v[0]   = (1,0,0,0) */
    data[(n - 1) * 4 + 2] = 1.0f;         /* v[n-1] = (0,0,1,0) */
    data[n * 4 + 3] = 1.0f;               /* tail   = (0,0,0,1) */
    GLuint vao, vbo, ubo; glGenVertexArrays(1, &vao); glBindVertexArray(vao);
    glGenBuffers(1, &vbo); glBindBuffer(GL_ARRAY_BUFFER, vbo); glBufferData(GL_ARRAY_BUFFER, sizeof tri, tri, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, 0); glEnableVertexAttribArray(0);
    glGenBuffers(1, &ubo); glBindBuffer(GL_UNIFORM_BUFFER, ubo); glBufferData(GL_UNIFORM_BUFFER, limit * 2, data, GL_STATIC_DRAW);
    glBindBufferRange(GL_UNIFORM_BUFFER, 3, ubo, 0, limit * 2);
    note("oversized glBindBufferRange is legal GL", glGetError() == GL_NO_ERROR);
    if (p) { glUniformBlockBinding(p, block, 3); glUseProgram(p); }
    /* Default-block uniforms: u[0] + u[1023] == cyan. */
    snprintf(source, sizeof source, "#version 330 core\nlayout(location=0) out vec4 c;uniform vec4 u[1024];void main(){c=u[0]+u[1023];}");
    GLuint q = link(); note("1024 default-block vec4 uniforms link", q != 0); if (!q) OutputDebugStringA(logbuf);
    if (q) { static float u[1024 * 4]; u[1] = 1.0f; u[1023 * 4 + 2] = 1.0f; u[1023 * 4 + 3] = 1.0f;
        glUseProgram(q); glUniform4fv(glGetUniformLocation(q, "u"), 1024, u); }
    if (p) glUseProgram(p);
    note("setup has no GL error", glGetError() == GL_NO_ERROR);
    char done[96]; snprintf(done, sizeof done, "x64-gl-limits PASS checks limit=%d failures=%u", limit, failures);
    if (!failures) OutputDebugStringA(done);
    for (unsigned frame = 0;; frame++) {
        glViewport(0, 0, 32, 32); glClearColor(0, 1, 0, 1); glClear(GL_COLOR_BUFFER_BIT);
        if (p) glUseProgram(p);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        if (q) { glUseProgram(q); glViewport(0, 0, 16, 32); glDrawArrays(GL_TRIANGLES, 0, 3); }
        if (frame == 1) { /* right: magenta = v[0] + v[n-1] + tail; left: cyan = u[0] + u[1023]; green = no draw */
            unsigned char px[4] = {0}, left[4] = {0}; glReadPixels(24, 16, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
            glReadPixels(8, 16, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, left);
            snprintf(text, sizeof text, "x64-gl-limits pixel=%u,%u,%u,%u", px[0], px[1], px[2], px[3]); OutputDebugStringA(text);
            snprintf(text, sizeof text, "x64-gl-limits default-pixel=%u,%u,%u,%u", left[0], left[1], left[2], left[3]); OutputDebugStringA(text);
        }
        SwapBuffers(dc);
    }
}
