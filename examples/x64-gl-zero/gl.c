/* SPDX-License-Identifier: CC0-1.0. Original engine-shaped workload, no game assets (K66, Q120).
 * 2D batching that orphans each vertex/index buffer with glBufferData(target, 0, NULL, usage) before every batch
 * upload (the "send null" pattern), 40 batches per frame. Startup checks the zero-size store semantics of
 * GL 3.3 §2.9.2 and logs one line; two deliberate invalid calls (a negative size and a draw that reads past a
 * zero-size store) exercise the error-code census. Every frame checks glGetError. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLUSEPROGRAMPROC,glUseProgram) \
 X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) X(PFNGLBUFFERDATAPROC,glBufferData) X(PFNGLBUFFERSUBDATAPROC,glBufferSubData) \
 X(PFNGLGETBUFFERPARAMETERIVPROC,glGetBufferParameteriv) X(PFNGLMAPBUFFERRANGEPROC,glMapBufferRange) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) \
 X(PFNGLDRAWELEMENTSPROC,glDrawElements) X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLGETERRORPROC,glGetError) \
 X(PFNGLCLEARPROC,glClear) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLREADPIXELSPROC,glReadPixels)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static unsigned checks, failed;
static void check(const char *what, int ok) { checks++; if (!ok) { failed++; char t[160]; snprintf(t, sizeof t, "zero FAIL %s", what); OutputDebugStringA(t); } }
static GLint size_of(GLenum target) { GLint v = -1; glGetBufferParameteriv(target, GL_BUFFER_SIZE, &v); return v; }
static GLuint shader(GLenum type, const char *src) { GLuint s = glCreateShader(type); glShaderSource(s, 1, &src, 0); glCompileShader(s); return s; }
int main(void) {
    WNDCLASSA c = {0}; c.lpfnWndProc = DefWindowProcA; c.lpszClassName = "ZeroCC0"; RegisterClassA(&c);
    HWND win = CreateWindowExA(0, c.lpszClassName, "Zero CC0", WS_VISIBLE | WS_POPUP, 0, 0, 32, 32, 0, 0, 0, 0); HDC dc = GetDC(win);
    PIXELFORMATDESCRIPTOR pfd = {0}; pfd.nSize = sizeof pfd; pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; pfd.cColorBits = 32;
    SetPixelFormat(dc, ChoosePixelFormat(dc, &pfd), &pfd); wglMakeCurrent(dc, wglCreateContext(dc));
#define X(t,n) n = (t)wglGetProcAddress(#n);
    FUNCTIONS
#undef X
    GLuint p = glCreateProgram();
    glAttachShader(p, shader(GL_VERTEX_SHADER, "#version 330 core\nlayout(location=0) in vec2 pos;void main(){gl_Position=vec4(pos,0.0,1.0);}"));
    glAttachShader(p, shader(GL_FRAGMENT_SHADER, "#version 330 core\nlayout(location=0) out vec4 color;void main(){color=vec4(1.0,0.0,0.0,1.0);}"));
    glLinkProgram(p); glUseProgram(p);
    GLuint vao, b[2]; glGenVertexArrays(1, &vao); glBindVertexArray(vao); glGenBuffers(2, b);
    const float v[6] = {-1, -1, 3, -1, -1, 3}; const unsigned short idx[3] = {0, 1, 2};
    /* Startup: zero-size store semantics. */
    glBindBuffer(GL_ARRAY_BUFFER, b[0]);
    glBufferData(GL_ARRAY_BUFFER, 0, 0, GL_STREAM_DRAW); check("zero size on a new buffer", glGetError() == GL_NO_ERROR && size_of(GL_ARRAY_BUFFER) == 0);
    glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STREAM_DRAW); check("upload", glGetError() == GL_NO_ERROR && size_of(GL_ARRAY_BUFFER) == 24);
    glBufferData(GL_ARRAY_BUFFER, 0, v, GL_STREAM_DRAW); check("zero size orphans a live store", glGetError() == GL_NO_ERROR && size_of(GL_ARRAY_BUFFER) == 0);
    glBufferSubData(GL_ARRAY_BUFFER, 0, 4, v); check("sub-data past a zero-size store", glGetError() == GL_INVALID_VALUE);
    check("map of a zero-size store", !glMapBufferRange(GL_ARRAY_BUFFER, 0, 0, GL_MAP_WRITE_BIT) && glGetError() != GL_NO_ERROR);
    glBufferData(GL_ARRAY_BUFFER, -1, 0, GL_STREAM_DRAW); check("negative size", glGetError() == GL_INVALID_VALUE && size_of(GL_ARRAY_BUFFER) == 0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, 0); glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 3); check("draw reading a zero-size store", glGetError() == GL_INVALID_OPERATION);
    glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STREAM_DRAW); glDrawArrays(GL_TRIANGLES, 0, 3);
    unsigned char px[4] = {0}; glReadPixels(16, 16, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
    check("draw after re-specification", glGetError() == GL_NO_ERROR);
    /* Pixels need a rasterizing backend (browser specs check this line; the unit recorder does not draw). */
    char text[96]; snprintf(text, sizeof text, "zero checks=%u failed=%u pixel=%u,%u,%u,%u", checks, failed, px[0], px[1], px[2], px[3]);
    OutputDebugStringA(text);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, b[1]);
    for (unsigned frame = 0;; frame++) {
        glClearColor(0, 0, frame & 1, 1); glClear(GL_COLOR_BUFFER_BIT);
        for (unsigned i = 0; i < 40; i++) {
            glBufferData(GL_ARRAY_BUFFER, 0, 0, GL_STREAM_DRAW); glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STREAM_DRAW);
            glBufferData(GL_ELEMENT_ARRAY_BUFFER, 0, 0, GL_STREAM_DRAW); glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof idx, idx, GL_STREAM_DRAW);
            glDrawElements(GL_TRIANGLES, 3, GL_UNSIGNED_SHORT, 0);
        }
        if (glGetError() != GL_NO_ERROR) OutputDebugStringA("zero FAIL frame error");
        SwapBuffers(dc);
    }
}
