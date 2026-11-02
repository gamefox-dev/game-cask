/* Original CC0-1.0. Actual GL object API + frontend in a bounded native host adapter.
 * The transport records and validates command ownership; it is NOT a native GPU compiler oracle.
 * Browser tests separately exercise the real native compilers. No guest/original executable runs. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include "../../platforms/win32/w32_gl.c"
x86_cpu_t X;
uint8_t *x86_pages[1u<<20];
uint8_t x86_protection[1u<<20]; int x86_protection_active;
__attribute__((noreturn)) void x86_fault(const char *s,uint32_t a){fprintf(stderr,"fault %s %u\n",s,a);exit(3);}
static uint8_t memory[2u<<20];
static uint8_t host[64u<<20];
static uint32_t top, submissions, rejected_size, request_pending, request_result;
static uint32_t live_modules[1024], module_creates;
static uint32_t reject_transport;
static void *x86_host_backing(uint32_t n) { n=(n+15)&~15u; if(n>sizeof host-top){rejected_size=n;return 0;} void *p=host+top;top+=n;memset(p,0,n);return p; }
uint64_t x86_host_limit(void) { return sizeof host; }
static char host_diagnostic[512];
void bgt_log(uint32_t level,const char *p,uint32_t n) { (void)level;/* no allocator recursion */
    if(n>=sizeof host_diagnostic)abort();memcpy(host_diagnostic,p,n);host_diagnostic[n]=0;
}
#include "../../platforms/x86/x86_host.h"
uint32_t x86_rd8_slow(uint32_t a){return memory[a];}
uint32_t x86_rd16_slow(uint32_t a){uint16_t v;memcpy(&v,memory+a,2);return v;}
uint32_t x86_rd32_slow(uint32_t a){uint32_t v;memcpy(&v,memory+a,4);return v;}
void x86_wr8_slow(uint32_t a,uint32_t v){memory[a]=(uint8_t)v;}
void x86_wr16_slow(uint32_t a,uint32_t v){memcpy(memory+a,&v,2);}
void x86_wr32_slow(uint32_t a,uint32_t v){memcpy(memory+a,&v,4);}
uint32_t w32_slen(const char *s){return (uint32_t)strlen(s);}
void w32_logf2(const char *a,const char *b){fprintf(stderr,"%s%s\n",a,b);}
void w32_log(const char *s){fprintf(stderr,"%s\n",s);}
void w32_wait_frame(void){abort();}
/* Recording transport, intentionally not a GLSL validator. Validate source ownership,
 * command shape and handle/request lifecycle; compiler rejection is independently injected. */
int32_t bgt_submit_commands(const void *p,uint32_t n) {
    const uint32_t *w=p; if(n<16||w[2]!=n||w[3]!=1)abort(); submissions++;
    uint32_t code=w[4]&65535u; const uint32_t *a=w+6;
    if(reject_transport&&code==0x48)return -3;
    if(code==0x48) {
        if(n!=48||a[0]==0||a[0]>=1024||live_modules[a[0]]||a[1]<1||a[1]>2||a[2]!=1||request_pending)abort();
        uint32_t off=a[3]-(uint32_t)(uintptr_t)host;
        if((uint64_t)off+a[4]>=top||!a[4]||host[off+a[4]]||!strstr((char *)host+off,"void main"))abort();
        live_modules[a[0]]=1;module_creates++;request_pending=a[5];
    } else if(code==0x49) {
        if(n!=28||a[0]>=1024||!live_modules[a[0]])abort();live_modules[a[0]]=0;
    }
    return 0;
}
int32_t bgt_request_status(uint32_t r){if(r!=request_pending||!r)abort();return 1;}
int32_t bgt_request_read(uint32_t r,void *p,uint32_t n){if(r!=request_pending||n<4)abort();memcpy(p,&request_result,4);return 4;}
int32_t bgt_request_close(uint32_t r){if(r!=request_pending)abort();request_pending=0;return 0;}
uint32_t w32_pstr(uint32_t a,uint32_t n,int wide,const char *s){(void)wide;uint32_t k=0;while(k+1<n&&s[k]){memory[a+k]=s[k];k++;}if(n)memory[a+k]=0;return k;}
uint32_t w32_gstr(uint32_t a,int wide,char *s,uint32_t n){(void)wide;snprintf(s,n,"%s",memory+a);return (uint32_t)strlen(s);}
static uint32_t call(uint32_t (*fn)(void),uint32_t a,uint32_t b,uint32_t c,uint32_t d){X.r[ESP]=1024;x86_wr32(1028,a);x86_wr32(1032,b);x86_wr32(1036,c);x86_wr32(1040,d);return fn();}

