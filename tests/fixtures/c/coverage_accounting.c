/* Original CC0-1.0. Known instruction/entry/function counts through the REAL dispatcher. */
#if MODE64
#define X86_FLAT_GUEST 1
#define X86_FLAT_BYTES 65536ull
#endif
#include "../../../platforms/x86/x86_rt.c"
#include "../../../platforms/x86/x86_decode.c"
#include "../../../platforms/x86/x86_exec.c"
#include "../../../platforms/x86/x86_exec64.c"
#include "../../../platforms/x86/x86_simd.c"
/* No x87 instructions in this finite program. Unexpected use must fail, never succeed. */
void x86_x87(const x86_insn_t *in) { (void)in; __builtin_trap(); }
static const uint8_t code[]={0xb9,3,0,0,0,0xff,0xc9,0x75,0xfc,0xe8,0x12,0,0,0,0x90,0xc3};
static const uint8_t callee[]={0xff,0xc0,0xc3};
static const x86_code_range_t ranges[]={{0x1000,0x1010,0},{0x1020,0x1023,1}};
static void suspend(void) { X.transfer=X86_SCHEDULE; }
static void prepare(void) {
    __builtin_memset(&X,0,sizeof X); __builtin_memset(&x86_metrics,0,sizeof x86_metrics);
    X.mode64=MODE64; X.r[ESP]=0x8000;
    x86_map(0x1000,0x8000);
}
BGT_EXPORT(run) void run(uint32_t quantum) {
    prepare(); X.frame_insns=quantum;
    x86_register_code_ranges(ranges,2,2);
    for(unsigned i=0;i<sizeof code;i++)x86_wr8(0x1000+i,code[i]);
    for(unsigned i=0;i<sizeof callee;i++)x86_wr8(0x1020+i,callee[i]);
    x86_set_scheduler(suspend);x86_push(0xfffffff4u);x86_invoke(0x1000,0xfffffff4u);
}
BGT_DEFINE_IO(io)
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) { (void)p;io.logical_width=64;io.logical_height=64;return BGT_OK; }
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) { (void)dt; }
BGT_EXPORT(bgt_render) void bgt_render(void) {}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(gap) void gap(void) {
    static const x86_code_range_t r[]={{0x1000,0x1001,0}};
    prepare(); x86_register_code_ranges(r,1,1);
    /* NOP (owned), MOV EAX,123; NOP; NOP; RET (unowned fall-through). */
    static const uint8_t bytes[]={0x90,0xb8,123,0,0,0,0x90,0x90,0xc3};
    for(unsigned i=0;i<sizeof bytes;i++)x86_wr8(0x1000+i,bytes[i]);
    x86_push(0xfffffff4u);x86_invoke(0x1000,0xfffffff4u);
}
#if MODE64
static void nested_callback(void) {
    x86_cpu_t saved=X;
    x86_push(0xfffffff0u);x86_invoke(0x2000,0xfffffff0u);
    X=saved;
}
BGT_EXPORT(nested) void nested(void) {
    static const x86_code_range_t r[]={{0x1000,0x1001,0},{0x2000,0x2001,1}};
    prepare();x86_register_code_ranges(r,2,2);
    x86_wr8(0x1000,0xc3);x86_wr8(0x2000,0xc3);
    X.frame_insns=2000000;x86_set_scheduler(nested_callback);
    x86_push(0xfffffff4u);x86_invoke(0x1000,0xfffffff4u);
}
#endif
/* K5a adds an inner quantum check before each string iteration. K5c must count
 * actual execution, not a dispatch suspended before its first iteration. */
BGT_EXPORT(string_run) void string_run(uint32_t quantum, uint32_t repeat, uint32_t count) {
    static const x86_code_range_t r[]={{0x1000,0x1003,0},{0x1010,0x1012,0}};
    prepare();x86_register_code_ranges(r,2,1);x86_set_scheduler(suspend);
    /* Separate stable addresses: the runtime deliberately caches decoded code. */
    x86_wr8(0x1000,0xf3);x86_wr8(0x1001,0xaa);x86_wr8(0x1002,0xc3);
    x86_wr8(0x1010,0xaa);x86_wr8(0x1011,0xc3);
    X.r[EAX]=0x5a;X.r[ECX]=count;X.r[ESI]=0x4000;X.r[EDI]=0x3000;
    for(unsigned i=0;i<4;i++)x86_wr8(0x3000+i,0);
    X.frame_insns=quantum;x86_push(0xfffffff4u);x86_invoke(repeat?0x1000:0x1010,0xfffffff4u);
}
BGT_EXPORT(pc) uint32_t pc(void) { return X.eip; }
BGT_EXPORT(remaining) uint32_t remaining(void) { return (uint32_t)X.r[ECX]; }
BGT_EXPORT(destination) uint32_t destination(void) { return (uint32_t)X.r[EDI]; }
BGT_EXPORT(source) uint32_t source(void) { return (uint32_t)X.r[ESI]; }
BGT_EXPORT(byte) uint32_t byte(uint32_t i) { return x86_rd8(0x3000+i); }
BGT_EXPORT(resume) void resume(void) { X.transfer=0; x86_invoke(X.eip,0xfffffff4u); }
BGT_EXPORT(insns) uint32_t insns(void) { return (uint32_t)x86_metrics.interp_insns; }
BGT_EXPORT(entries) uint32_t entries(void) { return (uint32_t)x86_metrics.interp_code_entries; }
BGT_EXPORT(functions) uint32_t functions(void) { return (uint32_t)x86_metrics.interp_functions; }
BGT_EXPORT(unowned) uint32_t unowned(void) { return (uint32_t)x86_metrics.interp_unowned_entries; }
BGT_EXPORT(result) uint32_t result(void) { return (uint32_t)X.r[EAX]; }
