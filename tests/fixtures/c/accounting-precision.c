/* Original CC0-1.0. Real serializer inputs only (same providers as capacity
 * regression), retaining exact u64s in the presentation ring. No guest shim. */
#include "metrics_capacity.c"
BGT_EXPORT(precision) uint32_t precision(void) {
    uint64_t huge=UINT64_C(9007199254740993);
    x86_account_t *a=&x86_accounts[0];
    a->id=1;a->start_address=0x1000;a->state=XA_EXITED;
    a->switches=a->sleep_requested_ms=a->object_requested_ms=a->infinite_waits=UINT64_MAX;
    a->virtual_ms[XA_SLEEP]=UINT64_MAX;a->wall_us[XA_RUNNING]=110;
    a->retired.instructions[XR_LIFTED]=42;x86_retired=a->retired;
    account_length=2;account_next=2;account_dropped=UINT64_MAX;
    for(unsigned n=0;n<2;n++) {
        account_frame_t *f=&account_frames[n];
        f->present=huge+n;f->wall_us=1000+400*n;f->lifted_calls=huge+7*n;f->generic_insn_execs=huge+n;
        f->retired.instructions[XR_LIFTED]=42*n;
        f->threads[0]=*a;f->threads[0].retired=f->retired;
        f->threads[0].switches=huge+3*n;f->threads[0].sleep_requested_ms=huge+5*n;
        f->threads[0].object_requested_ms=huge+7*n;f->threads[0].infinite_waits=huge+n;
        f->threads[0].virtual_ms[XA_SLEEP]=huge+2*n;f->threads[0].wall_us[XA_RUNNING]=100+10*n;
    }
    return (uint32_t)(uintptr_t)w32_metrics_json();
}
