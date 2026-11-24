/* SPDX-License-Identifier: CC0-1.0. The first present ends the host update.
 * A ready worker presents during that SwapBuffers' resume pump, without ending
 * the new update. The main thread then clears before its next host yield. */
#include <windows.h>
#include <GL/gl.h>
static HDC dc;
static DWORD WINAPI worker(void *unused) {
    (void)unused;
    glClearColor(0, 1, 0, 1); glClear(GL_COLOR_BUFFER_BIT);
    if (!SwapBuffers(dc)) ExitProcess(2);
    OutputDebugStringA("worker resumed from SwapBuffers");
    return 0;
}
int main(void) {
    WNDCLASSA c = {0}; c.lpfnWndProc = DefWindowProcA; c.lpszClassName = "WorkerPresent";
    RegisterClassA(&c);
    HWND w = CreateWindowExA(0, c.lpszClassName, c.lpszClassName, WS_POPUP, 0, 0, 16, 16, 0, 0, 0, 0);
    dc = GetDC(w);
    PIXELFORMATDESCRIPTOR pfd = {0}; pfd.nSize = sizeof pfd; pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; pfd.cColorBits = 32;
    if (!SetPixelFormat(dc, ChoosePixelFormat(dc, &pfd), &pfd) || !wglMakeCurrent(dc, wglCreateContext(dc))) ExitProcess(3);
    BOOL (WINAPI *swapInterval)(int) = (void *)wglGetProcAddress("wglSwapIntervalEXT");
    if (!swapInterval || !swapInterval(0)) ExitProcess(4);
    LARGE_INTEGER now, freq; QueryPerformanceFrequency(&freq);
    do { QueryPerformanceCounter(&now); } while (now.QuadPart < freq.QuadPart * 9 / 1000);
    if (!CreateThread(0, 0, worker, 0, 0, 0)) ExitProcess(5);
    glClearColor(1, 0, 0, 1); glClear(GL_COLOR_BUFFER_BIT);
    if (!SwapBuffers(dc)) ExitProcess(6);
    OutputDebugStringA("main resumed from SwapBuffers");
    glClearColor(0, 0, 1, 1); glClear(GL_COLOR_BUFFER_BIT);
    Sleep(20);
    ExitProcess(0);
}
