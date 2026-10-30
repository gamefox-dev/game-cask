/* Original CC0-1.0. Deep i386 caller stacks must resume lifted after each cooperative wait. */
#include <windows.h>
int _tls_index; /* Freestanding import-library TLS anchor, as in win32-hello. */
static HANDLE ready, done, mutex;
static CRITICAL_SECTION cs;
static CONDITION_VARIABLE cv;
static DWORD slot;
static volatile LONG value, notified;
__declspec(noinline) static unsigned inner(unsigned id) {
    unsigned sentinel[4] = {id, id + 5, id ^ 0x7654, id * 3};
    TlsSetValue(slot, (void *)(ULONG_PTR)(id + 0x4000));
    SetLastError(100 + id);
    Sleep(0);
    unsigned bad = GetLastError() != 100 + id;
    DWORD teb, tid;
    __asm__ volatile("movl %%fs:0x18,%0" : "=r"(teb));
    __asm__ volatile("movl %%fs:0x24,%0" : "=r"(tid));
    bad += !teb || tid != GetCurrentThreadId() || *(DWORD *)(ULONG_PTR)(teb + 0x34) != 100 + id;
    WaitForSingleObject(ready, INFINITE);
    WaitForSingleObject(mutex, INFINITE);
    InterlockedExchangeAdd(&value, id);
    ReleaseMutex(mutex);
    EnterCriticalSection(&cs);
    while (!notified) SleepConditionVariableCS(&cv, &cs, INFINITE);
    LeaveCriticalSection(&cs);
    bad += TlsGetValue(slot) != (void *)(ULONG_PTR)(id + 0x4000);
    bad += sentinel[0] != id || sentinel[1] != id + 5 || sentinel[2] != (id ^ 0x7654) || sentinel[3] != id * 3;
    return bad ? 999 : id + 10;
}
static DWORD WINAPI worker(void *arg) { return inner((unsigned)(ULONG_PTR)arg); }
void entry(void) {
    slot = TlsAlloc();
    ready = CreateEventA(0, TRUE, FALSE, 0); done = CreateEventA(0, FALSE, TRUE, 0);
    mutex = CreateMutexA(0, FALSE, 0);
    InitializeCriticalSection(&cs); InitializeConditionVariable(&cv);
    HANDLE h[2];
    h[0] = CreateThread(0, 0, worker, (void *)1, 0, 0);
    h[1] = CreateThread(0, 0, worker, (void *)2, 0, 0);
    unsigned bad = WaitForSingleObject(ready, 4) != WAIT_TIMEOUT;
    DWORD current_code = 0;
    bad += !GetExitCodeThread(GetCurrentThread(), &current_code) || current_code != STILL_ACTIVE;
    static CRITICAL_SECTION lifecycle[520];
    for (unsigned i = 0; i < 520; i++) {
        InitializeCriticalSection(&lifecycle[i]); EnterCriticalSection(&lifecycle[i]);
        bad += lifecycle[i].RecursionCount != 1;
        LeaveCriticalSection(&lifecycle[i]); DeleteCriticalSection(&lifecycle[i]);
    }
    LONGLONG (WINAPI *exchange64)(volatile LONGLONG *, LONGLONG) =
        (void *)GetProcAddress(GetModuleHandleA("kernel32.dll"), "InterlockedExchange64");
    LONGLONG (WINAPI *compare64)(volatile LONGLONG *, LONGLONG, LONGLONG) =
        (void *)GetProcAddress(GetModuleHandleA("kernel32.dll"), "InterlockedCompareExchange64");
    volatile LONGLONG atom = 0x123456789abcdef0LL;
    if (!exchange64 || !compare64) bad++;
    else {
        bad += exchange64(&atom, 0x8877665544332211ULL) != 0x123456789abcdef0LL;
        bad += compare64(&atom, 7, 0x8877665544332211ULL) != (LONGLONG)0x8877665544332211ULL || atom != 7;
        bad += compare64(&atom, 9, 8) != 7 || atom != 7;
    }
    bad += WaitForSingleObject(done, 0) != 0 || WaitForSingleObject(done, 0) != WAIT_TIMEOUT;
    SetEvent(ready); Sleep(1);
    EnterCriticalSection(&cs); notified = 1; WakeAllConditionVariable(&cv); LeaveCriticalSection(&cs);
    bad += WaitForMultipleObjects(2, h, TRUE, INFINITE) != 0;
    DWORD a = 0, b = 0; GetExitCodeThread(h[0], &a); GetExitCodeThread(h[1], &b);
    bad += a != 11 || b != 12 || value != 3 || TlsGetValue(slot) != 0;
    OutputDebugStringA(bad ? "x86-threads FAIL" : "x86-threads PASS exits=23 value=3");
    CloseHandle(h[0]); CloseHandle(h[1]); CloseHandle(ready); CloseHandle(done); CloseHandle(mutex);
    TlsFree(slot);
}
