/* Original CC0-1.0. Native Windows x64 layouts and real Win64 callbacks. */
#include <windows.h>
static int clicks;
static LRESULT CALLBACK proc(HWND h,UINT message,WPARAM w,LPARAM l){
    if(message==WM_PAINT){PAINTSTRUCT ps;HDC dc=BeginPaint(h,&ps);RECT rc={0,0,320,200};HBRUSH bg=CreateSolidBrush(RGB(20,30,50));FillRect(dc,&rc,bg);DeleteObject(bg);
        RECT box={20+clicks*12,60,60+clicks*12,100};HBRUSH b=CreateSolidBrush(RGB(40,220,90));FillRect(dc,&box,b);DeleteObject(b);
        SetBkMode(dc,TRANSPARENT);SetTextColor(dc,RGB(255,255,255));TextOutW(dc,12,12,L"AMD64 window",12);EndPaint(h,&ps);return 0;
    }
    if(message==WM_LBUTTONDOWN || (message==WM_KEYDOWN && w==VK_RIGHT)){clicks++;InvalidateRect(h,0,TRUE);char s[80];wsprintfA(s,"x64-gui clicks=%d",clicks);OutputDebugStringA(s);return 0;}
    if(message==WM_APP)return (LRESULT)(w^(UINT_PTR)l);
    if(message==WM_DESTROY){PostQuitMessage(0);return 0;}return DefWindowProcW(h,message,w,l);
}
int main(void){HINSTANCE instance=GetModuleHandleW(0);WNDCLASSEXW c={0};c.cbSize=sizeof c;c.hInstance=instance;c.lpfnWndProc=proc;c.lpszClassName=L"x64-conformance";
    ATOM a=RegisterClassExW(&c);HWND h=CreateWindowExW(0,c.lpszClassName,L"AMD64",WS_OVERLAPPEDWINDOW,0,0,320,200,0,0,instance,0);
    UINT_PTR wide=(UINT_PTR)0x123456789abcdef0ull,other=(UINT_PTR)0x0fedcba987654321ull;
    SetWindowLongPtrW(h,GWLP_USERDATA,(LONG_PTR)wide);
    SYSTEM_INFO info;GetSystemInfo(&info);
    int pointer_ok=info.wProcessorArchitecture==PROCESSOR_ARCHITECTURE_AMD64 && info.dwPageSize==4096 && info.dwNumberOfProcessors==1 &&
        (UINT_PTR)GetCurrentThread()==(UINT_PTR)-2 && (UINT_PTR)GetCurrentProcess()==(UINT_PTR)-1 &&
        (UINT_PTR)GetWindowLongPtrW(h,GWLP_USERDATA)==wide && (UINT_PTR)SendMessageW(h,WM_APP,wide,(LPARAM)other)==(wide^other);
    ShowWindow(h,SW_SHOW);UpdateWindow(h);OutputDebugStringA(a && h && pointer_ok?"x64-gui PASS window":"x64-gui FAIL window");MSG message;while(GetMessageW(&message,0,0,0)){TranslateMessage(&message);DispatchMessageW(&message);}return 0;
}
