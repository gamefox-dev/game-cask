/* Original CC0-1.0. K50 delta review vK50c. MODE 1: one deferred span (after an interval-0
 * present) holds six 256 KiB texture uploads, so the journal grows several times; every upload
 * must reach the GPU with its own bytes. MODE 2: under a 16 MiB gpu budget, forty cheap frames
 * (256 KiB upload each) share an update, then one frame uploads 12 MiB, far above the recent
 * frames; it must not be flushed into the shared host frame (no late GL_OUT_OF_MEMORY). */
#include <windows.h>
#include <GL/gl.h>
#include <stdio.h>
#include <string.h>
static void check(int ok) { if (!ok) { OutputDebugStringA("present-journal FAIL"); ExitProcess(1); } }
typedef BOOL (WINAPI *SwapInterval)(int);
static unsigned char pixels[1024 * 1024 * 4];
static unsigned errors, first_error;
static void present(HDC dc, unsigned frame) {
    GLenum e = glGetError(); if (e) { if (!errors) first_error = frame; errors++; }
    check(SwapBuffers(dc));
    e = glGetError(); if (e) { if (!errors) first_error = frame; errors++; }
}
int main(void) {
    WNDCLASSA cls = {0}; cls.lpfnWndProc = DefWindowProcA; cls.lpszClassName = "PresentJournal"; RegisterClassA(&cls);
    HWND win = CreateWindowExA(0, cls.lpszClassName, "Journal", WS_VISIBLE | WS_POPUP, 0, 0, 160, 100, 0, 0, 0, 0);
    HDC dc = GetDC(win); PIXELFORMATDESCRIPTOR d = {0}; d.nSize = sizeof d; d.nVersion = 1;
    d.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; d.cColorBits = 32;
    check(SetPixelFormat(dc, ChoosePixelFormat(dc, &d), &d));
    HGLRC context = wglCreateContext(dc); check(context && wglMakeCurrent(dc, context));
    SwapInterval interval = (SwapInterval)wglGetProcAddress("wglSwapIntervalEXT"); check(interval && interval(0));
    GLuint texture; glGenTextures(1, &texture); glBindTexture(GL_TEXTURE_2D, texture);
#if MODE == 1
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 256, 256, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    glClear(GL_COLOR_BUFFER_BIT); present(dc, 0);
    for (unsigned i = 0; i < 6; i++) { /* all inside one deferred span */
        memset(pixels, 0x11 * (int)(i + 1), 256 * 256 * 4);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 256, 256, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    }
    glClear(GL_COLOR_BUFFER_BIT); present(dc, 1);
    for (unsigned f = 2; f < 6; f++) { glClear(GL_COLOR_BUFFER_BIT); present(dc, f); }
#else
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1024, 1024, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    unsigned frame = 0;
    for (; frame < 40; frame++) {
        glClear(GL_COLOR_BUFFER_BIT);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 256, 256, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
        present(dc, frame);
    }
    glClear(GL_COLOR_BUFFER_BIT);
    for (unsigned i = 0; i < 3; i++) glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 1024, 1024, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    present(dc, frame++);
    for (; frame < 50; frame++) {
        glClear(GL_COLOR_BUFFER_BIT);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 256, 256, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
        present(dc, frame);
    }
#endif
    char s[96]; snprintf(s, sizeof s, "present-journal done errors=%u first=%u", errors, first_error);
    OutputDebugStringA(s); return 0;
}
