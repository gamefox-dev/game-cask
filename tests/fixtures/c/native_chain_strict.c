/* Original CC0: real native driver must enforce strict policy on cache hits and misses. */
#define X86_COVERAGE_MODE 2
#include "native_chain.c"
BGT_EXPORT(strict_chain) void strict_chain(uint32_t warm) {
    static const x86_lifted_entry_t entries[]={{0x1000,entry_a,0x1002,step_a},{0x2000,entry_b,0x2002,step_b}};
    static const uint32_t allowed[]={0x1000,0x2000};
    prepare(); steps=depth=peak=0; X.r[ECX]=1;
    x86_set_slice(allowed,2,0,0); x86_register_lifted(entries,2);
    if(warm) { (void)x86_find_lifted(0x1000); (void)x86_find_lifted(0x2000); }
    uint32_t p=x86_prepare_host_slice(1,0); if(!p)__builtin_trap();
    bgt_slice_policy_t *policy=(bgt_slice_policy_t *)(uintptr_t)p;
    *(uint32_t *)(uintptr_t)policy->entries_ptr=0x1000;
    x86_push(0xfffffff4u); x86_invoke(0x1000,0xfffffff4u);
}
BGT_EXPORT(native_steps) uint32_t native_steps(void) { return steps; }
