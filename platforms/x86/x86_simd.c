/* Baseline SSE/SSE2 exact-width scalar implementation, no host SIMD alignment assumptions. MIT. */
#include "x86_sem64.h"
#if defined(X86_FLAT_GUEST) || defined(X86_WIDE_CPU)
static x86_vec_t loadv(const x86_opnd_t *o,int bytes) {
    x86_vec_t v={0};if(o->kind==XK_XMM)return X.xmm[o->reg];uint32_t p=x64_ea(o);for(int i=0;i<bytes;i++)v.u8[i]=(uint8_t)x86_rd8(p+(uint32_t)i);return v;
}
static void storev(const x86_opnd_t *o,x86_vec_t v,int bytes) {
    if(o->kind==XK_XMM){X.xmm[o->reg]=v;return;}uint32_t p=x64_ea(o);for(int i=0;i<bytes;i++)x86_wr8(p+(uint32_t)i,v.u8[i]);
}
static double nearest_even(double x){if(!(x<4503599627370496.0&&x>-4503599627370496.0))return x;double lo=__builtin_floor(x),delta=x-lo;if(delta<0.5)return lo;if(delta>0.5)return lo+1;return ((int64_t)lo&1)?lo+1:lo;}
static int64_t convert_int(double x,int bits,int trunc) {
    if(!trunc){int mode=(X.mxcsr>>13)&3;x=mode==0?nearest_even(x):mode==1?__builtin_floor(x):mode==2?__builtin_ceil(x):__builtin_trunc(x);}
    double lo=bits==64?-9223372036854775808.0:-2147483648.0,hi=bits==64?9223372036854775808.0:2147483648.0;
    if(!(x>=lo&&x<hi))return bits==64?INT64_MIN:INT32_MIN;
    return (int64_t)x;
}
static int64_t clamp_signed(int64_t x,int bits){int64_t lo=-(1ll<<(bits-1)),hi=(1ll<<(bits-1))-1;return x<lo?lo:x>hi?hi:x;}
static uint64_t clamp_unsigned(int64_t x,int bits){uint64_t hi=(1ull<<bits)-1;return x<0?0:(uint64_t)x>hi?hi:(uint64_t)x;}
static uint64_t lane(x86_vec_t v,int i,int bytes){return bytes==1?v.u8[i]:bytes==2?v.u16[i]:bytes==4?v.u32[i]:v.u64[i];}
static int64_t slane(x86_vec_t v,int i,int bytes){return bytes==1?v.i8[i]:bytes==2?v.i16[i]:bytes==4?v.i32[i]:v.i64[i];}
static void setlane(x86_vec_t *v,int i,int bytes,uint64_t x){if(bytes==1)v->u8[i]=(uint8_t)x;else if(bytes==2)v->u16[i]=(uint16_t)x;else if(bytes==4)v->u32[i]=(uint32_t)x;else v->u64[i]=x;}
void x86_simd(const x86_insn_t *in) {
    unsigned op=in->simd_op,prefix=in->simd_prefix;int scalar=prefix==0xf2||prefix==0xf3,dbl=prefix==0x66||prefix==0xf2,bytes=dbl?8:4,n=scalar?1:16/bytes;
    const x86_opnd_t *a=&in->o[0],*b=&in->o[1];x86_vec_t av=X.xmm[a->reg],bv={0},r=av;
    if(op==0xae){unsigned group=a->reg&7;if(group==2){X.mxcsr=(uint32_t)x64_load(x64_ea(b),4);return;}if(group==3){x64_store(x64_ea(b),X.mxcsr,4);return;}if(group>=5)return;x86_fault("unsupported FXSAVE/XSAVE instruction",in->addr);}
    if(op==0x6e || op==0x2a){x86_opnd_t g=*b;if(g.kind==XK_XMM)g.kind=XK_REG;g.size=(in->rex&8)?8:4;uint64_t v=x64_read(&g);
        if(op==0x6e){r=(x86_vec_t){0};r.u64[0]=v;}else if(dbl)r.f64[0]=(double)(int64_t)x64_sext(v,g.size);else r.f32[0]=(float)(int64_t)x64_sext(v,g.size);X.xmm[a->reg]=r;return;}
    if(op==0x7e && prefix!=0xf3){x86_opnd_t g=*b;if(g.kind==XK_XMM)g.kind=XK_REG;g.size=(in->rex&8)?8:4;x64_write(&g,av.u64[0]);return;}
    if(op==0xd6 && prefix==0x66){bv=av;bv.u64[1]=0;storev(b,bv,8);return;}
    if(op==0x2c || op==0x2d){bv=loadv(b,bytes);x64_set(a->reg,(in->rex&8)?8:4,(uint64_t)convert_int(dbl?bv.f64[0]:bv.f32[0],(in->rex&8)?64:32,op==0x2c));return;}
    if(op==0x50){bv=loadv(b,16);uint32_t mask=0;for(int i=0;i<16/bytes;i++)mask|=(uint32_t)(lane(bv,i,bytes)>>(bytes*8-1))<<i;x64_set(a->reg,4,mask);return;}
    if(op==0xd7){bv=loadv(b,16);uint32_t mask=0;for(int i=0;i<16;i++)mask|=(bv.u8[i]>>7)<<i;x64_set(a->reg,4,mask);return;}
    if(op==0xc5){bv=loadv(b,16);x64_set(a->reg,4,bv.u16[in->simd_imm&7]);return;}
    if(op==0xc4){x86_opnd_t g=*b;if(g.kind==XK_XMM)g.kind=XK_REG;g.size=2;r.u16[in->simd_imm&7]=(uint16_t)x64_read(&g);X.xmm[a->reg]=r;return;}
    if(op==0x11 || op==0x29 || op==0x7f || op==0x2b || op==0xe7){int count=(op==0x11&&scalar)?bytes:16;if(b->kind==XK_XMM&&scalar){bv=X.xmm[b->reg];__builtin_memcpy(&bv,&av,(uint32_t)count);storev(b,bv,16);}else storev(b,av,count);return;}
    if(op==0x13 || op==0x17){bv=(x86_vec_t){0};bv.u64[0]=av.u64[op==0x17];storev(b,bv,8);return;}
    if(op==0x12 || op==0x16){bv=loadv(b,8);r.u64[op==0x16]=b->kind==XK_XMM?(op==0x12?bv.u64[1]:bv.u64[0]):bv.u64[0];X.xmm[a->reg]=r;return;}
    if(op==0x71 || op==0x72 || op==0x73){int width=op==0x71?2:op==0x72?4:8;unsigned group=a->reg&7,count=in->simd_imm;bv=loadv(b,16);r=bv;
        if(op==0x73&&(group==3||group==7)){r=(x86_vec_t){0};if(count<16)for(int i=0;i<16;i++){int src=group==3?i+(int)count:i-(int)count;if(src>=0&&src<16)r.u8[i]=bv.u8[src];}}
        else for(int i=0;i<16/width;i++){uint64_t v=lane(bv,i,width),out=0;if(group==2)out=count>=(unsigned)width*8?0:v>>count;else if(group==6)out=count>=(unsigned)width*8?0:v<<count;else if(group==4)out=(uint64_t)(slane(bv,i,width)>>(count>=(unsigned)width*8?width*8-1:count));else x86_fault("unsupported SSE shift group",in->addr);setlane(&r,i,width,out);}
        X.xmm[b->reg]=r;return;
    }
    int readbytes=(op==0x10&&scalar)||(op>=0x2e&&op<=0x2f)?bytes:(op==0x7e?8:scalar&&op>=0x51&&op<=0x5f?bytes:16);
    if((op==0x5a&&prefix==0)||(op==0xe6&&prefix==0xf3))readbytes=8;
    bv=loadv(b,readbytes);
    if(op==0x10 || op==0x28 || op==0x6f || op==0x7e){if(op==0x7e){r=(x86_vec_t){0};r.u64[0]=bv.u64[0];}else if(op==0x10&&scalar){if(b->kind==XK_MEM)r=(x86_vec_t){0};__builtin_memcpy(&r,&bv,(uint32_t)bytes);}else r=bv;X.xmm[a->reg]=r;return;}
    if(op==0x2e || op==0x2f){double x=dbl?av.f64[0]:av.f32[0],y=dbl?bv.f64[0]:bv.f32[0];X.flags&=~(F_OF|F_SF|F_AF|F_ZF|F_PF|F_CF);if(x!=x||y!=y)X.flags|=F_ZF|F_PF|F_CF;else if(x==y)X.flags|=F_ZF;else if(x<y)X.flags|=F_CF;return;}
    if((op>=0x51&&op<=0x53)||(op>=0x58&&op<=0x5f)||op==0xc2){
        if(op==0x5a){if(prefix==0xf3)r.f64[0]=bv.f32[0];else if(prefix==0xf2)r.f32[0]=(float)bv.f64[0];else if(prefix==0x66){r=(x86_vec_t){0};r.f32[0]=(float)bv.f64[0];r.f32[1]=(float)bv.f64[1];}else{r.f64[0]=bv.f32[0];r.f64[1]=bv.f32[1];}X.xmm[a->reg]=r;return;}
        if(op==0x5b){for(int i=0;i<4;i++){if(prefix==0)r.f32[i]=(float)bv.i32[i];else r.i32[i]=(int32_t)convert_int(bv.f32[i],32,prefix==0xf3);}X.xmm[a->reg]=r;return;}
        for(int i=0;i<n;i++){
            double x=dbl?av.f64[i]:av.f32[i],y=dbl?bv.f64[i]:bv.f32[i],v=0;
            if(op==0xc2){int unordered=x!=x||y!=y,p=in->simd_imm&7;int on=p==0?x==y:p==1?x<y:p==2?x<=y:p==3?unordered:p==4?x!=y:p==5?!(x<y):p==6?!(x<=y):!unordered;setlane(&r,i,bytes,on?UINT64_MAX:0);continue;}
            switch(op){case 0x51:v=__builtin_sqrt(y);break;case 0x52:v=1.0/__builtin_sqrt(y);break;case 0x53:v=1.0/y;break;case 0x58:v=x+y;break;case 0x59:v=x*y;break;case 0x5c:v=x-y;break;case 0x5d:v=x<y?x:y;break;case 0x5e:v=x/y;break;case 0x5f:v=x>y?x:y;break;default:x86_fault("unsupported SSE arithmetic",in->addr);}
            if(dbl)r.f64[i]=v;else r.f32[i]=(float)v;
        }X.xmm[a->reg]=r;return;
    }
    if(op==0x54||op==0x55||op==0x56||op==0x57||op==0xdb||op==0xdf||op==0xeb||op==0xef){for(int i=0;i<2;i++)r.u64[i]=(op==0x54||op==0xdb)?av.u64[i]&bv.u64[i]:(op==0x55||op==0xdf)?~av.u64[i]&bv.u64[i]:(op==0x56||op==0xeb)?av.u64[i]|bv.u64[i]:av.u64[i]^bv.u64[i];X.xmm[a->reg]=r;return;}
    if(op==0xc6){unsigned k=in->simd_imm;if(dbl){r.u64[0]=av.u64[k&1];r.u64[1]=bv.u64[(k>>1)&1];}else{r.u32[0]=av.u32[k&3];r.u32[1]=av.u32[(k>>2)&3];r.u32[2]=bv.u32[(k>>4)&3];r.u32[3]=bv.u32[(k>>6)&3];}X.xmm[a->reg]=r;return;}
    if(op==0x70){r=bv;unsigned k=in->simd_imm;if(prefix==0x66)for(int i=0;i<4;i++)r.u32[i]=bv.u32[(k>>(i*2))&3];else{int base=prefix==0xf3?4:0;for(int i=0;i<4;i++)r.u16[base+i]=bv.u16[base+((k>>(i*2))&3)];}X.xmm[a->reg]=r;return;}
    if(op==0x14 || op==0x15 || (op>=0x60&&op<=0x62)||(op>=0x68&&op<=0x6a)||op==0x6c||op==0x6d){int width=op<=0x15?bytes:op==0x6c||op==0x6d?8:1<<((op&7)%3),high=op==0x15||(op>=0x68&&op<=0x6a)||op==0x6d;int count=16/width,base=high?count/2:0;for(int i=0;i<count/2;i++){setlane(&r,2*i,width,lane(av,base+i,width));setlane(&r,2*i+1,width,lane(bv,base+i,width));}X.xmm[a->reg]=r;return;}
    if(op==0x63||op==0x67||op==0x6b){int out=op==0x6b?2:1,src=out*2,count=16/src;for(int i=0;i<count*2;i++){int64_t v=slane(i<count?av:bv,i%count,src);setlane(&r,i,out,op==0x67?clamp_unsigned(v,out*8):(uint64_t)clamp_signed(v,out*8));}X.xmm[a->reg]=r;return;}
    if(op==0xe6){r=(x86_vec_t){0};if(prefix==0xf3){r.f64[0]=bv.i32[0];r.f64[1]=bv.i32[1];}else{r.i32[0]=(int32_t)convert_int(bv.f64[0],32,prefix==0x66);r.i32[1]=(int32_t)convert_int(bv.f64[1],32,prefix==0x66);}X.xmm[a->reg]=r;return;}
    if(op==0xf7){for(int i=0;i<16;i++)if(bv.u8[i]&128)x86_wr8(x86_address(X.r[EDI]+(uint32_t)i),av.u8[i]);return;}
    int width=0,action=0;
    switch(op){case 0xfc:width=1;action=1;break;case 0xfd:width=2;action=1;break;case 0xfe:width=4;action=1;break;case 0xd4:width=8;action=1;break;
    case 0xf8:width=1;action=2;break;case 0xf9:width=2;action=2;break;case 0xfa:width=4;action=2;break;case 0xfb:width=8;action=2;break;
    case 0x74:width=1;action=3;break;case 0x75:width=2;action=3;break;case 0x76:width=4;action=3;break;
    case 0x64:width=1;action=4;break;case 0x65:width=2;action=4;break;case 0x66:width=4;action=4;break;
    case 0xdc:width=1;action=5;break;case 0xdd:width=2;action=5;break;case 0xec:width=1;action=6;break;case 0xed:width=2;action=6;break;
    case 0xd8:width=1;action=7;break;case 0xd9:width=2;action=7;break;case 0xe8:width=1;action=8;break;case 0xe9:width=2;action=8;break;
    case 0xda:width=1;action=9;break;case 0xea:width=2;action=9;break;case 0xde:width=1;action=10;break;case 0xee:width=2;action=10;break;
    case 0xe0:width=1;action=11;break;case 0xe3:width=2;action=11;break;case 0xd5:width=2;action=12;break;case 0xe4:width=2;action=13;break;case 0xe5:width=2;action=14;break;
    case 0xd1:case 0xe1:case 0xf1:width=2;action=15;break;case 0xd2:case 0xe2:case 0xf2:width=4;action=15;break;case 0xd3:case 0xf3:width=8;action=15;break;
    }
    if(action){for(int i=0;i<16/width;i++){uint64_t x=lane(av,i,width),y=lane(bv,i,width),v=0;int64_t sx=slane(av,i,width),sy=slane(bv,i,width);
        switch(action){case 1:v=x+y;break;case 2:v=x-y;break;case 3:v=x==y?UINT64_MAX:0;break;case 4:v=sx>sy?UINT64_MAX:0;break;case 5:v=clamp_unsigned((int64_t)(x+y),width*8);break;case 6:v=(uint64_t)clamp_signed(sx+sy,width*8);break;case 7:v=x<y?0:x-y;break;case 8:v=(uint64_t)clamp_signed(sx-sy,width*8);break;case 9:v=width==1?(x<y?x:y):(uint64_t)(sx<sy?sx:sy);break;case 10:v=width==1?(x>y?x:y):(uint64_t)(sx>sy?sx:sy);break;case 11:v=(x+y+1)>>1;break;case 12:v=x*y;break;case 13:v=(x*y)>>16;break;case 14:v=(uint64_t)((sx*sy)>>16);break;case 15:{uint64_t count=bv.u64[0];if(op>=0xf1)v=count>=(uint64_t)width*8?0:x<<count;else if(op==0xe1||op==0xe2)v=(uint64_t)(sx>>(count>=(uint64_t)width*8?width*8-1:count));else v=count>=(uint64_t)width*8?0:x>>count;break;}}
        setlane(&r,i,width,v);}X.xmm[a->reg]=r;return;}
    if(op==0xf4){r.u64[0]=(uint64_t)av.u32[0]*bv.u32[0];r.u64[1]=(uint64_t)av.u32[2]*bv.u32[2];X.xmm[a->reg]=r;return;}
    if(op==0xf5){for(int i=0;i<4;i++)r.u32[i]=(uint32_t)((int64_t)av.i16[2*i]*bv.i16[2*i]+(int64_t)av.i16[2*i+1]*bv.i16[2*i+1]);X.xmm[a->reg]=r;return;}
    if(op==0xf6){r=(x86_vec_t){0};for(int i=0;i<16;i++){int d=(int)av.u8[i]-bv.u8[i];r.u64[i/8]+=(uint64_t)(d<0?-d:d);}X.xmm[a->reg]=r;return;}
    x86_fault("unsupported SSE/SSE2 operation",in->addr);
}
#else
void x86_simd(const x86_insn_t *in) { x86_fault("SSE semantics require the Win64 build",in->addr); }
#endif
