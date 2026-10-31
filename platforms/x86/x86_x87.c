/* Shared i386/AMD64 x87 contracts. MIT. Precision model: X87.md. */
#include "x86_sem64.h"
#include "x86_ext80.h"
#define FPU X.fpu
static unsigned fp_top(void) { return (FPU.status>>11)&7; }
static void fp_top_set(unsigned t) { FPU.status=(FPU.status&~0x3800)|((t&7)<<11); }
static unsigned fp_tag(unsigned p) { return (FPU.tags>>(p*2))&3; }
static void fp_tag_set(unsigned p,unsigned t) { FPU.tags=(FPU.tags&~(3u<<(p*2)))|(t<<(p*2)); }
static unsigned fp_class_tag(ext80 v) { return fp_zero(v)?1:!fp_exp(v)||fp_exp(v)==0x7fff||fp_unsupported(v)?2:0; }
static void fp_init(void) { __builtin_memset(&FPU,0,sizeof FPU);FPU.control=0x37f;FPU.tags=0xffff;FPU.initialized=1; }
static ext80 fp_get(unsigned i) {
    unsigned p=(fp_top()+i)&7;
    if(fp_tag(p)==3){FPU.status=(FPU.status&~FP_C1)|0x40;fp_raise(FP_I);return fp_nan();}
    return FPU.st[p];
}
static void fp_put(unsigned i,ext80 v) { unsigned p=(fp_top()+i)&7;FPU.st[p]=v;fp_tag_set(p,fp_class_tag(v)); }
static void fp_push(ext80 v) {
    unsigned p=(fp_top()-1)&7;FPU.status&=~FP_C1;
    if(fp_tag(p)!=3){FPU.status|=0x40|FP_C1;fp_raise(FP_I);v=fp_nan();}
    fp_top_set(p);fp_put(0,v);
}
static void fp_pop(void) { fp_tag_set(fp_top(),3);fp_top_set(fp_top()+1); }
static void fp_cc(unsigned v) { FPU.status=(FPU.status&~FP_CC)|v; }
static void fp_cmp(ext80 a,ext80 b,int quiet,int flags) {
    int c=fp_compare(a,b,quiet);
    if(flags){X.flags&=~(F_CF|F_PF|F_ZF|F_OF|F_SF|F_AF);X.flags|=c==2?F_CF|F_ZF|F_PF:c<0?F_CF:c==0?F_ZF:0;}
    else fp_cc(c==2?FP_C0|FP_C2|FP_C3:c<0?FP_C0:c==0?FP_C3:0);
}
static ext80 fp_arith(unsigned r,ext80 a,ext80 b) {
    switch(r){case 0:return fp_add(a,b);case 1:return fp_mul(a,b);
    case 4:return fp_add(a,fp_neg(b));case 5:return fp_add(b,fp_neg(a));
    case 6:return fp_div(a,b);case 7:return fp_div(b,a);default:return fp_nan();}
}
static ext80 fp_load80(uint32_t p) { return fp_make(x86_rd64(p),x86_rd16(p+8)); }
static void fp_store80(uint32_t p,ext80 v) { x86_wr64(p,v.sig);x86_wr16(p+8,v.se); }
static ext80 fp_load_real(uint32_t p,int wide) {
    if(wide){
        uint64_t u=x86_rd64(p);if(!(u&0x7ff0000000000000ull)&&(u&0xfffffffffffffull))fp_raise(FP_D);
        double d;__builtin_memcpy(&d,&u,8);return fp_operand(fp_from_double(d));
    }
    uint32_t u=x86_rd32(p);unsigned sign=u>>31,e=(u>>23)&255;uint64_t s=u&0x7fffff;
    if(e==255)return fp_operand(fp_make(FP_INT|(s<<40),(sign<<15)|0x7fff));
    if(!e&&s)fp_raise(FP_D);
    float f;__builtin_memcpy(&f,&u,4);return fp_from_double(f);
}
static ext80 fp_scale(ext80 a,ext80 b) {
    a=fp_operand(a);b=fp_operand(b);if(fp_isnan(a))return a;if(fp_isnan(b))return b;
    if(fp_inf(b)){
        if((!fp_sign(b)&&fp_zero(a))||(fp_sign(b)&&fp_inf(a))){fp_raise(FP_I);return fp_nan();}
        return fp_make(fp_sign(b)?0:FP_INT,(a.se&0x8000)|(fp_sign(b)?0:0x7fff));
    }
    if(fp_inf(a)||fp_zero(a))return a;
    uint64_t s,t;int e,be;fp_unpack(a,&s,&e);fp_unpack(b,&t,&be);
    int n=be<0?0:be>16?65536:(int)(t>>(63-be));if(fp_sign(b))n=-n;
    return fp_round(fp_sign(a),e+n,(u128)s<<63,64,-16382,16383);
}
static void fp_remainder(int nearest) {
    ext80 a=fp_operand(fp_get(0)),b=fp_operand(fp_get(1));
    if(fp_isnan(a)||fp_isnan(b)){fp_put(0,fp_isnan(a)?a:b);return;}
    if(fp_inf(a)||fp_zero(b)){fp_raise(FP_I);fp_put(0,fp_nan());return;}
    if(fp_inf(b)||fp_zero(a)){fp_cc(0);return;}
    uint64_t sa,sb;int ea,eb;fp_unpack(a,&sa,&ea);fp_unpack(b,&sb,&eb);int d=ea-eb;
    if(d< -1){fp_cc(0);return;}
    /* Bounded partial reduction (32..63 exponent bits), as permitted by SDM. */
    int partial=d>=64, n=partial?32+(d&31):d, out_e=partial?ea-n:d<0?ea:eb;
    u128 num=sa,den=sb;
    if(n>=0)num<<=n;else den<<=-n;
    u128 q=num/den,rem=num%den;
    int neg=0;
    if(nearest&&!partial&&(rem>den-rem||(rem==den-rem&&(q&1)))){q++;rem=den-rem;neg=1;}
    unsigned low=(unsigned)q&7; // quotient bits are magnitude bits, even for a negative quotient.
    fp_cc(partial?FP_C2:((low&4)?FP_C0:0)|((low&1)?FP_C1:0)|((low&2)?FP_C3:0));
    /* rem may have bit 64 for d=-1. Normalize before aligning at bit 126. */
    int re=out_e;
    while(rem>>64){rem=fp_jam(rem,1);re++;}
    uint16_t sw=FPU.status;fp_put(0,fp_round(fp_sign(a)^neg,re,rem<<63,64,-16382,16383));
    FPU.status=(FPU.status&~FP_CC)|(sw&FP_CC);
}
static ext80 fp_trans(double d) {
    if(isnan(d)){fp_raise(FP_I);return fp_nan();}
    return fp_from_double(d);
}
void x86_x87(const x86_insn_t *in) {
    unsigned op=in->simd_op,m=in->simd_imm,r=(m>>3)&7,i=m&7;
    if(!FPU.initialized)fp_init();
    if(op==0x9b){if(FPU.status&~FPU.control&63)fp_raise(FPU.status&63);return;}
    if(op==0xdb&&m==0xe3){fp_init();return;}
    if(op==0xdb&&m==0xe2){FPU.status&=~0x80ff;return;}
    if(op==0xdf&&m==0xe0){X.r[EAX]=(X.r[EAX]&~(x86_word_t)0xffff)|FPU.status;return;}
    if(m<0xc0){
        uint32_t p=X.mode64?x64_ea(&in->o[0]):xs_ea(&in->o[0]);
        if(op==0xd9&&r==5){FPU.control=x86_rd16(p);return;}
        if(op==0xd9&&r==7){x86_wr16(p,FPU.control);return;}
        if(op==0xdd&&r==7){x86_wr16(p,FPU.status);return;}
        if(op==0xdb&&r==5){fp_push(fp_load80(p));return;}
        if(op==0xdb&&r==7){fp_store80(p,fp_get(0));fp_pop();return;}
        if((op==0xd9||op==0xdd)&&r==0){fp_push(fp_load_real(p,op==0xdd));return;}
        if((op==0xd9||op==0xdd)&&(r==2||r==3)){
            ext80 v=fp_get(0);if(op==0xdd)x86_wr64(p,fp_ieee(v,53,-1022,1023,1023));else x86_wr32(p,(uint32_t)fp_ieee(v,24,-126,127,127));
            if(r==3)fp_pop();return;
        }
        if((op==0xdb&&r==0)||(op==0xdf&&(r==0||r==5))){int64_t v=op==0xdb?(int64_t)(int32_t)x86_rd32(p):r==5?(int64_t)x86_rd64(p):(int64_t)(int16_t)x86_rd16(p);fp_push(fp_from_int(v));return;}
        if((op==0xdb&&(r==1||r==2||r==3))||(op==0xdd&&r==1)||(op==0xdf&&(r==1||r==2||r==3||r==7))){
            unsigned bits=op==0xdf&&r!=7?16:op==0xdb?32:64;
            /* Invalid integer conversion takes priority over precision. Compute
             * rounding with exceptions masked, then commit only the applicable flags. */
            ext80 src=fp_get(0);uint16_t cw=FPU.control,sw=FPU.status;FPU.control|=63;
            FPU.status&=~(63|FP_C1|0x8080); /* Collect operation-local events, not sticky-bit differences. */
            ext80 a=fp_integer(src,r==1);uint16_t rounded=FPU.status;FPU.control=cw;FPU.status=sw&~FP_C1;
            uint64_t s;int e;fp_unpack(a,&s,&e);
            uint64_t v=bits==64?0x8000000000000000ull:1ull<<(bits-1);
            if(fp_isnan(a)||fp_inf(a)||e>(int)bits-1||(e==(int)bits-1&&(!fp_sign(a)||s!=FP_INT)))fp_raise(FP_I);
            else {FPU.status|=rounded&FP_C1;fp_raise(rounded&63);v=e<0?0:e<=63?s>>(63-e):0;if(fp_sign(a))v=0-v;}
            if(bits==64)x86_wr64(p,v);else if(bits==32)x86_wr32(p,(uint32_t)v);else x86_wr16(p,(uint32_t)v);
            if(r==1||r==3||r==7)fp_pop();return;
        }
        if((op==0xd8||op==0xdc||op==0xda||op==0xde)){
            ext80 b=(op==0xda||op==0xde)?fp_from_int(op==0xda?(int64_t)(int32_t)x86_rd32(p):(int64_t)(int16_t)x86_rd16(p)):fp_load_real(p,op==0xdc);
            if(r==2||r==3){fp_cmp(fp_get(0),b,0,0);if(r==3)fp_pop();}
            else fp_put(0,fp_arith(r,fp_get(0),b));return;
        }
    }else{
        if(op==0xd9&&(m&0xf8)==0xc0){ext80 a=fp_get(i);fp_push(a);return;}
        if((op==0xd9||op==0xdd)&&(m&0xf8)==0xc8){ext80 a=fp_get(0),b=fp_get(i);fp_put(0,b);fp_put(i,a);FPU.status&=~FP_C1;return;}
        if(op==0xdd&&r==0){fp_tag_set((fp_top()+i)&7,3);return;}
        if(op==0xdd&&(r==2||r==3)){fp_put(i,fp_get(0));if(r==3)fp_pop();return;}
        if(op==0xdf&&r==0){fp_tag_set((fp_top()+i)&7,3);fp_pop();return;}
        if((op==0xdb||op==0xdf)&&(r==5||r==6)){fp_cmp(fp_get(0),fp_get(i),r==5,1);if(op==0xdf)fp_pop();return;}
        if((op==0xda||op==0xdb)&&r<4){
            unsigned mask=r==0?F_CF:r==1?F_ZF:r==2?F_CF|F_ZF:F_PF;
            if(!!(X.flags&mask)==(op==0xda))fp_put(0,fp_get(i));return;
        }
        if(op==0xda&&m==0xe9){fp_cmp(fp_get(0),fp_get(1),1,0);fp_pop();fp_pop();return;}
        if(op==0xde&&m==0xd9){fp_cmp(fp_get(0),fp_get(1),0,0);fp_pop();fp_pop();return;}
        if(op==0xdd&&(r==4||r==5)){fp_cmp(fp_get(0),fp_get(i),1,0);if(r==5)fp_pop();return;}
        if(op==0xd8||op==0xdc||op==0xde){
            if(r==2||r==3){fp_cmp(fp_get(0),fp_get(i),0,0);if(r==3)fp_pop();return;}
            ext80 a=fp_get(0),b=fp_get(i);
            if(op==0xd8)fp_put(0,fp_arith(r,a,b));
            else fp_put(i,fp_arith(r>=4?r^1:r,b,a)); // DC/DE reverse subtract/divide encodings.
            if(op==0xde)fp_pop();return;
        }
        if(op==0xd9){
            if(m==0xd0)return;
            if(m>=0xe8&&m<=0xee){
                static const uint64_t sig[]={0x8000000000000000ull,0xd49a784bcd1b8afeull,0xb8aa3b295c17f0bcull,0xc90fdaa22168c235ull,0x9a209a84fbcff799ull,0xb17217f7d1cf79acull,0};
                static const unsigned exp[]={0x3fff,0x4000,0x3fff,0x4000,0x3ffd,0x3ffe,0};
                unsigned k=m-0xe8,rc=(FPU.control>>10)&3;uint64_t s=sig[k];
                if(k&&k<6){if(rc==2&&k==1)s++;else if((rc==1||rc==3)&&k!=1)s--;}
                fp_push(fp_make(s,exp[k]));return;
            }
            if(m==0xf6||m==0xf7){fp_top_set(fp_top()+(m==0xf6?-1:1));FPU.status&=~FP_C1;return;}
            if(m==0xe5){
                unsigned p=fp_top();ext80 a=FPU.st[p];unsigned c;
                if(fp_tag(p)==3)c=FP_C3|FP_C0;
                else if(fp_unsupported(a))c=0;
                else if(fp_isnan(a))c=FP_C0;
                else if(fp_inf(a))c=FP_C2|FP_C0;
                else if(fp_zero(a))c=FP_C3;
                else if(!fp_exp(a))c=FP_C3|FP_C2;
                else c=FP_C2;
                fp_cc(c|(fp_sign(a)?FP_C1:0));return;
            }
            ext80 a=fp_get(0);
            if(m==0xe0){fp_put(0,fp_neg(a));return;}
            if(m==0xe1){a.se&=0x7fff;fp_put(0,a);return;}
            if(m==0xe4){fp_cmp(a,fp_make(0,0),0,0);return;}
            if(m==0xfa){fp_put(0,fp_sqrt(a));return;}
            if(m==0xfc){fp_put(0,fp_integer(a,0));return;}
            if(m==0xfd){fp_put(0,fp_scale(a,fp_get(1)));return;}
            if(m==0xf5||m==0xf8){fp_remainder(m==0xf5);return;}
            if(m==0xf4){
                a=fp_operand(a);ext80 e,s=a;
                if(fp_zero(a)){fp_raise(FP_Z);e=fp_make(FP_INT,0xffff);}
                else if(fp_isnan(a))e=a;
                else if(fp_inf(a))e=fp_make(FP_INT,0x7fff);
                else{uint64_t sig;int ex;fp_unpack(a,&sig,&ex);e=fp_from_int(ex);s=fp_make(sig,(a.se&0x8000)|0x3fff);}
                fp_put(0,e);fp_push(s);return;
            }
            a=fp_operand(a);double d=fp_double(a);
            if(fp_isnan(a)){
                if(m==0xf1||m==0xf9||m==0xf3){fp_put(1,a);fp_pop();}
                else if(m==0xfb){fp_put(0,a);fp_push(a);}
                else if(m==0xf2){fp_put(0,a);fp_push(fp_from_int(1));}
                else fp_put(0,a);
                return;
            }
            if(m==0xf0){if(d>=-1&&d<=1)fp_put(0,fp_trans(expm1(d*0.69314718055994530942)));else x86_fault("F2XM1 outside architectural result domain",in->addr);return;}
            if(m==0xf1||m==0xf9){
                ext80 y=fp_operand(fp_get(1));double x=m==0xf9?d+1:d;
                if(fp_isnan(y)){fp_put(1,y);fp_pop();return;}
                if(x==0&&!fp_zero(y))fp_raise(FP_Z);
                fp_put(1,fp_trans(fp_double(y)*(m==0xf9?log1p(d)/0.69314718055994530942:log2(d))));fp_pop();return;
            }
            if(m==0xf3){ext80 y=fp_operand(fp_get(1));fp_put(1,fp_isnan(y)?y:fp_trans(atan2(fp_double(y),d)));fp_pop();return;}
            if(m==0xf2||m==0xfb||m==0xfe||m==0xff){
                if(!fp_isnan(a)&&!fp_inf(a)&&fp_exp(a)>=16383+63){FPU.status|=FP_C2;return;}
                FPU.status&=~FP_C2;
                if(m==0xf2){fp_put(0,fp_trans(tan(d)));fp_push(fp_from_int(1));}
                else if(m==0xfb){fp_put(0,fp_trans(sin(d)));fp_push(fp_trans(cos(d)));}
                else fp_put(0,fp_trans(m==0xfe?sin(d):cos(d)));return;
            }
        }
    }
    x86_fault("unsupported x87 operation",in->addr);
}
