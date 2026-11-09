/* Wasm-local coverage cache. SPDX-License-Identifier: MIT */
#ifndef X86_COVERAGE_H
#define X86_COVERAGE_H
#ifndef X86_COVERAGE_MODE
#define X86_COVERAGE_MODE 1 /* 0 direct reference, 1 buffered discovery, 2 strict check only */
#endif
#define XC_SLOTS 65536u
#define XC_PENDING 4096u
uint64_t x86_coverage_events, x86_coverage_crossings, x86_coverage_cache_hits;
static const uint32_t *slice_entries;
static const x86_code_range_t *slice_ranges;
static uint32_t slice_nentries,slice_nranges;
static uint32_t slice_first_entry[2];
uint32_t x86_slice_first_entry(void) {return slice_first_entry[1]?(uint32_t)(uintptr_t)slice_first_entry:0;}
static void slice_note_first(uint32_t address,uint32_t kind) {if(!slice_first_entry[1]){slice_first_entry[0]=address;slice_first_entry[1]=kind;}}
static const uint32_t *host_entries,*host_ranges;
static uint32_t host_nentries,host_nranges;
static int host_slice_enabled;
uint32_t x86_prepare_host_slice(uint32_t nentries,uint32_t nranges) {
    if(nentries>1048576 || nranges>1048576 || host_slice_enabled)return 0;
    bgt_slice_policy_t *p=(bgt_slice_policy_t *)x86_alloc(24+4*nentries+8*nranges);
    if(!p)return 0;
    uint32_t *entries=(uint32_t *)(p+1),*ranges=entries+nentries;
    *p=(bgt_slice_policy_t){24,1,nentries,(uint32_t)(uintptr_t)entries,nranges,(uint32_t)(uintptr_t)ranges};
    host_entries=entries;host_ranges=ranges;host_nentries=nentries;host_nranges=nranges;host_slice_enabled=1;
    return (uint32_t)(uintptr_t)p;
}
static int host_allows(uint32_t address) {
    if(!host_slice_enabled)return 1;
    uint32_t lo=0,hi=host_nentries;
    while(lo<hi){uint32_t m=(lo+hi)/2;if(host_entries[m]<address)lo=m+1;else hi=m;}
    if(lo<host_nentries && host_entries[lo]==address)return 1;
    lo=0;hi=host_nranges;
    while(lo<hi){uint32_t m=(lo+hi)/2;if(host_ranges[2*m]<=address)lo=m+1;else hi=m;}
    return lo && address<host_ranges[2*(lo-1)+1];
}
void x86_set_slice(const uint32_t *entries,uint32_t nentries,const x86_code_range_t *ranges,uint32_t nranges) {
    slice_entries=entries;slice_nentries=nentries;slice_ranges=ranges;slice_nranges=nranges;
}
#if X86_COVERAGE_MODE == 1
static uint32_t coverage_keys[XC_SLOTS], coverage_pending[XC_PENDING];
static uint8_t coverage_kinds[XC_SLOTS], coverage_pending_kind[XC_PENDING];
static uint32_t coverage_pending_n;
#endif
void x86_coverage_flush(void) {
#if X86_COVERAGE_MODE == 1
    /* Remove a queue item only after it has crossed; a failing host hook remains visible. */
    for(uint32_t i=0;i<coverage_pending_n;i++) {
        x86_coverage_crossings++;bgt_coverage_entry(coverage_pending[i],coverage_pending_kind[i]);
    }
    coverage_pending_n=0;
#endif
}
#if X86_COVERAGE_MODE == 1
/* Keep queue/host work out of the overwhelmingly common exact cache hit.
 * Preserve the pre-flush old kind, exactly as the original queue path did:
 * no second cache, changed hash, batching or evidence policy. */
static __attribute__((noinline)) void coverage_miss(uint32_t address,uint32_t kind,uint32_t h,uint8_t old) {
    uint8_t add=(uint8_t)kind & (uint8_t)~old;
    if(coverage_pending_n==XC_PENDING)x86_coverage_flush();
    coverage_keys[h]=address;coverage_kinds[h]=(uint8_t)(old|kind);
    coverage_pending[coverage_pending_n]=address;coverage_pending_kind[coverage_pending_n++]=add;
}
#endif
void x86_coverage_entry(uint32_t address,uint32_t kind) {
#if X86_COVERAGE_MODE == 2
    /* Same half-open membership contract as the host, checked before guest execution. */
    if(!host_allows(address)) { bgt_slice_missing(1,address);return; }
    uint32_t lo=0,hi=slice_nentries;
    while(lo<hi){uint32_t m=(lo+hi)/2;if(slice_entries[m]<address)lo=m+1;else hi=m;}
    if(lo<slice_nentries && slice_entries[lo]==address){slice_note_first(address,kind);return;}
    lo=0;hi=slice_nranges;
    while(lo<hi){uint32_t m=(lo+hi)/2;if(slice_ranges[m].addr<=address)lo=m+1;else hi=m;}
    if(lo && address<slice_ranges[lo-1].end){slice_note_first(address,kind);return;}
    (void)kind;bgt_slice_missing(1,address);
#elif X86_COVERAGE_MODE == 0
    x86_coverage_events++;x86_coverage_crossings++;bgt_coverage_entry(address,kind);
#else
    if(kind!=1 && kind!=2)return;
    x86_coverage_events++;
    /* Direct-mapped cache: collisions may re-report entries, never lose evidence.
     * No bounded set can silently replace the host's independent overflow policy. */
    uint32_t h=((address^(address>>16))*2654435761u)>>(32-16);
    uint8_t old=coverage_keys[h]==address?coverage_kinds[h]:0;
    if((old&kind)==kind){x86_coverage_cache_hits++;return;}
    coverage_miss(address,kind,h,old);
#endif
}
#endif
