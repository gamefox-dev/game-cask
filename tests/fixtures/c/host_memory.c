/* Original CC0-1.0. Real wasm host arena + libc replacement + CRT FILE read/error paths.
 * The immutable read adapter supplies original synthetic bytes, not a VFS implementation oracle. */
#include "../../../platforms/x86/x86_rt.c"
#include "../../../platforms/win32/w32_crt.c"
static unsigned read_calls, close_calls;
uint32_t w32_misc_alloc(uint32_t n) {
    static uint32_t next = 0xc00000; uint32_t p=next; next+=(n+15)&~15u;
    return x86_map(p,n)?p:0;
}
/* These paths are outside this immutable-file fixture; unexpected execution must trap. */
void w32_heap_free(uint32_t p){(void)p;__builtin_trap();}
uint32_t w32_heap_realloc(uint32_t p,uint32_t n){(void)p;(void)n;__builtin_trap();}
uint64_t w32_fs_now(void){__builtin_trap();}
void w32_fs_update_key(const char *key,uint64_t size){(void)key;(void)size;__builtin_trap();}
void w32_logf2(const char *a,const char *b){bgt_log(1,a,(uint32_t)strlen(a));bgt_log(1,b,(uint32_t)strlen(b));}
int w32_file_read_ahead(uint32_t h,uint8_t *dst,uint32_t n,uint32_t *got){
    (void)h;read_calls++;*got=n<302?n:302;
    for(uint32_t i=0;i<*got;i++)dst[i]=(uint8_t)('A'+(i+2)%26);return 1;
}
void w32_file_consumed(uint32_t h,uint64_t pos,uint32_t n){(void)h;(void)pos;(void)n;}
void w32_file_observed(uint32_t h,uint64_t pos,uint32_t n){(void)h;(void)pos;(void)n;}
int w32_file_seek_pos(uint32_t h,int64_t d,uint32_t m,uint64_t *out){(void)h;(void)d;(void)m;(void)out;return 1;}
int w32_file_close_h(uint32_t h){(void)h;close_calls++;return 1;}
#define VERIFY(x) do {if(!(x))return __LINE__;} while(0)
static void *held[4096];
BGT_EXPORT(check_host) uint32_t check_host(void) {
    VERIFY(x86_map(0x10000,4096));crt_iob_base();crt_errno(0);
    uint32_t token=iob_base+3*48;
    crt_file_t *f=&cfiles[3];memset(f,0,sizeof *f);
    f->open=f->read=f->binary=1;f->handle=17;f->capacity=16384;f->pushback=-1;
    uint32_t count=0;
    for(uint32_t n=1u<<20;n>=32;n/=2){void *p;while((p=x86_host_alloc(XH_GL,n))!=0){VERIFY(count<4096);held[count++]=p;}}
    errno=0;volatile size_t request=65536;
    void *p=malloc(request);VERIFY(!p&&errno==ENOMEM);
    p=calloc(SIZE_MAX,2);VERIFY(!p&&errno==ENOMEM);
    X.r[ECX]=0x10000;X.r[EDX]=1;X.r[R8]=1;X.r[R9]=token;
    VERIFY(c_fread()==0);VERIFY(f->error&&!f->buffer&&f->capacity==16384);
    VERIFY(x86_rd32(crt_errno_cell())==12&&read_calls==0);
    VERIFY(x86_host_stats[XH_FILE].oom==1);
    for(uint32_t i=0;i<count;i++)x86_host_free(held[i]);
    uint64_t backing=x86_host_reserved;
    f->error=0;VERIFY(c_fread()==1);VERIFY(x86_rd8(0x10000)=='C'&&read_calls==1);
    X.r[R8]=301;VERIFY(c_fread()==301);
    for(uint32_t i=0;i<301;i++)VERIFY(x86_rd8(0x10000+i)==(uint8_t)('A'+(i+3)%26));
    VERIFY(!f->error);X.r[ECX]=token;VERIFY(c_fclose()==0);
    VERIFY(close_calls==1&&x86_host_stats[XH_FILE].used==0);
    p=malloc(12000);VERIFY(p);memset(p,0x42,12000);
    void *q=realloc(p,SIZE_MAX);VERIFY(!q&&errno==ENOMEM&&((uint8_t *)p)[11999]==0x42);
    q=realloc(p,24000);VERIFY(q&&((uint8_t *)q)[11999]==0x42);free(q);
    VERIFY(x86_host_stats[XH_CRT].used==0&&x86_host_stats[XH_GL].used==0);
    VERIFY(x86_host_reserved==backing&&x86_host_used==x86_host_stats[XH_RUNTIME].used);
    VERIFY(x86_host_reserved<=x86_host_limit());return 0;
}
BGT_EXPORT(host_limit) uint32_t host_limit(void){return (uint32_t)x86_host_limit();}
