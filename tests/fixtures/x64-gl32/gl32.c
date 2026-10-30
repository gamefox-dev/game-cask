/* Original CC0-1.0. Tests 32-bit stdcall stack cleanup including doubles and extension aliases. */
#include <windows.h>
#include <GL/gl.h>
int _tls_index; /* No CRT in this ABI-only i386 probe. */
static void check(int ok) { if (!ok) { OutputDebugStringA("gl32 FAIL"); ExitProcess(10); } }
void entry(void) {
    HDC dc = (HDC)1; PIXELFORMATDESCRIPTOR desc = {0};
    check(SetPixelFormat(dc, ChoosePixelFormat(dc, &desc), &desc));
    HGLRC context = wglCreateContext(dc); check(context != 0 && wglMakeCurrent(dc, context));
    typedef void (WINAPI *Gen)(GLsizei, GLuint *);
    typedef void (WINAPI *Bind)(GLenum, GLuint);
    Gen gen = (Gen)wglGetProcAddress("glGenBuffersARB");
    Bind bind = (Bind)wglGetProcAddress("glBindBufferARB");
    GLuint b = 0; check(gen != 0 && bind != 0); gen(1, &b); bind(0x8892, b);
    glClearDepth(0.25); glDepthRange(0.125, 0.75); glClearColor(0.25f, 0.5f, 0.75f, 1);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    check(glGetError() == GL_NO_ERROR);
    glEnable(0xffffffffu); // Earlier errors must not suppress later valid state changes.
    glDepthFunc(GL_GEQUAL); GLint state = 0; glGetIntegerv(GL_DEPTH_FUNC, &state);
    check(state == GL_GEQUAL && glGetError() == GL_INVALID_ENUM && glGetError() == GL_NO_ERROR);
    glEnable(0xffffffffu); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glGetIntegerv(0x80c9, &state); // GL_BLEND_SRC_RGB: setters run despite an existing pending error.
    check(state == GL_SRC_ALPHA && glGetError() == GL_INVALID_ENUM && glGetError() == GL_NO_ERROR);
    typedef void (WINAPI *Stub)(GLenum, GLuint, GLuint);
    Stub unsupported = (Stub)wglGetProcAddress("glTexBuffer"); check(unsupported != 0);
    unsupported(0, 0, 0); check(glGetError() == GL_INVALID_OPERATION);
    check(wglGetProcAddress("glDefinitelyNotAnEntry") == 0);
    OutputDebugStringA("x64-gl32 PASS stdcall doubles alias errors visible-stubs");
    for (;;) Sleep(16);
}
