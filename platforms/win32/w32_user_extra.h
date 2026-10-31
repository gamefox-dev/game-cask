/* Virtual display, US keyboard and process-local clipboard. Browser touch/drop sources absent. MIT. */
#include "w32_thread.h"
static uint32_t u_error(uint32_t e) { *w32_thread_error()=e;return 0; }
static uint32_t u_unsupported(void) { return u_error(50); }
static uint32_t u_invalid_touch(void) { return u_error(6); }
static uint32_t u_TrackMouseEvent(void) {
    uint32_t p=ARG(0),size=W32_64?24:16;
    if(!p||!x86_mapped(p,size)||x86_rd32(p)!=size)return u_error(87);
    uint32_t flags=x86_rd32(p+4),hwnd=w32_rdptr(p+8),ms=x86_rd32(p+(W32_64?16:12));wnd_t *w=W(hwnd);
    if(!w||w->destroyed)return u_error(1400);
    if(flags&0x40000000u){x86_wr32(p+4,w->tracking);x86_wr32(p+(W32_64?16:12),w->hover_ms);return 1;}
    if(flags&~0x80000013u)return u_error(87);
    if(flags&0x10)return u_error(50); /* nonclient hover is not exposed */
    if(flags&0x80000000u){w->tracking&=~(flags&3);return 1;}
    if(!ms||ms==0xffffffffu)ms=400;
    w->tracking|=flags&3;w->hover_ms=ms;w->hover_since=w32_now_ms();w->hover_x=last_px;w->hover_y=last_py;
    if((flags&2)&&(!w32_io->pointer_inside||hit(last_px,last_py)!=w)){post(hwnd,0x2a3,0,0);w->tracking=0;}
    return 1;
}
static void mouse_tracking(int32_t px,int32_t py,uint32_t buttons,int inside) {
    wnd_t *under=inside?hit(px,py):0;uint32_t now=w32_now_ms();
    for(unsigned i=1;i<NWND;i++){
        wnd_t *w=&wnds[i];if(!w->used||w->destroyed||!w->tracking)continue;
        if(under!=w){if(w->tracking&2)post(hwnd_of(w),0x2a3,0,0);w->tracking=0;continue;}
        if(px<w->hover_x-2||px>w->hover_x+2||py<w->hover_y-2||py>w->hover_y+2){w->hover_x=px;w->hover_y=py;w->hover_since=now;}
        if((w->tracking&1)&&now-w->hover_since>=w->hover_ms){uint32_t lp=((uint32_t)(uint16_t)(py-w->cy)<<16)|(uint16_t)(px-w->cx);post(hwnd_of(w),0x2a1,mk_flags(buttons),lp);w->tracking&=~1u;}
    }
}
static uint32_t u_GetKeyboardLayout(void) { return 0x04090409; }
static uint32_t u_GetKeyboardLayoutList(void) { if(ARG(0)&&ARG(1))w32_wrptr(ARG(1),0x04090409);return 1; }
static uint32_t u_GetKeyboardLayoutNameA(void) { if(!ARG(0))return u_error(87);w32_pstr(ARG(0),9,0,"00000409");return 1; }
static uint32_t u_ActivateKeyboardLayout(void) {
    if(ARG(0)==0 || ARG(0)==1 || ARG(0)==0x04090409)return 0x04090409;
    return u_error(87);
}
static uint32_t u_AllowSetForegroundWindow(void) { return ARG(0)==1||ARG(0)==0xffffffffu?1:u_error(87); }
static uint32_t u_GetMessageExtraInfo(void) { return 0; } /* browser events carry no private extra-info */
#define VIRTUAL_MONITOR 0x00110001u
static uint32_t u_MonitorFromWindow(void) {
    if(W(ARG(0))||ARG(0)==H_WND)return VIRTUAL_MONITOR;
    if(ARG(1)&3)return VIRTUAL_MONITOR;return 0;
}
static uint32_t u_MonitorFromPoint(void) {
    int32_t x=(int32_t)ARG(0),y=W32_64?(int32_t)(ARG64(0)>>32):(int32_t)ARG(1);
    uint32_t flags=ARG(W32_64?1:2);
    return (x>=0&&y>=0&&x<w32_gdi_screen_w()&&y<w32_gdi_screen_h())||(flags&3)?VIRTUAL_MONITOR:0;
}
static uint32_t u_GetMonitorInfoW(void) {
    uint32_t p=ARG(1),size=p?x86_rd32(p):0;
    if(ARG(0)!=VIRTUAL_MONITOR || (size!=40&&size!=104))return u_error(87);
    put_rect(p+4,0,0,w32_gdi_screen_w(),w32_gdi_screen_h());
    put_rect(p+20,0,0,w32_gdi_screen_w(),w32_gdi_screen_h());x86_wr32(p+36,1);
    if(size==104)w32_pstr(p+40,32,1,"\\\\.\\DISPLAY1");return 1;
}
static uint32_t u_EnumDisplayMonitors(void) {
    if(ARG(0))return u_error(50); /* DC clipping/coordinate transforms not exposed */
    if(!ARG(2))return u_error(87);
    int32_t r[4]={0,0,w32_gdi_screen_w(),w32_gdi_screen_h()};
    if(ARG(1)){
        uint32_t p=ARG(1);r[0]=imax(r[0],(int32_t)x86_rd32(p));r[1]=imax(r[1],(int32_t)x86_rd32(p+4));
        r[2]=imin(r[2],(int32_t)x86_rd32(p+8));r[3]=imin(r[3],(int32_t)x86_rd32(p+12));
        if(r[2]<=r[0]||r[3]<=r[1])return 1;
    }
    uint32_t p=w32_heap_alloc(16,0);if(!p)return u_error(8);for(unsigned i=0;i<4;i++)x86_wr32(p+4*i,(uint32_t)r[i]);
    uint32_t result;
    if(W32_64){uint64_t args[4]={VIRTUAL_MONITOR,0,p,ARG64(3)};result=(uint32_t)x86_callback64(ARG(2),4,args);}
    else {uint32_t args[4]={VIRTUAL_MONITOR,0,p,ARG(3)};result=x86_callback(ARG(2),4,args);}
    w32_heap_free(p);return result;
}
static uint32_t u_EnumDisplaySettingsW(void) {
    if(ARG(0)){char name[64];w32_gstr(ARG(0),1,name,sizeof name);if(!w32_streqi(name,"\\\\.\\DISPLAY1"))return 0;}
    if(ARG(1)!=0 && ARG(1)!=0xffffffffu && ARG(1)!=0xfffffffeu)return 0;
    uint32_t p=ARG(2);if(!p||x86_rd16(p+68)!=220)return u_error(87);
    for(uint32_t i=0;i<220;i++)x86_wr8(p+i,0);
    w32_pstr(p,32,1,"\\\\.\\DISPLAY1");x86_wr16(p+64,0x401);x86_wr16(p+68,220);
    x86_wr32(p+72,0x5c0000);x86_wr32(p+168,32);x86_wr32(p+172,(uint32_t)w32_gdi_screen_w());
    x86_wr32(p+176,(uint32_t)w32_gdi_screen_h());x86_wr32(p+184,60);return 1;
}
static int clipboard_open;
static uint32_t clipboard_owner,clipboard_opener;
static struct { uint32_t format,handle; } clipboard[32];
static uint32_t u_OpenClipboard(void) {
    if(clipboard_open)return u_error(5);
    if(ARG(0)&&!W(ARG(0)))return u_error(1400);
    clipboard_open=1;clipboard_opener=ARG(0);return 1;
}
static uint32_t u_CloseClipboard(void) { if(!clipboard_open)return u_error(1418);clipboard_open=0;return 1; }
static uint32_t u_EmptyClipboard(void) {
    if(!clipboard_open)return u_error(1418);
    clipboard_owner=clipboard_opener;
    for(unsigned i=0;i<32;i++){if(clipboard[i].handle)w32_heap_free(clipboard[i].handle);clipboard[i].format=clipboard[i].handle=0;}return 1;
}
static uint32_t u_IsClipboardFormatAvailable(void) { for(unsigned i=0;i<32;i++)if(clipboard[i].format==ARG(0)&&clipboard[i].handle)return 1;return 0; }
static uint32_t u_GetClipboardData(void) {
    if(!clipboard_open)return u_error(1418);
    for(unsigned i=0;i<32;i++)if(clipboard[i].format==ARG(0))return clipboard[i].handle;
    return u_error(0);
}
static uint32_t u_SetClipboardData(void) {
    if(!clipboard_open)return u_error(1418);
    if(!clipboard_owner || !ARG(0) || !ARG(1))return u_error(87);
    /* Only owned guest HGLOBAL byte blocks, not GDI/palette/metafile handles. */
    if(ARG(0)!=1&&ARG(0)!=7&&ARG(0)!=13&&ARG(0)<0xc000)return u_error(50);
    if(!w32_heap_size(ARG(1)))return u_error(6);
    unsigned slot=32;for(unsigned i=0;i<32;i++){if(clipboard[i].format==ARG(0)){slot=i;break;}if(!clipboard[i].format)slot=i;}
    if(slot==32)return u_error(8);
    if(clipboard[slot].handle&&clipboard[slot].handle!=ARG(1))w32_heap_free(clipboard[slot].handle);
    clipboard[slot].format=ARG(0);clipboard[slot].handle=ARG(1);return ARG(1);
}
/* PC set-1 make codes for the virtual US keyboard. */
static const uint8_t us_scan[256]={
 [0x1b]=1,[0x31]=2,[0x32]=3,[0x33]=4,[0x34]=5,[0x35]=6,[0x36]=7,[0x37]=8,[0x38]=9,[0x39]=10,[0x30]=11,
 [0xbd]=12,[0xbb]=13,[8]=14,[9]=15,['Q']=16,['W']=17,['E']=18,['R']=19,['T']=20,['Y']=21,['U']=22,['I']=23,['O']=24,['P']=25,
 ['A']=30,['S']=31,['D']=32,['F']=33,['G']=34,['H']=35,['J']=36,['K']=37,['L']=38,[13]=28,[0x10]=42,[0x11]=29,[0x12]=56,
 ['Z']=44,['X']=45,['C']=46,['V']=47,['B']=48,['N']=49,['M']=50,[32]=57,[0x70]=59,[0x71]=60,[0x72]=61,[0x73]=62,[0x74]=63,[0x75]=64,[0x76]=65,[0x77]=66,[0x78]=67,[0x79]=68,[0x7a]=87,[0x7b]=88
};
static uint32_t u_MapVirtualKeyA(void) {
    uint32_t code=ARG(0),type=ARG(1);
    if(type==0||type==4)return code<256?us_scan[code]:0;
    if(type==1||type==3){for(unsigned i=0;i<256;i++)if(us_scan[i]&&us_scan[i]==code)return i;return 0;}
    if(type==2){if((code>='A'&&code<='Z')||(code>='0'&&code<='9')||code==32)return code;return 0;}return 0;
}
