/* Software extended precision, MIT. See X87.md for the precision/exception model.
 * Integer significands avoid dependence on wasm/host long double and host rounding. */
#ifndef X86_EXT80_H
#define X86_EXT80_H
#include "x86.h"
#include <math.h>
typedef x86_ext80_t ext80;
typedef __uint128_t u128;
#define FP_I 1u
#define FP_D 2u
#define FP_Z 4u
#define FP_O 8u
#define FP_U 16u
#define FP_P 32u
#define FP_C0 0x100u
#define FP_C1 0x200u
#define FP_C2 0x400u
#define FP_C3 0x4000u
#define FP_CC (FP_C0|FP_C1|FP_C2|FP_C3)
#define FP_INT 0x8000000000000000ull
static ext80 fp_make(uint64_t s, unsigned se) { ext80 v = {s, (uint16_t)se}; return v; }
static ext80 fp_nan(void) { return fp_make(0xc000000000000000ull,0xffff); }
static int fp_sign(ext80 a) { return a.se >> 15; }
static int fp_exp(ext80 a) { return a.se & 0x7fff; }
static int fp_isnan(ext80 a) { return fp_exp(a)==0x7fff && a.sig!=FP_INT; }
static int fp_inf(ext80 a) { return fp_exp(a)==0x7fff && a.sig==FP_INT; }
static int fp_zero(ext80 a) { return !fp_exp(a) && !a.sig; }
static int fp_snan(ext80 a) { return fp_isnan(a) && !(a.sig & (FP_INT>>1)); }
static int fp_unsupported(ext80 a) { return fp_exp(a) && !(a.sig & FP_INT); }
static void fp_raise(unsigned f) {
    X.fpu.status |= f;
    if (f & ~X.fpu.control & 63) {
        X.fpu.status |= 0x8080;
        x86_fault("unmasked x87 exception", X.eip);
    }
}
static ext80 fp_operand(ext80 a) {
    if (fp_unsupported(a)) { fp_raise(FP_I); return fp_nan(); }
    if (fp_snan(a)) { fp_raise(FP_I); a.sig |= FP_INT>>1; }
    if (!fp_exp(a) && a.sig) fp_raise(FP_D);
    return a;
}
static u128 fp_jam(u128 v, unsigned n) {
    if (!n) return v;
    if (n >= 128) return v != 0;
    return (v >> n) | ((v << (128-n)) != 0);
}
static void fp_unpack(ext80 a, uint64_t *s, int *e) {
    *s=a.sig; *e=(fp_exp(a)?fp_exp(a):1)-16383;
    if (*s) while (!(*s & FP_INT)) { *s <<= 1; --*e; }
}
static unsigned fp_precision(void) {
    unsigned p=(X.fpu.control>>8)&3; return p==0?24:p==2?53:64;
}
/* v's binary point is at bit 126. All bits below the represented exact result
 * have been jammed into bit 0. One rounding, including the denormal boundary. */
