/* Original CC0-1.0. Identical queue/checksum code in the native and normal -O2 Win64 CRT builds. */
#include <stdint.h>
#include <stdio.h>
#ifdef _WIN32
#include <windows.h>
#include <process.h>
#define LOCAL __thread
#else
#include "native.h"
#define LOCAL _Thread_local
#endif
static CRITICAL_SECTION guard;
static CONDITION_VARIABLE available;
static HANDLE start, slots;
static DWORD tls_slot;
static LOCAL uint64_t local = 0x12345678;
static unsigned queue[8], head, tail, count, finished, processed, errors, worker_errors;
static uint64_t checksum;
#ifdef _WIN32
static volatile LONG tls_attaches, tls_detaches, tls_errors;
static void NTAPI tls_callback(PVOID module, DWORD reason, PVOID reserved) {
    (void)module; (void)reserved;
    if (reason == DLL_THREAD_ATTACH) {
        if (local != 0x12345678) InterlockedIncrement(&tls_errors);
        InterlockedIncrement(&tls_attaches);
    }
    if (reason == DLL_THREAD_DETACH) InterlockedIncrement(&tls_detaches);
}
PIMAGE_TLS_CALLBACK callback_slot __attribute__((section(".CRT$XLC"),used)) = tls_callback;
#endif
static uint64_t work(unsigned x) {
    uint64_t y = x + 1;
    for (unsigned i = 0; i < 19; i++) y = (y * 1664525 + 1013904223) ^ (y >> 17);
    return y;
}
static DWORD WINAPI worker(LPVOID arg) {
    unsigned id = (unsigned)(uintptr_t)arg;
    unsigned bad = local != 0x12345678 || TlsGetValue(tls_slot) != 0;
    local += id;
    TlsSetValue(tls_slot, (void *)(uintptr_t)(0x1000 + id));
    SetLastError(800 + id);
    Sleep(0);
    bad += GetLastError() != 800 + id;
#ifdef _WIN32
    uint64_t teb, tid;
    __asm__ volatile("movq %%gs:0x30,%0" : "=r"(teb));
    __asm__ volatile("movq %%gs:0x48,%0" : "=r"(tid));
    bad += !teb || tid != GetCurrentThreadId() || *(DWORD *)(uintptr_t)(teb + 0x68) != 800 + id;
#endif
    WaitForSingleObject(start, INFINITE);
    for (;;) {
        EnterCriticalSection(&guard);
        while (!count && !finished) SleepConditionVariableCS(&available, &guard, INFINITE);
        if (!count) { LeaveCriticalSection(&guard); break; }
        unsigned job = queue[head++ % 8]; count--;
        LeaveCriticalSection(&guard);
        uint64_t value = work(job);
        EnterCriticalSection(&guard); checksum += value; processed++; LeaveCriticalSection(&guard);
        ReleaseSemaphore(slots, 1, 0);
        Sleep(0);
    }
    bad += local != 0x12345678 + id;
    bad += TlsGetValue(tls_slot) != (void *)(uintptr_t)(0x1000 + id);
    EnterCriticalSection(&guard); worker_errors += bad; LeaveCriticalSection(&guard);
    return 100 + id;
}
#ifdef _WIN32
static unsigned __stdcall begin_worker(void *arg) { return worker(arg); }
#endif
#ifdef _WIN32
#include "contracts.h"
#endif
int main(void) {
    InitializeCriticalSection(&guard); InitializeConditionVariable(&available);
    tls_slot = TlsAlloc(); start = CreateEventA(0, TRUE, FALSE, 0); slots = CreateSemaphoreA(0, 8, 8, 0);
    HANDLE workers[4];
    for (unsigned i = 0; i < 4; i++) {
#ifdef _WIN32
        if (i == 3) workers[i] = (HANDLE)_beginthreadex(0, 0, begin_worker, (void *)(uintptr_t)i, 0, 0);
        else
#endif
        workers[i] = CreateThread(0, 0, worker, (void *)(uintptr_t)i, 0, 0);
        if (!workers[i]) errors++;
    }
    errors += WaitForSingleObject(start, 3) != WAIT_TIMEOUT;
    DWORD active = 0; GetExitCodeThread(workers[0], &active); errors += active != 259;
    SetEvent(start);
    /* Let the pool reach its empty-queue condition-variable wait before publishing. */
    Sleep(1);
    for (unsigned i = 0; i < 96; i++) {
        errors += WaitForSingleObject(slots, INFINITE) != 0;
        EnterCriticalSection(&guard); queue[tail++ % 8] = i; count++;
        WakeConditionVariable(&available); LeaveCriticalSection(&guard);
    }
    EnterCriticalSection(&guard); finished = 1; WakeAllConditionVariable(&available); LeaveCriticalSection(&guard);
    errors += WaitForMultipleObjects(4, workers, TRUE, INFINITE) != 0;
    unsigned exits = 0;
    for (unsigned i = 0; i < 4; i++) {
        DWORD code = 0; GetExitCodeThread(workers[i], &code); errors += code != 100 + i; exits += code;
        CloseHandle(workers[i]);
    }
    errors += worker_errors;
    errors += local != 0x12345678 || TlsGetValue(tls_slot) != 0;
#ifdef _WIN32
    unsigned contract_errors = contracts();
    errors += contract_errors;
    errors += tls_attaches != 6 || tls_detaches != 6 || tls_errors != 0;
    if (errors) printf("thread detail contracts=%u attach=%ld detach=%ld tls=%ld\n",
        contract_errors, tls_attaches, tls_detaches, tls_errors);
#endif
    printf("threads checksum=%016llx processed=%u exits=%u errors=%u %s\n",
        (unsigned long long)checksum, processed, exits, errors, errors ? "FAIL" : "PASS");
    CloseHandle(start); CloseHandle(slots); TlsFree(tls_slot); DeleteCriticalSection(&guard);
    return errors ? 1 : 0;
}
