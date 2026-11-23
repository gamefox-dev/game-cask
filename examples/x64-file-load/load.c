/* SPDX-License-Identifier: CC0-1.0. Original fixture, no game data (K66, Q123).
 * An engine-shaped blocking stage load: 30 presented frames, then a load that neither presents nor sleeps,
 * reading a 4 MiB streamed pattern file in 16 KiB ReadFile calls (cold chunks) and re-reading its first
 * 2 MiB in 4 KiB calls (resident chunks), then presented frames forever. Every byte is checked against the
 * generator's pattern. The guest logs what it can observe (virtual GetTickCount/QPC, presents, sums), so a
 * host pacing change that altered the guest timeline would change these lines. */
#include <windows.h>
#include <GL/gl.h>
#include <stdio.h>
#define FILE_BYTES (4u << 20)
static unsigned pattern(unsigned off) { return ((off * 31u + 7u) ^ (off >> 13)) & 255u; }
static unsigned fnv(unsigned h, const unsigned char *p, DWORD n, unsigned off, unsigned *bad) {
    for (DWORD i = 0; i < n; i++) { if (p[i] != pattern(off + i)) (*bad)++; h = (h ^ p[i]) * 16777619u; }
    return h;
}
static unsigned load_pass(HANDLE f, DWORD chunk, unsigned limit, unsigned *reads, unsigned *bad, unsigned h) {
    static unsigned char buf[16384];
    unsigned off = 0;
    SetFilePointer(f, 0, 0, FILE_BEGIN);
    while (off < limit) {
        DWORD got = 0;
        if (!ReadFile(f, buf, chunk, &got, 0)) { (*bad)++; break; }
        (*reads)++;
        if (!got) break;
        h = fnv(h, buf, got, off, bad); off += got;
    }
    if (off != limit) (*bad)++;
    return h;
}
int main(void) {
    WNDCLASSA c = {0}; c.lpfnWndProc = DefWindowProcA; c.lpszClassName = "LoadCC0"; RegisterClassA(&c);
    HWND win = CreateWindowExA(0, c.lpszClassName, "Load CC0", WS_VISIBLE | WS_POPUP, 0, 0, 64, 64, 0, 0, 0, 0);
    HDC dc = GetDC(win);
    PIXELFORMATDESCRIPTOR pfd = {0}; pfd.nSize = sizeof pfd; pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; pfd.cColorBits = 32;
    SetPixelFormat(dc, ChoosePixelFormat(dc, &pfd), &pfd); wglMakeCurrent(dc, wglCreateContext(dc));
    /* Vsync-paced frames (one present per host frame), as a game's normal frames are. */
    typedef BOOL (WINAPI *swap_interval_t)(int);
    swap_interval_t swap_interval = (swap_interval_t)wglGetProcAddress("wglSwapIntervalEXT");
    if (swap_interval) swap_interval(1);
    unsigned presents = 0; char text[200];
    for (; presents < 30; presents++) { glClearColor(0, 0, 1, 1); glClear(GL_COLOR_BUFFER_BIT); SwapBuffers(dc); }
    LARGE_INTEGER q0, q1; QueryPerformanceCounter(&q0);
    DWORD t0 = GetTickCount();
    OutputDebugStringA("file-load begin");
    HANDLE f = CreateFileA("stage.dat", GENERIC_READ, FILE_SHARE_READ, 0, OPEN_EXISTING, 0, 0);
    unsigned reads = 0, bad = f == INVALID_HANDLE_VALUE, h = 2166136261u;
    if (!bad) {
        h = load_pass(f, 16384, FILE_BYTES, &reads, &bad, h);
        h = load_pass(f, 4096, FILE_BYTES / 2, &reads, &bad, h);
        CloseHandle(f);
    }
    DWORD t1 = GetTickCount(); QueryPerformanceCounter(&q1);
    snprintf(text, sizeof text, "file-load done %s reads=%u fnv=%08x presents=%u ticks=%lu qpc=%lld", bad ? "FAIL" : "ok", reads, h,
        presents, (unsigned long)(t1 - t0), (long long)(q1.QuadPart - q0.QuadPart));
    OutputDebugStringA(text);
    for (;;) {
        glClearColor(0, 1, 0, 1); glClear(GL_COLOR_BUFFER_BIT); SwapBuffers(dc); presents++;
        if (presents % 120 == 0) { snprintf(text, sizeof text, "file-load frame presents=%u ticks=%lu", presents, (unsigned long)(GetTickCount() - t0)); OutputDebugStringA(text); }
    }
}
