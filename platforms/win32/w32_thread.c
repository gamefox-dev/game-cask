/* Deterministic cooperative Win32 threads, waits and per-thread state. MIT.
 * No host workers, wall-clock sleeps, or engine-specific paths. See THREADS.md. */
#include "w32_int.h"
#include "w32_thread.h"
#define OBJECTS 1024u
#define LOCKS 512u
#define H_SYNC 0x00100000u
#define INFINITE 0xffffffffu
#define TIMEOUT 258u
#define FAILED 0xffffffffu

enum { THREAD = 1, EVENT, MUTEX, SEMAPHORE };
enum { NONE, SLEEPING, OBJECT_WAIT, LOCK_WAIT, COND_WAIT, ADDRESS_WAIT };
typedef struct {
    uint32_t kind, value, limit, owner, recursion, thread, abandoned;
    int manual, closed;
} object_t;
typedef struct { uint32_t addr, owner, recursion, readers, critical; } lock_t;
typedef struct {
    uint64_t tls[64], fls[128];
    uint32_t error, teb, stack, code, object, kind, start_ms, timeout_ms, finite, suspended;
    uint32_t handles[64], count, all, lock, shared, recursive, cv, notified, address, size, deferred;
    uint64_t compare;
    int fresh, crt_auto_close;
    int32_t priority;
} thread_t;
static thread_t threads[X86_THREADS];
static object_t objects[OBJECTS];
static lock_t locks[LOCKS];
static uint32_t nobjects, nlocks, nthreads = 1;
static int yield_requested, scheduling, pumping;
static uint64_t tls_mask, fls_mask[2], fls_callbacks[128];
static thread_t *self(void) { return &threads[x86_current]; }
static uint32_t *error_cell(thread_t *t) {
    uint32_t teb = t->teb ? t->teb : W32_TEB;
    return (uint32_t *)x86_host(teb + (W32_64 ? 0x68 : 0x34));
}
uint32_t *w32_thread_error(void) { return error_cell(self()); }
static uint32_t fail(uint32_t error) { self()->error = error; return FAILED; }
static object_t *object(uint32_t h) {
    uint32_t i = h - H_SYNC;
    return i && i <= nobjects && !objects[i].closed ? &objects[i] : 0;
}
static uint32_t new_object(uint32_t kind) {
    if (nobjects + 1 >= OBJECTS) { self()->error = 8; return 0; }
    uint32_t i = ++nobjects;
    objects[i].kind = kind;
    objects[i].owner = INFINITE;
    return H_SYNC + i;
}
static lock_t *lock_at(uint32_t addr) {
    if (!addr) x86_fault("null thread lock", addr);
    uint32_t free_slot = LOCKS;
    for (uint32_t i = 0; i < nlocks; i++) {
        if (locks[i].addr == addr) return &locks[i];
        if (!locks[i].addr && free_slot == LOCKS) free_slot = i;
    }
    if (free_slot == LOCKS) {
        if (nlocks == LOCKS) x86_fault("thread lock table exhausted", addr);
        free_slot = nlocks++;
    }
    lock_t *l = &locks[free_slot];
    *l = (lock_t){.addr = addr, .owner = INFINITE};
    return l;
}
static void set_timeout(thread_t *t, uint32_t ms) {
    t->finite = ms != INFINITE;
    t->start_ms = w32_now_ms(); t->timeout_ms = ms;
}
static int expired(thread_t *t) {
    return t->finite && w32_now_ms() - t->start_ms >= t->timeout_ms;
}
static uint32_t block(uint32_t kind, uint32_t ms) {
    thread_t *t = self();
    t->kind = kind; t->deferred = !X.callback_depth; set_timeout(t, ms);
    x86_tasks[x86_current].ready = 0;
    return 0;
}
int w32_thread_deferred_result(void) { return self()->deferred != 0; }
int w32_thread_pending(void) {
    int pending = self()->kind != NONE || yield_requested;
    yield_requested = 0;
    return pending;
}
static int available(object_t *o, uint32_t tid) {
    if (o->kind == THREAD) return !x86_tasks[o->thread].live;
    if (o->kind == MUTEX) return o->owner == INFINITE || o->owner == tid;
    return o->value != 0;
}
static uint32_t consume(object_t *o, uint32_t tid) {
    uint32_t result = 0;
    if (o->kind == EVENT && !o->manual) o->value = 0;
    if (o->kind == SEMAPHORE) o->value--;
    if (o->kind == MUTEX) {
        result = o->abandoned ? 0x80u : 0;
        o->abandoned = 0; o->owner = tid; o->recursion++;
    }
    return result;
}
static uint32_t try_objects(thread_t *t, uint32_t tid) {
    for (uint32_t i = 0; i < t->count; i++) if (!object(t->handles[i])) return FAILED;
    if (t->all) {
        for (uint32_t i = 0; i < t->count; i++) if (!available(object(t->handles[i]), tid)) return TIMEOUT;
        uint32_t result = 0;
        for (uint32_t i = 0; i < t->count; i++) result |= consume(object(t->handles[i]), tid);
        return result;
    }
    for (uint32_t i = 0; i < t->count; i++) {
        object_t *o = object(t->handles[i]);
        if (available(o, tid)) return i + consume(o, tid);
    }
    return TIMEOUT;
}
static void wake_waiters(void);
/* LANE-E/C: signal scheduler-owned events from the virtual-clock audio pump. */
int w32_thread_event_valid(uint32_t h) {
    object_t *o = object(h);
    return o && o->kind == EVENT;
}
void w32_thread_signal_event(uint32_t h) {
    object_t *o = object(h);
    if (o && o->kind == EVENT) { o->value = 1; wake_waiters(); }
}
static void publish_lock(lock_t *l) {
    if (!l->critical) return;
    x86_wr32(l->addr + (W32_64 ? 8 : 4), l->recursion - 1);
    x86_wr32(l->addr + (W32_64 ? 12 : 8), l->recursion);
    w32_wrptr(l->addr + (W32_64 ? 16 : 12), l->recursion ? l->owner + 1 : 0);
}
static int acquire(uint32_t addr, uint32_t tid, int shared, int recursive) {
    lock_t *l = lock_at(addr);
    if (shared) {
        if (l->owner != INFINITE) return 0;
        for (uint32_t i = 0; i < X86_THREADS; i++) if (x86_tasks[i].live &&
            !x86_tasks[i].ready && threads[i].kind == LOCK_WAIT && !threads[i].shared &&
            threads[i].lock == addr) return 0; /* Don't admit new readers ahead of a waiting writer. */
        l->readers++; return 1;
    }
    if (l->readers || (l->owner != INFINITE && !(recursive && l->owner == tid))) return 0;
    l->owner = tid; l->recursion++; publish_lock(l); return 1;
}
static void release(uint32_t addr, int shared) {
    lock_t *l = lock_at(addr);
    if (shared) { if (!l->readers) x86_fault("release unowned shared lock", addr); l->readers--; }
    else {
        if (l->owner != x86_current || !l->recursion) x86_fault("release unowned lock", addr);
        if (!--l->recursion) l->owner = INFINITE;
    }
    publish_lock(l); wake_waiters();
}
static uint64_t read_size(uint32_t p, uint32_t size) {
    if (size == 1) return x86_rd8(p);
    if (size == 2) return x86_rd16(p);
    return size == 4 ? x86_rd32(p) : x86_rd64(p);
}
static void wake_waiters(void) {
    /* Rotating scan is also the deterministic arbitration order for auto events/semaphores. */
    for (uint32_t n = 1; n <= X86_THREADS; n++) {
        uint32_t i = (x86_current + n) % X86_THREADS;
        thread_t *t = &threads[i];
        if (!x86_tasks[i].live || x86_tasks[i].ready) continue;
        uint32_t result = 0;
        int done = 0;
        switch (t->kind) {
        case SLEEPING: done = expired(t); break;
        case OBJECT_WAIT:
            result = try_objects(t, i); done = result != TIMEOUT || expired(t);
            if (result == FAILED) t->error = 6;
            break;
        case LOCK_WAIT: done = acquire(t->lock, i, t->shared, t->recursive); result = 1; break;
        case COND_WAIT:
            if (t->notified || expired(t)) {
                done = acquire(t->lock, i, t->shared, 1);
                result = t->notified ? 1 : 0;
                if (!result) t->error = 1460;
            }
            break;
        case ADDRESS_WAIT:
            done = t->notified || read_size(t->address, t->size) != t->compare || expired(t);
            result = expired(t) && !t->notified ? 0 : 1;
            if (!result) t->error = 1460;
            break;
        default: break;
        }
        if (done) {
            t->kind = NONE; x86_tasks[i].ready = !t->suspended; x86_tasks[i].cpu.r[EAX] = result;
            *error_cell(t) = t->error;
            if (t->deferred) { w32_trace_result(result); t->deferred = 0; }
        }
    }
}
static void tls_image(uint32_t teb) {
    uint32_t width = w32_ptr_size(), vector = w32_heap_alloc(NMOD * width, 1);
    w32_wrptr(teb + (W32_64 ? 0x58 : 0x2c), vector);
    for (uint32_t i = 0; i < w32_nmods; i++) {
        uint32_t dir = w32_mods[i].tls_rva;
        if (!dir) continue;
        dir += w32_mods[i].base;
        uint32_t start = x86_address(w32_rdptr(dir)), end = x86_address(w32_rdptr(dir + width));
        uint32_t zero = x86_rd32(dir + width * 4);
        if (end < start || (uint64_t)end - start + zero > (1u << 20)) x86_fault("invalid thread TLS", dir);
        uint32_t data = w32_heap_alloc(end - start + zero + 16, 1);
        for (uint32_t j = 0; j < end - start; j++) x86_wr8(data + j, x86_rd8(start + j));
        w32_wrptr(vector + i * width, data);
    }
}
static void tls_notify(uint32_t reason) {
    for (uint32_t i = 0; i < w32_nmods; i++) {
        uint32_t dir = w32_mods[i].tls_rva;
        if (!dir) continue;
        dir += w32_mods[i].base;
        uint32_t callbacks = x86_address(w32_rdptr(dir + w32_ptr_size() * 3));
        if (!callbacks) continue;
        for (uint32_t j = 0; j < 64; j++) {
            uint32_t fn = x86_address(w32_rdptr(callbacks + j * w32_ptr_size()));
            if (!fn) break;
            uint32_t args[3] = {w32_mods[i].base, reason, 0};
            x86_callback(fn, 3, args);
        }
    }
}
void w32_thread_init(void) {
    threads[0].teb = W32_TEB;
    if (!W32_64) {
        tls_image(W32_TEB);
        for (uint32_t i = 0; i < w32_nmods; i++) if (w32_mods[i].tls_rva) {
            uint32_t dir = w32_mods[i].base + w32_mods[i].tls_rva;
            x86_wr32(x86_address(w32_rdptr(dir + 2 * w32_ptr_size())), i);
        }
        tls_notify(1);
    }
    x86_sched_init();
}
void w32_thread_return(uint32_t code) {
    X.transfer = 0; /* A normal guest RET arrives via the scheduler transfer sentinel. */
    thread_t *t = self();
    for (uint32_t pass = 0; pass < 4; pass++) for (uint32_t i = 0; i < 128; i++) {
        uint64_t value = t->fls[i];
        if (value && fls_callbacks[i]) {
            t->fls[i] = 0;
            if (W32_64) x86_callback64((uint32_t)fls_callbacks[i], 1, &value);
            else { uint32_t arg = (uint32_t)value; x86_callback((uint32_t)fls_callbacks[i], 1, &arg); }
        }
    }
    if (x86_current) tls_notify(3);
    t->code = code;
    if (t->crt_auto_close && t->object) objects[t->object-H_SYNC].closed=1;
    x86_tasks[x86_current].live = x86_tasks[x86_current].ready = 0;
    for (uint32_t i = 1; i <= nobjects; i++) if (objects[i].kind == MUTEX && objects[i].owner == x86_current) {
        objects[i].owner = INFINITE; objects[i].recursion = 0; objects[i].abandoned = 1;
    }
    int live = 0;
    for (uint32_t i = 0; i < X86_THREADS; i++) live |= x86_tasks[i].live;
    if (!live) {
        w32_exited = 1; w32_exit_code = code;
        w32_log("win32 profile: last thread exited");
        for (;;) w32_wait_frame();
    }
    X.transfer = X86_SCHEDULE;
}
void w32_thread_schedule(void) {
    scheduling = 1;
    x86_sched_save();
    for (;;) {
        wake_waiters();
        if (x86_sched_next()) break;
        w32_sleep_ms(1);
    }
    scheduling = 0;
    if (self()->fresh) {
        self()->fresh = 0;
        tls_notify(2);
    }
}
static void park_native(void) {
    /* Keep the profile's native C locals until this exact guest caller can return.
     * A nested callback wait excludes all outer parked continuations from dispatch. */
    uint32_t parked = x86_current, target = x86_sched_target;
    x86_tasks[parked].parked = 1; x86_sched_target = parked;
    pumping++;
    do {
        if (X.eip == X86_THREAD_RETURN) w32_thread_return((uint32_t)X.r[EAX]);
        w32_thread_schedule();
        if (x86_current == parked) break;
        x86_invoke(X.eip, X86_THREAD_RETURN);
    } while (!w32_exited);
    pumping--;
    x86_tasks[parked].parked = 0; x86_sched_target = target;
}
void w32_thread_yield(void) {
    if (w32_exited || nthreads == 1 || scheduling || pumping || X.transfer) return;
    park_native();
}
void w32_thread_quantum(void) {
    /* Instruction budgets yield a browser frame as well as rotating guest tasks. */
    w32_wait_frame();
    if (nthreads > 1 && !X.transfer && !X.callback_depth) X.transfer = X86_SCHEDULE;
}
static uint32_t create_thread(int begin) {
    if (nthreads == X86_THREADS) { self()->error = 8; return 0; }
    uint32_t flags = begin==2?0:ARG(4);
    if (flags & ~4u) { self()->error = 87; return 0; }
    uint32_t h = new_object(THREAD);
    if (!h) return 0;
    uint32_t i = nthreads++, stack_size = ARG(1);
    if (stack_size < 0x100000) stack_size = 0x100000;
    if (stack_size > 0x1000000) { objects[h - H_SYNC].closed = 1; self()->error = 8; return 0; }
    thread_t *t = &threads[i];
    t->stack = w32_heap_alloc(stack_size, 1); t->teb = w32_heap_alloc(8192, 1);
    if (!t->stack || !t->teb) x86_fault("thread allocation failed", X.eip);
    t->object = h; t->fresh = 1; t->code = 259;
    uint32_t top = (t->stack + stack_size - 64) & ~15u;
    w32_wrptr(t->teb + w32_ptr_size(), top);
    w32_wrptr(t->teb + 2 * w32_ptr_size(), t->stack);
    w32_wrptr(t->teb + (W32_64 ? 0x30 : 0x18), t->teb);
    w32_wrptr(t->teb + (W32_64 ? 0x40 : 0x20), 1);
    w32_wrptr(t->teb + (W32_64 ? 0x48 : 0x24), i + 1);
    w32_wrptr(t->teb + (W32_64 ? 0x60 : 0x30), W32_PEB);
    if (!W32_64) x86_wr32(t->teb, INFINITE);
    tls_image(t->teb);
    x86_cpu_t saved = X;
    uint32_t entry = ARG(begin==2?0:2); uint64_t arg = ARG64(begin==2?2:3); uint32_t idptr = begin==2?0:ARG(5);
    t->crt_auto_close=begin==2;
    x86_cpu_t *cpu = &x86_tasks[i].cpu;
    __builtin_memset(cpu, 0, sizeof *cpu);
    cpu->mode64 = saved.mode64; cpu->mxcsr = 0x1f80; cpu->eip = entry;
    cpu->r[ESP] = W32_64 ? top - 40 : top - 8;
    if (W32_64) { cpu->gs_base = t->teb; cpu->r[ECX] = arg; }
    else { cpu->fs_base = t->teb; x86_wr32(top - 4, (uint32_t)arg); }
    w32_wrptr((uint32_t)cpu->r[ESP], X86_THREAD_RETURN);
    t->suspended = !!(flags & 4);
    x86_tasks[i].live = 1; x86_tasks[i].ready = !t->suspended;
    objects[h - H_SYNC].thread = i;
    if (idptr) x86_wr32(idptr, i + 1);
    (void)begin;
    return h;
}
static uint32_t wait_objects(int multiple) {
    thread_t *t = self();
    t->count = multiple ? ARG(0) : 1; t->all = multiple ? ARG(2) : 0;
    uint32_t ms = multiple ? ARG(3) : ARG(1);
    if (!t->count || t->count > 64) return fail(87);
    for (uint32_t i = 0; i < t->count; i++) {
        t->handles[i] = multiple ? (uint32_t)w32_rdptr(ARG(1) + i * w32_ptr_size()) : ARG(0);
        if (!object(t->handles[i])) return fail(6);
        for (uint32_t j = 0; j < i; j++) if (t->handles[j] == t->handles[i]) return fail(87);
    }
    uint32_t result = try_objects(t, x86_current);
    if (result != TIMEOUT || !ms) return result;
    return block(OBJECT_WAIT, ms);
}
static uint32_t enter_lock(int shared, int attempt, int recursive) {
    self()->lock = ARG(0); self()->shared = (uint32_t)shared; self()->recursive = (uint32_t)recursive;
    if (acquire(ARG(0), x86_current, shared, recursive)) return 1;
    return attempt ? 0 : block(LOCK_WAIT, INFINITE);
}
static uint32_t condition(int srw) {
    thread_t *t = self();
    t->cv = ARG(0); t->lock = ARG(1); t->shared = srw ? ARG(3) & 1 : 0; t->notified = 0;
    release(t->lock, t->shared);
    return block(COND_WAIT, ARG(2));
}
static void notify(uint32_t addr, int all, int address) {
    for (uint32_t n = 1; n <= X86_THREADS; n++) {
        uint32_t i = (x86_current + n) % X86_THREADS;
        thread_t *t = &threads[i];
        if (x86_tasks[i].live && !t->notified &&
            t->kind == (uint32_t)(address ? ADDRESS_WAIT : COND_WAIT) &&
            (address ? t->address : t->cv) == addr) {
            t->notified = 1;
            if (!all) break;
        }
    }
}
/* One signature table is shared by GetProcAddress, i386 cleanup and AMD64 dispatch. */
#define T(n, a) {n, a, 0, 0}
#define C(n, a) {n, a, 1, 0}
#define TF(n,a) T(n,a)
#define T64(n, a32, a64) {n, W32_64 ? a64 : a32, 0, 0}
static const w32_api_t api[] = {
    T("CreateThread",6), C("_beginthreadex",6), C("_beginthread",3), C("_endthread",0), C("_lock",1), C("_unlock",1),
    T("GetTickCount64",0), T("GetThreadPriority",1), T("SetThreadPriority",2), T("SuspendThread",1), TF("GetThreadContext",2), TF("SetThreadContext",2),
    T("ExitThread",1), C("_endthreadex",1),
    T("GetExitCodeThread",2), T("GetCurrentThreadId",0), T("GetCurrentThread",0), T("ResumeThread",1),
    T("WaitForSingleObject",2), T("WaitForSingleObjectEx",3), T("WaitForMultipleObjects",4),
    T("WaitForMultipleObjectsEx",5), T("Sleep",1), T("SleepEx",2), T("SwitchToThread",0),
    T("CreateEventA",4), T("CreateEventW",4), T("SetEvent",1), T("ResetEvent",1),
    T("CreateMutexA",3), T("CreateMutexW",3), T("ReleaseMutex",1),
    T("CreateSemaphoreA",4), T("CreateSemaphoreW",4), T("ReleaseSemaphore",3),
    T("InitializeCriticalSection",1), T("InitializeCriticalSectionAndSpinCount",2),
    T("InitializeCriticalSectionEx",3), T("EnterCriticalSection",1), T("TryEnterCriticalSection",1),
    T("LeaveCriticalSection",1), T("DeleteCriticalSection",1), T("SetCriticalSectionSpinCount",2),
    T("InitializeSRWLock",1), T("AcquireSRWLockExclusive",1), T("AcquireSRWLockShared",1),
    T("TryAcquireSRWLockExclusive",1), T("TryAcquireSRWLockShared",1),
    T("ReleaseSRWLockExclusive",1), T("ReleaseSRWLockShared",1),
    T("InitializeConditionVariable",1), T("SleepConditionVariableCS",3), T("SleepConditionVariableSRW",4),
    T("WakeConditionVariable",1), T("WakeAllConditionVariable",1),
    T("WaitOnAddress",4), T("WakeByAddressSingle",1), T("WakeByAddressAll",1),
    T("TlsAlloc",0), T("TlsFree",1), T("TlsGetValue",1), T("TlsSetValue",2),
    T("FlsAlloc",1), T("FlsFree",1), T("FlsGetValue",1), T("FlsSetValue",2),
    T("GetLastError",0), T("SetLastError",1),
    T("InterlockedIncrement",1), T("InterlockedDecrement",1), T("InterlockedExchange",2),
    T("InterlockedExchangeAdd",2), T("InterlockedCompareExchange",3),
    T("InterlockedIncrement64",1), T("InterlockedDecrement64",1),
    T64("InterlockedExchange64",3,2), T64("InterlockedExchangeAdd64",3,2),
    T64("InterlockedCompareExchange64",5,3),
    T("InterlockedExchangePointer",2), T("InterlockedCompareExchangePointer",3),
};
const w32_api_t *w32_thread_find(const char *name) {
    for (uint32_t i = 0; i < sizeof api / sizeof api[0]; i++) if (w32_streqi(name, api[i].name)) return &api[i];
    return 0;
}
#define IS(n) w32_streqi(name, n)
static uint64_t thread_api(const char *name) {
    thread_t *t = self();
    uint32_t p = ARG(0), v = ARG(1);
    if (IS("CreateThread") || IS("_beginthreadex") || IS("_beginthread")) {
        uint32_t h=create_thread(IS("_beginthread")?2:IS("_beginthreadex"));
        return !h&&IS("_beginthread")?(W32_64?UINT64_MAX:FAILED):h;
    }
    if (IS("_endthread")) { w32_thread_return(0); return 0; }
    if (IS("_lock") || IS("_unlock")) {
        static uint32_t crt_locks;
        if(p>=64)x86_fault("invalid CRT lock number",p);
        if(!crt_locks)crt_locks=w32_misc_alloc(64*8);
        uint32_t addr=crt_locks+8*p;
        if(IS("_unlock")){release(addr,0);return 0;}
        t->lock=addr;t->shared=0;t->recursive=1;
        if(acquire(addr,x86_current,0,1))return 0;
        return block(LOCK_WAIT,INFINITE);
    }
    if(IS("GetThreadPriority") || IS("SetThreadPriority") || IS("SuspendThread") || IS("GetThreadContext") || IS("SetThreadContext")) {
        object_t *o=object(p);uint32_t tid=p==0xfffffffeu?x86_current:o&&o->kind==THREAD?o->thread:X86_THREADS;
        if(tid==X86_THREADS){t->error=6;return IS("GetThreadPriority")?0x7fffffffu:IS("SuspendThread")?FAILED:0;}
        if(IS("GetThreadPriority"))return (uint64_t)(int64_t)threads[tid].priority;
        if(IS("SetThreadPriority")){
            int32_t priority=(int32_t)v;
            if((priority<-2||priority>2)&&priority!=-15&&priority!=15){t->error=87;return 0;}
            /* Priorities are stored, but the cooperative scheduler has no priority policy. */
            if(priority){t->error=50;return 0;}threads[tid].priority=priority;return 1;
        }
        if(IS("SuspendThread")){
            uint32_t old=threads[tid].suspended;
            if(old==127){t->error=298;return FAILED;}
            threads[tid].suspended++;x86_tasks[tid].ready=0;
            if(tid==x86_current)yield_requested=1;return old;
        }
        t->error=50;return 0; /* no asynchronous context editing */
    }
    if (IS("ExitThread") || IS("_endthreadex")) { w32_thread_return(p); return 0; }
    if (IS("GetCurrentThreadId")) return x86_current + 1;
    if (IS("GetTickCount64")) return w32_now_ms64();
    if (IS("GetCurrentThread")) return W32_64 ? UINT64_MAX - 1 : 0xfffffffeu;
    if (IS("GetLastError")) return t->error;
    if (IS("SetLastError")) { t->error = p; return 0; }
    if (IS("GetExitCodeThread") || IS("ResumeThread")) {
        uint32_t tid = x86_current;
        if (ARG64(0) != (W32_64 ? UINT64_MAX - 1 : 0xfffffffeu)) {
            object_t *o = object(p);
            if (!o || o->kind != THREAD) { fail(6); return IS("ResumeThread") ? FAILED : 0; }
            tid = o->thread;
        }
        if (IS("GetExitCodeThread")) {
            x86_wr32(v, x86_tasks[tid].live ? 259 : threads[tid].code); return 1;
        }
        uint32_t old = threads[tid].suspended;
        if (old) { threads[tid].suspended--; if(!threads[tid].suspended && threads[tid].kind==NONE)x86_tasks[tid].ready = 1; }
        return old;
    }
    if (IS("WaitForSingleObject") || IS("WaitForSingleObjectEx")) return wait_objects(0);
    if (IS("WaitForMultipleObjects") || IS("WaitForMultipleObjectsEx")) return wait_objects(1);
    if (IS("Sleep") || IS("SleepEx") || IS("SwitchToThread")) {
        uint32_t ms = IS("SwitchToThread") ? 0 : p;
        if (!ms) { yield_requested = 1; return IS("SwitchToThread") ? nthreads > 1 : 0; }
        return block(SLEEPING, ms);
    }
    if (IS("CreateEventA") || IS("CreateEventW") || IS("CreateMutexA") || IS("CreateMutexW") ||
        IS("CreateSemaphoreA") || IS("CreateSemaphoreW")) {
        int event = IS("CreateEventA") || IS("CreateEventW"), mutex = IS("CreateMutexA") || IS("CreateMutexW");
        uint32_t nameptr = ARG(mutex ? 2 : 3);
        int wide_name = IS("CreateEventW") || IS("CreateMutexW") || IS("CreateSemaphoreW");
        if (nameptr && (wide_name ? x86_rd16(nameptr) : x86_rd8(nameptr))) {
            t->error = 50; return 0; /* Named cross-process namespaces are outside this profile. */
        }
        if (!event && !mutex && ((int32_t)v < 0 || (int32_t)ARG(2) <= 0 || v > ARG(2))) { t->error = 87; return 0; }
        uint32_t h = new_object(event ? EVENT : mutex ? MUTEX : SEMAPHORE);
        if (!h) return 0;
        object_t *o = object(h);
        if (event) { o->manual = !!v; o->value = !!ARG(2); }
        else if (mutex) { if (v) { o->owner = x86_current; o->recursion = 1; } }
        else { o->value = v; o->limit = ARG(2); }
        return h;
    }
    if (IS("SetEvent") || IS("ResetEvent") || IS("ReleaseMutex") || IS("ReleaseSemaphore") || IS("CloseHandle")) {
        object_t *o = object(p);
        if (!o) { t->error = 6; return 0; }
        if (IS("CloseHandle")) { o->closed = 1; return 1; }
        if (IS("SetEvent") || IS("ResetEvent")) {
            if (o->kind != EVENT) { t->error = 6; return 0; }
            o->value = IS("SetEvent"); wake_waiters(); return 1;
        }
        if (IS("ReleaseMutex")) {
            if (o->kind != MUTEX || o->owner != x86_current) { t->error = 288; return 0; }
            if (!--o->recursion) o->owner = INFINITE;
            wake_waiters(); return 1;
        }
        if (o->kind != SEMAPHORE || (int32_t)v <= 0 || v > o->limit - o->value) { t->error = 298; return 0; }
        if (ARG(2)) x86_wr32(ARG(2), o->value);
        o->value += v; wake_waiters(); return 1;
    }
    if (IS("InitializeCriticalSection") || IS("InitializeCriticalSectionAndSpinCount") ||
        IS("InitializeCriticalSectionEx") || IS("InitializeSRWLock")) {
        lock_t *l = lock_at(p); l->owner = INFINITE; l->recursion = l->readers = 0;
        l->critical = !IS("InitializeSRWLock");
        uint32_t size = l->critical ? (W32_64 ? 40 : 24) : w32_ptr_size();
        for (uint32_t i = 0; i < size; i++) x86_wr8(p + i, 0);
        publish_lock(l); return 1;
    }
    if (IS("DeleteCriticalSection")) {
        for (uint32_t i = 0; i < nlocks; i++) if (locks[i].addr == p) {
            locks[i] = (lock_t){0}; break;
        }
        return 0;
    }
    if (IS("InitializeConditionVariable") || IS("SetCriticalSectionSpinCount")) return 0;
    if (IS("EnterCriticalSection") || IS("TryEnterCriticalSection"))
        return enter_lock(0, IS("TryEnterCriticalSection"), 1);
    if (IS("AcquireSRWLockExclusive") || IS("TryAcquireSRWLockExclusive"))
        return enter_lock(0, IS("TryAcquireSRWLockExclusive"), 0);
    if (IS("AcquireSRWLockShared") || IS("TryAcquireSRWLockShared"))
        return enter_lock(1, IS("TryAcquireSRWLockShared"), 0);
    if (IS("LeaveCriticalSection") || IS("ReleaseSRWLockExclusive") || IS("ReleaseSRWLockShared")) {
        release(p, IS("ReleaseSRWLockShared")); return 0;
    }
    if (IS("SleepConditionVariableCS") || IS("SleepConditionVariableSRW"))
        return condition(IS("SleepConditionVariableSRW"));
    if (IS("WakeConditionVariable") || IS("WakeAllConditionVariable")) {
        notify(p, IS("WakeAllConditionVariable"), 0); return 0;
    }
    if (IS("WaitOnAddress")) {
        uint32_t size = ARG(2);
        if (size != 1 && size != 2 && size != 4 && size != 8) { t->error = 87; return 0; }
        t->address = p; t->size = size; t->compare = read_size(v, size); t->notified = 0;
        if (read_size(p, size) != t->compare) return 1;
        if (!ARG(3)) { t->error = 1460; return 0; }
        return block(ADDRESS_WAIT, ARG(3));
    }
    if (IS("WakeByAddressSingle") || IS("WakeByAddressAll")) { notify(p, IS("WakeByAddressAll"), 1); return 0; }
    if (IS("TlsAlloc") || IS("FlsAlloc")) {
        uint32_t count = IS("TlsAlloc") ? 64 : 128;
        for (uint32_t i = 0; i < count; i++) {
            uint64_t *mask = count == 64 ? &tls_mask : &fls_mask[i / 64], bit = 1ull << (i % 64);
            if (!(*mask & bit)) {
                *mask |= bit;
                for (uint32_t j = 0; j < X86_THREADS; j++) {
                    if (count == 64) {
                        threads[j].tls[i] = 0;
                        if (threads[j].teb) w32_wrptr(threads[j].teb + (W32_64 ? 0x1480 : 0xe10) +
                            i * w32_ptr_size(), 0);
                    } else threads[j].fls[i] = 0;
                }
                if (count == 128) fls_callbacks[i] = p;
                return i;
            }
        }
        t->error = 8; return FAILED;
    }
    if (IS("TlsFree") || IS("TlsGetValue") || IS("TlsSetValue") ||
        IS("FlsFree") || IS("FlsGetValue") || IS("FlsSetValue")) {
        int tls = name[0] == 'T'; uint32_t count = tls ? 64 : 128;
        uint64_t *mask = tls ? &tls_mask : &fls_mask[p / 64 % 2], bit = 1ull << (p % 64);
        if (p >= count || !(*mask & bit)) { t->error = 87; return 0; }
        uint64_t *values = tls ? t->tls : t->fls;
        if (IS("TlsFree") || IS("FlsFree")) {
            *mask &= ~bit;
            if (!tls && fls_callbacks[p]) {
                uint32_t callback = (uint32_t)fls_callbacks[p];
                fls_callbacks[p] = 0;
                for (uint32_t i = 0; i < X86_THREADS; i++) {
                    uint64_t value = threads[i].fls[p]; threads[i].fls[p] = 0;
                    if (!value) continue;
                    if (W32_64) x86_callback64(callback, 1, &value);
                    else { uint32_t arg = (uint32_t)value; x86_callback(callback, 1, &arg); }
                }
            }
            return 1;
        }
        uint32_t teb_slot = t->teb + (W32_64 ? 0x1480 : 0xe10) + p * w32_ptr_size();
        if (IS("TlsSetValue") || IS("FlsSetValue")) {
            values[p] = ARG64(1);
            if (tls) w32_wrptr(teb_slot, values[p]);
            return 1;
        }
        t->error = 0; return tls ? w32_rdptr(teb_slot) : values[p];
    }
    /* Exported Interlocked operations and LOCK instructions are indivisible on this core. */
    int wide = IS("InterlockedIncrement64") || IS("InterlockedDecrement64") || IS("InterlockedExchange64") ||
        IS("InterlockedExchangeAdd64") || IS("InterlockedCompareExchange64") ||
        (W32_64 && (IS("InterlockedExchangePointer") || IS("InterlockedCompareExchangePointer")));
    uint64_t old = wide ? x86_rd64(p) : x86_rd32(p), value = ARG64(1), result = old;
    if (wide && !W32_64) value = x86_rd64((uint32_t)X.r[ESP] + 8);
    if (IS("InterlockedIncrement") || IS("InterlockedIncrement64")) result = value = old + 1;
    else if (IS("InterlockedDecrement") || IS("InterlockedDecrement64")) result = value = old - 1;
    else if (IS("InterlockedExchangeAdd") || IS("InterlockedExchangeAdd64")) value += old;
    else if (IS("InterlockedCompareExchange") || IS("InterlockedCompareExchange64") ||
        IS("InterlockedCompareExchangePointer")) {
        uint64_t compare = wide ? (W32_64 ? ARG64(2) : x86_rd64((uint32_t)X.r[ESP] + 16)) : ARG(2);
        if (old != compare) return old;
    }
    if (wide) x86_wr64(p, value); else x86_wr32(p, (uint32_t)value);
    return result;
}
uint64_t w32_thread_api(const char *name) {
    thread_t *t = self();
    t->error = *error_cell(t);
    uint64_t result = thread_api(name);
    *error_cell(t) = t->error;
    if (X.callback_depth && X.transfer != X86_SCHEDULE && w32_thread_pending()) {
        X.r[EAX] = (x86_word_t)result;
        park_native();
        result = X.r[EAX];
    }
    return result;
}
