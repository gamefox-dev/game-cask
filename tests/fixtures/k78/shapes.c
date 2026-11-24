/* Original CC0-1.0. K78 stress fixture for fast lifting (liftFast sync minimal, inline 16, outlined calls): code shapes
 * the kit's other fixtures lack. Every shape is ABI-correct Win64 code, so a fast build must match the interpreter
 * exactly (API trace and guest state). Global assembly stands in for MSVC/hand-written shapes clang does not emit. */
#include <windows.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static uint64_t hash = 1469598103934665603ull;
static void mix(uint64_t v) { hash = (hash ^ v) * 1099511628211ull; }
static void report(const char *name) {
    char line[96]; wsprintfA(line, "k78 %s %08x%08x", name, (unsigned)(hash >> 32), (unsigned)hash);
    OutputDebugStringA(line); hash = 1469598103934665603ull;
}

/* ---- hand-written shapes (Intel syntax) ---- */
uint64_t k_leaf3(uint64_t x);              /* 3x */
uint64_t k_multi_a(uint64_t x);            /* falls through into k_multi_b: second entry */
uint64_t k_multi_b(uint64_t x);
uint64_t k_mid_target(uint64_t x);
uint64_t k_mid_jumper(uint64_t x);         /* jumps into the middle of k_mid_target, after its prologue */
uint64_t k_cond_tail(uint64_t x);          /* conditional tail call (jz k_leaf3) */
uint64_t k_shrink(uint64_t n, uint64_t fast); /* shrink-wrapped: fast path before the prologue */
uint64_t k_home(uint64_t a, uint64_t b);   /* MSVC-style saves into the caller's home area */
uint64_t k_probe_user(uint64_t n);         /* __chkstk-style helper that preserves RAX; caller subtracts RAX */
uint64_t k_dispatch_user(uint64_t a, uint64_t b); /* call [ptr] -> `jmp rax` dispatch thunk (CFG shape) */
uint64_t k_divmod_user(uint64_t a, uint64_t b);   /* callee returns a second value in RDX */
uint64_t k_two_tails(uint64_t x);          /* two different tail jumps and a jump table leaving the function */
uint64_t k_inline_pair(uint64_t x);        /* tiny callee that itself makes a tiny call (two inline levels) */
uint64_t k_saves_all(uint64_t x);          /* uses every callee-saved register around calls */
__asm__(
    ".intel_syntax noprefix\n"
    ".text\n"
    ".globl k_leaf3\nk_leaf3:\n  lea rax, [rcx+rcx*2]\n  ret\n"
    ".globl k_multi_a\nk_multi_a:\n  lea rcx, [rcx+rcx*1+1]\n"
    ".globl k_multi_b\nk_multi_b:\n  push rbx\n  sub rsp, 32\n  mov rbx, rcx\n  call k_leaf3\n  add rax, rbx\n  add rsp, 32\n  pop rbx\n  ret\n"
    ".globl k_mid_target\nk_mid_target:\n  push rbx\n  sub rsp, 32\n  mov rbx, rcx\n"
    "k_mid_body:\n  lea rcx, [rbx+3]\n  call k_leaf3\n  add rax, rbx\n  add rsp, 32\n  pop rbx\n  ret\n"
    ".globl k_mid_jumper\nk_mid_jumper:\n  push rbx\n  sub rsp, 32\n  mov rbx, rcx\n  add rbx, 100\n  jmp k_mid_body\n"
    ".globl k_cond_tail\nk_cond_tail:\n  test cl, 1\n  jz k_leaf3\n  lea rax, [rcx+5]\n  ret\n"
    ".globl k_shrink\nk_shrink:\n  test rcx, rcx\n  jle 2f\n  push rbx\n  push rsi\n  sub rsp, 40\n  mov rbx, rcx\n  xor esi, esi\n"
    "1:\n  mov rcx, rbx\n  call k_leaf3\n  add rsi, rax\n  dec rbx\n  jnz 1b\n  mov rax, rsi\n  add rsp, 40\n  pop rsi\n  pop rbx\n  ret\n"
    "2:\n  mov rax, rdx\n  ret\n"
    ".globl k_home\nk_home:\n  mov [rsp+8], rbx\n  mov [rsp+16], rsi\n  push rdi\n  sub rsp, 32\n  mov rbx, rcx\n  mov rsi, rdx\n"
    "  mov rcx, rsi\n  call k_leaf3\n  mov rdi, rax\n  mov rcx, rbx\n  call k_cond_tail\n  lea rax, [rax+rdi*4]\n  add rax, rsi\n"
    "  mov rbx, [rsp+48]\n  mov rsi, [rsp+56]\n  add rsp, 32\n  pop rdi\n  ret\n"
    /* k_probe: touches every page below RSP down to RSP-RAX, preserves RAX (like __chkstk) */
    "k_probe:\n  push rcx\n  push rax\n  lea rcx, [rsp+24]\n  sub rcx, rax\n  mov r10, rsp\n"
    "3:\n  sub r10, 4096\n  cmp r10, rcx\n  jb 4f\n  test byte ptr [r10], 0\n  jmp 3b\n4:\n  pop rax\n  pop rcx\n  ret\n"
    ".globl k_probe_user\nk_probe_user:\n  push rbp\n  mov rbp, rsp\n  push rbx\n  mov rbx, rcx\n  mov eax, 0x3020\n  call k_probe\n  sub rsp, rax\n"
    "  mov rcx, rsp\n  mov rdx, 0\n5:\n  mov [rcx+rdx*8], rdx\n  inc rdx\n  cmp rdx, 1536\n  jb 5b\n"
    "  sub rsp, 32\n  mov rcx, rbx\n  call k_leaf3\n  add rax, [rsp+32+8*1000]\n  lea rsp, [rbp-8]\n  pop rbx\n  pop rbp\n  ret\n"
    "k_dispatch:\n  jmp rax\n"
    ".globl k_dispatch_user\nk_dispatch_user:\n  push rbx\n  sub rsp, 32\n  mov rbx, rdx\n  lea rax, [rip+k_multi_b]\n  call [rip+k_dispatch_ptr]\n"
    "  mov rcx, rbx\n  lea rax, [rip+k_leaf3]\n  mov rbx, rax\n  call [rip+k_dispatch_ptr]\n  add rax, rbx\n  add rsp, 32\n  pop rbx\n  ret\n"
    "k_divmod:\n  mov rax, rcx\n  xor edx, edx\n  div r8\n  ret\n"
    ".globl k_divmod_user\nk_divmod_user:\n  sub rsp, 40\n  mov r8, rdx\n  call k_divmod\n  imul rdx, rdx, 1000\n  add rax, rdx\n  add rsp, 40\n  ret\n"
    ".globl k_two_tails\nk_two_tails:\n  cmp rcx, 3\n  ja 7f\n  lea rdx, [rip+k_tail_table]\n  movsxd rax, dword ptr [rdx+rcx*4]\n  add rax, rdx\n  jmp rax\n"
    "6:\n  lea rax, [rcx+11]\n  ret\n"
    "7:\n  test cl, 2\n  jnz k_mid_target\n  jmp k_multi_b\n"
    "k_inline_inner:\n  lea rax, [rcx+7]\n  ret\n"
    ".globl k_inline_pair\nk_inline_pair:\n  add rcx, 1\n  call k_inline_inner\n  imul rax, rax, 3\n  ret\n"
    ".globl k_saves_all\nk_saves_all:\n  push rbx\n  push rbp\n  push rsi\n  push rdi\n  push r12\n  push r13\n  push r14\n  push r15\n  sub rsp, 40\n"
    "  mov rbx, rcx\n  lea rbp, [rcx+1]\n  lea rsi, [rcx+2]\n  lea rdi, [rcx+3]\n  lea r12, [rcx+4]\n  lea r13, [rcx+5]\n  lea r14, [rcx+6]\n  lea r15, [rcx+7]\n"
    "  call k_leaf3\n  add rbx, rax\n  mov rcx, rbp\n  call k_inline_pair\n  add rbp, rax\n  mov rcx, rsi\n  call k_cond_tail\n  add rsi, rax\n"
    "  mov rcx, rdi\n  call k_multi_a\n  add rdi, rax\n  mov rcx, r12\n  call k_shrink\n"
    "  lea rax, [rbx+rbp]\n  add rax, rsi\n  add rax, rdi\n  add rax, r12\n  add rax, r13\n  add rax, r14\n  add rax, r15\n"
    "  add rsp, 40\n  pop r15\n  pop r14\n  pop r13\n  pop r12\n  pop rdi\n  pop rsi\n  pop rbp\n  pop rbx\n  ret\n"
    ".section .rdata,\"dr\"\n.p2align 3\nk_dispatch_ptr:\n  .quad k_dispatch\n"
    ".p2align 2\nk_tail_table:\n  .long 6b-k_tail_table\n  .long k_leaf3-k_tail_table\n  .long k_cond_tail-k_tail_table\n  .long 6b-k_tail_table\n"
    ".text\n"
    ".att_syntax prefix\n");

