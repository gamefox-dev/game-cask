/* Original CC0-1.0: shared CRT leaf primitives with real guest memory/faults. */
#define MODE64 1
#include "coverage_accounting.c"
#include "../../../platforms/win32/w32_crt_internal.h"
#include "../../../platforms/win32/w32_crt_string.h"
BGT_EXPORT(strings) uint64_t strings(unsigned mode) {
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
    return c_strcmp();
}
