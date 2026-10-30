/* Original CC0-1.0 fixture. State squares: pad A / raw keyboard / raw mouse / consistent key state. */
#include <windows.h>
#include <xinput.h>
static int keyboard, mouse, keycode, dx, dy, keydown;
static LRESULT CALLBACK proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_INPUT) {
        UINT size = 0;
        if (GetRawInputData((HRAWINPUT)lp, RID_INPUT, 0, &size, sizeof(RAWINPUTHEADER)) != 0)
            ExitProcess(2);
        RAWINPUT raw;
        UINT shortsize = 1;
        if (GetRawInputData((HRAWINPUT)lp, RID_INPUT, &raw, &shortsize, sizeof(RAWINPUTHEADER)) != (UINT)-1
            || shortsize != size) ExitProcess(7);
        UINT headersize = sizeof(RAWINPUTHEADER);
        if (GetRawInputData((HRAWINPUT)lp, RID_HEADER, &raw, &headersize, sizeof(RAWINPUTHEADER))
            != sizeof(RAWINPUTHEADER)) ExitProcess(8);
        if (GetRawInputData((HRAWINPUT)lp, RID_INPUT, &raw, &size, sizeof(RAWINPUTHEADER)) != size)
            ExitProcess(3);
        if (raw.header.dwType == RIM_TYPEKEYBOARD) {
            keyboard++; keycode = raw.data.keyboard.VKey;
            keydown = !(raw.data.keyboard.Flags & RI_KEY_BREAK);
        } else {
            mouse++; dx = raw.data.mouse.lLastX; dy = raw.data.mouse.lLastY;
        }
        return 0;
    }
    return DefWindowProcA(hwnd, msg, wp, lp);
}
static void box(HDC dc, int x, int on) {
    RECT r = {x, 40, x + 40, 80};
    HBRUSH b = CreateSolidBrush(on ? RGB(0, 220, 0) : RGB(220, 0, 0));
    FillRect(dc, &r, b); DeleteObject(b);
}
int main(void) {
    WNDCLASSA cls = {0}; cls.lpfnWndProc = proc; cls.lpszClassName = "InputFixture";
    RegisterClassA(&cls);
    HWND hwnd = CreateWindowExA(0, cls.lpszClassName, "Input", WS_VISIBLE | WS_POPUP,
        0, 0, 320, 160, 0, 0, 0, 0);
    RAWINPUTDEVICE devices[2] = {{1, 6, 0, hwnd}, {1, 2, 0, hwnd}};
    if (!RegisterRawInputDevices(devices, 2, sizeof devices[0])) ExitProcess(4);
    UINT invalidsize = 0;
    if (GetRawInputData(0, RID_INPUT, 0, &invalidsize, sizeof(RAWINPUTHEADER)) != (UINT)-1)
        ExitProcess(9);
    OutputDebugStringA("x64-input PASS window raw registered");
    DWORD lastpacket = 0; int lastkey = -1, lastmouse = -1;
    for (;;) {
        MSG msg;
        while (PeekMessageA(&msg, 0, 0, 0, PM_REMOVE)) DispatchMessageA(&msg);
        XINPUT_STATE state = {0};
        DWORD result = XInputGetState(0, &state);
        if (!result) {
            XINPUT_CAPABILITIES caps; XINPUT_VIBRATION vibration = {0};
            if (XInputGetCapabilities(0, 0, &caps) || XInputSetState(0, &vibration)) ExitProcess(5);
        }
        BYTE keys[256]; GetKeyboardState(keys);
        int consistent = !!(keys['K'] & 128) == !!(GetAsyncKeyState('K') & 0x8000);
        if (!consistent || keys[VK_SHIFT] != (keys[VK_LSHIFT] | keys[VK_RSHIFT]) ||
            !!(keys[VK_LBUTTON] & 128) != !!(GetAsyncKeyState(VK_LBUTTON) & 0x8000)) ExitProcess(6);
        HDC dc = GetDC(hwnd);
        RECT all = {0, 0, 320, 160}; FillRect(dc, &all, (HBRUSH)GetStockObject(BLACK_BRUSH));
        SetTextColor(dc, RGB(255, 255, 255)); SetBkMode(dc, TRANSPARENT);
        TextOutA(dc, 10, 10, "PAD", 3); TextOutA(dc, 80, 10, "RAW KEY", 7);
        TextOutA(dc, 150, 10, "RAW MOUSE", 9); TextOutA(dc, 220, 10, "KEY", 3);
        box(dc, 10, !result && (state.Gamepad.wButtons & XINPUT_GAMEPAD_A));
        box(dc, 80, keyboard && keydown); box(dc, 150, mouse > 0); box(dc, 220, keys['K'] & 128);
        ReleaseDC(hwnd, dc);
        if (lastpacket != state.dwPacketNumber || lastkey != keyboard || lastmouse != mouse) {
            char text[256];
            wsprintfA(text, "input connected=%u packet=%u buttons=%u lx=%d ly=%d lt=%u "
                "rawkey=%u vk=%u down=%u mouse=%u dx=%d dy=%d consistent=%u",
                !result, state.dwPacketNumber, state.Gamepad.wButtons, state.Gamepad.sThumbLX,
                state.Gamepad.sThumbLY, state.Gamepad.bLeftTrigger, keyboard, keycode, keydown, mouse, dx, dy,
                consistent);
            OutputDebugStringA(text);
            lastpacket = state.dwPacketNumber; lastkey = keyboard; lastmouse = mouse;
        }
        Sleep(0);
    }
}
