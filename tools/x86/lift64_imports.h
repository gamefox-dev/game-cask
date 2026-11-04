/* Guarded import hints, not constant folding guest memory. MIT.
 * A forward CFG join retains a slot only when every reached predecessor agrees.
 * Even a hint entered through an interior PC is checked against the real full-width
 * operand: no slot or register value is replaced by this analysis. */
static uint32_t l64_iat_operand(const pe_t *pe,const x86_opnd_t *p) {
    if(p->kind!=XK_MEM||p->size!=8||p->base!=X86_NOREG||p->index!=X86_NOREG||p->seg_fs||(p->pad&1))return 0;
    uint64_t addr=(p->pad&4)?p->imm:(p->pad&2)?(uint32_t)p->disp:(uint64_t)(int64_t)p->disp;
    const import_t *im=addr<=UINT32_MAX?import_at_iat(pe,(uint32_t)addr):0;
    return im?im->iat:0;
}
static void l64_import_transfer(const pe_t *pe,const x86_insn_t *in,uint32_t *s) {
    unsigned op=in->op;
    if(op==XO_CALL||op==XO_CALL_IND) {
        const unsigned volatile_regs[]={EAX,ECX,EDX,R8,R9,R10,R11};
        for(unsigned k=0;k<sizeof volatile_regs/sizeof volatile_regs[0];k++)s[volatile_regs[k]]=0;
        return;
    }
    if(!l64_specialized(in)||op==XO_SIMD){memset(s,0,16*sizeof *s);return;}
    if(op==XO_JMP||op==XO_JMP_IND||op==XO_JCC||op==XO_CMP||op==XO_TEST||op==XO_NOP)return;
    const x86_opnd_t *d=&in->o[0],*src=&in->o[1];
    if(op==XO_XCHG&&d->kind==XK_REG&&src->kind==XK_REG&&d->size==8&&src->size==8) {
        uint32_t t=s[d->reg];s[d->reg]=s[src->reg];s[src->reg]=t;return;
    }
    uint32_t value=op==XO_MOV&&src->kind==XK_REG&&src->size==8?s[src->reg]:
        op==XO_MOV?l64_iat_operand(pe,src):0;
    if(d->kind==XK_REG&&op!=XO_PUSH) s[d->reg>=16?d->reg-16:d->reg]=d->size==8?value:0;
    if(op==XO_XCHG&&src->kind==XK_REG)s[src->reg>=16?src->reg-16:src->reg]=0;
    if(op==XO_CWDE)s[EAX]=0;
    if(op==XO_CDQ)s[EDX]=0;
    if(op==XO_PUSH||op==XO_POP||op==XO_RET||op==XO_LEAVE)s[ESP]=0;
    if(op==XO_LEAVE)s[EBP]=0;
}
static uint32_t *l64_import_hints(const pe_t *pe,const func_t *f) {
    uint32_t n=f->insns.n,*hints=xcalloc(n?n:1,sizeof *hints);
    if(!n)return hints;
    uint32_t (*state)[16]=xcalloc(n,sizeof *state),*queue=xcalloc(n,sizeof *queue);
    uint8_t *seen=xcalloc(n,1),*queued=xcalloc(n,1);
    unsigned head=0,tail=0,count=1;queue[tail++]=0;tail%=n;seen[0]=queued[0]=1;
    while(count) {
        unsigned k=queue[head++];head%=n;count--;queued[k]=0;
        x86_insn_t in;decode_at(pe,f->insns.v[k],&in);
        uint32_t s[16];memcpy(s,state[k],sizeof s);l64_import_transfer(pe,&in,s);
        int succ[2]={-1,-1};
        if(in.op==XO_JMP||in.op==XO_JCC)succ[0]=l64_index(f,in.target);
        if(in.op!=XO_JMP&&in.op!=XO_JMP_IND&&in.op!=XO_RET&&k+1<n&&in.addr+in.len==f->insns.v[k+1])succ[1]=(int)k+1;
        for(unsigned j=0;j<2;j++)if(succ[j]>=0) {
            unsigned t=(unsigned)succ[j];int changed=!seen[t];
            for(unsigned r=0;r<16;r++) {
                uint32_t v=!seen[t]?s[r]:state[t][r]==s[r]?s[r]:0;
                changed|=v!=state[t][r];state[t][r]=v;
            }
            seen[t]=1;
            if(changed&&!queued[t]){queue[tail++]=t;tail%=n;count++;queued[t]=1;}
        }
    }
    for(unsigned k=0;k<n;k++) {
        x86_insn_t in;decode_at(pe,f->insns.v[k],&in);
        if(in.op!=XO_CALL_IND&&in.op!=XO_JMP_IND)continue;
        const x86_opnd_t *p=&in.o[0];
        hints[k]=l64_iat_operand(pe,p);
        if(!hints[k]&&seen[k]&&p->kind==XK_REG&&p->size==8)hints[k]=state[k][p->reg];
    }
    free(state);free(queue);free(seen);free(queued);return hints;
}