static void shapes(void) {
    for (uint64_t i = 0; i < 40; i++) {
        mix(k_multi_a(i)); mix(k_multi_b(i)); mix(k_mid_target(i)); mix(k_mid_jumper(i)); mix(k_cond_tail(i));
        mix(k_shrink(i & 7, i)); mix(k_home(i, i * 5)); mix(k_dispatch_user(i, i + 9)); mix(k_divmod_user(i * 977 + 5, (i & 15) + 1));
        mix(k_two_tails(i & 7)); mix(k_inline_pair(i)); mix(k_saves_all(i));
        if ((i & 7) == 0) mix(k_probe_user(i));
    }
    report("asm-shapes");
}

/* ---- compiler shapes ---- */
/* Shrink-wrapping: a cheap early exit before a prologue that saves callee-saved registers. */
__attribute__((noinline)) static uint64_t heavy(uint64_t a, uint64_t b) { return a * 31 + (b ^ (a >> 3)); }
__attribute__((noinline)) static uint64_t shrink_c(uint64_t n, uint64_t *v) {
    if (n < 3) return n + 1;
    uint64_t s = 0, t = n * 7, u = n ^ 0x55;
    for (uint64_t i = 0; i < n; i++) { s += heavy(v[i & 15], t); t = heavy(t, s); u ^= heavy(u, i); }
    return s + t + u;
}
/* Tail calls (sibling calls), mutually recursive, and through a pointer table. */
typedef uint64_t (*op_t)(uint64_t, uint64_t);
__attribute__((noinline)) static uint64_t op_add(uint64_t a, uint64_t b) { return a + b; }
__attribute__((noinline)) static uint64_t op_mul(uint64_t a, uint64_t b) { return a * (b | 1); }
__attribute__((noinline)) static uint64_t op_xor(uint64_t a, uint64_t b) { return (a ^ b) + 3; }
__attribute__((noinline)) static uint64_t op_rot(uint64_t a, uint64_t b) { return (a << (b & 31)) | (a >> (64 - (b & 31) - 1)); }
static op_t const ops[4] = {op_add, op_mul, op_xor, op_rot};
static volatile op_t vops[4] = {op_add, op_mul, op_xor, op_rot};
__attribute__((noinline)) static uint64_t even(uint64_t n, uint64_t acc);
__attribute__((noinline)) static uint64_t odd(uint64_t n, uint64_t acc) { return n ? even(n - 1, ops[n & 3](acc, n)) : acc; }
__attribute__((noinline)) static uint64_t even(uint64_t n, uint64_t acc) { return n ? odd(n - 1, vops[(n >> 1) & 3](acc, n)) : acc + 1; }
static uint64_t switchy(uint64_t k, uint64_t a) {
    switch (k & 15) {
    case 0: return op_add(a, 1); case 1: return op_mul(a, 3); case 2: return a ^ 0x77; case 3: return op_xor(a, k);
    case 4: return a + k * 9; case 5: return op_rot(a, k); case 6: return a - 5; case 7: return heavy(a, k);
    case 8: return a * a; case 9: return op_add(a, k); case 10: return a >> 2; case 11: return op_mul(a, k);
    default: return a + 1;
    }
}
static void tails(void) {
    uint64_t v[16]; for (int i = 0; i < 16; i++) v[i] = (uint64_t)i * 0x9e3779b97f4a7c15ull;
    for (uint64_t n = 0; n < 60; n++) { mix(shrink_c(n, v)); mix(odd(n * 3, n)); mix(even(n * 2 + 1, n)); mix(switchy(n * 7, n)); }
    report("tails-tables");
}
/* Deep recursion past the fast call-depth cap (128) with callee-saved and volatile values live across calls. */
__attribute__((noinline)) static uint64_t deep(uint64_t n, uint64_t a, uint64_t b, uint64_t c) {
    if (!n) return a ^ b ^ c;
    uint64_t x = a * 3 + n, y = b + c * 5, z = c ^ (a << 1);
    uint64_t r = deep(n - 1, y, z, x);
    return r + x * 7 + y * 11 + z * 13 + heavy(r, n);
}
static void recursion(void) {
    for (uint64_t n = 1; n < 400; n += 57) mix(deep(n, n, n * 2, n * 3));
    report("deep-recursion");
}
/* Stack slots live across calls (arrays filled by callees, alloca via ___chkstk_ms, a 12 KB frame). */
__attribute__((noinline)) static void fill(uint64_t *p, unsigned n, uint64_t seed) { for (unsigned i = 0; i < n; i++) p[i] = seed + i * 3; }
__attribute__((noinline)) static uint64_t sum(const uint64_t *p, unsigned n) { uint64_t s = 0; for (unsigned i = 0; i < n; i++) s += p[i] ^ (s >> 3); return s; }
__attribute__((noinline)) static uint64_t slots(unsigned n) {
    uint64_t big[1500], small[8];
    fill(big, 1500, n); fill(small, 8, n * 5);
    uint64_t *dyn = __builtin_alloca(8 * (n + 1));
    fill(dyn, n + 1, small[3]);
    uint64_t s = sum(big, 1500) + sum(small, 8) + sum(dyn, n + 1);
    small[2] = s; fill(big + 700, 10, small[2]);
    return s + sum(big + 690, 30) + small[7];
}
static void stack(void) { for (unsigned n = 1; n < 200; n += 13) mix(slots(n)); report("stack-slots"); }
/* x87 (long double is 80-bit on this target) and SSE with many values live across calls (XMM6-15 are callee-saved). */
__attribute__((noinline)) static long double lmix(long double a, long double b) { return a * 1.5L + b / 3.0L; }
__attribute__((noinline)) static double dmix(double a, double b) { return a * 0.75 + b * b * 0.001; }
static void floats(void) {
    long double l = 1.0L; double d[10]; for (int i = 0; i < 10; i++) d[i] = i * 1.25;
    for (int r = 0; r < 50; r++) {
        l = lmix(l, (long double)r); if (l > 1e9L) l /= 1e6L;
        double a = d[0], b = d[1], c = d[2], e = d[3], f = d[4], g = d[5], h = d[6], k = d[7];
        for (int i = 0; i < 10; i++) d[i] = dmix(d[i], a + b * c - e + f * g - h + k + r);
        d[0] += a; d[3] -= e; d[6] += h * 0.5;
        uint64_t bits; memcpy(&bits, &d[r % 10], 8); mix(bits);
    }
    uint64_t lb[2] = {0, 0}; memcpy(lb, &l, 10); mix(lb[0]); mix(lb[1] & 0xffff);
    report("x87-sse");
}
/* setjmp/longjmp from nested and tiny (inlinable) frames, callee-saved values live. */
static jmp_buf env;
__attribute__((noinline)) static void tiny_jump(int v) { longjmp(env, v); }
__attribute__((noinline)) static uint64_t nest_jump(uint64_t n, uint64_t a) { if (n == 0) tiny_jump((int)(a & 0x7fff) + 1); return nest_jump(n - 1, heavy(a, n)) + n; }
static void jumps(void) {
    for (uint64_t r = 0; r < 12; r++) {
        volatile uint64_t keep = r * 0x1234567ull, other = r + 99;
        int got = setjmp(env);
        if (!got) { nest_jump(r * 3 + 1, keep); mix(0xdead); }
        else mix((uint64_t)got + keep + other);
    }
    report("setjmp-longjmp");
}
/* qsort through the profile (guest comparator callback) and an indirect call through a computed pointer. */
static int cmp_u64(const void *a, const void *b) { uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b; return x < y ? -1 : x > y; }
static void callbacks(void) {
    uint64_t v[97]; for (int i = 0; i < 97; i++) v[i] = (uint64_t)(i * 7919 % 97) * 0x10001ull;
    qsort(v, 97, 8, cmp_u64);
    for (int i = 0; i < 97; i += 5) mix(v[i]);
    op_t f = (op_t)((uintptr_t)ops[(uintptr_t)v[3] & 3] ^ 0); mix(f(v[1], v[2]));
    report("callbacks");
}
/* A very large function (over the 4096-instruction fast limit: exact emitter) and a large one under it, both
 * calling fast functions and called by them. */
