/* vK72: guest-visible state hash for differential checks (lifted vs interpreted builds), never used by execution.
 * Separate translation unit so standalone x86_sched.c test builds need no guest memory. MIT. */
#include "x86_guest.h"
#include "x86_sched.h"
static uint64_t state_mix(uint64_t h, uint64_t v) { h ^= v; h *= 0x9e3779b97f4a7c15ull; return h ^ (h >> 29); }
static uint64_t state_cpu(uint64_t h, const x86_cpu_t *c, uint32_t parts) {
    for (int i = 0; i < 16; i++) h = state_mix(h, (uint64_t)c->r[i]);
    h = state_mix(h, ((uint64_t)c->eip << 32) | ((parts & X86_STATE_FLAGS) ? (c->flags & 0xcd5u) : 0));
    h = state_mix(h, ((uint64_t)c->fs_base << 32) | c->gs_base);
    for (int i = 0; i < 16; i++) { h = state_mix(h, c->xmm[i].u64[0]); h = state_mix(h, c->xmm[i].u64[1]); }
    h = state_mix(h, ((uint64_t)c->mxcsr << 32) | (uint32_t)c->mode64);
    h = state_mix(h, c->tsc);
    for (int i = 0; i < 8; i++) { h = state_mix(h, c->fpu.st[i].sig); h = state_mix(h, c->fpu.st[i].se); }
    return state_mix(h, ((uint64_t)c->fpu.control << 48) | ((uint64_t)c->fpu.status << 32) | ((uint64_t)c->fpu.tags << 16) | c->fpu.initialized);
}
uint32_t x86_guest_state_hash(uint32_t parts) {
    uint64_t h = 0x6a09e667f3bcc908ull;
    uint32_t live = 0;
    for (uint32_t i = 0; i < X86_THREADS; i++) live += x86_tasks[i].live || i == x86_current;
    /* CURRENT (fast builds): once a second thread has been live, which thread ran when, where it stopped (loop
     * headers in fast mode) and the scratch registers blocking APIs leave all depend on quantum positions: from then
     * on compare the live-thread count only (memory still compares every page). */
    static int multi;
    multi |= live > 1;
    if ((parts & X86_STATE_CPU) && (parts & X86_STATE_CURRENT) && multi) h = state_mix(h, 0x6d74000000000000ull | live);
    else if (parts & X86_STATE_CPU) for (uint32_t i = 0; i < X86_THREADS; i++) {
        if ((!x86_tasks[i].live || (parts & X86_STATE_CURRENT)) && i != x86_current) continue;
        h = state_mix(h, i);
        h = state_cpu(h, i == x86_current ? &X : &x86_tasks[i].cpu, parts);
    }
    if (parts & X86_STATE_MEMORY) for (uint32_t p = 0; p < (1u << 20); p++) {
        const uint8_t *page = x86_pages[p];
        if (!page) continue;
        uint64_t w, a = state_mix(h, p), b = 0;
        for (uint32_t o = 0; o < X86_PAGE; o += 16) {
            __builtin_memcpy(&w, page + o, 8); a = (a ^ w) * 0x9e3779b97f4a7c15ull;
            __builtin_memcpy(&w, page + o + 8, 8); b = (b ^ w) * 0xc2b2ae3d27d4eb4full;
        }
        h = state_mix(state_mix(h, a ^ (a >> 31)), b ^ (b >> 29));
    }
    return (uint32_t)(h ^ (h >> 32));
}
