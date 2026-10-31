/* LANE-K1 — original CC0-1.0 BGT import probe. */
#include "bgt.h"
static bgt_io_t io;
static uint8_t bytes[70000];
BGT_EXPORT(bgt_abi_version) uint32_t version(void){return BGT_ABI_VERSION;}
BGT_EXPORT(bgt_io) uint32_t getio(void){return (uint32_t)(uintptr_t)&io;}
BGT_EXPORT(bgt_init) int32_t init(uint32_t p){(void)p;io.logical_width=io.logical_height=1;return 0;}
BGT_EXPORT(bgt_update) void update(uint32_t dt){
    (void)dt;
    for(uint32_t i=0;i<sizeof bytes;i++)bytes[i]=0xa5;
    int32_t result=bgt_random_bytes(bytes,sizeof bytes);
    if(result)for(uint32_t i=0;i<sizeof bytes;i++)if(bytes[i]!=0xa5)bgt_abort(-3,"partial entropy failure",23);
    if(result==0) {
        uint32_t changed=0;for(uint32_t i=0;i<sizeof bytes;i++)changed|=bytes[i];
        if(!changed)bgt_abort(-3,"zero entropy",12);
        bgt_log(1,"entropy-ok",10);
    } else if(result==BGT_E_IO)bgt_log(1,"entropy-failed",14);
    else if(result==BGT_E_UNSUPPORTED)bgt_log(1,"entropy-unavailable",19);
    else bgt_abort(-3,"unexpected entropy status",25);
    if(bgt_random_bytes((void*)(uintptr_t)0xfffffff0u,32)!=BGT_E_BOUNDS)bgt_abort(-3,"entropy bounds",14);
    if(bgt_random_bytes(bytes,0)!=(result==BGT_E_UNSUPPORTED?BGT_E_UNSUPPORTED:0))bgt_abort(-3,"entropy empty",13);
}
BGT_EXPORT(bgt_render) void render(void){}
BGT_EXPORT(bgt_shutdown) void shutdown(void){}
