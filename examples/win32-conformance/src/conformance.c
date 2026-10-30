/* win32-conformance — Game Cask Win32 profile conformance fixture (CC0-1.0).
 * A Win32 program built from source at build time and run through the pipeline like a real game. It checks
 * profile behaviour against the Win32 API contract and reports through guest memory (read by tests with
 * __BGT_TEST__.peek / GameHost.peek) and OutputDebugStringA:
 *   - module loading: LoadLibrary/GetModuleHandle/GetProcAddress resolution order, ERROR_MOD_NOT_FOUND (126),
 *     ERROR_PROC_NOT_FOUND (127), exports by name and ordinal;
 *   - pixel reads: every kind of GDI drawing the profile records (fills, raster ops, blits from CPU-known and
 *     GPU-drawn bitmaps, stretching, text, pens, pattern brushes, DIB uploads, mono bitmaps, screen-to-memory
 *     copies) is read back with GetPixel/GetDIBits; tests compare the values with the GPU's pixels.
 * Layout: client 320x200; cells of 32x32 in an 8x5 grid (x 0..255, y 0..159); a 64x64 memory bitmap at (256,0). */
#include <windows.h>

#define CW 320
#define CH 200
#define RH 160
#define CELL 32

struct report {
    char magic[16];                 /* "BGT-CONFORMANCE" */
    DWORD loader_total, loader_pass;
    DWORD loader[16];               /* 1 = check passed */
    DWORD errs[16];                 /* GetLastError() observed by each check */
    DWORD gdi_done, outside_clip;   /* outside_clip = GetPixel(hdc, -1, -1) */
    DWORD screen_w, screen_h;
    COLORREF screen[CW * RH];       /* GetPixel of the window DC, client coords */
    COLORREF mem[64 * 64];          /* GetPixel of a memory DC holding a GPU-drawn bitmap */
    DWORD dib[64 * 64];             /* GetDIBits (32 bpp, top-down) of the same bitmap */
};
static struct report R;
int _tls_index = 0;

/* exported by name and as ordinal 1 (the asm label keeps the i386 symbol undecorated for lld's export directive) */
__declspec(dllexport) int conf_export_one(int x) __asm__("conf_export_one");
int conf_export_one(int x) { return x + 1; }

static void put_magic(void) {
    const char *m = "BGT-CONFORMANCE";
    for (int i = 0; m[i]; i++) R.magic[i] = m[i];
}
static void check(int i, int ok) { R.loader[i] = ok ? 1 : 0; R.errs[i] = GetLastError(); R.loader_total = (DWORD)(i + 1); if (ok) R.loader_pass++; }

/* ------------------------------------------------------------------ module loading (Win32 contract) */
static void loader_checks(void) {
    HMODULE self = GetModuleHandleA(0), k;
    FARPROC f;
    SetLastError(0); check(0, LoadLibraryA("missing.dll") == 0 && GetLastError() == ERROR_MOD_NOT_FOUND);
    SetLastError(0); check(1, LoadLibraryA("C:\\nowhere\\missing") == 0 && GetLastError() == ERROR_MOD_NOT_FOUND);
    SetLastError(0); k = LoadLibraryA("KERNEL32"); check(2, k != 0);              /* ".dll" appended, case-insensitive */
    SetLastError(0); f = GetProcAddress(k, "GetTickCount"); check(3, f != 0);
    SetLastError(0); check(4, GetProcAddress(k, "NoSuchFunctionAnywhere") == 0 && GetLastError() == ERROR_PROC_NOT_FOUND);
    SetLastError(0); check(5, GetProcAddress(k, MAKEINTRESOURCEA(1)) == 0 && GetLastError() == ERROR_PROC_NOT_FOUND);
    SetLastError(0); check(6, GetProcAddress(self, MAKEINTRESOURCEA(1)) == (FARPROC)conf_export_one);  /* by ordinal */
    SetLastError(0); check(7, GetProcAddress(self, "conf_export_one") == (FARPROC)conf_export_one);    /* by name */
    SetLastError(0); check(8, GetProcAddress(self, MAKEINTRESOURCEA(99)) == 0 && GetLastError() == ERROR_PROC_NOT_FOUND);
    SetLastError(0); check(9, LoadLibraryA("Conformance.EXE") == self);                                /* shipped module */
    SetLastError(0); check(10, GetModuleHandleA("missing.dll") == 0 && GetLastError() == ERROR_MOD_NOT_FOUND);
    SetLastError(0); check(11, FreeLibrary(k) != 0);
    if (f) { typedef DWORD(WINAPI * tick_fn)(void); SetLastError(0); check(12, ((tick_fn)f)() == GetTickCount()); }
    else check(12, 0);
}

