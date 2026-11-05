/* SPDX-License-Identifier: CC0-1.0 — original Windows x64 memory contract probe. */
#include <windows.h>
#include <stdint.h>
#include <stdlib.h>
unsigned _tls_index;
void entry(void);
void (*volatile entry_ref)(void) = entry; /* Genuine DIR64 relocation. */
__attribute__((section(".k27a"), aligned(16))) volatile uint32_t aligned_data[4] = {1,2,3,4};
extern unsigned stack_contract(void);
static unsigned checks;
static void check(int ok) { if (!ok) { OutputDebugStringA("alignment FAIL"); ExitProcess(2); } checks++; }
void entry(void) {
    check(stack_contract() == 1);
    check(((uintptr_t)aligned_data & 15) == 0);
    check(aligned_data[0] == 1 && aligned_data[3] == 4);
    typedef void *(__cdecl *malloc_fn)(size_t);
    typedef void (__cdecl *free_fn)(void *);
    HMODULE crt = LoadLibraryA("msvcrt.dll");
    malloc_fn guest_malloc = (malloc_fn)GetProcAddress(crt,"malloc");
    free_fn guest_free = (free_fn)GetProcAddress(crt,"free");
    check(crt && guest_malloc && guest_free);
    HANDLE heap = GetProcessHeap();
    void *blocks[32];
    for (unsigned i=0;i<32;i++) {
        size_t n = i*i + 1;
        blocks[i] = guest_malloc(n); check(blocks[i] && !((uintptr_t)blocks[i] & 15));
        void *p = HeapAlloc(heap,0,n); check(p && !((uintptr_t)p & 15));
        check(HeapFree(heap,0,p));
    }
    for (unsigned i=0;i<32;i++) guest_free(blocks[i]);
    /* All virtual sections must load at base+RVA, not be individually repacked. */
    unsigned char *base = (unsigned char *)GetModuleHandleA(0);
    unsigned char *nt = base + *(uint32_t *)(base+0x3c);
    uint16_t count = *(uint16_t *)(nt+6), opt = *(uint16_t *)(nt+20);
    unsigned char *section = nt+24+opt;
    check(count >= 3);
    for (unsigned i=0;i<count;i++,section+=40) {
        uint32_t rva = *(uint32_t *)(section+12);
        check(((uintptr_t)(base+rva) & 15) == (rva & 15));
        if (section[0]=='.' && section[1]=='k' && section[2]=='2' && section[3]=='7' && section[4]=='a')
            check((uintptr_t)(base+rva) == (uintptr_t)aligned_data);
    }
    check(checks >= 100);
    OutputDebugStringA("native Windows x64 alignment PASS");
    ExitProcess(0);
}
