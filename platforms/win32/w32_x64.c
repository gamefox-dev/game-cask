/* Windows AMD64 ABI glue, table-driven SEH unwinding and CRT bridges. MIT.
 * Guest pointers are 64-bit values; mapped addresses are validated in the low flat window.
 * No guest C++ ABI is replaced: compiled personalities and landing pads execute in guest code. */
#include "w32_int.h"
#ifdef X86_FLAT_GUEST
#define CTX_BYTES 1232u
#define CTX_REG 120u
#define CTX_IP 248u
#define CTX_XMM 416u
static uint32_t ptr(uint64_t p){return x86_address(p);}
void w64_context_save(uint32_t c,int caller) {
    for(uint32_t i=0;i<CTX_BYTES;i++)x86_wr8(c+i,0);
    x86_wr32(c+48,0x10000bu);x86_wr32(c+52,X.mxcsr);x86_wr32(c+68,X.flags);
    for(int i=0;i<16;i++)x86_wr64(c+CTX_REG+8u*(uint32_t)i,X.r[i]);
    x86_wr64(c+CTX_IP,caller?x86_rd64((uint32_t)X.r[ESP]):X.eip);
    if(caller)x86_wr64(c+CTX_REG+8*ESP,X.r[ESP]+8);
    for(int i=0;i<16;i++)for(int j=0;j<16;j++)x86_wr8(c+CTX_XMM+16u*(uint32_t)i+(uint32_t)j,X.xmm[i].u8[j]);
}
void w64_context_restore(uint32_t c) {
    for(int i=0;i<16;i++)X.r[i]=x86_rd64(c+CTX_REG+8u*(uint32_t)i);
    X.eip=ptr(x86_rd64(c+CTX_IP));X.flags=x86_rd32(c+68);X.mxcsr=x86_rd32(c+52);
    for(int i=0;i<16;i++)for(int j=0;j<16;j++)X.xmm[i].u8[j]=(uint8_t)x86_rd8(c+CTX_XMM+16u*(uint32_t)i+(uint32_t)j);
}
uint32_t w64_lookup(uint32_t pc,uint32_t *base) {
    for(uint32_t m=0;m<w32_nmods;m++) {
        w32_module_t *mod=&w32_mods[m];if(pc<mod->base||pc>=mod->base+mod->size)continue;
        if(base)*base=mod->base;
        uint32_t lo=0,hi=mod->pdata_size/12;
        while(lo<hi){uint32_t mid=(lo+hi)/2,f=mod->base+mod->pdata_rva+mid*12;
            uint32_t begin=x86_rd32(f)+mod->base,end=x86_rd32(f+4)+mod->base;
            if(pc<begin)hi=mid;else if(pc>=end)lo=mid+1;else return f;
        }
    }return 0;
}
static uint32_t cr(uint32_t c,unsigned reg){return c+CTX_REG+8*reg;}
/* Recognize AMD64 epilog sequences before processing unwind codes. */
static int epilog(uint32_t pc,uint32_t end,uint32_t c) {
    uint32_t p=pc;uint64_t sp=x86_rd64(cr(c,ESP));
    if(p+4<=end && x86_rd8(p)==0x48 && x86_rd8(p+1)==0x83 && x86_rd8(p+2)==0xc4){sp+=x86_rd8(p+3);p+=4;}
    else if(p+7<=end && x86_rd8(p)==0x48 && x86_rd8(p+1)==0x81 && x86_rd8(p+2)==0xc4){sp+=x86_rd32(p+3);p+=7;}
    else if(p+4<=end && (x86_rd8(p)&0xf8)==0x48 && x86_rd8(p+1)==0x8d){
        uint32_t rex=x86_rd8(p),modrm=x86_rd8(p+2),reg=(modrm&7)+((rex&1)?8:0);if(((modrm>>3)&7)!=ESP || (modrm&7)==4)return 0;
        if((modrm>>6)==1){sp=x86_rd64(cr(c,reg))+(int8_t)x86_rd8(p+3);p+=4;}
        else if((modrm>>6)==2 && p+7<=end){sp=x86_rd64(cr(c,reg))+(int32_t)x86_rd32(p+3);p+=7;}else return 0;
    }
    uint64_t regs[16];for(int i=0;i<16;i++)regs[i]=x86_rd64(cr(c,(unsigned)i));
    for(int n=0;n<16 && p<end;n++){
        uint32_t op=x86_rd8(p),rex=0;if(op==0x41){rex=8;p++;op=x86_rd8(p);}
        if(op<0x58 || op>0x5f)break;regs[(op&7)+rex]=x86_rd64(ptr(sp));sp+=8;p++;
    }
    if(p>=end || (x86_rd8(p)!=0xc3 && x86_rd8(p)!=0xc2))return 0;
    for(unsigned i=0;i<16;i++)x86_wr64(cr(c,i),regs[i]);
    x86_wr64(c+CTX_IP,x86_rd64(ptr(sp)));sp+=8;
    if(x86_rd8(p)==0xc2)sp+=x86_rd16(p+1);
    x86_wr64(cr(c,ESP),sp);return 1;
}
uint32_t w64_virtual_unwind(uint32_t type,uint32_t base,uint32_t pc,uint32_t fn,uint32_t c,uint32_t data,uint32_t frame) {
    if(data)x86_wr64(data,0);
    if(!fn){uint64_t sp=x86_rd64(cr(c,ESP));if(frame)x86_wr64(frame,sp);x86_wr64(c+CTX_IP,x86_rd64(ptr(sp)));x86_wr64(cr(c,ESP),sp+8);return 0;}
    uint32_t begin=base+x86_rd32(fn),end=base+x86_rd32(fn+4),u=base+x86_rd32(fn+8);
    uint32_t frame_reg=x86_rd8(u+3)&15,frame_off=x86_rd8(u+3)>>4;
    uint64_t sp=x86_rd64(cr(c,ESP));
    int established=pc>=begin+x86_rd8(u+1);
    if(!established&&frame_reg)for(uint32_t i=0;i<x86_rd8(u+2);i++){uint32_t code=u+4+i*2;if((x86_rd8(code+1)&15)==3&&pc>=begin+x86_rd8(code)){established=1;break;}}
    uint64_t est=frame_reg&&established?x86_rd64(cr(c,frame_reg))-16u*frame_off:sp;
    if(frame)x86_wr64(frame,est);
    if(pc>=begin+x86_rd8(u+1) && epilog(pc,end,c))return 0;
    for(unsigned chained=0;chained<16;chained++) {
        uint32_t flags=x86_rd8(u)>>3,count=x86_rd8(u+2),offset=pc>=begin?pc-begin:UINT32_MAX;
        frame_reg=x86_rd8(u+3)&15;frame_off=x86_rd8(u+3)>>4;
        for(uint32_t i=0;i<count;) {
            uint32_t code=u+4+2*i,at=x86_rd8(code),op=x86_rd8(code+1)&15,info=x86_rd8(code+1)>>4,slots=1;
            if(op==1)slots=info==0?2:3;else if(op==4||op==8)slots=2;else if(op==5||op==9)slots=3;
            if(i+slots>count)x86_fault("invalid UNWIND_INFO slots",u);
            if(offset>=at) switch(op) {
            case 0:x86_wr64(cr(c,info),x86_rd64(ptr(sp)));sp+=8;break;
            case 1:sp+=info==0?8u*x86_rd16(code+2):x86_rd32(code+2);break;
            case 2:sp+=8u*info+8;break;
            case 3:sp=x86_rd64(cr(c,frame_reg))-16u*frame_off;break;
            case 4:case 5:x86_wr64(cr(c,info),x86_rd64(ptr(sp+(op==4?8u*x86_rd16(code+2):x86_rd32(code+2)))));break;
            case 8:case 9:{uint32_t src=ptr(sp+(op==8?16u*x86_rd16(code+2):x86_rd32(code+2)));for(uint32_t j=0;j<16;j++)x86_wr8(c+CTX_XMM+info*16+j,x86_rd8(src+j));break;}
            case 10:{uint32_t p=ptr(sp+(info?8:0));x86_wr64(c+CTX_IP,x86_rd64(p));sp=x86_rd64(p+24);x86_wr64(cr(c,ESP),sp);return 0;}
            default:x86_fault("unsupported unwind code",code);
            }
            i+=slots;
        }
        uint32_t tail=u+4+((count+1)&~1u)*2;
        if(flags&4){fn=tail;begin=base+x86_rd32(fn);u=base+x86_rd32(fn+8);continue;}
        x86_wr64(c+CTX_IP,x86_rd64(ptr(sp)));x86_wr64(cr(c,ESP),sp+8);
        if((flags&type)&&pc>=begin+x86_rd8(u+1)){if(data)x86_wr64(data,tail+4);return base+x86_rd32(tail);}
        return 0;
    }
    x86_fault("chained unwind cycle",u);
}
void w64_tls_init(void) {
    uint32_t vector=w32_misc_alloc(NMOD*8);x86_wr64(W32_TEB+0x58,vector);
    for(uint32_t i=0;i<w32_nmods;i++){
        uint32_t t=w32_mods[i].tls_rva?w32_mods[i].base+w32_mods[i].tls_rva:0;if(!t)continue;
        uint32_t start=ptr(x86_rd64(t)),end=ptr(x86_rd64(t+8)),index=ptr(x86_rd64(t+16)),zero=x86_rd32(t+32);
        if(end<start || (uint64_t)end-start+zero>W32_MISC_SIZE/2)x86_fault("TLS template too large",t);
        uint32_t block=w32_misc_alloc(end-start+zero+16);for(uint32_t k=0;k<end-start;k++)x86_wr8(block+k,x86_rd8(start+k));
        x86_wr32(index,i);x86_wr64(vector+i*8,block);
    }
    for(uint32_t i=0;i<w32_nmods;i++)if(w32_mods[i].tls_rva){uint32_t t=w32_mods[i].base+w32_mods[i].tls_rva,callbacks=ptr(x86_rd64(t+24));
        if(callbacks)for(uint32_t p=callbacks,n=0;n<64 && x86_rd64(p);p+=8,n++){uint64_t args[3]={w32_mods[i].base,1,0};x86_callback64(ptr(x86_rd64(p)),3,args);}
    }
}
static uint32_t scratch_ctx[16],scratch_next[16],scratch_origin[16],scratch_disp[16],scratch_data[16],scratch_frame[16];
static int scratch_phase[16];
static unsigned depth;
static void unwind_exception(uint32_t record,uint32_t target_frame,uint32_t target_pc,uint64_t retval,uint32_t initial,int phase2) {
    if(depth>=16)x86_fault("exception nesting limit",record);unsigned d=depth++;
    if(!scratch_ctx[d]){scratch_ctx[d]=w32_misc_alloc(CTX_BYTES);scratch_next[d]=w32_misc_alloc(CTX_BYTES);scratch_origin[d]=w32_misc_alloc(CTX_BYTES);scratch_disp[d]=w32_misc_alloc(80);scratch_data[d]=w32_misc_alloc(8);scratch_frame[d]=w32_misc_alloc(8);}
    uint32_t c=scratch_ctx[d],next=scratch_next[d],disp=scratch_disp[d],data=scratch_data[d],frame=scratch_frame[d];
    if(initial)for(uint32_t i=0;i<CTX_BYTES;i++)x86_wr8(c+i,x86_rd8(initial+i));else w64_context_save(c,1);
    scratch_phase[d]=phase2;for(uint32_t i=0;i<CTX_BYTES;i++)x86_wr8(scratch_origin[d]+i,x86_rd8(c+i));
    for(unsigned step=0;step<512;step++){
        uint32_t pc=ptr(x86_rd64(c+CTX_IP)),sp=ptr(x86_rd64(cr(c,ESP))),base=0;
        if(sp<W32_STACK_LO||sp>=W32_STACK_HI||!pc)break;
        uint32_t fn=w64_lookup(pc,&base);
        for(uint32_t i=0;i<CTX_BYTES;i++)x86_wr8(next+i,x86_rd8(c+i));
        uint32_t handler=w64_virtual_unwind(phase2?2:1,base,pc,fn,next,data,frame),est=ptr(x86_rd64(frame));
        if(phase2){uint32_t flags=x86_rd32(record+4)|2u;if(est==target_frame)flags|=0x20u;x86_wr32(record+4,flags);}
        x86_wr64(disp,pc);x86_wr64(disp+8,base);x86_wr64(disp+16,fn);x86_wr64(disp+24,est);x86_wr64(disp+32,target_pc);x86_wr64(disp+40,c);x86_wr64(disp+48,handler);x86_wr64(disp+56,x86_rd64(data));x86_wr64(disp+64,0);x86_wr32(disp+72,0);
        if(handler){uint64_t args[4]={record,est,c,disp};x86_callback64(handler,4,args);if(X.transfer){depth--;return;}}
        if(phase2&&est==target_frame){w64_context_restore(c);X.r[EAX]=retval;X.eip=target_pc;X.transfer=1;depth--;return;}
        for(uint32_t i=0;i<CTX_BYTES;i++)x86_wr8(c+i,x86_rd8(next+i));
        if(x86_rd64(cr(c,ESP))<=sp)x86_fault("unwind made no stack progress",pc);
    }
    depth--;x86_fault(phase2?"RtlUnwindEx target not found":"unhandled guest exception",record);
}
static uint32_t rtl_lookup(void){uint32_t base=0,f=w64_lookup(ARG(0),&base);if(ARG(1))x86_wr64(ARG(1),base);return f;}
static uint32_t rtl_virtual(void){return w64_virtual_unwind(ARG(0),ARG(1),ARG(2),ARG(3),ARG(4),ARG(5),ARG(6));}
static uint32_t rtl_capture(void){w64_context_save(ARG(0),1);return 0;}
static uint32_t rtl_restore(void){w64_context_restore(ARG(0));X.transfer=1;return 0;}
static uint32_t rtl_unwind(void){uint32_t record=ARG(2),target=ARG(0),pc=ARG(1);uint64_t value=ARG64(3);if(!record){record=w32_misc_alloc(152);x86_wr32(record,0xc0000027u);x86_wr32(record+4,2);}uint32_t initial=depth?(scratch_phase[depth-1]?scratch_ctx[depth-1]:scratch_origin[depth-1]):0;unwind_exception(record,target,pc,value,initial,1);return 0;}
static uint32_t raise_exception(void){uint32_t r=w32_misc_alloc(152);x86_wr32(r,ARG(0));x86_wr32(r+4,ARG(1));x86_wr64(r+16,x86_rd64((uint32_t)X.r[ESP]));uint32_t count=ARG(2)>15?15:ARG(2);x86_wr32(r+24,count);for(uint32_t i=0;i<count;i++)x86_wr64(r+32+8*i,x86_rd64(ARG(3)+8*i));unwind_exception(r,0,0,0,0,0);return 0;}
static uint32_t setjmp64(void){uint32_t p=ARG(0);static const unsigned regs[10]={EBX,ESP,EBP,ESI,EDI,R12,R13,R14,R15,0};x86_wr64(p,X.r[EDX]);for(unsigned i=0;i<9;i++)x86_wr64(p+8+8*i,X.r[regs[i]]+(regs[i]==ESP?8:0));x86_wr64(p+80,x86_rd64((uint32_t)X.r[ESP]));x86_wr32(p+88,X.mxcsr);x86_wr16(p+92,0x37f);for(unsigned i=0;i<10;i++)for(unsigned j=0;j<16;j++)x86_wr8(p+96+i*16+j,X.xmm[i+6].u8[j]);return 0;}
static uint32_t longjmp64(void){uint32_t p=ARG(0),value=ARG(1);static const unsigned regs[9]={EBX,ESP,EBP,ESI,EDI,R12,R13,R14,R15};for(unsigned i=0;i<9;i++)X.r[regs[i]]=x86_rd64(p+8+8*i);X.eip=ptr(x86_rd64(p+80));X.r[EAX]=value?value:1;X.mxcsr=x86_rd32(p+88);for(unsigned i=0;i<10;i++)for(unsigned j=0;j<16;j++)X.xmm[i+6].u8[j]=(uint8_t)x86_rd8(p+96+i*16+j);X.transfer=1;return (uint32_t)X.r[EAX];}
static uint64_t fls[128],dynamic_tls[64],tls_mask;static uint32_t nfls;
static uint32_t fls_alloc(void){return nfls<128?nfls++:0xffffffffu;}
static uint32_t fls_get(void){return ARG(0)<128?(uint32_t)fls[ARG(0)]:0;}
static uint32_t fls_set(void){if(ARG(0)>=128)return 0;fls[ARG(0)]=ARG64(1);return 1;}
static uint32_t once_execute(void){uint32_t cell=ARG(0);if(!(x86_rd64(cell)&2)){uint64_t args[3]={cell,ARG64(2),ARG64(3)};uint64_t ok=x86_callback64(ARG(1),3,args);if(!ok)return 0;x86_wr64(cell,2);}return 1;}
static uint32_t empty_env(void){static uint32_t cell;if(!cell){cell=w32_misc_alloc(16);x86_wr64(cell,cell+8);}return cell;}
static uint32_t wide_argv(void){static uint32_t cell;if(!cell){cell=w32_misc_alloc(64);x86_wr64(cell,cell+8);x86_wr64(cell+8,cell+24);w32_pstr(cell+24,16,1,"game.exe");}return cell;}
static uint32_t crt_ok(void){return 0;}
static uint32_t yes(void){return 1;}
static uint32_t critical_init(void){for(unsigned i=0;i<40;i++)x86_wr8(ARG(0)+i,0);x86_wr32(ARG(0)+8,0xffffffffu);return 0;}
static uint32_t critical_enter(void){uint32_t p=ARG(0),n=x86_rd32(p+12);x86_wr32(p+8,n);x86_wr32(p+12,n+1);x86_wr64(p+16,1);return 1;}
static uint32_t critical_leave(void){uint32_t p=ARG(0),n=x86_rd32(p+12);if(n){n--;x86_wr32(p+8,n-1);x86_wr32(p+12,n);if(!n)x86_wr64(p+16,0);}return 0;}
static uint32_t system_info(void){uint32_t p=ARG(0);for(unsigned i=0;i<48;i++)x86_wr8(p+i,0);x86_wr16(p,9);x86_wr32(p+4,4096);x86_wr64(p+8,0x10000);x86_wr64(p+16,X86_FLAT_BYTES-1);x86_wr64(p+24,1);x86_wr32(p+32,1);x86_wr32(p+36,8664);x86_wr32(p+40,65536);return 0;}
static uint32_t virtual_query(void){uint32_t p=ARG(1);for(unsigned i=0;i<48;i++)x86_wr8(p+i,0);x86_wr64(p,ARG(0)&~4095u);x86_wr64(p+8,ARG(0)&~4095u);x86_wr32(p+16,4);x86_wr64(p+24,4096);x86_wr32(p+32,0x1000);x86_wr32(p+36,4);x86_wr32(p+40,0x20000);return 48;}
static uint32_t aligned_malloc(void){uint32_t align=ARG(1);if(!align || (align&(align-1)))return 0;uint32_t p=w32_heap_alloc(ARG(0)+align+8,0),q=(p+8+align-1)&~(align-1);x86_wr64(q-8,p);return q;}
static uint32_t aligned_free(void){if(ARG(0))w32_heap_free((uint32_t)x86_rd64(ARG(0)-8));return 0;}
static uint32_t memchr64(void){uint32_t p=ARG(0);for(uint32_t i=0;i<ARG(2);i++)if(x86_rd8(p+i)==(ARG(1)&255))return p+i;return 0;}
static uint32_t strncmp64(void){for(uint32_t i=0;i<ARG(2);i++){uint32_t a=x86_rd8(ARG(0)+i),b=x86_rd8(ARG(1)+i);if(a!=b)return (uint32_t)((int32_t)a-(int32_t)b);if(!a)return 0;}return 0;}
static uint32_t abort64(void){x86_fault("guest CRT abort",(uint32_t)x86_rd64((uint32_t)X.r[ESP]));}
static uint32_t iob(void){static uint32_t base;if(!base)base=w32_misc_alloc(512);return base+ARG(0)*48;}
static uint32_t fwrite64(void){
    uint32_t size=ARG(1),count=ARG(2);if(!size||!count)return 0;
    if((uint64_t)size*count>0x100000u)return 0;
    char buf[256];uint32_t n=size*count;if(n>255)n=255;w32_gstrn(ARG(0),(int32_t)n,0,buf,sizeof buf);w32_logf2("guest CRT stdout: ",buf);return count;
}
static uint32_t fputc64(void){char s[2]={(char)ARG(0),0};w32_logf2("guest CRT stdout: ",s);return ARG(0);}
static uint32_t signal64(void){return 0;}
static uint32_t fpreset64(void){X.mxcsr=0x1f80;return 0;}
typedef struct {const char *name;uint32_t(*fn)(void);} api64_t;
static const api64_t api[] = {
 {"RtlLookupFunctionEntry",rtl_lookup},{"RtlVirtualUnwind",rtl_virtual},{"RtlCaptureContext",rtl_capture},{"RtlRestoreContext",rtl_restore},{"RtlUnwindEx",rtl_unwind},{"RaiseException",raise_exception},
 {"__intrinsic_setjmpex",setjmp64},{"_setjmpex",setjmp64},
 {"_setjmp",setjmp64},{"setjmp",setjmp64},{"longjmp",longjmp64},{"_longjmp",longjmp64},
 {"FlsAlloc",fls_alloc},{"FlsGetValue",fls_get},{"FlsSetValue",fls_set},{"FlsFree",yes},
 {"InitOnceExecuteOnce",once_execute},{"InitializeCriticalSection",critical_init},{"EnterCriticalSection",critical_enter},{"TryEnterCriticalSection",critical_enter},{"LeaveCriticalSection",critical_leave},{"DeleteCriticalSection",crt_ok},
 {"AcquireSRWLockExclusive",crt_ok},{"ReleaseSRWLockExclusive",crt_ok},{"TryAcquireSRWLockExclusive",yes},
 {"GetSystemInfo",system_info},{"GetNativeSystemInfo",system_info},
 {"VirtualQuery",virtual_query},{"_aligned_malloc",aligned_malloc},{"_aligned_free",aligned_free},{"memchr",memchr64},{"strncmp",strncmp64},
 {"_configure_narrow_argv",crt_ok},{"_configure_wide_argv",crt_ok},{"_initialize_narrow_environment",crt_ok},{"_initialize_wide_environment",crt_ok},{"_set_app_type",crt_ok},{"_set_new_mode",crt_ok},{"_set_invalid_parameter_handler",crt_ok},{"__setusermatherr",crt_ok},{"_crt_atexit",crt_ok},{"_crt_at_quick_exit",crt_ok},{"_cexit",crt_ok},{"_tzset",crt_ok},
 {"__p__environ",empty_env},{"__p__wenviron",empty_env},{"__p___wargv",wide_argv},
 {"__acrt_iob_func",iob},{"fflush",crt_ok},{"fputc",fputc64},{"fwrite",fwrite64},{"signal",signal64},{"abort",abort64},{"_fpreset",fpreset64},
};
uint64_t w64_api(const char *name,int *handled) {
    int query=*handled<0;*handled=0;
    if(w32_streqi(name,"GetCurrentProcess")){*handled=1;return query?0:UINT64_MAX;}
    if(w32_streqi(name,"GetCurrentThread")){*handled=1;return query?0:UINT64_MAX-1;}
    if(w32_streqi(name,"TlsAlloc")){*handled=1;if(query)return 0;for(unsigned i=0;i<64;i++)if(!(tls_mask&(1ull<<i))){tls_mask|=1ull<<i;dynamic_tls[i]=0;return i;}return 0xffffffffu;}
    if(w32_streqi(name,"TlsFree")){*handled=1;if(query)return 0;if(ARG(0)>=64)return 0;tls_mask&=~(1ull<<ARG(0));dynamic_tls[ARG(0)]=0;return 1;}
    if(w32_streqi(name,"TlsSetValue")){*handled=1;if(query)return 0;if(ARG(0)>=64)return 0;dynamic_tls[ARG(0)]=ARG64(1);return 1;}
    if(w32_streqi(name,"TlsGetValue")){*handled=1;return query?0:ARG(0)<64?dynamic_tls[ARG(0)]:0;}
    if(w32_streqi(name,"FlsGetValue")){*handled=1;return query?0:ARG(0)<128?fls[ARG(0)]:0;}
    if(w32_streqi(name,"GetWindowLongPtrW")||w32_streqi(name,"GetWindowLongPtrA")){*handled=1;return query?0:w32_longptr64(ARG(0),(int32_t)ARG(1),0,0);}
    if(w32_streqi(name,"SetWindowLongPtrW")||w32_streqi(name,"SetWindowLongPtrA")){*handled=1;return query?0:w32_longptr64(ARG(0),(int32_t)ARG(1),ARG64(2),1);}
    if(w32_streqi(name,"SendMessageW")||w32_streqi(name,"SendMessageA")){*handled=1;return query?0:w32_send64(ARG(0),ARG(1),ARG64(2),ARG64(3));}
    for(unsigned i=0;i<sizeof api/sizeof api[0];i++)if(w32_streqi(name,api[i].name)){*handled=1;return query?0:api[i].fn();}
    return 0;
}
#else
uint64_t w64_api(const char *name,int *handled) { (void)name;*handled=0;return 0; }
void w64_tls_init(void) {}
#endif