/* ------------------------------------------------------------------ drawing */
static BITMAPINFO bi;
static DWORD pix16[16 * 16], pix64[64 * 64], pat8[8 * 8], dib24[16 * 16 * 3 / 4 + 16];
static BYTE mono16[16 * 2];
static HBITMAP dib16, dib64, patbm, monobm, membm, copybm;
static HBRUSH patbrush;

static void set_bi(int w, int h, int bpp) {
    BITMAPINFOHEADER *b = &bi.bmiHeader;
    b->biSize = sizeof *b; b->biWidth = w; b->biHeight = h; b->biPlanes = 1; b->biBitCount = (WORD)bpp;
    b->biCompression = BI_RGB; b->biSizeImage = 0; b->biXPelsPerMeter = b->biYPelsPerMeter = 0; b->biClrUsed = b->biClrImportant = 0;
}
static void make_bitmaps(HDC dc) {
    for (int y = 0; y < 16; y++)
        for (int x = 0; x < 16; x++)
            pix16[y * 16 + x] = (DWORD)((x * 16) << 16 | (y * 16) << 8 | ((x ^ y) & 1 ? 255 : 0)); /* 0xRRGGBB */
    for (int y = 0; y < 64; y++)
        for (int x = 0; x < 64; x++)
            pix64[y * 64 + x] = (DWORD)(((x / 4) & 1 ? 255 : 40) << 16 | (y * 4) << 8 | ((x + y) & 8 ? 200 : 10));
    for (int i = 0; i < 64; i++) pat8[i] = ((i / 8 + i) & 1) ? 0x00ff00ffu : 0x0000ffffu;
    BYTE *p = (BYTE *)dib24;
    for (int y = 0; y < 16; y++)
        for (int x = 0; x < 16; x++) { p[(y * 16 + x) * 3] = (BYTE)(x * 15); p[(y * 16 + x) * 3 + 1] = 255; p[(y * 16 + x) * 3 + 2] = (BYTE)(y * 15); }
    for (int y = 0; y < 16; y++) { mono16[y * 2] = (BYTE)(0xf0 >> (y & 3)); mono16[y * 2 + 1] = (BYTE)(y & 1 ? 0xaa : 0x55); }
    set_bi(16, -16, 32); dib16 = CreateDIBitmap(dc, &bi.bmiHeader, CBM_INIT, pix16, &bi, DIB_RGB_COLORS);
    set_bi(64, -64, 32); dib64 = CreateDIBitmap(dc, &bi.bmiHeader, CBM_INIT, pix64, &bi, DIB_RGB_COLORS);
    set_bi(8, -8, 32); patbm = CreateDIBitmap(dc, &bi.bmiHeader, CBM_INIT, pat8, &bi, DIB_RGB_COLORS);
    patbrush = CreatePatternBrush(patbm);
    monobm = CreateBitmap(16, 16, 1, 1, mono16);
    membm = CreateCompatibleBitmap(dc, 64, 64);
    copybm = CreateCompatibleBitmap(dc, CELL, CELL);
}
static void fill(HDC dc, int x, int y, int w, int h, COLORREF c) {
    RECT r = {x, y, x + w, y + h};
    HBRUSH b = CreateSolidBrush(c);
    FillRect(dc, &r, b);
    DeleteObject(b);
}
static void stripes(HDC dc, int x, int y) { /* a two-colour background for raster ops that read the destination */
    fill(dc, x, y, CELL, CELL / 2, RGB(255, 0, 255));
    fill(dc, x, y + CELL / 2, CELL, CELL / 2, RGB(0, 255, 0));
}
static void blit_from(HDC dc, int x, int y, int w, int h, HBITMAP bm, int sx, int sy, DWORD rop) {
    HDC m = CreateCompatibleDC(dc);
    HGDIOBJ old = SelectObject(m, bm);
    BitBlt(dc, x, y, w, h, m, sx, sy, rop);
    SelectObject(m, old);
    DeleteDC(m);
}

