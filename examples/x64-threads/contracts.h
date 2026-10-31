/* Original CC0-1.0: independently checked Win32 thread/synchronisation contracts. */
#ifndef THREAD_CONTRACTS_H
#define THREAD_CONTRACTS_H
static SRWLOCK srw;
static CONDITION_VARIABLE scv;
static HANDLE contract_gate;
static volatile LONG contract_value, fls_calls;
static DWORD fls_slot;
static volatile LONG spin_value, address_value;
/* Resolve optional Windows-8 exports without requiring a newer host import library. */
static BOOL (WINAPI *wait_address)(volatile VOID *, PVOID, SIZE_T, DWORD);
static VOID (WINAPI *wake_address)(PVOID);
static DWORD WINAPI address_worker(void *unused) {
    (void)unused;
    LONG compare = 0;
    if (!wait_address(&address_value, &compare, sizeof compare, INFINITE)) return 998;
    while (!spin_value) { /* CPU-bound worker must not starve its signaller. */ }
    return address_value == 9 ? 73 : 999;
}
static void WINAPI fls_cleanup(void *value) {
    if (value == (void *)(uintptr_t)0x8765) InterlockedIncrement(&fls_calls);
}
static DWORD WINAPI contract_worker(void *unused) {
    (void)unused;
    FlsSetValue(fls_slot, (void *)(uintptr_t)0x8765);
    AcquireSRWLockExclusive(&srw);
    contract_value = 1; WakeAllConditionVariable(&scv);
    ReleaseSRWLockExclusive(&srw);
    WaitForSingleObject(contract_gate, INFINITE);
    AcquireSRWLockShared(&srw);
    DWORD result = contract_value == 3 ? 71 : 999;
    ReleaseSRWLockShared(&srw);
    ExitThread(result);
    return 999;
}
static unsigned contracts(void) {
    unsigned bad = 0;
    DWORD current_code = 0;
    bad += !GetExitCodeThread(GetCurrentThread(), &current_code) || current_code != STILL_ACTIVE;
    static CRITICAL_SECTION lifecycle[520];
    for (unsigned i = 0; i < 520; i++) {
        InitializeCriticalSection(&lifecycle[i]); EnterCriticalSection(&lifecycle[i]);
        bad += lifecycle[i].RecursionCount != 1;
        LeaveCriticalSection(&lifecycle[i]); DeleteCriticalSection(&lifecycle[i]);
    }
    EnterCriticalSection(&guard); EnterCriticalSection(&guard);
    bad += !TryEnterCriticalSection(&guard) || guard.RecursionCount != 3;
    LeaveCriticalSection(&guard); LeaveCriticalSection(&guard);
    bad += SleepConditionVariableCS(&available, &guard, 1) != 0 || GetLastError() != ERROR_TIMEOUT;
    bad += guard.RecursionCount != 1 || guard.LockCount != 0;
    LeaveCriticalSection(&guard);
    HANDLE auto_event = CreateEventA(0, FALSE, TRUE, 0), manual = CreateEventA(0, TRUE, TRUE, 0);
    bad += WaitForSingleObject(auto_event, 0) != 0;
    bad += WaitForSingleObject(auto_event, 0) != WAIT_TIMEOUT;
    HANDLE pair[2] = {auto_event, manual};
    bad += WaitForMultipleObjects(2, pair, FALSE, 0) != 1;
    bad += WaitForMultipleObjects(2, pair, TRUE, 0) != WAIT_TIMEOUT;
    SetEvent(auto_event);
    bad += WaitForMultipleObjects(2, pair, TRUE, 0) != 0;
    bad += WaitForSingleObject(manual, 0) != 0;
    ResetEvent(manual); bad += WaitForSingleObject(manual, 2) != WAIT_TIMEOUT;
    HANDLE m = CreateMutexA(0, TRUE, 0);
    bad += WaitForSingleObject(m, 0) != 0;
    bad += !ReleaseMutex(m) || !ReleaseMutex(m);
    SetLastError(0); bad += ReleaseMutex(m) != 0 || GetLastError() != ERROR_NOT_OWNER;
    HANDLE sem = CreateSemaphoreA(0, 0, 2, 0); LONG old = -1;
    bad += !ReleaseSemaphore(sem, 2, &old) || old != 0;
    bad += ReleaseSemaphore(sem, 1, 0) != 0;
    bad += WaitForSingleObject(sem, 0) != 0 || WaitForSingleObject(sem, 0) != 0;
    bad += WaitForSingleObject(sem, 1) != WAIT_TIMEOUT;
    InitializeSRWLock(&srw); InitializeConditionVariable(&scv);
    AcquireSRWLockShared(&srw); bad += !TryAcquireSRWLockShared(&srw);
    bad += TryAcquireSRWLockExclusive(&srw) != 0;
    ReleaseSRWLockShared(&srw); ReleaseSRWLockShared(&srw);
    AcquireSRWLockExclusive(&srw);
    bad += SleepConditionVariableSRW(&scv, &srw, 2, 0) != 0 || GetLastError() != ERROR_TIMEOUT;
    contract_gate = CreateEventA(0, TRUE, FALSE, 0);
    fls_slot = FlsAlloc(fls_cleanup);
    HANDLE h = CreateThread(0, 0, contract_worker, 0, 0, 0);
    while (!contract_value) bad += !SleepConditionVariableSRW(&scv, &srw, INFINITE, 0);
    contract_value = 3;
    ReleaseSRWLockExclusive(&srw); SetEvent(contract_gate);
    bad += WaitForSingleObject(h, INFINITE) != 0;
    DWORD code = 0; GetExitCodeThread(h, &code); bad += code != 71 || fls_calls != 1;
    FlsFree(fls_slot);
    DWORD allocated[64], n = 0;
    while (n < 64 && (allocated[n] = TlsAlloc()) != TLS_OUT_OF_INDEXES) n++;
    bad += n != 63;
    for (DWORD i = 0; i < n; i++) TlsFree(allocated[i]);
    DWORD reuse = TlsAlloc(); bad += reuse == TLS_OUT_OF_INDEXES || TlsGetValue(reuse) != 0; TlsFree(reuse);
    HMODULE kernel = GetModuleHandleA("kernel32.dll");
    wait_address = (void *)GetProcAddress(kernel, "WaitOnAddress");
    wake_address = (void *)GetProcAddress(kernel, "WakeByAddressAll");
    if (!wait_address || !wake_address) return bad + 100;
    HANDLE address_thread = CreateThread(0, 0, address_worker, 0, 0, 0);
    Sleep(0);
    address_value = 9; wake_address((void *)&address_value);
    Sleep(0); /* Worker now spins until its instruction quantum expires. */
    spin_value = 1;
    bad += WaitForSingleObject(address_thread, INFINITE) != 0;
    GetExitCodeThread(address_thread, &code); bad += code != 73;
    CloseHandle(address_thread);
    LONG compare = 9;
    bad += wait_address(&address_value, &compare, sizeof compare, 1) != 0 || GetLastError() != ERROR_TIMEOUT;
    compare = 8;
    bad += !wait_address(&address_value, &compare, sizeof compare, 0);
    CloseHandle(auto_event); CloseHandle(manual); CloseHandle(m); CloseHandle(sem);
    CloseHandle(h); CloseHandle(contract_gate);
    return bad;
}
#endif
