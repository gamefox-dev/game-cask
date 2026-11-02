/* Shared guest-allocation bridges for both CRT widths. MIT.
 * Including TU supplies CA_RETURN and CA_ERRNO(e). Host malloc is unrelated. */
static void ca_zero(uint32_t p,uint32_t n) {
    if(W32_64&&x86_host(p))__builtin_memset(x86_host(p),0,n);
    else for(uint32_t i=0;i<n;i++)x86_wr8(p+i,0);
}
static void ca_copy(uint32_t d,uint32_t s,uint32_t n) {
    if(W32_64&&x86_host(d)&&x86_host(s))__builtin_memcpy(x86_host(d),x86_host(s),n);
    else for(uint32_t i=0;i<n;i++)x86_wr8(d+i,x86_rd8(s+i));
}
static CA_RETURN c_malloc(void) {
    uint32_t p=ARG64(0)>UINT32_MAX?0:w32_heap_alloc(ARG(0),0);
    if(!p)CA_ERRNO(12);
    return p;
}
static CA_RETURN c_calloc(void) {
    uint64_t a=ARG64(0),b=ARG64(1);
    if(b&&a>UINT32_MAX/b){CA_ERRNO(12);return 0;}
    uint32_t p=w32_heap_alloc((uint32_t)(a*b),1);
    if(!p)CA_ERRNO(12);
    return p;
}
static CA_RETURN c_free(void) {w32_heap_free(ARG(0));return 0;}
static CA_RETURN c_msize(void) {
    uint32_t n=ARG64(0)>UINT32_MAX?UINT32_MAX:w32_heap_size_on(H_HEAP,ARG(0));
    if(n==UINT32_MAX){CA_ERRNO(22);return (CA_RETURN)-1;}
    return n;
}
static CA_RETURN c_realloc(void) {
    if(!ARG64(1)){w32_heap_free(ARG(0));return 0;}
    uint32_t p=ARG64(1)>UINT32_MAX||ARG64(0)>UINT32_MAX?0:w32_heap_realloc(ARG(0),ARG(1));
    if(!p)CA_ERRNO(12);
    return p;
}
static CA_RETURN c_recalloc(void) {
    uint64_t count=ARG64(1),width=ARG64(2);
    if(width&&count>UINT32_MAX/width){CA_ERRNO(12);return 0;}
    uint32_t n=(uint32_t)(count*width),a=ARG(0),old=w32_heap_size(a);
    if(!n){w32_heap_free(a);return 0;}
    uint32_t p=ARG64(0)>UINT32_MAX?0:w32_heap_realloc(a,n);
    if(!p){CA_ERRNO(12);return 0;}
    if(n>old)ca_zero(p+old,n-old);
    return p;
}
#define CA_TAG 0xa11cca5cu
#define CA_META 24u
static uint32_t ca_aligned(uint64_t n,uint64_t alignment,uint64_t offset) {
    if(!alignment||(alignment&(alignment-1))||(offset&&offset>=n)){CA_ERRNO(22);return 0;}
    if(alignment<w32_ptr_size())alignment=w32_ptr_size();
    if(n>UINT32_MAX-CA_META||alignment>UINT32_MAX-n-CA_META){CA_ERRNO(12);return 0;}
    uint32_t a=(uint32_t)alignment,off=(uint32_t)offset;
    uint32_t raw=w32_heap_alloc((uint32_t)n+a+CA_META,0);
    if(!raw){CA_ERRNO(12);return 0;}
    uint32_t q=((raw+CA_META+off+a-1)&~(a-1))-off;
    x86_wr32(q-24,CA_TAG^q);x86_wr32(q-20,raw);x86_wr32(q-16,(uint32_t)n);
    x86_wr32(q-12,a);x86_wr32(q-8,off);x86_wr32(q-4,CA_TAG^raw);
    return q;
}
static uint32_t ca_raw(uint32_t q) {
    if(q<W32_HEAP_LO+CA_META||q>=W32_HEAP_HI||!x86_pages[(q-24)>>12]||!x86_pages[(q-1)>>12])return 0;
    if(x86_rd32(q-24)!=(CA_TAG^q))return 0;
    uint32_t raw=x86_rd32(q-20);
    if(x86_rd32(q-4)!=(CA_TAG^raw)||w32_heap_size_on(H_HEAP,raw)==UINT32_MAX)return 0;
    return raw;
}
static CA_RETURN c_aligned_malloc(void) {return ca_aligned(ARG64(0),ARG64(1),0);}
static CA_RETURN c_aligned_offset_malloc(void) {return ca_aligned(ARG64(0),ARG64(1),ARG64(2));}
static CA_RETURN c_aligned_free(void) {
    if(!ARG64(0))return 0;
    uint32_t raw=ARG64(0)>UINT32_MAX?0:ca_raw(ARG(0));
    if(!raw){CA_ERRNO(22);return 0;}
    w32_heap_free(raw);return 0;
}
static CA_RETURN c_aligned_msize(void) {
    uint32_t q=ARG(0);uint64_t alignment=ARG64(1);
    int invalid=!alignment||(alignment&(alignment-1));
    if(alignment<w32_ptr_size()&&alignment)alignment=w32_ptr_size();
    if(invalid||ARG64(0)>UINT32_MAX||!ca_raw(q)||alignment!=x86_rd32(q-12)||ARG64(2)!=x86_rd32(q-8)){
        CA_ERRNO(22);return (CA_RETURN)-1;
    }
    return x86_rd32(q-16);
}
static uint32_t ca_resize(int recalloc,int offset_form) {
    uint64_t n=ARG64(1),alignment=ARG64(recalloc?3:2),off=offset_form?ARG64(recalloc?4:3):0;
    if(recalloc){uint64_t width=ARG64(2);if(width&&n>UINT32_MAX/width){CA_ERRNO(12);return 0;}n*=width;}
    uint32_t q=ARG(0),raw=0,old=0;
    if(ARG64(0)){
        raw=ARG64(0)>UINT32_MAX?0:ca_raw(q);
        if(!raw){CA_ERRNO(22);return 0;}
        old=x86_rd32(q-16);
    }
    if(!n&&raw){w32_heap_free(raw);return 0;}
    uint32_t p=ca_aligned(n,alignment,off);
    if(!p)return 0;
    if(raw)ca_copy(p,q,old<n?old:(uint32_t)n);
    if(recalloc&&n>old)ca_zero(p+old,(uint32_t)n-old);
    if(raw)w32_heap_free(raw);
    return p;
}
static CA_RETURN c_aligned_realloc(void) {return ca_resize(0,0);}
static CA_RETURN c_aligned_offset_realloc(void) {return ca_resize(0,1);}
static CA_RETURN c_aligned_recalloc(void) {return ca_resize(1,0);}
static CA_RETURN c_aligned_offset_recalloc(void) {return ca_resize(1,1);}
#undef CA_TAG
#undef CA_META
#undef CA_RETURN
#undef CA_ERRNO