static void paint_scene(HDC dc) {
    RECT all = {0, 0, CW, CH};
    FillRect(dc, &all, (HBRUSH)GetStockObject(BLACK_BRUSH));
    int c = 0;
#define CX (CELL * (c % 8))
#define CY (CELL * (c / 8))
    /* 0 FillRect */
    fill(dc, CX, CY, CELL, CELL, RGB(200, 30, 40)); c++;
    /* 1 PatBlt PATCOPY */
    { HBRUSH b = CreateSolidBrush(RGB(20, 180, 60)); HGDIOBJ o = SelectObject(dc, b); PatBlt(dc, CX, CY, CELL, CELL, PATCOPY); SelectObject(dc, o); DeleteObject(b); } c++;
    /* 2 BLACKNESS / WHITENESS */
    PatBlt(dc, CX, CY, CELL / 2, CELL, BLACKNESS); PatBlt(dc, CX + CELL / 2, CY, CELL / 2, CELL, WHITENESS); c++;
    /* 3 DSTINVERT */
    stripes(dc, CX, CY); PatBlt(dc, CX + 4, CY + 4, CELL - 8, CELL - 8, DSTINVERT); c++;
    /* 4 PATINVERT, black-and-white brush (exact XOR) */
    stripes(dc, CX, CY);
    { HGDIOBJ o = SelectObject(dc, GetStockObject(WHITE_BRUSH)); PatBlt(dc, CX + 4, CY, CELL - 8, CELL, PATINVERT); SelectObject(dc, o); } c++;
    /* 5 PATINVERT, mid colour (smooth blend; rounding) */
    stripes(dc, CX, CY);
    { HBRUSH b = CreateSolidBrush(RGB(128, 64, 32)); HGDIOBJ o = SelectObject(dc, b); PatBlt(dc, CX, CY + 8, CELL, CELL - 16, PATINVERT); SelectObject(dc, o); DeleteObject(b); } c++;
    /* 6 InvertRect */
    stripes(dc, CX, CY); { RECT r = {CX + 8, CY + 2, CX + 24, CY + 30}; InvertRect(dc, &r); } c++;
    /* 7 SRCCOPY from a CPU-known bitmap */
    blit_from(dc, CX, CY, 16, 16, dib16, 0, 0, SRCCOPY); blit_from(dc, CX + 16, CY + 16, 16, 16, dib16, 0, 0, SRCCOPY); c++;
    /* 8 SRCCOPY from a GPU-drawn memory bitmap */
    {
        HDC m = CreateCompatibleDC(dc);
        HGDIOBJ o = SelectObject(m, membm);
        RECT r = {0, 0, 64, 64};
        FillRect(m, &r, (HBRUSH)GetStockObject(WHITE_BRUSH));
        fill(m, 4, 4, 30, 20, RGB(10, 100, 250));
        blit_from(m, 32, 32, 16, 16, dib16, 0, 0, SRCCOPY);
        SetBkMode(m, TRANSPARENT); SetTextColor(m, RGB(250, 0, 0)); TextOutA(m, 2, 40, "GDI", 3);
        { HPEN p = CreatePen(PS_SOLID, 1, RGB(0, 120, 0)); HGDIOBJ op = SelectObject(m, p); MoveToEx(m, 0, 63, 0); LineTo(m, 63, 0); SelectObject(m, op); DeleteObject(p); }
        RECT ir = {40, 2, 60, 22}; InvertRect(m, &ir);
        BitBlt(dc, CX, CY, CELL, CELL, m, 16, 16, SRCCOPY);
        SelectObject(m, o);
        DeleteDC(m);
    } c++;
    /* 9 SRCAND (mask): colour background AND a black/white bitmap */
    fill(dc, CX, CY, CELL, CELL, RGB(90, 200, 160)); blit_from(dc, CX, CY, 16, 16, monobm, 0, 0, SRCAND); blit_from(dc, CX + 16, CY + 16, 16, 16, dib16, 0, 0, SRCAND); c++;
    /* 10 SRCPAINT (OR as add) */
    fill(dc, CX, CY, CELL, CELL, RGB(0, 0, 0)); fill(dc, CX + 8, CY, 8, CELL, RGB(0, 0, 128));
    blit_from(dc, CX, CY, 16, 16, dib16, 0, 0, SRCPAINT); blit_from(dc, CX + 16, CY, 16, 16, monobm, 0, 0, SRCPAINT); c++;
    /* 11 SRCINVERT with a black/white source */
    stripes(dc, CX, CY); blit_from(dc, CX + 8, CY + 8, 16, 16, monobm, 0, 0, SRCINVERT); c++;
    /* 12 NOTSRCCOPY */
    blit_from(dc, CX + 4, CY + 4, 16, 16, dib16, 0, 0, NOTSRCCOPY); c++;
    /* 13 StretchBlt 2x */
    { HDC m = CreateCompatibleDC(dc); HGDIOBJ o = SelectObject(m, dib16); StretchBlt(dc, CX, CY, CELL, CELL, m, 0, 0, 16, 16, SRCCOPY); SelectObject(m, o); DeleteDC(m); } c++;
    /* 14 StretchBlt 3:2 (minify) */
    { HDC m = CreateCompatibleDC(dc); HGDIOBJ o = SelectObject(m, dib64); StretchBlt(dc, CX, CY, CELL, CELL, m, 8, 8, 48, 48, SRCCOPY); SelectObject(m, o); DeleteDC(m); } c++;
    /* 15 TextOut, transparent */
    fill(dc, CX, CY, CELL, CELL, RGB(30, 30, 90)); SetBkMode(dc, TRANSPARENT); SetTextColor(dc, RGB(255, 220, 0)); TextOutA(dc, CX + 1, CY + 4, "Ab1", 3); TextOutA(dc, CX + 1, CY + 18, "&%", 2); c++;
    /* 16 TextOut, opaque */
    SetBkMode(dc, OPAQUE); SetBkColor(dc, RGB(0, 90, 0)); SetTextColor(dc, RGB(255, 255, 255)); TextOutA(dc, CX, CY + 10, "Hi!", 3); SetBkMode(dc, TRANSPARENT); c++;
    /* 17 SetPixel checkerboard */
    for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) if ((x ^ y) & 1) SetPixel(dc, CX + 8 + x, CY + 8 + y, RGB(x * 16, 255 - y * 16, 77)); c++;
    /* 18 lines */
    { HPEN p = CreatePen(PS_SOLID, 1, RGB(255, 128, 0)); HGDIOBJ o = SelectObject(dc, p);
      MoveToEx(dc, CX, CY + 3, 0); LineTo(dc, CX + CELL, CY + 3); MoveToEx(dc, CX + 5, CY, 0); LineTo(dc, CX + 5, CY + CELL);
      MoveToEx(dc, CX + 2, CY + 30, 0); LineTo(dc, CX + 29, CY + 9); SelectObject(dc, o); DeleteObject(p); } c++;
    /* 19 Rectangle with pen + brush */
    { HPEN p = CreatePen(PS_SOLID, 1, RGB(0, 0, 255)); HBRUSH b = CreateSolidBrush(RGB(255, 255, 128));
      HGDIOBJ op = SelectObject(dc, p), ob = SelectObject(dc, b); Rectangle(dc, CX + 2, CY + 2, CX + 30, CY + 26);
      SelectObject(dc, op); SelectObject(dc, ob); DeleteObject(p); DeleteObject(b); } c++;
    /* 20 pattern brush */
    { RECT r = {CX + 1, CY + 3, CX + 30, CY + 29}; FillRect(dc, &r, patbrush); } c++;
    /* 21 StretchDIBits (24 bpp, 2x) */
    set_bi(16, 16, 24); StretchDIBits(dc, CX, CY, CELL, CELL, 0, 0, 16, 16, dib24, &bi, DIB_RGB_COLORS, SRCCOPY); c++;
    /* 22 SetDIBitsToDevice (32 bpp top-down) */
    set_bi(16, -16, 32); SetDIBitsToDevice(dc, CX + 8, CY + 8, 16, 16, 0, 0, 0, 16, pix16, &bi, DIB_RGB_COLORS); c++;
    /* 23 SetDIBits into a bitmap, then BitBlt */
    { HBITMAP b = CreateCompatibleBitmap(dc, 16, 16); set_bi(16, 16, 24); SetDIBits(dc, b, 0, 16, dib24, &bi, DIB_RGB_COLORS);
      blit_from(dc, CX + 4, CY + 12, 16, 16, b, 0, 0, SRCCOPY); DeleteObject(b); } c++;
    /* 24 monochrome bitmap SRCCOPY */
    blit_from(dc, CX + 8, CY + 8, 16, 16, monobm, 0, 0, SRCCOPY); c++;
    /* 25 screen -> memory -> screen (copies cell 0 + part of cell 1) */
    { HDC m = CreateCompatibleDC(dc); HGDIOBJ o = SelectObject(m, copybm); BitBlt(m, 0, 0, CELL, CELL, dc, 16, 0, SRCCOPY);
      BitBlt(dc, CX, CY, CELL, CELL, m, 0, 0, SRCCOPY); SelectObject(m, o); DeleteDC(m); } c++;
    /* 26 R2_XORPEN and R2_NOT lines */
    stripes(dc, CX, CY);
    { HPEN p = CreatePen(PS_SOLID, 1, RGB(255, 255, 255)); HGDIOBJ o = SelectObject(dc, p); SetROP2(dc, R2_XORPEN);
      MoveToEx(dc, CX, CY + 10, 0); LineTo(dc, CX + CELL, CY + 10); SetROP2(dc, R2_NOT); MoveToEx(dc, CX + 12, CY, 0); LineTo(dc, CX + 12, CY + CELL);
      SetROP2(dc, R2_COPYPEN); SelectObject(dc, o); DeleteObject(p); } c++;
    /* 27 ExtTextOut with ETO_OPAQUE */
    { RECT r = {CX + 2, CY + 6, CX + 30, CY + 22}; SetBkColor(dc, RGB(80, 0, 80)); SetTextColor(dc, RGB(0, 255, 255));
      ExtTextOutA(dc, CX + 3, CY + 8, ETO_OPAQUE, &r, "xyz", 3, 0); } c++;
    /* 28 DrawText centred */
    { RECT r = {CX, CY, CX + CELL, CY + CELL}; SetTextColor(dc, RGB(255, 255, 255)); DrawTextA(dc, "&OK", 3, &r, DT_CENTER | DT_VCENTER | DT_SINGLELINE); } c++;
    /* 29 FrameRect + Ellipse (approximated by the profile, still exact to read back) */
    { RECT r = {CX + 1, CY + 1, CX + 31, CY + 31}; FrameRect(dc, &r, (HBRUSH)GetStockObject(WHITE_BRUSH));
      HBRUSH b = CreateSolidBrush(RGB(255, 0, 0)); HGDIOBJ o = SelectObject(dc, b); Ellipse(dc, CX + 6, CY + 6, CX + 26, CY + 26); SelectObject(dc, o); DeleteObject(b); } c++;
