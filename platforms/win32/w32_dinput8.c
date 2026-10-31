/* LANE-K1: DirectInput8 identity/lifetime and immediate BGT keyboard/mouse/gamepad snapshots.
 * Buffered events, force feedback and action maps are not advertised. SPDX-License-Identifier: MIT */
#include "w32_dinput8.h"
#include "w32_sysdll.h"
#include "w32_com.h"
static const uint32_t iid_a[4]={0xbf798030,0x4da2483a,0x645d99aa,0x009736ed};
static const uint32_t iid_w[4]={0xbf798031,0x4da2483a,0x645d99aa,0x009736ed};
static const uint32_t dev_a[4]={0x54d41080,0x4833dc15,0x8f741ba4,0x7981a373};
static const uint32_t dev_w[4]={0x54d41081,0x4833dc15,0x8f741ba4,0x7981a373};
static const uint32_t unknown[4]={0,0,0xc0,0x46000000};
static const uint32_t devices[6][4]={{0x6f1d2b61,0x11cfd5a0,0x4544c7bf,0x00005453},
    {0x6f1d2b60,0x11cfd5a0,0x4544c7bf,0x00005453},
    {0x6f1d2b70,0x11cfd5a0,0x4544c7bf,0x00005453},{0x6f1d2b71,0x11cfd5a0,0x4544c7bf,0x00005453},
    {0x6f1d2b72,0x11cfd5a0,0x4544c7bf,0x00005453},{0x6f1d2b73,0x11cfd5a0,0x4544c7bf,0x00005453}};
