/* Original CC0 host-side optional-policy descriptor validation fixture. */
#include "bgt.h"
#include "coverage_probe.c"
static uint32_t entries[2],ranges[4];
BGT_EXPORT(bgt_slice_policy) uint32_t policy(uint32_t ne,uint32_t nr) {
    static bgt_slice_policy_t p;
    p=(bgt_slice_policy_t){24,1,ne,(uint32_t)(uintptr_t)entries,nr,(uint32_t)(uintptr_t)ranges};
    if(io.arg0==1)return 0;
    if(io.arg0==2)p.version=2;
    if(io.arg0==3)p.entry_count++;
    if(io.arg0==4)p.ranges_ptr=0xfffffffcu;
    if(io.arg0==5)p.entries_ptr=(uint32_t)(uintptr_t)&p;
    if(io.arg0==6)p.ranges_ptr=(uint32_t)(uintptr_t)&p+4;
    if(io.arg0==7)p.ranges_ptr=p.entries_ptr;
    return (uint32_t)(uintptr_t)&p;
}
BGT_EXPORT(value) uint32_t value(uint32_t i) {return i<2?entries[i]:ranges[i-2];}