#define CHECK(x) do { if (!(x)) { fprintf(stderr,"frontend invariant line %u: %s\n",__LINE__,#x); exit(1); } } while (0)
static uint32_t compile(const char *src,uint32_t type) {
    uint32_t s=call(api_CreateShader,type,0,0,0); CHECK(s);
    CHECK(strlen(src)<sizeof memory-8192); strcpy((char *)memory+8192,src); x86_wr32(4096,8192);
    call(api_ShaderSource,s,1,4096,0); call(api_CompileShader,s,0,0,0); return s;
}
static const char *vertex="#version 330 core\nvoid main(){gl_Position=vec4(0.0);}";
static void drop(uint32_t p) { if(p) call(api_DeleteProgram,p,0,0,0); }
static uint32_t build(const char *fragment) {
    uint32_t v=compile(vertex,0x8b31),f=compile(fragment,0x8b30),p=call(api_CreateProgram,0,0,0,0); CHECK(p);
    CHECK(shaders[v].compiled&&shaders[f].compiled); CHECK(!shaders[v].unit&&!shaders[f].unit);
    call(api_AttachShader,p,v,0,0);call(api_AttachShader,p,f,0,0);call(api_LinkProgram,p,0,0,0);
    CHECK(programs[p].linked);CHECK(!shaders[v].unit&&!shaders[f].unit);
    call(api_DeleteShader,v,0,0,0);call(api_DeleteShader,f,0,0,0);CHECK(shaders[v].used&&shaders[f].used);
    return p;
}
static void stress(void) {
    uint32_t cache[96]={0},plateau=0;
    static char source[300000];
    for(uint32_t i=0;i<768;i++) {
        drop(cache[i%96]);
        uint32_t n=(uint32_t)sprintf(source,"#version 330 core\n/*");
        uint32_t padding=4096+(i%12)*16384;
        memset(source+n,' ',padding);n+=padding;n+=(uint32_t)sprintf(source+n,"*/\nout vec4 c; uniform vec4 shade;\n");
        for(uint32_t f=0;f<48;f++)n+=(uint32_t)sprintf(source+n,"float h%u(float x){return x+0.001;}\n",f);
        n+=(uint32_t)sprintf(source+n,"void main(){float x=0.0;");
        for(uint32_t f=0;f<48;f++)n+=(uint32_t)sprintf(source+n,"x=h%u(x);",f);
        sprintf(source+n,"c=shade+vec4(x);}");
        uint32_t p=cache[i%96]=build(source);
        if(i%3==0) { call(api_LinkProgram,p,0,0,0); CHECK(programs[p].linked); }
        if(i==383)plateau=top;
        if(i>=384)CHECK(top==plateau);
        CHECK(!error&&w32_gl_frontend_oom==0&&w32_gl_frontend_bytes<32u<<20);
    }
    for(uint32_t i=0;i<96;i++)drop(cache[i]);
    CHECK(w32_gl_frontend_bytes==0&&w32_gl_frontend_allocations==w32_gl_frontend_frees);
    printf("stress cycles=768 retained=96 plateau=%u peak=%llu live=%llu oom=%llu\n",plateau,
        (unsigned long long)w32_gl_frontend_peak,(unsigned long long)w32_gl_frontend_bytes,(unsigned long long)w32_gl_frontend_oom);
}
static void lifecycle(void) {
    const char *valid="#version 330 core\nout vec4 c;void main(){c=vec4(1.0);}";
    uint32_t p=build(valid),v=programs[p].vs,f=programs[p].fs;
    call(api_UseProgram,p,0,0,0);call(api_DeleteProgram,p,0,0,0);CHECK(programs[p].used&&programs[p].deleted);
    /* ShaderSource must NOT change the last compiled snapshot, even for an attached deleted shader. */
    strcpy((char *)memory+8192,"#version 330 core\n#error must not be compiled at link");x86_wr32(4096,8192);
    call(api_ShaderSource,f,1,4096,0);call(api_LinkProgram,p,0,0,0);CHECK(programs[p].linked&&shaders[f].compiled);
    Gp *info=programs[p].info;call(api_CompileShader,f,0,0,0);CHECK(!shaders[f].compiled&&strstr(shaders[f].log,"must not"));
    call(api_LinkProgram,p,0,0,0);CHECK(!programs[p].linked&&programs[p].info==info);CHECK(programs[p].log[0]);
    call(api_GetProgramInfoLog,p,512,4096,8192);CHECK(x86_rd32(4096)>0&&memory[8192]);
    call(api_GetShaderInfoLog,f,512,4096,8192);CHECK(x86_rd32(4096)>0&&memory[8192]);
    call(api_UseProgram,0,0,0,0);CHECK(!programs[p].used&&!shaders[v].used&&!shaders[f].used);
    /* Replacing a stage attachment must release an old delete-pending object. */
    p=build(valid);v=programs[p].vs;uint32_t next=compile(vertex,0x8b31);
    call(api_AttachShader,p,next,0,0);CHECK(!shaders[v].used);call(api_DeleteShader,next,0,0,0);drop(p);
    CHECK(w32_gl_frontend_bytes==0);CHECK(!error);
    /* Explicit detach and sharing retain the compiled snapshot until the final attachment dies. */
    uint32_t s=compile(vertex,0x8b31),a=call(api_CreateProgram,0,0,0,0),b=call(api_CreateProgram,0,0,0,0);
    call(api_AttachShader,a,s,0,0);call(api_AttachShader,b,s,0,0);call(api_DeleteShader,s,0,0,0);
    call(api_DetachShader,a,s,0,0);CHECK(shaders[s].used);drop(a);drop(b);CHECK(!shaders[s].used);
    CHECK(w32_gl_frontend_bytes==0);printf("lifecycle snapshot/relink/rollback/deferred/shared/detach OK\n");
}
static void exhaustion(void) {
    uint32_t s=compile(vertex,0x8b31);CHECK(shaders[s].compiled);
    uint32_t p=call(api_CreateProgram,0,0,0,0);call(api_AttachShader,p,s,0,0);
    /* Drain ALL reusable spans, then the remaining shared host reservation. */
    void *held[2048];uint32_t count=0;
    for(uint32_t n=1u<<20;n>=32;n/=2) { void *q;while((q=glp_alloc(n))!=0){CHECK(count<2048);held[count++]=q;} }
    error=0;uint32_t before=submissions;call(api_CompileShader,s,0,0,0);
    CHECK(!shaders[s].compiled&&error==OOM&&strstr(shaders[s].log,"out of memory"));CHECK(submissions==before+1); /* delete old provisional module only */
    call(api_GetShaderInfoLog,s,512,4096,8192);CHECK(strstr((char *)memory+8192,"out of memory"));
    error=0;call(api_LinkProgram,p,0,0,0);CHECK(!programs[p].linked&&error==OOM&&strstr(programs[p].log,"out of memory"));
    call(api_GetProgramInfoLog,p,512,4096,8192);CHECK(strstr((char *)memory+8192,"out of memory"));
    for(uint32_t i=0;i<count;i++)glp_free(held[i],0);
    error=0;call(api_CompileShader,s,0,0,0);CHECK(shaders[s].compiled&&!error);
    call(api_DeleteShader,s,0,0,0);drop(p);CHECK(w32_gl_frontend_bytes==0);
    printf("exhaustion truthful compile/link logs, GL_OUT_OF_MEMORY, recovery OK\n");
}
static void buffer_memory(void) {
    call(api_BindBuffer,ARRAY_BUFFER,1,0,0);
    for(uint32_t i=0;i<600;i++) {
        uint32_t size=65536+(i%4)*65536;
        call(api_BufferData,ARRAY_BUFFER,size,8192,0x88e4);CHECK(!error&&buffers[1].size==size);
        CHECK(w32_gl_frontend_bytes<300000);
    }
    x86_wr32(4096,1);call(api_DeleteBuffers,1,4096,0,0);CHECK(w32_gl_frontend_bytes==0);
    printf("buffer reupload/delete cycles=600 reusable host memory OK\n");
}
static void backend_failure(void) {
    const char *valid="#version 330 core\nout vec4 c;void main(){c=vec4(1.0);}";
    request_result=1;uint32_t s=compile(valid,0x8b30);CHECK(!shaders[s].compiled&&shaders[s].log[0]);
    CHECK(strstr(shaders[s].log,"compilation failed"));call(api_DeleteShader,s,0,0,0);
    request_result=0;reject_transport=1;error=0;s=compile(valid,0x8b30);
    CHECK(!shaders[s].compiled&&error==OOM&&strstr(shaders[s].log,"submission out of memory"));
    call(api_DeleteShader,s,0,0,0);CHECK(w32_gl_frontend_bytes==0);
    printf("backend rejected compile and command submission failures remain visible OK\n");
}
static void consumers(void) {
    /* Drain the shared reservation as GL, not just one private pool. CRT and FILE must fail
     * truthfully, then recover from exactly those GL spans without new arena backing. */
    void *held[2048];uint32_t count=0;
    for(uint32_t n=1u<<20;n>=32;n/=2) { void *p;while((p=x86_host_alloc(XH_GL,n))!=0){CHECK(count<2048);held[count++]=p;} }
    uint32_t old=top;
    CHECK(!x86_host_alloc(XH_FILE,16384));
    CHECK(strstr(host_diagnostic,"consumer=file size=16384")&&strstr(host_diagnostic," used=")&&strstr(host_diagnostic," limit=67108864"));
    CHECK(x86_host_stats[XH_FILE].oom==1);
    CHECK(!x86_host_alloc(XH_CRT,65536));CHECK(strstr(host_diagnostic,"consumer=crt size=65536"));
    for(uint32_t i=0;i<count;i++)x86_host_free(held[i]);
    CHECK(x86_host_used==0);
    void *files[48];for(uint32_t i=0;i<48;i++){files[i]=x86_host_alloc(XH_FILE,16384);CHECK(files[i]);}
    void *crt=x86_host_alloc(XH_CRT,1000000);CHECK(crt);memset(crt,0x45,1000000);
    CHECK(!x86_host_realloc(crt,UINT64_MAX));CHECK(((uint8_t *)crt)[999999]==0x45);
    CHECK(x86_host_realloc(crt,1)==crt);
    CHECK(!x86_host_realloc(crt,0));
    for(uint32_t i=0;i<48;i++)x86_host_free(files[i]);
    CHECK(top==old&&x86_host_used==0);
    CHECK(x86_host_stats[XH_FILE].used==0&&x86_host_stats[XH_FILE].peak>=48*16384);
    /* Bidirectional reuse and accounting conservation, including permanent runtime blocks. */
    uint32_t rng=29;void *slots[128]={0};uint32_t sizes[128]={0};
    void *permanent=x86_alloc(4096);CHECK(permanent);
    for(uint32_t i=0;i<30000;i++) {
        rng=rng*1664525u+1013904223u;unsigned k=rng%128;
        if(slots[k]){for(uint32_t j=0;j<sizes[k];j++)CHECK(((uint8_t *)slots[k])[j]==(uint8_t)k);x86_host_free(slots[k]);slots[k]=0;}
        else{rng=rng*1664525u+1013904223u;sizes[k]=rng%90000+1;slots[k]=x86_host_alloc(1+i%3,sizes[k]);CHECK(slots[k]);memset(slots[k],k,sizes[k]);}
        uint64_t sum=0,backing=0;for(unsigned c=0;c<XH_COUNT;c++){sum+=x86_host_stats[c].used;backing+=x86_host_stats[c].backing_requested;}
        CHECK(backing==x86_host_reserved);
        CHECK(sum==x86_host_used&&x86_host_used<=x86_host_reserved&&x86_host_reserved<=x86_host_limit());
    }
    for(unsigned i=0;i<128;i++)x86_host_free(slots[i]);
    CHECK(x86_host_used==x86_host_stats[XH_RUNTIME].used&&top==old);
    printf("consumers bidirectional GL/CRT/FILE reuse random=30000 runtime=%llu peak=%llu limit=%llu OK\n",
        (unsigned long long)x86_host_used,(unsigned long long)x86_host_peak,(unsigned long long)x86_host_limit());
}
static void allocator(void) {
    void *a=glp_alloc(65520),*b=glp_alloc(65520),*c=glp_alloc(65520);CHECK(a&&b&&c);
    memset(a,0xff,65520);glp_free(a,65520);glp_free(b,65520);glp_free(c,65520);uint32_t old=top;
    a=glp_alloc(180000);CHECK(a&&top==old);for(uint32_t i=0;i<180000;i++)CHECK(!((uint8_t *)a)[i]);glp_free(a,180000);
    CHECK(!glp_alloc(UINT32_MAX));CHECK(w32_gl_frontend_bytes==0);
    void *slots[128]={0}; uint32_t sizes[128]={0},rng=17;
    for(uint32_t i=0;i<24000;i++) {
        rng=rng*1664525u+1013904223u;uint32_t slot=rng%128;
        if(slots[slot]) {for(uint32_t j=0;j<sizes[slot];j++)CHECK(((uint8_t *)slots[slot])[j]==(uint8_t)slot);glp_free(slots[slot],sizes[slot]);slots[slot]=0;}
        else {rng=rng*1664525u+1013904223u;sizes[slot]=1+rng%100000;slots[slot]=glp_alloc(sizes[slot]);CHECK(slots[slot]);
            for(uint32_t j=0;j<sizes[slot];j++)CHECK(!((uint8_t *)slots[slot])[j]);memset(slots[slot],slot,sizes[slot]);}
    }
    for(uint32_t i=0;i<128;i++)glp_free(slots[i],sizes[i]);CHECK(w32_gl_frontend_bytes==0);
    printf("allocator split/coalesce/zero/overflow OK randomized=24000\n");
}
int main(int argc,char **argv) {
    for(uint32_t i=0;i<sizeof memory/4096;i++)x86_pages[i]=memory+i*4096;
    CHECK(argc==2);
    if(!strcmp(argv[1],"stress"))stress();else if(!strcmp(argv[1],"lifecycle"))lifecycle();
    else if(!strcmp(argv[1],"exhaustion"))exhaustion();else if(!strcmp(argv[1],"allocator"))allocator();else if(!strcmp(argv[1],"backend-failure"))backend_failure();else if(!strcmp(argv[1],"buffers"))buffer_memory();else if(!strcmp(argv[1],"consumers"))consumers();else return 2;
    CHECK(!request_pending); for(uint32_t i=0;i<1024;i++)CHECK(!live_modules[i]);
    return 0;
}
