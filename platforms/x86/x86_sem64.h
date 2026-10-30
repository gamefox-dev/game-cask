/* AMD64 integer semantics; shared by the interpreter and lifted basic blocks. MIT. */
#ifndef X86_SEM64_H
#define X86_SEM64_H
#include "x86_sem.h"
static inline uint64_t x64_mask(int n) { return n==8?UINT64_MAX:((1ull<<(n*8))-1); }
static inline uint64_t x64_sext(uint64_t v,int n) { return n==1?(uint64_t)(int64_t)(int8_t)v:n==2?(uint64_t)(int64_t)(int16_t)v:n==4?(uint64_t)(int64_t)(int32_t)v:v; }
static inline uint64_t x64_reg(int r,int n) { if(n==1 && r>=16)return (X.r[r-16]>>8)&255;return X.r[r]&x64_mask(n); }
static inline void x64_set(int r,int n,uint64_t v) {
    if(n==1 && r>=16)X.r[r-16]=(X.r[r-16]&~0xff00ull)|((v&255)<<8);
    else if(n>=4)X.r[r]=v&x64_mask(n);
    else X.r[r]=(X.r[r]&~x64_mask(n))|(v&x64_mask(n));
}
static inline uint64_t x64_calc_ea(const x86_opnd_t *o) {
    uint64_t a=(o->pad&4)?o->imm:o->base==X86_NOREG?((o->pad&2)?(uint32_t)o->disp:(uint64_t)(int64_t)o->disp):(uint64_t)(int64_t)o->disp+X.r[o->base];
    if(o->index!=X86_NOREG)a+=X.r[o->index]<<o->scale;
    if(o->pad&1)a=(uint32_t)a;
    if(o->seg_fs)a+=o->seg_fs==2?X.gs_base:X.fs_base;
    return a;
}
static inline uint32_t x64_ea(const x86_opnd_t *o) {return x86_address(x64_calc_ea(o));}
static inline uint64_t x64_load(uint32_t a,int n) {return n==8?x86_rd64(a):n==4?x86_rd32(a):n==2?x86_rd16(a):x86_rd8(a);}
static inline void x64_store(uint32_t a,uint64_t v,int n) {if(n==8)x86_wr64(a,v);else if(n==4)x86_wr32(a,(uint32_t)v);else if(n==2)x86_wr16(a,(uint32_t)v);else x86_wr8(a,(uint32_t)v);}
static inline uint64_t x64_read(const x86_opnd_t *o) {return o->kind==XK_IMM?o->imm&x64_mask(o->size):o->kind==XK_REG?x64_reg(o->reg,o->size):x64_load(x64_ea(o),o->size);}
static inline void x64_write(const x86_opnd_t *o,uint64_t v) {if(o->kind==XK_REG)x64_set(o->reg,o->size,v);else x64_store(x64_ea(o),v,o->size);}
static inline void x64_szp(uint64_t r,int n) {r&=x64_mask(n);xs_setf(F_ZF,!r);xs_setf(F_SF,(r>>(n*8-1))&1);xs_setf(F_PF,xs_parity((uint32_t)r));}
static inline uint64_t x64_alu(int op,uint64_t a,uint64_t b,int n) {
    uint64_t m=x64_mask(n),s=1ull<<(n*8-1),r=0,carry=X.flags&F_CF;a&=m;b&=m;
    switch(op) {
    case XO_ADD:case XO_ADC: { __uint128_t t=(__uint128_t)a+b+(op==XO_ADC?carry:0);r=(uint64_t)t&m;xs_setf(F_CF,t>m);xs_setf(F_OF,!!((a^r)&(b^r)&s));break; }
    case XO_SUB:case XO_CMP:case XO_SBB:{__uint128_t t=(__uint128_t)b+(op==XO_SBB?carry:0);r=(a-(uint64_t)t)&m;xs_setf(F_CF,(__uint128_t)a<t);xs_setf(F_OF,!!((a^b)&(a^r)&s));break;}
    case XO_AND:case XO_TEST:r=a&b;X.flags&=~(F_CF|F_OF);break;
    case XO_OR:r=a|b;X.flags&=~(F_CF|F_OF);break;
    case XO_XOR:r=a^b;X.flags&=~(F_CF|F_OF);break;
    }
    xs_setf(F_AF,!!((a^b^r)&16));x64_szp(r,n);return r;
}
static inline uint64_t x64_shift(int op,uint64_t a,uint32_t c,int n) {
    int bits=n*8;uint64_t m=x64_mask(n),sign=1ull<<(bits-1),r=a&m;a&=m;c&=n==8?63:31;if(!c)return a;
    if(op==XO_ROL || op==XO_ROR) {c%=bits;if(!c)return a;r=op==XO_ROL?((a<<c)|(a>>(bits-c)))&m:((a>>c)|(a<<(bits-c)))&m;xs_setf(F_CF,op==XO_ROL?r&1:!!(r&sign));xs_setf(F_OF,op==XO_ROL?!!(r&sign)^!!(X.flags&F_CF):!!((r^(r<<1))&sign));return r;}
    if(op==XO_RCL || op==XO_RCR) {for(uint32_t i=0;i<c;i++){uint32_t old=X.flags&F_CF,cf=op==XO_RCL?!!(r&sign):r&1;r=op==XO_RCL?((r<<1)|old)&m:(r>>1)|(old?sign:0);xs_setf(F_CF,cf);}xs_setf(F_OF,op==XO_RCL?!!(r&sign)^!!(X.flags&F_CF):!!((r^(r<<1))&sign));return r;}
    if(op==XO_SHL || op==XO_SAL){r=c>=(uint32_t)bits?0:(a<<c)&m;xs_setf(F_CF,c<=(uint32_t)bits&&((a>>(bits-c))&1));xs_setf(F_OF,!!(r&sign)^!!(X.flags&F_CF));}
    else if(op==XO_SHR){r=c>=(uint32_t)bits?0:a>>c;xs_setf(F_CF,c<=(uint32_t)bits&&((a>>(c-1))&1));xs_setf(F_OF,!!(a&sign));}
    else{uint32_t k=c>=(uint32_t)bits?(uint32_t)bits-1:c;int64_t sa=(int64_t)x64_sext(a,n);r=(uint64_t)(sa>>k)&m;xs_setf(F_CF,(sa>>(k-1))&1);X.flags&=~F_OF;}
    x64_szp(r,n);return r;
}
#endif
