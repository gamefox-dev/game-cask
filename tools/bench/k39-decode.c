/* Original CC0-1.0. Bench-only decoded census; no production tool command. */
#define main k39_unused_main
#include "../x86/x86tool.c"
#undef main
int main(int argc, char **argv) {
    if(argc!=2)return 2;
    FILE *f=fopen(argv[1],"rb");if(!f)return 2;
    fseek(f,0,SEEK_END);long len=ftell(f);rewind(f);
    uint8_t *d=malloc((size_t)len);if(fread(d,1,(size_t)len,f)!=(size_t)len)return 2;fclose(f);
    pe_t pe;pe_load(&pe,d,(uint32_t)len,0x01000000);free(d);
    an_t a={0};a.pe=&pe;analyze_all(&a);
    puts("[");int comma=0;
    for(uint32_t j=0;j<a.nf;j++)for(uint32_t k=0;k<a.f[j].insns.n;k++) {
        x86_insn_t in;decode_at(&pe,a.f[j].insns.v[k],&in);char txt[160];x86_format(&in,txt,sizeof txt);
        unsigned unwind_flags=0;
        for(uint32_t off=0;off+12<=pe.dd_size[3];off+=12){
            uint32_t pos=pe.dd_rva[3]+off;
            if((uint64_t)pos+12>pe.size)return 2;
            uint32_t begin=pe.base+r32(pe.img+pos),end=pe.base+r32(pe.img+pos+4),unwind=r32(pe.img+pos+8);
            if(in.addr>=begin && in.addr<end){if((uint64_t)unwind+4>pe.size)return 2;unwind_flags=pe.img[unwind]>>3;}
        }
        printf("%s{\"owner\":%u,\"address\":%u,\"unwindFlags\":%u,\"simdOp\":%u,\"simdPrefix\":%u,\"text\":\"%s\",\"op\":%u,\"size\":%u,\"operands\":[",comma?",":"",a.f[j].addr,in.addr,unwind_flags,in.simd_op,in.simd_prefix,txt,in.op,in.osz);comma=1;
        for(int p=0;p<in.nops;p++){x86_opnd_t *v=&in.o[p];printf("%s{\"kind\":%u,\"size\":%u,\"reg\":%u,\"base\":%u,\"index\":%u,\"pad\":%u,\"seg\":%u,\"disp\":%d}",p?",":"",v->kind,v->size,v->reg,v->base,v->index,v->pad,v->seg_fs,v->disp);}
        printf("]}");
    }
    puts("]");return 0;
}