#undef CX
#undef CY
    /* the 64x64 memory bitmap (drawn in cell 8) shown 1:1 */
    blit_from(dc, 256, 0, 64, 64, membm, 0, 0, SRCCOPY);
}

static void read_back(HWND h) {
    HDC dc = GetDC(h);
    RECT rc;
    GetClientRect(h, &rc);
    R.screen_w = (DWORD)rc.right; R.screen_h = (DWORD)rc.bottom;
    for (int y = 0; y < RH; y++)
        for (int x = 0; x < CW; x++) R.screen[y * CW + x] = GetPixel(dc, x, y);
    R.outside_clip = GetPixel(dc, -1, -1);
    HDC m = CreateCompatibleDC(dc);
    HGDIOBJ o = SelectObject(m, membm);
    for (int y = 0; y < 64; y++)
        for (int x = 0; x < 64; x++) R.mem[y * 64 + x] = GetPixel(m, x, y);
    SelectObject(m, o); /* GetDIBits needs the bitmap deselected */
    DeleteDC(m);
    set_bi(64, -64, 32);
    GetDIBits(dc, membm, 0, 64, R.dib, &bi, DIB_RGB_COLORS);
    ReleaseDC(h, dc);
    R.gdi_done = 1;
}

static void report_line(const char *what) {
    char line[128];
    wsprintfA(line, "conformance: %s report=0x%08x loader=%u/%u", what, (unsigned)(UINT_PTR)&R, (unsigned)R.loader_pass, (unsigned)R.loader_total);
    OutputDebugStringA(line);
}