static ext80 fp_round(int sign, int e, u128 v, unsigned p, int emin, int emax) {
    X.fpu.status &= ~FP_C1;
    if (!v) return fp_make(0,sign<<15);
    while (v>>127) { v=fp_jam(v,1); e++; }
    while (!(v & ((u128)1<<126))) { v<<=1; e--; }
    unsigned shift=127-p;
    if (e<emin) { unsigned d=(unsigned)(emin-e); v=fp_jam(v,d); e=emin; }
    u128 mask=((u128)1<<shift)-1, lost=v&mask, q=v>>shift, half=(u128)1<<(shift-1);
    unsigned rc=(X.fpu.control>>10)&3;
    int up=lost && (rc==0 ? lost>half || (lost==half && (q&1)) : rc==1?sign:rc==2?!sign:0);
    X.fpu.status &= ~FP_C1;
    if (up) { q++; X.fpu.status|=FP_C1; }
    if (lost) fp_raise(FP_P);
    if (q>>p) { q>>=1; e++; }
    if (e>emax) {
        fp_raise(FP_O|FP_P);
        if (!rc || (rc==1 && sign) || (rc==2 && !sign)) return fp_make(FP_INT,(sign<<15)|0x7fff);
        return fp_make(UINT64_MAX << (64-p),(sign<<15)|(emax+16383));
    }
    uint64_t sig=(uint64_t)q << (64-p);
    if (lost && e==emin && !(sig&FP_INT)) fp_raise(FP_U);
    return fp_make(sig,(sign<<15)|(sig ? e+16383-(e==emin && !(sig&FP_INT)) : 0));
}
static ext80 fp_result(int sign,int e,u128 v) { return fp_round(sign,e,v,fp_precision(),-16382,16383); }
static ext80 fp_add(ext80 a,ext80 b) {
    X.fpu.status &= ~FP_C1;
    a=fp_operand(a); b=fp_operand(b);
    if(fp_isnan(a))return a;if(fp_isnan(b))return b;
    if(fp_inf(a)||fp_inf(b)) {
        if(fp_inf(a)&&fp_inf(b)&&fp_sign(a)!=fp_sign(b)){fp_raise(FP_I);return fp_nan();}
        return fp_inf(a)?a:b;
    }
    uint64_t sa,sb;int ea,eb;fp_unpack(a,&sa,&ea);fp_unpack(b,&sb,&eb);
    if(ea<eb){ext80 t=a;a=b;b=t;uint64_t s=sa;sa=sb;sb=s;int e=ea;ea=eb;eb=e;}
    u128 va=(u128)sa<<63,vb=fp_jam((u128)sb<<63,(unsigned)(ea-eb));
    int sign=fp_sign(a);u128 v;
    if(sign==fp_sign(b))v=va+vb;
    else if(va>=vb)v=va-vb;else{v=vb-va;sign=fp_sign(b);}
    if(!v)sign=fp_zero(a)&&fp_zero(b)&&fp_sign(a)==fp_sign(b)?fp_sign(a):((X.fpu.control>>10)&3)==1;
    return fp_result(sign,ea,v);
}
static ext80 fp_neg(ext80 a) { a.se^=0x8000;return a; }
static ext80 fp_mul(ext80 a,ext80 b) {
    X.fpu.status &= ~FP_C1;
    a=fp_operand(a);b=fp_operand(b);int sign=fp_sign(a)^fp_sign(b);
    if(fp_isnan(a))return a;if(fp_isnan(b))return b;
    if((fp_inf(a)&&fp_zero(b))||(fp_inf(b)&&fp_zero(a))){fp_raise(FP_I);return fp_nan();}
    if(fp_inf(a)||fp_inf(b))return fp_make(FP_INT,(sign<<15)|0x7fff);
    uint64_t sa,sb;int ea,eb;fp_unpack(a,&sa,&ea);fp_unpack(b,&sb,&eb);
    return fp_result(sign,ea+eb,(u128)sa*sb);
}
static ext80 fp_div(ext80 a,ext80 b) {
    X.fpu.status &= ~FP_C1;
    a=fp_operand(a);b=fp_operand(b);int sign=fp_sign(a)^fp_sign(b);
    if(fp_isnan(a))return a;if(fp_isnan(b))return b;
    if((fp_inf(a)&&fp_inf(b))||(fp_zero(a)&&fp_zero(b))){fp_raise(FP_I);return fp_nan();}
    if(fp_inf(a))return fp_make(FP_INT,(sign<<15)|0x7fff);
    if(fp_inf(b)||fp_zero(a))return fp_make(0,sign<<15);
    if(fp_zero(b)){fp_raise(FP_Z);return fp_make(FP_INT,(sign<<15)|0x7fff);}
    uint64_t sa,sb;int ea,eb;fp_unpack(a,&sa,&ea);fp_unpack(b,&sb,&eb);
    u128 rem=sa,q=0;int e=ea-eb;
    if(sa<sb){rem<<=1;e--;}
    for(int k=126;k>=0;k--){if(rem>=sb){rem-=sb;q|=(u128)1<<k;}rem<<=1;}
    return fp_result(sign,e,q|(rem!=0));
}
static ext80 fp_sqrt(ext80 a) {
    X.fpu.status &= ~FP_C1;
    a=fp_operand(a);if(fp_isnan(a)||fp_zero(a))return a;
    if(fp_sign(a)){fp_raise(FP_I);return fp_nan();}if(fp_inf(a))return a;
    uint64_t s;int e;fp_unpack(a,&s,&e);int odd=e&1, exp=(e-odd)/2;
    /* Integer square root of s << (69+odd), streamed as 67 bit-pairs.
     * Three guard bits plus a sticky exact remainder suffice for ext80. */
    u128 rem=0,q=0;
    for(int i=66;i>=0;i--){
        unsigned pair=0;
        for(int j=0;j<2;j++){int bit=2*i+j-(69+odd);if(bit>=0&&bit<64)pair|=(unsigned)((s>>bit)&1)<<j;}
        rem=(rem<<2)|pair;q<<=1;u128 trial=(q<<1)|1;
        if(rem>=trial){rem-=trial;q++;}
    }
    return fp_result(0,exp,(q<<60)|(rem!=0));
}
/* -1/0/1, or 2 for unordered; exact signed-zero and ext80 comparison. */
static int fp_compare(ext80 a,ext80 b,int quiet) {
    a=fp_operand(a);b=fp_operand(b);
    if(fp_isnan(a)||fp_isnan(b)){if(!quiet)fp_raise(FP_I);return 2;}
    if(fp_zero(a)&&fp_zero(b))return 0;
    if(fp_zero(a))return fp_sign(b)?1:-1;
    if(fp_zero(b))return fp_sign(a)?-1:1;
    if(fp_sign(a)!=fp_sign(b))return fp_sign(a)?-1:1;
    uint64_t sa,sb;int ea,eb;fp_unpack(a,&sa,&ea);fp_unpack(b,&sb,&eb);
    int c=ea<eb?-1:ea>eb?1:sa<sb?-1:sa>sb?1:0;
    return fp_sign(a)?-c:c;
}
static ext80 fp_from_int(int64_t n) {
    int sign=n<0;uint64_t s=sign?0-(uint64_t)n:(uint64_t)n;
    if(!s)return fp_make(0,0);int e=63;
    while(!(s&FP_INT)){s<<=1;e--;}
    return fp_make(s,(sign<<15)|(e+16383));
}
static ext80 fp_from_double(double d) {
    uint64_t u;__builtin_memcpy(&u,&d,8);int sign=u>>63,e=(int)(u>>52)&2047;
    uint64_t s=u&0xfffffffffffffull;
    if(e==2047)return fp_make(FP_INT|(s<<11),(sign<<15)|0x7fff);
    if(!e){if(!s)return fp_make(0,sign<<15);e=1;while(!(s&(1ull<<52))){s<<=1;e--;}}
    return fp_make((s|(1ull<<52))<<11,(sign<<15)|((int)e-1023+16383));
}
static uint64_t fp_ieee(ext80 a,unsigned p,int emin,int emax,int bias) {
    a=fp_operand(a);unsigned sign=fp_sign(a),bits=p==24?32:64,frac=p-1;
    uint64_t inf=p==24?0x7f800000ull:0x7ff0000000000000ull;
    if(fp_isnan(a))return ((uint64_t)sign<<(bits-1))|inf|(1ull<<(frac-1))|((a.sig>>(64-p))&((1ull<<frac)-1));
    if(fp_inf(a))return ((uint64_t)sign<<(bits-1))|inf;
    uint64_t s;int e;fp_unpack(a,&s,&e);ext80 r=fp_round(sign,e,(u128)s<<63,p,emin,emax);
    if(fp_inf(r))return ((uint64_t)sign<<(bits-1))|inf;
    unsigned ex=fp_exp(r)?(unsigned)((fp_exp(r)-16383)+bias):0;
    if(!(r.sig&FP_INT))ex=0;
    return ((uint64_t)sign<<(bits-1))|((uint64_t)ex<<frac)|((r.sig>>(64-p))&((1ull<<frac)-1));
}
/* Transcendental bridge only: conversion intentionally uses nearest binary64,
 * without changing guest control/status; exact arithmetic never uses this path. */
