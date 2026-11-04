/* Original CC0-1.0: shared CRT leaf primitives with real guest memory/faults. */
#define MODE64 1
/* These production TUs normally have separate internal-linkage namespaces. */
#define convert_int simd_convert_int
#include "coverage_accounting.c"
#undef convert_int
#include "wasi_offline.h"
#include "../../../platforms/win32/w32_crt_internal.h"
#include "../../../platforms/win32/w32_crt_string.h"
BGT_EXPORT(strings) uint64_t strings(unsigned mode) {
    /* Each mode runs in the same instance, even after an abort. Reset permissions
     * before fixture writes; x86_map deliberately does not reset VirtualProtect. */
    __builtin_memset(x86_protection,0,sizeof x86_protection);
    prepare();X.r[ECX]=0x3ffe;X.r[EDX]=0x4ffe;X.r[R8]=4;
    x86_wr8(0x3ffe,0xff);x86_wr8(0x3fff,0);
    x86_wr8(0x4ffe,0x80);x86_wr8(0x4fff,0);
    /* Adjacent holes: no read beyond the terminator, including readonly/execute-read. */
    x86_pages[4]=0;x86_pages[5]=0;X.r[EDX]=0x2ffe;
    x86_wr8(0x2ffe,0x80);x86_wr8(0x2fff,0);
    if(mode==1){x86_protection[3]=2;x86_protection[2]=0x20;}
    if(mode==2)X.r[ECX]+=0x100000000ull;
    if(mode==3){X.r[ECX]+=0x100000000ull;return c_strlen();}
    if(mode==4)x86_protection[3]=1;
    if(mode==5)x86_wr8(0x3fff,1); /* reaches exactly the next unmapped page */
    if(mode==6){X.r[ECX]+=0x100000000ull;X.r[R8]=0;return c_strncmp();}
    if(mode==7){x86_wr8(0x3ffe,0x80);x86_wr8(0x3fff,1);return c_strncmp();}
    if(mode==8)return c_strlen();
    if(mode==9){ /* Equal nonzero prefix must actually reach the unmapped page. */
        x86_wr8(0x2ffe,0xff);x86_wr8(0x2fff,1);x86_wr8(0x3fff,1);
    }
    if(mode==10)X.r[EDX]+=0x100000000ull;
    if(mode==11){X.r[R8]=0x100000000ull;return c_strncmp();}
    if(mode==12)x86_protection[3]=0x10; /* execute-only is not readable */
    if(mode>=13){
        X.r[ECX]=0x3ffc;X.r[EDX]=0x2ffc;
        x86_wr16(0x3ffc,0xffff);x86_wr16(0x3ffe,0);
        x86_wr16(0x2ffc,0x8000);x86_wr16(0x2ffe,0);
        if(mode==13){x86_protection[3]=2;return c_wcscmp();}
        if(mode==14)return c_wcslen();
        if(mode==15){X.r[ECX]+=0x100000000ull;return c_wcslen();}
        if(mode==16){X.r[EDX]+=0x100000000ull;return c_wcscmp();}
        x86_wr16(0x3ffe,1);return c_wcslen(); /* terminator missing across hole */
    }
    return c_strcmp();
}
