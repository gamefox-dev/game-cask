/* CC0 native reference adapters, only used when compiling this original source for the host. */
#ifndef THREADS_NATIVE_H
#define THREADS_NATIVE_H
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <time.h>
#include <errno.h>
#include <unistd.h>
typedef uint32_t DWORD;
typedef void *LPVOID;
typedef int BOOL;
#define WINAPI
#define INFINITE 0xffffffffu
#define WAIT_TIMEOUT 258u
#define TRUE 1
#define FALSE 0
#define TLS_OUT_OF_INDEXES 0xffffffffu
#define FLS_OUT_OF_INDEXES 0xffffffffu
typedef pthread_mutex_t CRITICAL_SECTION;
typedef pthread_cond_t CONDITION_VARIABLE;
typedef struct handle {
    pthread_mutex_t lock;
    pthread_cond_t cv;
    pthread_t thread;
    DWORD (*fn)(void *);
    void *arg;
    DWORD code;
    unsigned kind, value, manual, limit;
} *HANDLE;
static _Thread_local DWORD native_error;
static pthread_key_t native_tls[64];
static unsigned native_ntls;
static struct timespec until(DWORD ms) {
    struct timespec t; clock_gettime(CLOCK_REALTIME, &t);
    t.tv_sec += ms / 1000; t.tv_nsec += (long)(ms % 1000) * 1000000;
    if (t.tv_nsec >= 1000000000) { t.tv_sec++; t.tv_nsec -= 1000000000; }
    return t;
}
static HANDLE new_handle(unsigned kind, unsigned value, unsigned manual, unsigned limit) {
    HANDLE h = calloc(1, sizeof *h); h->kind = kind; h->value = value; h->manual = manual; h->limit = limit;
    pthread_mutex_init(&h->lock, 0); pthread_cond_init(&h->cv, 0); return h;
}
static void *native_start(void *p) {
    HANDLE h = p; h->code = h->fn(h->arg); return 0;
}
static HANDLE CreateThread(void *a, unsigned size, DWORD (*fn)(void *), void *arg, unsigned flags, DWORD *id) {
    (void)a; (void)size; (void)flags; (void)id;
    HANDLE h = new_handle(1, 0, 0, 0); h->code = 259; h->fn = fn; h->arg = arg;
    pthread_create(&h->thread, 0, native_start, h); return h;
}
static HANDLE CreateEventA(void *a, int manual, int value, const char *name) {
    (void)a; (void)name; return new_handle(2, value, manual, 1);
}
static HANDLE CreateSemaphoreA(void *a, int value, int limit, const char *name) {
    (void)a; (void)name; return new_handle(3, value, 0, limit);
}
static DWORD WaitForSingleObject(HANDLE h, DWORD ms) {
    if (h->kind == 1) { pthread_join(h->thread, 0); return 0; }
    pthread_mutex_lock(&h->lock); int err = 0; struct timespec t = until(ms);
    while (!h->value && !err) {
        if (!ms) { err = ETIMEDOUT; break; }
        err = ms == INFINITE ? pthread_cond_wait(&h->cv, &h->lock) : pthread_cond_timedwait(&h->cv, &h->lock, &t);
    }
    if (!err && !h->manual) h->value--;
    pthread_mutex_unlock(&h->lock); return err ? WAIT_TIMEOUT : 0;
}
static DWORD WaitForMultipleObjects(DWORD n, HANDLE *h, int all, DWORD ms) {
    (void)all; for (DWORD i = 0; i < n; i++) if (WaitForSingleObject(h[i], ms)) return WAIT_TIMEOUT; return 0;
}
static int SetEvent(HANDLE h) {
    pthread_mutex_lock(&h->lock); h->value = 1; pthread_cond_broadcast(&h->cv);
    pthread_mutex_unlock(&h->lock); return 1;
}
static int ReleaseSemaphore(HANDLE h, int n, void *old) {
    (void)old; pthread_mutex_lock(&h->lock); h->value += n;
    pthread_cond_broadcast(&h->cv); pthread_mutex_unlock(&h->lock); return 1;
}
static int CloseHandle(HANDLE h) { pthread_mutex_destroy(&h->lock); pthread_cond_destroy(&h->cv); free(h); return 1; }
static int GetExitCodeThread(HANDLE h, DWORD *code) { *code = h->code; return 1; }
static void InitializeCriticalSection(CRITICAL_SECTION *c) { pthread_mutex_init(c, 0); }
#define EnterCriticalSection pthread_mutex_lock
#define LeaveCriticalSection pthread_mutex_unlock
#define DeleteCriticalSection pthread_mutex_destroy
static void InitializeConditionVariable(CONDITION_VARIABLE *c) { pthread_cond_init(c, 0); }
#define WakeAllConditionVariable pthread_cond_broadcast
#define WakeConditionVariable pthread_cond_signal
static int SleepConditionVariableCS(CONDITION_VARIABLE *c, CRITICAL_SECTION *m, DWORD ms) {
    struct timespec t = until(ms);
    int e = ms == INFINITE ? pthread_cond_wait(c, m) : pthread_cond_timedwait(c, m, &t);
    if (e == ETIMEDOUT) native_error = 1460;
    return !e;
}
static void Sleep(DWORD ms) {
    struct timespec t = {(time_t)(ms / 1000), (long)(ms % 1000) * 1000000};
    if (!ms) sched_yield(); else nanosleep(&t, 0);
}
static DWORD TlsAlloc(void) { unsigned i = native_ntls++; pthread_key_create(&native_tls[i], 0); return i; }
static int TlsFree(DWORD i) { return !pthread_key_delete(native_tls[i]); }
static void *TlsGetValue(DWORD i) { native_error = 0; return pthread_getspecific(native_tls[i]); }
static int TlsSetValue(DWORD i, void *p) { return !pthread_setspecific(native_tls[i], p); }
static DWORD GetLastError(void) { return native_error; }
static void SetLastError(DWORD e) { native_error = e; }
#endif
