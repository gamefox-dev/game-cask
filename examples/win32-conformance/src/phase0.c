/* CC0-1.0: original Win32 contract fixture; no external game content. */
#include <windows.h>
#include <shellapi.h>

static unsigned checks;
#define CHECK(expr, bit) do { if (expr) checks |= 1u << (bit); } while (0)

void phase0(HWND h) {
    checks = 0;
    MSG m;
    while (PeekMessageA(&m, 0, 0, 0, PM_REMOVE)) DispatchMessageA(&m);
    DWORD start = GetTickCount();
    Sleep(5);
    CHECK(GetTickCount() - start == 5, 0);
    start = GetTickCount();
    CHECK(MsgWaitForMultipleObjects(0, 0, FALSE, 5, QS_ALLINPUT) == WAIT_TIMEOUT, 1);
    CHECK(GetTickCount() - start == 5, 2);
    PostMessageA(h, WM_NULL, 0, 0);
    CHECK(MsgWaitForMultipleObjects(0, 0, FALSE, 0, QS_ALLINPUT) == WAIT_OBJECT_0, 3);
    while (PeekMessageA(&m, 0, 0, 0, PM_REMOVE)) DispatchMessageA(&m);
    HDC dc = GetDC(h);
    HFONT f = CreateFontA(26, 0, 0, 0, FW_BOLD, 0, 0, 0, 0, 0, 0, 0, 0, "Fixture Mono");
    HGDIOBJ old = SelectObject(dc, f);
    TEXTMETRICA tm; SIZE extent;
    GetTextMetricsA(dc, &tm);
    GetTextExtentPoint32A(dc, "Help", 4, &extent);
    CHECK(tm.tmHeight == 26 && tm.tmAscent + tm.tmDescent == 26 && tm.tmWeight == 700, 4);
    CHECK(extent.cx == 4 * tm.tmAveCharWidth && extent.cy == tm.tmHeight, 5);
    RECT calc = {0, 0, 200, 40};
    DrawTextA(dc, "H&elp &&", -1, &calc, DT_CALCRECT | DT_SINGLELINE);
    CHECK(calc.right == 6 * tm.tmAveCharWidth && calc.bottom == tm.tmHeight, 6);
    calc.right = 200;
    DrawTextA(dc, "H&elp &&", -1, &calc, DT_CALCRECT | DT_SINGLELINE | DT_NOPREFIX);
    CHECK(calc.right == 8 * tm.tmAveCharWidth, 7);
    SelectObject(dc, old); DeleteObject(f); ReleaseDC(h, dc);

    SetWindowLongA(h, GWL_STYLE, GetWindowLongA(h, GWL_STYLE) | WS_CLIPCHILDREN);
    WNDCLASSA wc = {0}; wc.lpfnWndProc = DefWindowProcA; wc.hbrBackground = (HBRUSH)GetStockObject(WHITE_BRUSH); wc.lpszClassName = "phase-child";
    RegisterClassA(&wc);
    HWND a = CreateWindowExA(0, "phase-child", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 40, 120, 40, 24, h, (HMENU)901, 0, 0);
    HWND b = CreateWindowExA(0, "phase-child", "", WS_CHILD | WS_VISIBLE, 160, 110, 40, 40, h, (HMENU)902, 0, 0);
    UpdateWindow(a); UpdateWindow(b);
    dc = GetDC(h);
    RECT all = {0,0,320,200}; HBRUSH red = CreateSolidBrush(RGB(220,30,40));
    FillRect(dc, &all, red); ReleaseDC(h, dc); DeleteObject(red);
    dc = GetDC(0);
    CHECK(GetPixel(dc, 50, 125) == RGB(255,255,255) && GetPixel(dc, 170, 125) == RGB(255,255,255), 8);
    CHECK(GetPixel(dc, 120, 125) == RGB(220,30,40), 9);
    ReleaseDC(0, dc);
    RECT rc; GetClientRect(a, &rc);
    CHECK(rc.right == 38 && rc.bottom == 22, 10);
    InvalidateRect(h, 0, TRUE); UpdateWindow(h);
    dc = GetDC(0);
    CHECK(GetPixel(dc, 50, 125) == RGB(255,255,255) && GetPixel(dc, 170, 125) == RGB(255,255,255), 11);
    ReleaseDC(0, dc);
    CreateWindowExA(0, "button", "&Group &&", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, 10, 10, 140, 40, h, (HMENU)910, 0, 0);
    CreateWindowExA(0, "static", "&A && B", WS_CHILD | WS_VISIBLE, 160, 10, 140, 18, h, (HMENU)911, 0, 0);
    CreateWindowExA(0, "static", "&A && B", WS_CHILD | WS_VISIBLE | SS_NOPREFIX, 160, 35, 140, 18, h, (HMENU)912, 0, 0);
    HWND radio = CreateWindowExA(0, "button", "&Radio", WS_CHILD | WS_VISIBLE | BS_RADIOBUTTON, 10, 60, 140, 20, h, (HMENU)913, 0, 0);
    SendMessageA(radio, BM_SETCHECK, BST_CHECKED, 0);
    HWND check = CreateWindowExA(0, "button", "&Check", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 160, 60, 140, 20, h, (HMENU)914, 0, 0);
    SendMessageA(check, BM_SETCHECK, BST_CHECKED, 0);
    char line[96]; wsprintfA(line, "phase0 checks=%08x", checks); OutputDebugStringA(line);
}

void phase0_message(HWND h) { int r = MessageBoxA(h, "Fixture warning", "Icon contract", MB_YESNO | MB_ICONEXCLAMATION | MB_DEFBUTTON2); OutputDebugStringA(r == IDNO ? "phase0 default=No" : "phase0 default=wrong"); }
void phase0_about(HWND h) { ShellAboutW(h, L"Fixture#Kit profile", L"CC0 contract test", 0); }
