/* Original CC0-1.0. Exercise the real bounded GDI recorder, not a mock list. */
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include "../../platforms/win32/w32_gdi.c"
x86_cpu_t X;
bgt_io_t io;
bgt_io_t *w32_io=&io;
w32_metrics_t w32_m;
static unsigned submits,transports,presents,target,blend,tex,rects,vertices,rendering,overlays;
static uint64_t virtual_us=12345;
void w32_clock_present(uint32_t interval) { virtual_us+=(uint64_t)interval*16667; }
void w32_wait_frame(void) { virtual_us+=16667;w32_gdi_present_boundary(); }
void *x86_alloc(uint32_t n) { void *p=calloc(1,n);assert(p);return p; }
__attribute__((noreturn)) void x86_fault(const char *s,uint32_t a) { (void)a;fprintf(stderr,"%s\n",s);abort(); }
void w32_rp_fill(uint32_t t,int32_t x,int32_t y,int32_t w,int32_t h,uint32_t c,uint32_t b) {
    (void)t;(void)x;(void)y;(void)w;(void)h;(void)c;(void)b;
}
void w32_user_present_overlay(void) {
    overlays++;
    for(unsigned i=0;i<20;i++)g_fill(TEX_SCREEN,0,0,64,64,0,0,1,1,0,BGT_BLEND_OPAQUE);
}
void w32_guest_present(int gl) { (void)gl;presents++; }
void w32_gl_charge_foreign(uint32_t bytes,uint32_t commands) { (void)bytes;(void)commands; }
int32_t bgt_submit_commands(const void *p,uint32_t n) {
    const uint32_t *v=p;assert(n>=16 && v[0]==BGT_CMD_MAGIC && v[2]==n && v[3]<=BGT_LIMIT_COMMANDS);
    for(unsigned off=16;off<n;) {
        const uint32_t *cmd=v+off/4;assert(off+8+cmd[1]<=n);
        if(cmd[0]==BGT_OP_TARGET)target=cmd[2];
        if(cmd[0]==BGT_OP_BLEND)blend=cmd[2];
        if(cmd[0]==BGT_OP_TEXTURE)tex=cmd[2];
        if(cmd[0]==BGT_OP_SPRITES) {
            vertices+=6*cmd[2];assert(vertices<=BGT_LIMIT_VERTICES_PER_FRAME);
            if(target==TEX_SCREEN) { assert(blend==BGT_BLEND_OPAQUE && tex==0);rects+=cmd[2]; }
        }
        off+=8+cmd[1];
    }
    submits++;return 0;
}
void w32_wait_transport(void) {
    assert(virtual_us==12345 && presents==0 && !rendering);transports++;
    w32_gdi_flush_and_present(); /* host render consumes without a guest present */
    target=tex=vertices=0;blend=BGT_BLEND_ALPHA; /* consumed host frame resets draw state */
    assert(virtual_us==12345 && presents==0);
}
int main(void) {
    screen_ready=1;scr_w=scr_h=64;io.logical_width=io.logical_height=64;
    for(unsigned i=0;i<650000;i++) g_fill(TEX_SCREEN,0,0,64,64,0,0,1,1,i,BGT_BLEND_OPAQUE);
    assert(transports>0 && submits>=NREC && presents==0 && w32_gdi_pending());
    assert(cur_target==TEX_SCREEN && cur_blend==BGT_BLEND_OPAQUE && cur_tex==0);
    unsigned total=650000;
    /* Force a host render with a full final record: its overlay must not yield. */
    while(nrec_used<NREC || rec[NREC-1].cb.len+1024<REC_BYTES) {
        g_fill(TEX_SCREEN,0,0,64,64,0,0,1,1,0,BGT_BLEND_OPAQUE);total++;
    }
    rendering=1;w32_gdi_flush_and_present();rendering=0;
    w32_gdi_present_boundary();w32_gdi_present_boundary();assert(presents==1);
    flush_records();assert(rects==total+overlays*20);
    assert(virtual_us==12345);
    for(unsigned i=0;i<NREC;i++)free(rec[i].mem);
    puts("bounded GDI transport: overflow, unchanged time, no present, restored draw state OK");
}
