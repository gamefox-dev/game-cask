/* AMD64 semantic execution, also used by predecoded lifted blocks. MIT. */
#include "x86_sem64.h"
#if defined(X86_FLAT_GUEST) || defined(X86_WIDE_CPU)
static void cpuid(void) {
    uint32_t leaf=(uint32_t)X.r[EAX];X.r[EAX]=X.r[EBX]=X.r[ECX]=X.r[EDX]=0;
    if(leaf==0){X.r[EAX]=1;X.r[EBX]=0x756e6547;X.r[EDX]=0x49656e69;X.r[ECX]=0x6c65746e;}
    else if(leaf==1){X.r[EAX]=0x00000663;X.r[EDX]=(1u<<4)|(1u<<8)|(1u<<15)|(1u<<25)|(1u<<26);}
    else if(leaf==0x80000000u)X.r[EAX]=0x80000001u;
    else if(leaf==0x80000001u)X.r[EDX]=1u<<29;
}
void x86_exec64(const x86_insn_t *in) {
    X.tsc++;
    if (++X.frame_insns > 2000000u) {
#ifdef X86_FLAT_GUEST
        X.eip = in->addr; /* LANE-C: resume before the unexecuted instruction. */
        x86_cooperate();
        if (X.transfer) return;
#else
        x86_fault("AMD64 instruction budget exhausted without yield", in->addr);
#endif
    }
    const x86_opnd_t *a=&in->o[0],*b=&in->o[1],*c=&in->o[2];int n=a->size?a->size:in->osz;uint32_t next=in->addr+in->len;X.eip=next;
    switch(in->op) {
    case XO_MOV:case XO_MOVZX:x64_write(a,x64_read(b));return;
    case XO_MOVSX:x64_write(a,x64_sext(x64_read(b),b->size));return;
    case XO_LEA:{x86_opnd_t m=*b;m.seg_fs=0;x64_write(a,x64_calc_ea(&m));return;}
    case XO_ADD:case XO_OR:case XO_ADC:case XO_SBB:case XO_AND:case XO_SUB:case XO_XOR:x64_write(a,x64_alu(in->op,x64_read(a),x64_read(b),n));return;
    case XO_CMP:case XO_TEST:x64_alu(in->op,x64_read(a),x64_read(b),n);return;
    case XO_INC:case XO_DEC:{uint32_t cf=X.flags&F_CF;x64_write(a,x64_alu(in->op==XO_INC?XO_ADD:XO_SUB,x64_read(a),1,n));X.flags=(X.flags&~F_CF)|cf;return;}
    case XO_NEG:x64_write(a,x64_alu(XO_SUB,0,x64_read(a),n));return;
    case XO_NOT:x64_write(a,~x64_read(a));return;
    case XO_ROL:case XO_ROR:case XO_RCL:case XO_RCR:case XO_SHL:case XO_SHR:case XO_SAL:case XO_SAR:x64_write(a,x64_shift(in->op,x64_read(a),(uint32_t)x64_read(b),n));return;
    case XO_IMUL:{uint64_t av=in->nops==3?x64_read(b):x64_read(a),bv=in->nops==3?x64_read(c):x64_read(b);__int128 full=(__int128)(int64_t)x64_sext(av,n)*(int64_t)x64_sext(bv,n);uint64_t r=(uint64_t)full&x64_mask(n);x64_write(a,r);int ov=full!=(__int128)(int64_t)x64_sext(r,n);xs_setf(F_CF,ov);xs_setf(F_OF,ov);return;}
    case XO_MUL:case XO_IMUL1:{uint64_t av=x64_reg(EAX,n),bv=x64_read(a),m=x64_mask(n);__uint128_t full=in->op==XO_MUL?(__uint128_t)av*bv:(__uint128_t)((__int128)(int64_t)x64_sext(av,n)*(int64_t)x64_sext(bv,n));if(n==1)x64_set(EAX,2,(uint64_t)full);else{x64_set(EAX,n,(uint64_t)full);x64_set(EDX,n,(uint64_t)(full>>(n*8)));}int ov=in->op==XO_MUL?(full>>(n*8))!=0:(__int128)full!=(__int128)(int64_t)x64_sext((uint64_t)full&m,n);xs_setf(F_CF,ov);xs_setf(F_OF,ov);return;}
    case XO_DIV:case XO_IDIV:{uint64_t v=x64_read(a);if(!v)x86_fault("divide by zero",in->addr);__uint128_t num=n==1?x64_reg(EAX,2):((__uint128_t)x64_reg(EDX,n)<<(n*8))|x64_reg(EAX,n);uint64_t q,r;
        if(in->op==XO_DIV){__uint128_t t=num/v;if(t>x64_mask(n))x86_fault("divide overflow",in->addr);q=(uint64_t)t;r=(uint64_t)(num%v);}
        else{__int128 s=n==8?(__int128)num:n==4?(int64_t)(uint64_t)num:n==2?(int32_t)(uint32_t)num:(int16_t)(uint16_t)num,d=(int64_t)x64_sext(v,n);if(d==-1 && (__uint128_t)s==((__uint128_t)1<<127))x86_fault("divide overflow",in->addr);__int128 t=s/d;if(t!=(__int128)(int64_t)x64_sext((uint64_t)t,n))x86_fault("divide overflow",in->addr);q=(uint64_t)t;r=(uint64_t)(s%d);}
        x64_set(EAX,n,q);x64_set(n==1?16:EDX,n,r);return;}
    case XO_XCHG:{uint64_t av=x64_read(a),bv=x64_read(b);x64_write(a,bv);x64_write(b,av);return;}
    case XO_XADD:{uint64_t v=x64_read(a),r=x64_alu(XO_ADD,v,x64_read(b),n);x64_write(b,v);x64_write(a,r);return;}
    case XO_CMPXCHG_PAIR:{uint32_t p=x64_ea(a);if(a->kind!=XK_MEM)x86_fault("CMPXCHG pair requires memory",in->addr);
        if(n==16){uint64_t lo=x86_rd64(p),hi=x86_rd64(p+8);int same=lo==X.r[EAX]&&hi==X.r[EDX];xs_setf(F_ZF,same);if(same){x86_wr64(p,X.r[EBX]);x86_wr64(p+8,X.r[ECX]);}else{X.r[EAX]=lo;X.r[EDX]=hi;}}
        else{uint64_t v=x86_rd64(p),cmp=((uint64_t)(uint32_t)X.r[EDX]<<32)|(uint32_t)X.r[EAX];xs_setf(F_ZF,v==cmp);if(v==cmp)x86_wr64(p,((uint64_t)(uint32_t)X.r[ECX]<<32)|(uint32_t)X.r[EBX]);else{X.r[EAX]=(uint32_t)v;X.r[EDX]=(uint32_t)(v>>32);}}return;}
    case XO_CMPXCHG:{uint64_t v=x64_read(a);x64_alu(XO_CMP,x64_reg(EAX,n),v,n);if(X.flags&F_ZF)x64_write(a,x64_read(b));else x64_set(EAX,n,v);return;}
    case XO_PUSH:{uint64_t v=x64_read(a);if(n==2){X.r[ESP]-=2;x86_wr16((uint32_t)X.r[ESP],(uint32_t)v);}else x86_push(v);return;}
    case XO_POP:{uint64_t v;if(n==2){v=x86_rd16((uint32_t)X.r[ESP]);X.r[ESP]+=2;}else v=x86_pop();x64_write(a,v);return;}
    case XO_PUSHF:x86_push(X.flags|2);return;case XO_POPF:X.flags=(uint32_t)x86_pop()&0xcd5;return;
    case XO_SAHF:X.flags=(X.flags&~0xd5u)|((uint32_t)(X.r[EAX]>>8)&0xd5);return;
    case XO_LAHF:x64_set(16,1,(X.flags&0xd5)|2);return;
    case XO_CWDE:x64_set(EAX,in->osz,x64_sext(x64_reg(EAX,in->osz/2),in->osz/2));return;
    case XO_CDQ:x64_set(EDX,in->osz,(X.r[EAX]&(1ull<<(in->osz*8-1)))?x64_mask(in->osz):0);return;
    case XO_CMOVCC:{uint64_t v=x64_read(b);if(xs_cond(in->cc))x64_write(a,v);return;}
    case XO_SETCC:x64_write(a,(uint64_t)xs_cond(in->cc));return;
    case XO_BSWAP:x64_write(a,n==8?__builtin_bswap64(x64_read(a)):__builtin_bswap32((uint32_t)x64_read(a)));return;
    case XO_BT:case XO_BTS:case XO_BTR:case XO_BTC:{uint64_t bit=x64_read(b);x86_opnd_t m=*a;if(a->kind==XK_MEM && b->kind==XK_REG)m.disp+=(int32_t)(((int64_t)bit>>(n==8?6:5))*n);uint64_t v=x64_read(&m),mask=1ull<<(bit&(n*8-1));xs_setf(F_CF,!!(v&mask));if(in->op!=XO_BT){v=in->op==XO_BTS?v|mask:in->op==XO_BTR?v&~mask:v^mask;x64_write(&m,v);}return;}
    case XO_BSF:case XO_BSR:{uint64_t v=x64_read(b);xs_setf(F_ZF,!v);if(v)x64_write(a,in->op==XO_BSF?__builtin_ctzll(v):63-__builtin_clzll(v));return;}
    case XO_SHLD:case XO_SHRD:{uint32_t count=(uint32_t)x64_read(c)&(n==8?63:31);if(!count)return;uint64_t av=x64_read(a),bv=x64_read(b);int bits=n*8;uint64_t r=in->op==XO_SHLD?(av<<count)|(bv>>(bits-count)):(av>>count)|(bv<<(bits-count));xs_setf(F_CF,in->op==XO_SHLD?(av>>(bits-count))&1:(av>>(count-1))&1);if(count==1)xs_setf(F_OF,!!((av^r)&(1ull<<(bits-1))));x64_szp(r,n);x64_write(a,r);return;}
    case XO_MOVS: case XO_STOS: case XO_LODS: case XO_CMPS: case XO_SCAS:
        xs_string(in->op, n, in->rep, in->asz, in->addr, next, a->seg_fs); return;
    case XO_CLC:X.flags&=~F_CF;return;case XO_STC:X.flags|=F_CF;return;case XO_CMC:X.flags^=F_CF;return;case XO_CLD:X.flags&=~F_DF;return;case XO_STD:X.flags|=F_DF;return;
    case XO_LEAVE:X.r[ESP]=X.r[EBP];X.r[EBP]=x86_pop();return;
    case XO_NOP:return;
    case XO_JCC:if(xs_cond(in->cc))X.eip=in->target;return;
    case XO_JMP:X.eip=in->target;return;case XO_JMP_IND:X.eip=x86_address(x64_read(a));return;
    case XO_CALL:x86_push(next);X.eip=in->target;return;case XO_CALL_IND:{uint64_t t=x64_read(a);x86_push(next);X.eip=x86_address(t);return;}
    case XO_RET:X.eip=x86_address(x86_pop());X.r[ESP]+=a->imm;return;
    case XO_LOOP:case XO_LOOPE:case XO_LOOPNE:X.r[ECX]--;if(in->asz==4)X.r[ECX]=(uint32_t)X.r[ECX];if(X.r[ECX]&&(in->op==XO_LOOP || (in->op==XO_LOOPE?!!(X.flags&F_ZF):!(X.flags&F_ZF))))X.eip=in->target;return;
    case XO_JECXZ:if(!(in->asz==4?(uint32_t)X.r[ECX]:X.r[ECX]))X.eip=in->target;return;
    case XO_CPUID:cpuid();return;case XO_RDTSC:X.r[EAX]=(uint32_t)X.tsc;X.r[EDX]=(uint32_t)(X.tsc>>32);return;
    case XO_SIMD:x86_simd(in);return;
    case XO_FPU: x86_x87(in); return;
    default:x86_fault("unsupported AMD64 instruction",in->addr);
    }
}
#else
void x86_exec64(const x86_insn_t *in) { x86_fault("AMD64 requires the flat Win64 profile",in->addr); }
#endif
