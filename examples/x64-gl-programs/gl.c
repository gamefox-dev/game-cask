/* SPDX-License-Identifier: CC0-1.0. Original engine-shaped workload, no game assets (K70, Q126).
 * An engine startup that builds its shader programs before the first frame: PROGRAMS distinct programs, each
 * compiled (glCompileShader + GL_COMPILE_STATUS), linked (glLinkProgram + GL_LINK_STATUS), drawn once and read
 * back with glReadPixels. Every status and pixel is a blocking request result in the Win32 GL profile (shader
 * compile, stage modules, readback); on WebGPU they resolve asynchronously in the renderer. No present happens
 * until the programs are built, so the whole startup is time-neutral transport waiting. The guest logs what it can
 * observe (statuses, a pixel checksum, virtual GetTickCount/QPC deltas, presents), then presents frames that cycle
 * through the programs. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#define PROGRAMS 24
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLGETSHADERIVPROC,glGetShaderiv) X(PFNGLGETPROGRAMIVPROC,glGetProgramiv) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLUSEPROGRAMPROC,glUseProgram) \
 X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) X(PFNGLBUFFERDATAPROC,glBufferData) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) \
 X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLGETERRORPROC,glGetError) X(PFNGLCLEARPROC,glClear) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLREADPIXELSPROC,glReadPixels)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static GLuint shader(GLenum type, const char *src, unsigned *ok) {
    GLuint s = glCreateShader(type); glShaderSource(s, 1, &src, 0); glCompileShader(s);
    GLint status = 0; glGetShaderiv(s, GL_COMPILE_STATUS, &status); *ok += status == GL_TRUE; return s;
}
int main(void) {
    WNDCLASSA c = {0}; c.lpfnWndProc = DefWindowProcA; c.lpszClassName = "ProgramsCC0"; RegisterClassA(&c);
    HWND win = CreateWindowExA(0, c.lpszClassName, "Programs CC0", WS_VISIBLE | WS_POPUP, 0, 0, 32, 32, 0, 0, 0, 0); HDC dc = GetDC(win);
    PIXELFORMATDESCRIPTOR pfd = {0}; pfd.nSize = sizeof pfd; pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; pfd.cColorBits = 32;
    SetPixelFormat(dc, ChoosePixelFormat(dc, &pfd), &pfd); wglMakeCurrent(dc, wglCreateContext(dc));
#define X(t,n) n = (t)wglGetProcAddress(#n);
    FUNCTIONS
#undef X
    GLuint vao, vb; glGenVertexArrays(1, &vao); glBindVertexArray(vao); glGenBuffers(1, &vb);
    const float v[6] = {-1, -1, 3, -1, -1, 3};
    glBindBuffer(GL_ARRAY_BUFFER, vb); glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, 0); glEnableVertexAttribArray(0);
    LARGE_INTEGER q0, q1; QueryPerformanceCounter(&q0); DWORD t0 = GetTickCount();
    GLuint prog[PROGRAMS]; unsigned compiled = 0, linked = 0, pixels = 0; unsigned fnv = 2166136261u;
    char vs[256], fs[320];
    for (unsigned i = 0; i < PROGRAMS; i++) {
        /* Distinct sources per program: no backend may share a compiled module between them. */
        snprintf(vs, sizeof vs, "#version 330 core\nlayout(location=0) in vec2 pos;out vec2 uv;void main(){uv=pos*%u.0;gl_Position=vec4(pos,0.0,1.0);}", i + 1);
        snprintf(fs, sizeof fs, "#version 330 core\nin vec2 uv;layout(location=0) out vec4 color;void main(){color=vec4(%u.0/255.0,%u.0/255.0,%u.0/255.0,1.0)+0.0*vec4(uv,0.0,0.0);}",
            (i * 37u + 11u) & 255u, (i * 91u + 3u) & 255u, (i * 53u + 200u) & 255u);
        prog[i] = glCreateProgram();
        glAttachShader(prog[i], shader(GL_VERTEX_SHADER, vs, &compiled)); glAttachShader(prog[i], shader(GL_FRAGMENT_SHADER, fs, &compiled));
        glLinkProgram(prog[i]); GLint status = 0; glGetProgramiv(prog[i], GL_LINK_STATUS, &status); linked += status == GL_TRUE;
        glUseProgram(prog[i]); glClearColor(0, 0, 0, 1); glClear(GL_COLOR_BUFFER_BIT); glDrawArrays(GL_TRIANGLES, 0, 3);
        unsigned char px[4] = {0}; glReadPixels(16, 16, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
        pixels += px[0] == ((i * 37u + 11u) & 255u) && px[1] == ((i * 91u + 3u) & 255u) && px[2] == ((i * 53u + 200u) & 255u);
        for (unsigned k = 0; k < 4; k++) fnv = (fnv ^ px[k]) * 16777619u;
    }
    DWORD t1 = GetTickCount(); QueryPerformanceCounter(&q1);
    char text[200];
    snprintf(text, sizeof text, "gl-programs done programs=%u compiled=%u linked=%u pixels=%u fnv=%08x error=0x%x ticks=%lu qpc=%lld",
        PROGRAMS, compiled, linked, pixels, fnv, (unsigned)glGetError(), (unsigned long)(t1 - t0), (long long)(q1.QuadPart - q0.QuadPart));
    OutputDebugStringA(text);
    for (unsigned frame = 0;; frame++) {
        glUseProgram(prog[frame % PROGRAMS]); glClear(GL_COLOR_BUFFER_BIT); glDrawArrays(GL_TRIANGLES, 0, 3);
        SwapBuffers(dc);
        if (frame % 120 == 119) { snprintf(text, sizeof text, "gl-programs frame presents=%u", frame + 1); OutputDebugStringA(text); }
    }
}
