/* Original CC0-1.0. K50 review regression, both guest widths (freestanding entry).
 * A SleepConditionVariable{CS,SRW} waiter whose 5-ms timeout expires while another thread holds
 * the lock in Sleep(50) must not freeze virtual time. As on Windows, the wait returns FALSE with
 * ERROR_TIMEOUT only after the holder's Sleep ends and it releases the lock (about 50 ms). */
#include <windows.h>
int _tls_index;
static CRITICAL_SECTION cs;
static SRWLOCK srw;
static CONDITION_VARIABLE cv;
static volatile LONG released;
static volatile DWORD release_tick;
static DWORD WINAPI cs_holder(void *unused) {
    (void)unused; EnterCriticalSection(&cs); Sleep(50);
    release_tick = GetTickCount(); InterlockedExchange(&released, 1); LeaveCriticalSection(&cs); return 0;
}
static DWORD WINAPI srw_holder(void *unused) {
    (void)unused; AcquireSRWLockExclusive(&srw); Sleep(50);
    release_tick = GetTickCount(); InterlockedExchange(&released, 1); ReleaseSRWLockExclusive(&srw); return 0;
}
static void put(char **o, const char *s) { while (*s) *(*o)++ = *s++; }
static void num(char **o, DWORD v) { char t[12]; int n = 0; do t[n++] = (char)('0' + v % 10); while (v /= 10); while (n) *(*o)++ = t[--n]; }
static unsigned run(int srw_case, char **o) {
    released = 0;
    if (srw_case) AcquireSRWLockExclusive(&srw); else EnterCriticalSection(&cs);
    HANDLE t = CreateThread(0, 0, srw_case ? srw_holder : cs_holder, 0, 0, 0);
    DWORD start = GetTickCount();
    BOOL ok = srw_case ? SleepConditionVariableSRW(&cv, &srw, 5, 0) : SleepConditionVariableCS(&cv, &cs, 5);
    DWORD error = GetLastError(), now = GetTickCount();
    LONG got = released;
    if (srw_case) ReleaseSRWLockExclusive(&srw); else LeaveCriticalSection(&cs);
    unsigned bad = !t || ok || error != ERROR_TIMEOUT || !got || now - start < 50 || now < release_tick;
    bad += WaitForSingleObject(t, INFINITE) != WAIT_OBJECT_0;
    CloseHandle(t);
    put(o, srw_case ? " srw_ms=" : " cs_ms="); num(o, now - start);
    return bad;
}
void entry(void) {
    InitializeCriticalSection(&cs); InitializeSRWLock(&srw); InitializeConditionVariable(&cv);
    char text[96], *o = text; put(&o, "cv-timeout");
    unsigned bad = run(0, &o); bad += run(1, &o);
    put(&o, bad ? " FAIL" : " PASS"); *o = 0;
    OutputDebugStringA(text);
    DeleteCriticalSection(&cs);
}
/* An absolute data reference makes even the tiny AMD64 main relocatable. */
void (*volatile entry_anchor)(void) = entry;
