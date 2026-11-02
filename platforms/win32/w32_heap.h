/* Deterministic two-level segregated guest heap. MIT.
 * 32-byte boundary tag: size|used, requested, previous physical size, owner slot+1,
 * free next/prev (allocated cookie/reserved), allocated owner next/prev.
 * All addresses/links are guest offsets, never host pointers. 16 sub-bins per power
 * of two; requests round UP to a bin boundary, so selection never scans a list.
 * Free eagerly coalesces both neighbours. Mapping/reservation lookup is bounded by
 * the profile's 256 virtual ranges, independent of the number of live blocks.
 * No allocation path yields, so the cooperative scheduler needs no host mutex.
 */
#define HEAP_HEADER 32u
#define HEAP_MIN 48u
#define HEAP_COUNT 256u
typedef struct { uint32_t head, flags, maximum, used, live, generation; } guest_heap_t;
static guest_heap_t guest_heaps[HEAP_COUNT] = {{.live=1}};
static uint32_t guest_heap_count = 1;
/* Each TLSF bin has four fixed sublists: offset 0,16,32,>=48 from its lower
 * bound. This permits exact quota-safe split lookup at need+48 without scanning
 * a partially suitable bin or rounding past a valid 48-byte tail. */
static uint32_t heap_bins[32][16][4],heap_category[32][16],heap_sub[32],heap_groups,heap_tail;
static uint32_t hb_size(uint32_t p) { return x86_rd32(p) & ~15u; }
static void hb_class(uint32_t n, uint32_t *l, uint32_t *s) {
    *l = 31u - (uint32_t)__builtin_clz(n);
    *s = (n >> (*l - 4u)) & 15u;
}
static uint32_t hb_need(uint32_t n) {
    uint64_t v = ((uint64_t)n + HEAP_HEADER + 15u) & ~15ull;
    if (v < HEAP_MIN) v = HEAP_MIN;
    if (v > W32_HEAP_HI - W32_HEAP_LO) return 0;
    uint32_t l = 31u - (uint32_t)__builtin_clz((uint32_t)v);
    uint32_t step = 1u << (l - 4u);
    v = (v + step - 1u) & ~(uint64_t)(step - 1u);
    return v <= W32_HEAP_HI - W32_HEAP_LO ? (uint32_t)v : 0;
}
static void hb_insert(uint32_t p) {
    uint32_t l,s; hb_class(hb_size(p),&l,&s);
    uint32_t lower=(16u+s)<<(l-4u),c=(hb_size(p)-lower)/16u;if(c>3)c=3;
    uint32_t next=heap_bins[l][s][c];
    x86_wr32(p+16,next); x86_wr32(p+20,0);
    if(next)x86_wr32(next+20,p);
    heap_bins[l][s][c]=p;heap_category[l][s]|=1u<<c;heap_sub[l]|=1u<<s;heap_groups|=1u<<l;
}
static void hb_remove(uint32_t p) {
    uint32_t l,s; hb_class(hb_size(p),&l,&s);
    uint32_t lower=(16u+s)<<(l-4u),c=(hb_size(p)-lower)/16u;if(c>3)c=3;
    uint32_t next=x86_rd32(p+16),prev=x86_rd32(p+20);
    if(prev)x86_wr32(prev+16,next);else heap_bins[l][s][c]=next;
    if(next)x86_wr32(next+20,prev);
    if(!heap_bins[l][s][c])heap_category[l][s]&=~(1u<<c);
    if(!heap_category[l][s]){heap_sub[l]&=~(1u<<s);if(!heap_sub[l])heap_groups&=~(1u<<l);}
}
static uint32_t hb_find(uint32_t need) {
    uint32_t l,s;hb_class(need,&l,&s);
    /* All callers search a class boundary or that boundary + HEAP_MIN (48),
     * so the threshold's offset in its containing bin is at most 48. */
    uint32_t lower=(16u+s)<<(l-4u),c=(need-lower+15u)/16u;
    uint32_t cats=c<=3?heap_category[l][s]&(~0u<<c):0;
    if(cats)return heap_bins[l][s][(uint32_t)__builtin_ctz(cats)];
    uint32_t bits=s==15?0:heap_sub[l]&(~0u<<(s+1));
    if(!bits){
        uint32_t groups=l==31?0:heap_groups&(~0u<<(l+1));
        if(!groups)return 0;
        l=(uint32_t)__builtin_ctz(groups);bits=heap_sub[l];
    }
    s=(uint32_t)__builtin_ctz(bits);c=(uint32_t)__builtin_ctz(heap_category[l][s]);
    return heap_bins[l][s][c];
}
static uint32_t hb_next(uint32_t p) {
    uint32_t q=p+hb_size(p);
    if(q>=heap_end)return 0;
    if(heap_skip(q)!=q)return 0;
    return x86_rd32(q+8)==hb_size(p)?q:0;
}
static void hb_follow(uint32_t p) {
    uint32_t q=p+hb_size(p);
    if(q==heap_end){heap_tail=p;return;}
    if(heap_skip(q)!=q)return;
    if(q<heap_end)x86_wr32(q+8,hb_size(p));
}
static uint32_t hb_heap(uint64_t h) {
    if(h<H_HEAP||h>UINT32_MAX)return UINT32_MAX;
    uint32_t token=(uint32_t)(h-H_HEAP),i=token&255u;
    return i<guest_heap_count&&guest_heaps[i].live&&guest_heaps[i].generation==(token>>8)?i:UINT32_MAX;
}
static uint32_t hb_block(uint32_t a, uint32_t owner) {
    if(a<W32_HEAP_LO+HEAP_HEADER||a>=heap_end||(a&15u))return 0;
    uint32_t p=a-HEAP_HEADER;
    if(!x86_pages[p>>12]||!x86_pages[(a-1)>>12])return 0;
    uint32_t size=hb_size(p);
    if(!(x86_rd32(p)&1u)||size<HEAP_MIN||(uint64_t)p+size>heap_end||
       x86_rd32(p+12)!=owner+1||x86_rd32(p+16)!=(0xc45c1234u^p^owner)||
       x86_rd32(p+4)>size-HEAP_HEADER)return 0;
    return p;
}
static void hb_zero(uint32_t p,uint32_t n) {
    if(W32_64&&x86_host(p))__builtin_memset(x86_host(p),0,n);
    else for(uint32_t i=0;i<n;i++)x86_wr8(p+i,0);
}
static void hb_copy(uint32_t d,uint32_t s,uint32_t n) {
    if(W32_64&&x86_host(d)&&x86_host(s))__builtin_memcpy(x86_host(d),x86_host(s),n);
    else for(uint32_t i=0;i<n;i++)x86_wr8(d+i,x86_rd8(s+i));
}
static void hb_split(uint32_t p,uint32_t need) {
    uint32_t size=hb_size(p),next=hb_next(p);
    if(size-need<HEAP_MIN)return;
    x86_wr32(p,need|(x86_rd32(p)&1u));
    uint32_t q=p+need;
    x86_wr32(q,size-need); x86_wr32(q+4,0); x86_wr32(q+8,need); x86_wr32(q+12,0);
    if(next&&!(x86_rd32(next)&1u)){hb_remove(next);x86_wr32(q,hb_size(q)+hb_size(next));}
    hb_follow(q); hb_insert(q);
}
static uint32_t hb_alloc(uint32_t owner,uint32_t n,int zero) {
    uint32_t need=hb_need(n); guest_heap_t *h=&guest_heaps[owner];
    if(!need)return 0;
    uint32_t p=hb_find(need),size=p?hb_size(p):need;
    if(size-need>=HEAP_MIN)size=need;
    if(h->maximum&&(uint64_t)h->used+size>h->maximum){
        if((uint64_t)h->used+need>h->maximum)return 0;
        /* Leave an unsplittable candidate available for another owner. Search
         * once more for a class guaranteed to leave a full free header/tail before
         * appending; a larger shared block may fit even when backing is exhausted. */
        p=hb_find(need+HEAP_MIN);size=need;
    }
    if(p){hb_remove(p);hb_split(p,need);size=hb_size(p);}
    else {
        p=heap_end;
        p=heap_place(p,need);
        if((uint64_t)p+need>W32_HEAP_HI||!heap_grow_to(p,p+need))return 0;
        heap_commit_skip(heap_end,p);
        x86_wr32(p+8,p==heap_end&&heap_tail?hb_size(heap_tail):0);
        heap_end=p+need;heap_tail=p;size=need;
    }
    x86_wr32(p,size|1u);x86_wr32(p+4,n);x86_wr32(p+12,owner+1);
    x86_wr32(p+16,0xc45c1234u^p^owner);
    x86_wr32(p+24,h->head);x86_wr32(p+28,0);
    if(h->head)x86_wr32(h->head+28,p);
    h->head=p;h->used+=size;
    if(zero)hb_zero(p+HEAP_HEADER,n);
    return p+HEAP_HEADER;
}
static void hb_free(uint32_t p,uint32_t owner) {
    guest_heap_t *h=&guest_heaps[owner];
    uint32_t next=x86_rd32(p+24),prev=x86_rd32(p+28);
    if(prev)x86_wr32(prev+24,next);else h->head=next;
    if(next)x86_wr32(next+28,prev);
    h->used-=hb_size(p);x86_wr32(p,hb_size(p));x86_wr32(p+4,0);x86_wr32(p+12,0);
    next=hb_next(p);
    if(next&&!(x86_rd32(next)&1u)){hb_remove(next);x86_wr32(p,hb_size(p)+hb_size(next));}
    prev=x86_rd32(p+8);
    if(prev&&!(x86_rd32(p-prev)&1u)){prev=p-prev;hb_remove(prev);x86_wr32(prev,hb_size(prev)+hb_size(p));p=prev;}
    hb_follow(p);hb_insert(p);
}
static uint32_t hb_realloc(uint32_t owner,uint32_t a,uint32_t n,int zero,int in_place) {
    uint32_t p=hb_block(a,owner),need=hb_need(n);
    if(!p||!need)return 0;
    guest_heap_t *h=&guest_heaps[owner];
    uint32_t size=hb_size(p),old=x86_rd32(p+4),next=hb_next(p),total=size;
    if(next&&!(x86_rd32(next)&1u))total+=hb_size(next);
    if(need<=total){
        uint32_t actual=total-need>=HEAP_MIN?need:total;
        /* Do not consume the following free block for a shrink that already fits. */
        if(need<=size)actual=size-need>=HEAP_MIN?need:size;
        if(h->maximum&&(uint64_t)h->used-size+actual>h->maximum)return 0;
        if(need>size){hb_remove(next);x86_wr32(p,total|1u);hb_follow(p);}
        hb_split(p,need);h->used=h->used-size+hb_size(p);
        x86_wr32(p+4,n);if(zero&&n>old)hb_zero(a+old,n-old);return a;
    }
    if(in_place)return 0;
    /* Replacing a block charges the net footprint, not both copies. */
    h->used-=size;
    uint32_t b=hb_alloc(owner,n,0);
    h->used+=size;
    if(!b)return 0;
    hb_copy(b,a,old<n?old:n);if(zero&&n>old)hb_zero(b+old,n-old);
    hb_free(p,owner);return b;
}
uint32_t w32_heap_create(uint32_t flags,uint32_t initial,uint32_t maximum) {
    if(initial>W32_HEAP_HI-W32_HEAP_LO||(maximum&&initial>maximum))return 0;
    uint32_t i=1,generation=0;
    for(;i<guest_heap_count;i++)if(!guest_heaps[i].live&&guest_heaps[i].generation<0x00fff7ffu){generation=guest_heaps[i].generation+1;break;}
    if(i==guest_heap_count){if(guest_heap_count==HEAP_COUNT)return 0;guest_heap_count++;}
    guest_heaps[i]=(guest_heap_t){0,flags,maximum,0,1,generation};return H_HEAP+(generation<<8)+i;
}
int w32_heap_destroy(uint64_t handle) {
    uint32_t i=hb_heap(handle);if(i==UINT32_MAX||!i)return 0;
    while(guest_heaps[i].head)hb_free(guest_heaps[i].head,i);
    guest_heaps[i].live=0;return 1;
}
int w32_heap_valid_handle(uint64_t handle) {return hb_heap(handle)!=UINT32_MAX;}
uint32_t w32_heap_flags(uint64_t handle) {uint32_t i=hb_heap(handle);return i==UINT32_MAX?0:guest_heaps[i].flags;}
uint32_t w32_heap_alloc_on(uint64_t handle,uint32_t n,int zero) {
    uint32_t i=hb_heap(handle);return i==UINT32_MAX?0:hb_alloc(i,n,zero);
}
int w32_heap_free_on(uint64_t handle,uint32_t a) {
    uint32_t i=hb_heap(handle);if(i==UINT32_MAX)return 0;if(!a)return 1;
    uint32_t p=hb_block(a,i);if(!p)return 0;hb_free(p,i);return 1;
}
uint32_t w32_heap_size_on(uint64_t handle,uint32_t a) {
    uint32_t i=hb_heap(handle),p=i==UINT32_MAX?0:hb_block(a,i);
    return p?x86_rd32(p+4):UINT32_MAX;
}
uint32_t w32_heap_realloc_on(uint64_t handle,uint32_t a,uint32_t n,int zero,int in_place) {
    uint32_t i=hb_heap(handle);return i==UINT32_MAX?0:hb_realloc(i,a,n,zero,in_place);
}
uint32_t w32_heap_alloc(uint32_t n,int zero) {return hb_alloc(0,n,zero);}
void w32_heap_free(uint32_t a) {(void)w32_heap_free_on(H_HEAP,a);}
uint32_t w32_heap_size(uint32_t a) {uint32_t n=w32_heap_size_on(H_HEAP,a);return n==UINT32_MAX?0:n;}
uint32_t w32_heap_realloc(uint32_t a,uint32_t n) {return a?hb_realloc(0,a,n,0,0):hb_alloc(0,n,0);}