void phase0(HWND h);
void file_checks(void);
void phase0_message(HWND h);
void phase0_about(HWND h);
static LRESULT CALLBACK wndproc(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_CREATE: SetTimer(h, 1, 100, 0); return 0;
    case WM_PAINT: { PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps); paint_scene(dc); EndPaint(h, &ps); return 0; }
    case WM_TIMER: KillTimer(h, 1); read_back(h); report_line("gdi done"); return 0;
    case WM_KEYDOWN:
        if (w == 'T') phase0(h);
        if (w == 'I') phase0_message(h);
        if (w == 'A') phase0_about(h);
        if (w == 'F') file_checks();
        return 0;
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProcA(h, m, w, l);
}

void entry(void) {
    HINSTANCE inst = GetModuleHandleA(0);
    put_magic();
    loader_checks();
    report_line("loader done");
    HDC screen = GetDC(0);
    make_bitmaps(screen);
    ReleaseDC(0, screen);
    WNDCLASSA wc = {0};
    wc.lpfnWndProc = wndproc; wc.hInstance = inst; wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH); wc.lpszClassName = "conformance";
    RegisterClassA(&wc);
    HWND h = CreateWindowExA(0, "conformance", "Win32 conformance", WS_OVERLAPPEDWINDOW, 0, 0, CW, CH, 0, 0, inst, 0);
    ShowWindow(h, SW_SHOW);
    UpdateWindow(h);
    MSG msg;
    while (GetMessageA(&msg, 0, 0, 0)) DispatchMessageA(&msg);
    ExitProcess((UINT)msg.wParam);
}
