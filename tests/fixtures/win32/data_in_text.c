/* Analyzer fixture (CC0-1.0): data placed inside the code section, referenced by immediate pointers, next to a
 * real callback that is only referenced by pointer. The analyzer must classify the data as data seeds (not lift
 * them as functions) and keep the callback as a function. Never run; only analysed. */
#include <windows.h>

__attribute__((section(".text"), used)) static const char text_ascii[] = "helper-control.ocx";
__attribute__((section(".text"), used)) static const unsigned short text_wide[] = {'W', 'i', 'd', 'e', ' ', 'n', 'a', 'm', 'e', 0};
__attribute__((section(".text"), used)) static const unsigned char text_zero[16] = {0};
/* nop; in al, 0x60; ret: decodes, but `in` is not supported user-mode code */
__attribute__((section(".text"), used)) static const unsigned char text_bad[4] = {0x90, 0xe4, 0x60, 0xc3};

int _tls_index = 0; /* no CRT: satisfy the linker's TLS reference */

static LRESULT CALLBACK real_callback(HWND h, UINT m, WPARAM w, LPARAM l) {
    if (m == WM_USER) return (LRESULT)(w + (WPARAM)l);
    return DefWindowProcA(h, m, w, l);
}

void entry(void) {
    OutputDebugStringA(text_ascii);
    OutputDebugStringW((const WCHAR *)text_wide);
    OutputDebugStringA((const char *)text_zero);
    OutputDebugStringA((const char *)text_bad);
    SetWindowLongA(0, GWL_WNDPROC, (LONG)(LONG_PTR)real_callback);
    ExitProcess(0);
}
