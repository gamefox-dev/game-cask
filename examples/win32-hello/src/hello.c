/* win32-hello — Game Cask pipeline example (CC0-1.0).
 * A tiny Win32 GUI program compiled to an i386 .exe at build time, then analysed, lifted to C and
 * run in the browser by the Win32 platform profile. It exercises the APIs a small Windows game
 * uses: window class + menu + accelerators from resources, bitmap resource drawn through a memory
 * DC (BitBlt), InvertRect selection, TextOut, a timer, MessageBox, the registry and a dense switch.
 * Click a tile to select it; arrow keys move the selection; F2 / Game>New reshuffles. */
#include <windows.h>
#include "ids.h"

#define COLS 6
#define ROWS 4
#define TILE 48
#define TOP 30
static HINSTANCE inst;
static HBITMAP tiles;
static int board[ROWS][COLS];
static int sel = -1, clicks, ticks, seed = 1;
static char status[64];

static int rnd(void) { seed = seed * 1103515245 + 12345; return (seed >> 16) & 0x7fff; }
static void shuffle(void) { for (int r = 0; r < ROWS; r++) for (int c = 0; c < COLS; c++) board[r][c] = rnd() % 4; sel = -1; }

static void load_clicks(void) {
    HKEY k; DWORD v = 0, sz = sizeof v, type;
    if (RegCreateKeyExA(HKEY_CURRENT_USER, "Software\\GameCask\\Win32Hello", 0, 0, 0, KEY_ALL_ACCESS, 0, &k, 0) == ERROR_SUCCESS) {
        if (RegQueryValueExA(k, "clicks", 0, &type, (BYTE *)&v, &sz) == ERROR_SUCCESS) clicks = (int)v;
        RegCloseKey(k);
    }
}
static void save_clicks(void) {
    HKEY k; DWORD v = (DWORD)clicks;
    if (RegCreateKeyExA(HKEY_CURRENT_USER, "Software\\GameCask\\Win32Hello", 0, 0, 0, KEY_ALL_ACCESS, 0, &k, 0) == ERROR_SUCCESS) {
        RegSetValueExA(k, "clicks", 0, REG_DWORD, (const BYTE *)&v, sizeof v);
        RegCloseKey(k);
    }
}
static const char *kind_name(int k) {
    switch (k) { /* dense switch -> jump table */
    case 0: return "red";
    case 1: return "green";
    case 2: return "blue";
    case 3: return "gold";
    case 4: return "none";
    case 5: return "?";
    default: return "";
    }
}
static void tile_rect(int i, RECT *r) { r->left = (i % COLS) * TILE + 8; r->top = TOP + (i / COLS) * TILE; r->right = r->left + TILE - 4; r->bottom = r->top + TILE - 4; }

static void paint(HWND h, HDC dc) {
    RECT rc; GetClientRect(h, &rc);
    FillRect(dc, &rc, (HBRUSH)GetStockObject(DKGRAY_BRUSH));
    HDC mem = CreateCompatibleDC(dc);
    HGDIOBJ old = SelectObject(mem, tiles);
    for (int i = 0; i < ROWS * COLS; i++) {
        RECT t; tile_rect(i, &t);
        BitBlt(dc, t.left, t.top, TILE - 4, TILE - 4, mem, board[i / COLS][i % COLS] * 44, 0, SRCCOPY);
        if (i == sel) InvertRect(dc, &t);
    }
    SelectObject(mem, old);
    DeleteDC(mem);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(255, 255, 255));
    wsprintfA(status, "clicks %d  ticks %d  sel %s", clicks, ticks, sel >= 0 ? kind_name(board[sel / COLS][sel % COLS]) : "-");
    TextOutA(dc, 8, 8, status, lstrlenA(status));
}

static LRESULT CALLBACK wndproc(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_CREATE: SetTimer(h, 1, 500, 0); return 0;
    case WM_TIMER: { ticks++; RECT r = {0, 0, 320, 24}; InvalidateRect(h, &r, TRUE); return 0; }
    case WM_LBUTTONDOWN: {
        int x = (short)LOWORD(l), y = (short)HIWORD(l);
        for (int i = 0; i < ROWS * COLS; i++) { RECT t; tile_rect(i, &t); POINT p = {x, y}; if (PtInRect(&t, p)) { sel = i; clicks++; save_clicks(); InvalidateRect(h, 0, TRUE); } }
        return 0;
    }
    case WM_KEYDOWN:
        if (sel < 0) sel = 0;
        else if (w == VK_RIGHT) sel = (sel + 1) % (ROWS * COLS);
        else if (w == VK_LEFT) sel = (sel + ROWS * COLS - 1) % (ROWS * COLS);
        else if (w == VK_DOWN) sel = (sel + COLS) % (ROWS * COLS);
        else if (w == VK_UP) sel = (sel + ROWS * COLS - COLS) % (ROWS * COLS);
        InvalidateRect(h, 0, TRUE);
        return 0;
    case WM_COMMAND:
        switch (LOWORD(w)) {
        case IDM_NEW: shuffle(); InvalidateRect(h, 0, TRUE); return 0;
        case IDM_ABOUT: MessageBoxA(h, "Game Cask pipeline example", "About", MB_OK); return 0;
        case IDM_EXIT: DestroyWindow(h); return 0;
        }
        break;
    case WM_PAINT: { PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps); paint(h, dc); EndPaint(h, &ps); return 0; }
    case WM_DESTROY: KillTimer(h, 1); PostQuitMessage(0); return 0;
    }
    return DefWindowProcA(h, m, w, l);
}

int _tls_index = 0;
void entry(void) {
    inst = GetModuleHandleA(0);
    tiles = LoadBitmapA(inst, MAKEINTRESOURCEA(IDB_TILES));
    load_clicks();
    shuffle();
    WNDCLASSEXA wc = {0};
    wc.cbSize = sizeof wc; wc.style = CS_DBLCLKS; wc.lpfnWndProc = wndproc; wc.hInstance = inst;
    wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH); wc.lpszMenuName = MAKEINTRESOURCEA(IDR_MENU); wc.lpszClassName = "hello";
    RegisterClassExA(&wc);
    RECT r = {0, 0, COLS * TILE + 12, TOP + ROWS * TILE + 4};
    AdjustWindowRect(&r, WS_OVERLAPPEDWINDOW, TRUE);
    HWND h = CreateWindowExA(0, "hello", "Win32 hello", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, r.right - r.left, r.bottom - r.top, 0, 0, inst, 0);
    ShowWindow(h, SW_SHOW);
    UpdateWindow(h);
    HACCEL acc = LoadAcceleratorsA(inst, MAKEINTRESOURCEA(IDR_ACCEL));
    MSG msg;
    while (GetMessageA(&msg, 0, 0, 0)) {
        if (!TranslateAcceleratorA(h, acc, &msg)) { TranslateMessage(&msg); DispatchMessageA(&msg); }
    }
    ExitProcess((UINT)msg.wParam);
}
