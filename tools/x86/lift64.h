/* AMD64 lifter: predecoded shared semantics, explicit native C basic-block edges. MIT.
 * Every function has an entry dispatcher for SEH/longjmp landing pads. No guest decode loop
 * is embedded in lifted code; fallback is counted only when a target truly is not lifted. */
static void lift64(FILE *o,an_t *a,const char *name,lift_stats_t *st) {
    fprintf(o,"/* GENERATED AMD64 lifted functions. Shared semantics: x86_exec64. */\n#include \"x86_lift.h\"\n#include \"bgt.h\"\n");
    vec_t order={0};
    for(uint32_t i=0;i<a->nf;i++) {if(lift_selected(a->f[i].addr))vpush(&order,a->f[i].addr);}
    vsort_uniq(&order);
    for(uint32_t i=0;i<a->nf;i++) {
        func_t *f=&a->f[i];if(!lift_selected(f->addr))continue;
        fprintf(o,"\nvoid F_%08x(void) {\n bgt_coverage_entry(0x%08xu,1);\n dispatch: switch(X.eip) {\n",f->addr,f->addr);
        for(uint32_t k=0;k<f->insns.n;k++)fprintf(o," case 0x%08xu: goto L_%08x;\n",f->insns.v[k],f->insns.v[k]);
        fprintf(o," default: return; }\n");
        for(uint32_t k=0;k<f->insns.n;k++) {
            uint32_t va=f->insns.v[k];x86_insn_t in;
            fprintf(o,"L_%08x:;\n",va);
            if(!decode_at(a->pe,va,&in)){fprintf(o,"x86_fault(\"undecodable AMD64 instruction\",0x%08xu);\n",va);continue;}
            fprintf(o,"{ static const x86_insn_t I = ");emit_insn_struct(o,&in);fprintf(o,"; x86_exec_one(&I); }\n");st->generic++;
            if(in.op==XO_RET){fprintf(o,"return;\n");continue;}
            if(in.op==XO_CALL||in.op==XO_CALL_IND){fprintf(o,"x86_invoke(X.eip,0x%08xu); if(X.transfer)return;\n",va+in.len);}
            if(in.flags&(X86_F_BRANCH|X86_F_INDIRECT)){fprintf(o,"goto dispatch;\n");continue;}
            if(k+1<f->insns.n&&f->insns.v[k+1]==va+in.len)fprintf(o,"goto L_%08x;\n",va+in.len);
            else fprintf(o,"goto dispatch;\n");
        }
        fprintf(o,"}\n");
        for(uint32_t j=0;j<f->nij;j++)if(!f->ij[j].resolved)st->unresolved++;
    }
    fprintf(o,"const x86_lifted_entry_t x86_lifted_%s[] = {\n",name);
    for(uint32_t i=0;i<order.n;i++){func_t *f=&a->f[func_index(a,order.v[i])];fprintf(o,"{0x%08xu,F_%08x,0x%08xu},\n",f->addr,f->addr,f->end);}
    fprintf(o,"};\nconst uint32_t x86_lifted_%s_count=%u;\n",name,order.n);free(order.v);
}
