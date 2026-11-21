/* Original CC0-1.0. K50 delta review: interval-0 presents that share one host update must never
 * exceed a per-frame GPU budget that a one-present-per-update guest stays within. Define MODE 1
 * (one 1024x1024 RGBA texture upload per frame, 4 MiB of upload budget) or MODE 2 (300000 GPU
 * vertices per frame, about a fifth of the 1572864-vertex frame limit) before including this file. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#define GLFUNCS X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) \
    X(PFNGLCOMPILESHADERPROC,glCompileShader) X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLCREATEPROGRAMPROC,glCreateProgram) \
    X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLGETSHADERIVPROC,glGetShaderiv) X(PFNGLGETPROGRAMIVPROC,glGetProgramiv) \
    X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLUSEPROGRAMPROC,glUseProgram) \
    X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLCLEARPROC,glClear) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLGETERRORPROC,glGetError) \
    X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) \
    X(PFNGLTEXSUBIMAGE2DPROC,glTexSubImage2D)
#define X(t,n) static t n;
GLFUNCS
#undef X
typedef HGLRC (WINAPI *CreateCore)(HDC,HGLRC,const int *);
typedef BOOL (WINAPI *SwapInterval)(int);
static void check(int ok) { if (!ok) { OutputDebugStringA("present-budget FAIL"); ExitProcess(1); } }
static GLuint shader(GLenum stage, const char *src) {
    GLuint s = glCreateShader(stage); GLint ok = 0; glShaderSource(s, 1, &src, 0); glCompileShader(s);
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok); check(ok); return s;
}
static unsigned char pixels[1024 * 1024 * 4];
int main(void) {
    WNDCLASSA cls = {0}; cls.lpfnWndProc = DefWindowProcA; cls.lpszClassName = "PresentBudget"; RegisterClassA(&cls);
    HWND win = CreateWindowExA(0, cls.lpszClassName, "Budget", WS_VISIBLE | WS_POPUP, 0, 0, 160, 100, 0, 0, 0, 0);
    HDC dc = GetDC(win); PIXELFORMATDESCRIPTOR d = {0}; d.nSize = sizeof d; d.nVersion = 1;
    d.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; d.cColorBits = 32;
    check(SetPixelFormat(dc, ChoosePixelFormat(dc, &d), &d));
    HGLRC legacy = wglCreateContext(dc); check(legacy && wglMakeCurrent(dc, legacy));
    CreateCore create = (CreateCore)wglGetProcAddress("wglCreateContextAttribsARB");
    const int attrs[] = {0x2091, 3, 0x2092, 3, 0x9126, 1, 0};
    HGLRC core = create ? create(dc, 0, attrs) : 0; check(core && wglMakeCurrent(dc, core));
#define X(t,n) n = (t)wglGetProcAddress(#n); check(n != 0);
    GLFUNCS
#undef X
    SwapInterval interval = (SwapInterval)wglGetProcAddress("wglSwapIntervalEXT"); check(interval && interval(0));
    GLuint texture = 0;
#if MODE == 1
    glGenTextures(1, &texture); glBindTexture(GL_TEXTURE_2D, texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 1024, 1024, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
#else
    GLuint program = glCreateProgram(), vao;
    glAttachShader(program, shader(GL_VERTEX_SHADER, "#version 330 core\nvoid main(){gl_Position=vec4(float(gl_VertexID%64)/64.0,0.0,0.0,1.0);}"));
    glAttachShader(program, shader(GL_FRAGMENT_SHADER, "#version 330 core\nout vec4 c;void main(){c=vec4(1.0);}"));
    glLinkProgram(program); GLint linked = 0; glGetProgramiv(program, GL_LINK_STATUS, &linked); check(linked);
    glUseProgram(program); glGenVertexArrays(1, &vao); glBindVertexArray(vao);
#endif
    (void)texture; check(glGetError() == GL_NO_ERROR);
    unsigned errors = 0, first = 0, code = 0;
    for (unsigned frame = 0; frame < 200; frame++) {
        glClearColor(0, (float)(frame & 255) / 255.0f, 0, 1); glClear(GL_COLOR_BUFFER_BIT);
#if MODE == 1
        pixels[frame] = (unsigned char)frame;
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 1024, 1024, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
#else
        glDrawArrays(GL_POINTS, 0, 300000);
#endif
        GLenum e = glGetError(); if (e) { if (!errors) { first = frame; code = e; } errors++; }
        check(SwapBuffers(dc));
        char s[64]; snprintf(s, sizeof s, "present-budget frame=%u", frame); OutputDebugStringA(s);
    }
    char s[96]; snprintf(s, sizeof s, "present-budget done errors=%u first=%u code=0x%x", errors, first, code);
    OutputDebugStringA(s); return 0;
}