static double fp_double(ext80 a) {
    uint16_t cw=X.fpu.control,sw=X.fpu.status;X.fpu.control=0x37f;
    uint64_t u=fp_ieee(a,53,-1022,1023,1023);X.fpu.control=cw;X.fpu.status=sw;
    double d;__builtin_memcpy(&d,&u,8);return d;
}
static ext80 fp_integer(ext80 a,int truncate) {
    X.fpu.status &= ~FP_C1;
    a=fp_operand(a);if(fp_isnan(a)||fp_inf(a)||fp_zero(a))return a;
    uint64_t s;int e;fp_unpack(a,&s,&e);if(e>=63)return a;
    unsigned shift=e<0?64:(unsigned)(63-e);uint64_t q=shift==64?0:s>>shift;
    uint64_t lost=shift==64?s:s&((1ull<<shift)-1);
    unsigned rc=truncate?3:(X.fpu.control>>10)&3;
    int up=lost&&(rc==0?(e==-1?s>FP_INT:e>=0&&(lost>(1ull<<(shift-1))||(lost==(1ull<<(shift-1))&&(q&1)))):rc==1?fp_sign(a):rc==2?!fp_sign(a):0);
    X.fpu.status&=~FP_C1;if(up){q++;X.fpu.status|=FP_C1;}if(lost)fp_raise(FP_P);
    if(!q)return fp_make(0,fp_sign(a)<<15);
    ext80 r=fp_from_int((int64_t)q);r.se=(r.se&0x7fff)|(a.se&0x8000);return r;
}
#endif
