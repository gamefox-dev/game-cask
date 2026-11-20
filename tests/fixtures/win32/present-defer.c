/* Original CC0-1.0. K50 delta review: interval-0 frames with jittery CPU cost must still end the
 * host update at a present, and when a frame overruns the instruction cap after a present in the
 * same update, the GPU work issued after that present must not be shown in that update. */
#include <windows.h>
#include <GL/gl.h>
#include <stdio.h>
static volatile unsigned sink;
static void check(int ok) { if (!ok) { OutputDebugStringA("present-defer FAIL"); ExitProcess(1); } }
static __declspec(noinline) unsigned work(unsigned n, unsigned x) {
    for (unsigned i = 0; i < n; i++) x = (x * 1664525u + 1013904223u) ^ (x >> 13);
    return x;
}
typedef BOOL (WINAPI *SwapInterval)(int);
static void frame(HDC dc, float r, float g, float b, unsigned cost, const char *label, unsigned index) {
    glClearColor(r, g, b, 1); glClear(GL_COLOR_BUFFER_BIT);
    sink = work(cost, sink + index);
    glClearColor(0, 0, b ? 1.0f : 0.5f, 1); glClear(GL_COLOR_BUFFER_BIT);
    check(SwapBuffers(dc));
    char s[64]; snprintf(s, sizeof s, "present-defer %s=%u", label, index); OutputDebugStringA(s);
}
int main(void) {
    WNDCLASSA cls = {0}; cls.lpfnWndProc = DefWindowProcA; cls.lpszClassName = "PresentDefer"; RegisterClassA(&cls);
    HWND win = CreateWindowExA(0, cls.lpszClassName, "Defer", WS_VISIBLE | WS_POPUP, 0, 0, 160, 100, 0, 0, 0, 0);
    HDC dc = GetDC(win); PIXELFORMATDESCRIPTOR d = {0}; d.nSize = sizeof d; d.nVersion = 1;
    d.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; d.cColorBits = 32;
    check(SetPixelFormat(dc, ChoosePixelFormat(dc, &d), &d));
    HGLRC context = wglCreateContext(dc); check(context && wglMakeCurrent(dc, context));
    SwapInterval interval = (SwapInterval)wglGetProcAddress("wglSwapIntervalEXT"); check(interval && interval(0));
    /* Three short frames then one long one (about 4M / 22.5M instruction units): predicting from the
     * last frame alone lets the long frame cross the 64M cap mid-frame about every other update. */
    for (unsigned i = 0; i < 120; i++) frame(dc, 0, (float)(i % 250 + 1) / 255.0f, 0, i % 4 == 3 ? 5000000 : 900000, "jitter", i);
    OutputDebugStringA("present-defer jitter done");
    check(interval(1)); frame(dc, 0, 0, 0, 1000, "sync", 0); check(interval(0));
    for (unsigned i = 0; i < 4; i++) frame(dc, 0, 0.5f, 0, 1000, "tiny", i);
    /* One overrunning frame (about 76M units) begins with a red clear after four presents. */
    frame(dc, 1, 0, 1, 17000000, "long", 0);
    for (unsigned i = 0; i < 3; i++) frame(dc, 0, 0.25f, 0, 1000, "after", i);
    check(glGetError() == GL_NO_ERROR);
    OutputDebugStringA("present-defer PASS"); return 0;
}
