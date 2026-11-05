/* Original CC0-1.0: direct real native-present instrumentation microbenchmark.
 * No guest instructions; this isolates capture cost, NOT guest throughput. */
#include "../../../platforms/x86/x86_rt.c"
#include "../../../platforms/x86/x86_sched.c"
#include "../../../platforms/win32/w32_core.c"
BGT_DEFINE_IO(io)
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p){(void)p;w32_io=&io;io.logical_width=io.logical_height=64;return BGT_OK;}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt){(void)dt;}
BGT_EXPORT(bgt_render) void bgt_render(void){}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void){}
BGT_EXPORT(prepare) void prepare(unsigned n){
    x86_sched_init();
    for(unsigned i=0;i<n;i++)x86_account_create(i,0x1000+i,i?XA_READY:XA_RUNNING,0);
}
BGT_EXPORT(run) void run(unsigned n){for(unsigned i=0;i<n;i++)w32_guest_present(1);}
BGT_EXPORT(presents) uint64_t presents(void){return guest_present.count;}
BGT_EXPORT(drops) uint64_t drops(void){
#if X86_ACCOUNTING_ENABLED && X86_PROFILE_ENABLED
    return account_dropped;
#else
    return 0;
#endif
}