static struct object {uint32_t p,refs,kind,wide,acquired,size,count,format,hwnd,cooperative;int32_t x,y;} objects[64];
static uint32_t tables[2];
static struct object *object(void) {for(uint32_t i=0;i<64;i++)if(objects[i].refs&&objects[i].p==ARG64(0))return &objects[i];return 0;}
static int connected(uint32_t kind) {bgt_gamepad_t p;return kind<3||(!bgt_input_gamepad(kind-3,&p,sizeof p)&&p.connected);}
static uint32_t make(uint32_t kind,uint32_t wide) {
    for(uint32_t i=0;i<64;i++)if(!objects[i].refs) {
        uint32_t p=w32_heap_alloc(w32_ptr_size(),1);if(!p)return 0;
        w32_wrptr(p,tables[!!kind]);objects[i]=(struct object){.p=p,.refs=1,.kind=kind,.wide=wide};return p;
    }
    return 0;
}
static uint32_t query(void) {
    struct object *o=object();if(!w32_sys_span(ARG64(2),w32_ptr_size()))return 0x80004003u;w32_wrptr(ARG(2),0);
    if(!w32_sys_span(ARG64(1),16))return 0x80070057u;
    if(!o||(!w32_com_guid(ARG(1),unknown)&&!w32_com_guid(ARG(1),o->kind?(o->wide?dev_w:dev_a):(o->wide?iid_w:iid_a))))return 0x80004002u;
    o->refs++;w32_wrptr(ARG(2),o->p);return 0;
}
static uint32_t addref(void) {struct object *o=object();return o?++o->refs:0;}
static uint32_t release(void) {struct object *o=object();if(!o)return 0;if(--o->refs)return o->refs;w32_heap_free(o->p);if(o->format)w32_heap_free(o->format);o->p=0;return 0;}
static uint32_t create_device(void) {
    struct object *o=object();if(!o||o->kind)return 0x80070006u;
    if(!w32_sys_span(ARG64(2),w32_ptr_size()))return 0x80004003u;w32_wrptr(ARG(2),0);
    if(!w32_sys_span(ARG64(1),16))return 0x80070057u;
    if(ARG64(3))return 0x80040110u;
    for(uint32_t k=0;k<6;k++)if(w32_com_guid(ARG(1),devices[k])){
        if(!connected(k+1))return 0x80040154u;
        uint32_t p=make(k+1,o->wide);w32_wrptr(ARG(2),p);return p?0:0x8007000eu;
    }
    return 0x80040154u; /* DIERR_DEVICENOTREG */
}
static uint32_t instance(uint32_t p,uint32_t k,uint32_t wide) {
    uint32_t n=wide?1100:580;if(x86_rd32(p)!=n)return 0x80070057u;
    for(uint32_t i=4;i<n;i++)x86_wr8(p+i,0);
    for(uint32_t i=0;i<4;i++){x86_wr32(p+4+i*4,devices[k-1][i]);x86_wr32(p+20+i*4,devices[k-1][i]);}
    x86_wr32(p+36,k==1?0x113:k==2?0x112:0x115);
    const char *name=k==1?"BGT Keyboard":k==2?"BGT Mouse":"BGT Gamepad 0";
    w32_pstr(p+40,260,wide,name);w32_pstr(p+40+260*(wide?2:1),260,wide,name);return 0;
}
static uint32_t enumerate(void) {
    struct object *o=object();if(!o||!w32_sys_span(ARG64(2),1))return 0x80070057u;
    if(ARG(1)>6&&ARG(1)<0x10)return 0x80070057u;
    if(ARG(4)&~0x00070101u)return 0x80070057u;
    if(ARG(4)&0x100)return 0; /* no force-feedback devices are advertised */
    uint32_t p=w32_heap_alloc(o->wide?1100:580,1);if(!p)return 0x8007000eu;
    for(uint32_t k=1;k<=6;k++) {
        uint32_t filter=ARG(1),type=k==1?0x13:k==2?0x12:0x15;
        if(!connected(k)||(filter&&filter!=1&&filter!=(k==1?3u:k==2?2u:4u)&&filter!=type))continue;
        x86_wr32(p,o->wide?1100:580);instance(p,k,o->wide);
        uint64_t args[2]={p,ARG64(3)};uint32_t a[2]={p,ARG(3)};
        uint64_t r=W32_64?x86_callback64(ARG(2),2,args):x86_callback(ARG(2),2,a);if(!r)break;
    }w32_heap_free(p);return 0;
}
static uint32_t status(void) {if(!w32_sys_span(ARG64(1),16))return 0x80070057u;for(uint32_t k=0;k<6;k++)if(w32_com_guid(ARG(1),devices[k]))return connected(k+1)?0:0x80040209u;return 0x80040154u;}
static uint32_t unsupported(void) {return 0x80004001u;}
static uint32_t caps(void) {
    struct object *o=object();if(!o||!o->kind||!w32_sys_span(ARG64(1),44)||x86_rd32(ARG(1))!=44)return 0x80070057u;
    uint32_t p=ARG(1);for(uint32_t i=4;i<44;i++)x86_wr8(p+i,0);
    x86_wr32(p+4,1);x86_wr32(p+8,o->kind==1?0x113:o->kind==2?0x112:0x115);
    x86_wr32(p+12,o->kind==1?0:o->kind==2?2:6);x86_wr32(p+16,o->kind==1?256:o->kind==2?3:16);
    if(o->kind>=3)x86_wr32(p+20,1); /* standard gamepad D-pad POV */
    return 0;
}
static uint32_t acquire(void) {struct object *o=object();if(!o)return 0x80070006u;if(!o->format)return 0x80070057u;if(!connected(o->kind))return 0x8007001eu;if(o->acquired)return 1;o->acquired=1;o->x=w32_io->pointer_x;o->y=w32_io->pointer_y;return 0;}
static uint32_t unacquire(void) {struct object *o=object();if(!o)return 0x80070006u;uint32_t r=o->acquired?0:1;o->acquired=0;return r;}
static uint32_t setformat(void) {
    struct object *o=object();uint32_t p=ARG(1),obj=W32_64?24:16;
    if(!o||!w32_sys_span(ARG64(1),W32_64?32:24)||x86_rd32(p)!=(W32_64?32u:24u)||x86_rd32(p+4)!=obj)return 0x80070057u;
    if(o->acquired)return 0x800700aau;
    uint32_t size=x86_rd32(p+12),count=x86_rd32(p+16),list=(uint32_t)w32_rdptr(p+(W32_64?24:20));
    if(!size||size>4096||count>256||!w32_sys_span(w32_rdptr(p+(W32_64?24:20)),count*obj)||(x86_rd32(p+8)!=1&&x86_rd32(p+8)!=2))return 0x80070057u;
    /* Only mouse-relative and gamepad-absolute axes are exposed by these devices. */
    if((o->kind==2&&x86_rd32(p+8)!=2)||(o->kind>=3&&x86_rd32(p+8)!=1))return 0x80004001u;
    for(uint32_t i=0;i<count;i++) {
        uint32_t q=list+i*obj,off=x86_rd32(q+w32_ptr_size()),type=x86_rd32(q+w32_ptr_size()+4),n=(type&12)?1:4;
        uint32_t base=type&255;
        if((type&~0x80ffff1fu)||(base!=1&&base!=2&&base!=3&&base!=4&&base!=8&&base!=12&&base!=16)||
            off>size||n>size-off||(w32_rdptr(q)&&!w32_sys_span(w32_rdptr(q),16)))return 0x80070057u;
    }
    uint32_t copy=w32_heap_alloc(count*obj+8,0);if(!copy)return 0x8007000eu;
    for(uint32_t i=0;i<count*obj;i++)x86_wr8(copy+i,x86_rd8(list+i));
    /* DIDFT_ANYINSTANCE selects objects in enumeration order, not instance 65535. */
    uint32_t axis=0,button=0,pov=0;
    for(uint32_t i=0;i<count;i++) {
        uint32_t q=copy+i*obj,type=x86_rd32(q+w32_ptr_size()+4),id=(type>>8)&65535;
        if(id==65535) {
            id=(type&12)?button++:(type&16)?pov++:axis++;
            uint32_t guid=(uint32_t)w32_rdptr(q);
            if(guid&&(type&3)) {
                static const uint32_t axes[6]={0xa36d02e0,0xa36d02e1,0xa36d02e2,0xa36d02f4,0xa36d02f5,0xa36d02e3};
                for(uint32_t j=0;j<6;j++)if(x86_rd32(guid)==axes[j])id=j;
            }
            x86_wr32(q+w32_ptr_size()+4,(type&~0x00ffff00u)|(id<<8));
        }
    }
    for(uint32_t i=0;i<count;i++) {
        uint32_t q=copy+i*obj,type=x86_rd32(q+w32_ptr_size()+4),id=(type>>8)&65535;
        uint32_t available=(type&12)?(o->kind==1?256:o->kind==2?3:16):(type&16)?(o->kind>=3?1:0):(type&3)?(o->kind==1?0:o->kind==2?2:6):0;
        uint32_t guid=(uint32_t)w32_rdptr(q);
        if(guid) {
            uint32_t expected=(type&12)?(o->kind==1?0x55728220u:0xa36d02f0u):(type&16)?0xa36d02f2u:0;
            if(type&3){static const uint32_t axes[6]={0xa36d02e0,0xa36d02e1,0xa36d02e2,0xa36d02f4,0xa36d02f5,0xa36d02e3};if(id<6)expected=axes[id];}
            uint32_t tail[3]={o->kind==1?0x11cfd33cu:0x11cfc9f3u,0x4544c7bf,0x00005453};
            if(x86_rd32(guid)!=expected||x86_rd32(guid+4)!=tail[0]||x86_rd32(guid+8)!=tail[1]||x86_rd32(guid+12)!=tail[2])available=0;
        }
        if(id>=available) {
            if(!(type&0x80000000u)){w32_heap_free(copy);return 0x80070002u;} /* DIERR_OBJECTNOTFOUND */
            x86_wr32(q+w32_ptr_size()+4,(type&16)?0x40000010u:0); /* absent POV is centered (-1), other objects zero */
        }
    }
    if(o->format)w32_heap_free(o->format);o->format=copy;o->size=size;o->count=count;return 0;
}
/* HID usages -> DirectInput scan codes (set 1, including extended keys). */
static uint32_t scan(uint32_t k) {
    static const uint8_t letters[26]={30,48,46,32,18,33,34,35,23,36,37,38,50,49,24,25,16,19,31,20,22,47,17,45,21,44};
    if(k>=4&&k<=29)return letters[k-4];if(k>=30&&k<=38)return k-28;if(k==39)return 11;
    if(k>=58&&k<=67)return k+1; /* F1..F10 */
    if(k==68||k==69)return k+19; /* F11/F12 */
    static const uint8_t extra[13]={12,13,26,27,43,43,39,40,41,51,52,53,58};
    if(k>=45&&k<=57)return extra[k-45];
    switch(k){case 40:return 28;case 41:return 1;case 42:return 14;case 43:return 15;case 44:return 57;case 70:return 183;case 71:return 70;case 72:return 197;case 73:return 210;case 74:return 199;case 75:return 201;case 76:return 211;case 77:return 207;case 78:return 209;case 79:return 205;case 80:return 203;case 81:return 208;case 82:return 200;case 224:return 29;case 225:return 42;case 226:return 56;case 228:return 157;case 229:return 54;case 230:return 184;default:return 0;}
}
static int32_t pov_angle(uint32_t buttons) {
    int x=!!(buttons&(1u<<15))-!!(buttons&(1u<<14));
    int y=!!(buttons&(1u<<13))-!!(buttons&(1u<<12));
    if(!x&&!y)return -1;
    return y<0?(x<0?31500:x>0?4500:0):y>0?(x<0?22500:x>0?13500:18000):x<0?27000:9000;
}
static uint32_t state(void) {
    struct object *o=object();if(!o)return 0x80070006u;if(!o->acquired)return 0x8007000cu;
    if(ARG(1)!=o->size||!w32_sys_span(ARG64(2),o->size))return 0x80070057u;
    if(!connected(o->kind))return 0x8007001eu;
    uint8_t keys[256]={0};if(o->kind==1)for(uint32_t k=0;k<256;k++)if((w32_io->keys[k>>5]>>(k&31))&1){uint32_t s=scan(k);if(s)keys[s]=128;}
    for(uint32_t i=0;i<o->size;i++)x86_wr8(ARG(2)+i,0);
    bgt_gamepad_t pad={0};if(o->kind>=3)bgt_input_gamepad(o->kind-3,&pad,sizeof pad);
    for(uint32_t i=0;i<o->count;i++) {
        uint32_t q=o->format+i*(W32_64?24:16),off=x86_rd32(q+w32_ptr_size()),type=x86_rd32(q+w32_ptr_size()+4),id=(type>>8)&65535;
        if(!type)continue;
        if(type&0x40000000u){x86_wr32(ARG(2)+off,~0u);continue;}
        if(type&12) {uint32_t v=o->kind==1?keys[id&255]:o->kind==2?(id<3?((w32_io->pointer_buttons>>id)&1)*128:0):(id<16?((pad.buttons>>id)&1)*128:0);x86_wr8(ARG(2)+off,v);}
        else {int32_t v=0;if(o->kind==2)v=id==0?w32_io->pointer_x-o->x:id==1?w32_io->pointer_y-o->y:0;else if(o->kind>=3)v=(type&16)?pov_angle(pad.buttons):id<4?(int32_t)(((int64_t)32767+pad.axes[id])*65535/65534):id<6?pad.triggers[id-4]:0;x86_wr32(ARG(2)+off,(uint32_t)v);}
    }o->x=w32_io->pointer_x;o->y=w32_io->pointer_y;return 0;
}
static uint32_t cooperative(void) {
    struct object *o=object();int32_t x,y,w,h;
    if(!o||ARG64(1)>UINT32_MAX||!w32_user_client(ARG(1),&x,&y,&w,&h))return 0x80070006u;
    if((ARG(2)&~31u)||!(ARG(2)&3)||((ARG(2)&3)==3)||!(ARG(2)&12)||((ARG(2)&12)==12))return 0x80070057u;
    if(ARG(2)&1)return 0x80070005u; /* exclusive hardware ownership unavailable */
    if(o->acquired)return 0x800700aau;
    o->hwnd=ARG(1);o->cooperative=ARG(2);return 0;
}
static uint32_t poll(void) {struct object *o=object();return !o?0x80070006u:!o->acquired?0x8007000cu:connected(o->kind)?0:0x8007001eu;}
static uint32_t device_info(void) {struct object *o=object();return o&&o->kind&&w32_sys_span(ARG64(1),o->wide?1100:580)?instance(ARG(1),o->kind,o->wide):0x80070057u;}
static uint32_t create(void) {
    if(!w32_sys_span(ARG64(3),w32_ptr_size()))return 0x80004003u;w32_wrptr(ARG(3),0);
    if(!w32_sys_span(ARG64(2),16))return 0x80070057u;
    if(ARG(1)!=0x800)return ARG(1)<0x800?0x8007047eu:0x80070481u;
    if(ARG64(4))return 0x80040110u;
    uint32_t wide=w32_com_guid(ARG(2),iid_w);if(!wide&&!w32_com_guid(ARG(2),iid_a))return 0x80004002u;
    if(!tables[0]) {
        static const char *root[]={"K1DiQuery","K1DiAddRef","K1DiRelease","K1DiCreateDevice","K1DiEnumDevices","K1DiStatus","K1DiUnsupported3","K1DiUnsupported3","K1DiUnsupported4","K1DiUnsupported6","K1DiUnsupported5"};
        static const uint8_t nargs[32]={3,1,1,2,4,3,3,1,1,3,5,2,2,3,4,2,3,4,5,4,3,2,2,4,2,1,5,5,5,4,4,2};
        for(uint32_t t=0;t<2;t++){uint32_t n=t?32:11;tables[t]=w32_misc_alloc(n*w32_ptr_size());for(uint32_t s=0;s<n;s++){
            const char *name=t?"":root[s];
            if(t){static const char *methods[32]={[0]="K1DiQuery",[1]="K1DiAddRef",[2]="K1DiRelease",[3]="K1DiCaps",[7]="K1DiAcquire",[8]="K1DiUnacquire",[9]="K1DiState",[11]="K1DiFormat",[13]="K1DiCooperative",[15]="K1DiInfo",[25]="K1DiPoll"};name=methods[s];if(!name){static const char *uns[]={"","","K1DiUnsupported2","K1DiUnsupported3","K1DiUnsupported4","K1DiUnsupported5"};name=uns[nargs[s]];}}
            w32_wrptr(tables[t]+s*w32_ptr_size(),w32_thunk_for("dinput8.dll",name));
        }}
    }
    uint32_t p=make(0,wide);w32_wrptr(ARG(3),p);return p?0:0x8007000eu;
}
#define API(n,a,f) {n,a,0,f}
const w32_api_t w32_api_dinput8[]={
    API("DirectInput8Create",5,create),API("K1DiQuery",3,query),API("K1DiAddRef",1,addref),API("K1DiRelease",1,release),
    API("K1DiCreateDevice",4,create_device),API("K1DiEnumDevices",5,enumerate),API("K1DiStatus",2,status),
    API("K1DiCaps",2,caps),API("K1DiAcquire",1,acquire),API("K1DiUnacquire",1,unacquire),API("K1DiState",3,state),
    API("K1DiFormat",2,setformat),API("K1DiCooperative",3,cooperative),API("K1DiInfo",2,device_info),API("K1DiPoll",1,poll),
    API("K1DiUnsupported2",2,unsupported),API("K1DiUnsupported3",3,unsupported),API("K1DiUnsupported4",4,unsupported),API("K1DiUnsupported5",5,unsupported),API("K1DiUnsupported6",6,unsupported),
};
const uint32_t w32_api_dinput8_n=sizeof w32_api_dinput8/sizeof w32_api_dinput8[0];