#define B1(i) acc = acc * 31 + (i) + heavy(acc, (i) & 7) * (((acc >> 5) & 1) ? 3 : 5);
#define B10(i) B1(i) B1(i+1) B1(i+2) B1(i+3) B1(i+4) B1(i+5) B1(i+6) B1(i+7) B1(i+8) B1(i+9)
#define B100(i) B10(i) B10(i+10) B10(i+20) B10(i+30) B10(i+40) B10(i+50) B10(i+60) B10(i+70) B10(i+80) B10(i+90)
__attribute__((noinline)) static uint64_t huge_fn(uint64_t acc) { B100(0) B100(100) B100(200) B100(300) B100(400) B100(500) return acc; }
__attribute__((noinline)) static uint64_t large_fn(uint64_t acc) { B100(1000) B100(1100) return acc; }
static void large(void) { for (uint64_t i = 0; i < 6; i++) { mix(huge_fn(i)); mix(large_fn(i)); } report("large-functions"); }
/* Long loops around tiny inlinable callees: quantum polls (and with two threads, transfers) inside inlined code. */
__attribute__((noinline)) static uint64_t step2(uint64_t x) { return (x ^ (x >> 7)) * 0x2545f4914f6cdd1dull; }
__attribute__((noinline)) static uint64_t step1(uint64_t x) { return step2(x + 1) + 1; }
static volatile uint64_t worker_out;
static DWORD WINAPI worker(LPVOID p) {
    uint64_t x = (uintptr_t)p;
    for (int i = 0; i < 700000; i++) { x = step1(x); if ((i & 0xffff) == 0) x += k_saves_all(x & 0xff); }
    worker_out = x; return 0;
}
static void quanta(void) {
    HANDLE t = CreateThread(0, 0, worker, (LPVOID)(uintptr_t)77, 0, 0);
    uint64_t x = 5;
    for (int i = 0; i < 900000; i++) { x = step1(x); if ((i & 0x3fff) == 0) x ^= k_inline_pair(x & 0xffff) + k_two_tails(x & 7); }
    WaitForSingleObject(t, INFINITE); CloseHandle(t);
    mix(x); mix(worker_out);
    report("quanta-threads");
}

int main(void) {
    shapes(); tails(); recursion(); stack(); floats(); jumps(); callbacks(); large(); quanta();
    OutputDebugStringA("k78 done");
    for (;;) Sleep(5);
}
