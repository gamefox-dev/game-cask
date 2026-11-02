/* Original CC0-1.0. Actual allocator; checked native memory adapter and structural invariants. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef W32_64
#define W32_64 1
#endif
#define W32_HEAP_LO 65536u
#define W32_HEAP_HI (32u<<20)
#define H_HEAP 0x80000u
static unsigned char memory[W32_HEAP_HI];
static unsigned char *x86_pages[W32_HEAP_HI/4096];
static uint32_t heap_end=W32_HEAP_LO;
static uint32_t reads,writes,mapped=W32_HEAP_LO,fail_map;
static void die(const char *s) {fprintf(stderr,"heap invariant: %s\n",s);exit(1);}
#define CHECK(x) do{if(!(x))die(#x);}while(0)
static unsigned char *x86_host(uint32_t p) {CHECK(p<W32_HEAP_HI);return memory+p;}
static uint32_t x86_rd32(uint32_t p) {uint32_t v;CHECK(p<=mapped-4&&x86_pages[p>>12]);reads++;memcpy(&v,memory+p,4);return v;}
static void x86_wr32(uint32_t p,uint32_t v) {CHECK(p<=mapped-4&&x86_pages[p>>12]);writes++;memcpy(memory+p,&v,4);}
static unsigned char x86_rd8(uint32_t p) {CHECK(p<mapped&&x86_pages[p>>12]);return memory[p];}
static void x86_wr8(uint32_t p,uint32_t v) {CHECK(p<mapped&&x86_pages[p>>12]);memory[p]=(unsigned char)v;}
/* Simulated virtual reservation; must not coalesce or write boundary tags across it. */
#define RES_LO (4u<<20)
#define RES_HI (5u<<20)
static uint32_t skip_lo=RES_LO;
static uint32_t heap_skip(uint32_t p){return p>=skip_lo&&p<RES_HI?RES_HI:p;}
static void heap_commit_skip(uint32_t begin,uint32_t end){if(begin<end)skip_lo=begin;}
static uint32_t heap_place(uint32_t p,uint32_t n) {return p<RES_HI&&(uint64_t)p+n>RES_LO?RES_HI:p;}
static int heap_grow_to(uint32_t begin,uint32_t end) {
    CHECK(begin>=W32_HEAP_LO&&end<=W32_HEAP_HI&&heap_place(begin,end-begin)==begin);
    if(fail_map)return 0;
    uint32_t hi=(end+65535)&~65535u;
    if(hi>mapped)mapped=hi;
    for(uint32_t p=begin&~65535u;p<hi;p+=4096)x86_pages[p>>12]=memory+p;
    return 1;
}
#include "../../platforms/win32/w32_heap.h"
static uint32_t random_state=123;
static uint32_t random32(void) {random_state=random_state*1664525+1013904223;return random_state;}
static void invariant(void) {
    uint32_t used[HEAP_COUNT]={0},live[HEAP_COUNT]={0},free_blocks=0,bin_blocks=0;
    for(uint32_t p=W32_HEAP_LO;p<heap_end;) {
        if(heap_skip(p)!=p){p=RES_HI;continue;}
        uint32_t n=hb_size(p),owner=x86_rd32(p+12);
        CHECK(n>=HEAP_MIN&&!(n&15)&&p+n<=heap_end);
        if(x86_rd32(p)&1){CHECK(owner&&owner<=guest_heap_count&&hb_block(p+HEAP_HEADER,owner-1)==p);used[owner-1]+=n;live[owner-1]++;}
        else {free_blocks++;uint32_t next=hb_next(p);CHECK(!next||(x86_rd32(next)&1));}
        uint32_t next=p+n;
        if(next<heap_end&&heap_skip(next)==next&&x86_rd32(next+8)!=n){
            fprintf(stderr,"p=%u size=%u next=%u prev=%u end=%u tail=%u\n",p,n,next,x86_rd32(next+8),heap_end,heap_tail);
            die("next boundary tag");
        }
        p=next;
    }
    for(uint32_t i=0;i<guest_heap_count;i++){
        CHECK(guest_heaps[i].used==used[i]);uint32_t count=0,prev=0;
        for(uint32_t p=guest_heaps[i].head;p;p=x86_rd32(p+24)){
            CHECK(x86_rd32(p+28)==prev&&x86_rd32(p+12)==i+1);prev=p;CHECK(++count<=live[i]);
        }
        CHECK(count==live[i]);
    }
    for(uint32_t l=0;l<32;l++){
        uint32_t mask=0;
        for(uint32_t s=0;s<16;s++){
            uint32_t cats=0;
            for(uint32_t c=0;c<4;c++){
                uint32_t prev=0;if(heap_bins[l][s][c])cats|=1u<<c;
                for(uint32_t p=heap_bins[l][s][c];p;p=x86_rd32(p+16)){
                    uint32_t bl,bs;hb_class(hb_size(p),&bl,&bs);
                    uint32_t category=(hb_size(p)-((16u+s)<<(l-4u)))/16u;if(category>3)category=3;
                    CHECK(bl==l&&bs==s&&category==c&&!(x86_rd32(p)&1)&&x86_rd32(p+20)==prev);
                    prev=p;CHECK(++bin_blocks<=free_blocks);
                }
            }
            CHECK(cats==heap_category[l][s]);if(cats)mask|=1u<<s;
        }
        CHECK(mask==heap_sub[l]);CHECK(!!mask==!!(heap_groups&(1u<<l)));
    }
    CHECK(free_blocks==bin_blocks);
}
int main(void) {
    uint32_t handles[3]={H_HEAP,w32_heap_create(1,0,0),w32_heap_create(0,0,0)};
    uint32_t addresses[2048]={0},sizes[2048]={0},owners[2048]={0};
    unsigned char tags[2048]={0};
    /* A shared unsplittable free block must not cause a premature tight-quota OOM. */
    uint32_t candidate=w32_heap_alloc(48,0),guard=w32_heap_alloc(1,0);CHECK(candidate&&guard);
    w32_heap_free(candidate);uint32_t tight=w32_heap_create(0,0,64);
    uint32_t small=w32_heap_alloc_on(tight,16,0);CHECK(small&&w32_heap_size_on(tight,small)==16);
    CHECK(w32_heap_destroy(tight));w32_heap_free(guard);invariant();
    /* Same quota edge with backing unavailable: a larger free block must split. */
    candidate=w32_heap_alloc(48,0);guard=w32_heap_alloc(1,0);
    uint32_t larger=w32_heap_alloc(96,0),guard2=w32_heap_alloc(1,0);
    CHECK(candidate&&guard&&larger&&guard2);
    tight=w32_heap_create(0,0,64);w32_heap_free(candidate);w32_heap_free(larger);fail_map=1;
    small=w32_heap_alloc_on(tight,16,0);CHECK(small&&w32_heap_size_on(tight,small)==16);fail_map=0;
    CHECK(w32_heap_destroy(tight));w32_heap_free(guard);w32_heap_free(guard2);invariant();
    /* Partially suitable SAME bin: 1040 cannot fit a quota-safe split, 1072 can. */
    uint32_t first=w32_heap_alloc(1120,0),g1=w32_heap_alloc(1,0);
    uint32_t second=w32_heap_alloc(1120,0),g2=w32_heap_alloc(1,0);
    CHECK(first&&g1&&second&&g2);
    CHECK(w32_heap_realloc(second,48)==second);CHECK(w32_heap_realloc(first,80)==first);
    CHECK(hb_size(first-HEAP_HEADER)==112&&hb_size(first-HEAP_HEADER+112)==1040);
    CHECK(hb_size(second-HEAP_HEADER)==80&&hb_size(second-HEAP_HEADER+80)==1072);
    tight=w32_heap_create(0,0,1024);fail_map=1;
    small=w32_heap_alloc_on(tight,992,0);CHECK(small&&w32_heap_size_on(tight,small)==992);fail_map=0;
    CHECK(w32_heap_destroy(tight));w32_heap_free(first);w32_heap_free(second);w32_heap_free(g1);w32_heap_free(g2);invariant();
    /* Bin edges and large sizes, including class carry and unrepresentable sizes. */
    for(uint32_t bits=4;bits<23;bits++)for(uint32_t edge=0;edge<3;edge++){
        uint32_t n=(1u<<bits)+edge-1,p=w32_heap_alloc(n,1);CHECK(p&&w32_heap_size(p)==n);
        x86_wr8(p+n-1,97);w32_heap_free(p);invariant();
    }
    CHECK(!w32_heap_alloc(UINT32_MAX,0));
    for(uint32_t k=0;k<150000;k++) {
        uint32_t i=random32()%2048,n=random32()%4096;
        if(addresses[i]) {
            for(uint32_t j=0;j<sizes[i];j++)CHECK(x86_rd8(addresses[i]+j)==tags[i]);
            if(k%3){CHECK(w32_heap_free_on(handles[owners[i]],addresses[i]));addresses[i]=0;}
            else {
                uint32_t p=w32_heap_realloc_on(handles[owners[i]],addresses[i],n,1,0);CHECK(p);
                for(uint32_t j=0;j<n;j++)CHECK(x86_rd8(p+j)==(j<sizes[i]?tags[i]:0));
                addresses[i]=p;sizes[i]=n;for(uint32_t j=0;j<n;j++)x86_wr8(p+j,tags[i]);
            }
        } else {
            uint32_t owner=random32()%3;reads=writes=0;
            uint32_t p=w32_heap_alloc_on(handles[owner],n,0);CHECK(p);
            /* Bound actual header operations, independent of live set size. */
            CHECK(reads<200&&writes<100);
            addresses[i]=p;sizes[i]=n;owners[i]=owner;tags[i]=(unsigned char)(i+k);
            for(uint32_t j=0;j<n;j++)x86_wr8(p+j,tags[i]);
        }
        if(k%1000==0)invariant();
    }
    for(uint32_t i=0;i<2048;i++)if(addresses[i])CHECK(w32_heap_free_on(handles[owners[i]],addresses[i]));
    invariant();CHECK(w32_heap_destroy(handles[1]));CHECK(w32_heap_destroy(handles[2]));
    CHECK(!w32_heap_destroy(H_HEAP));CHECK(!w32_heap_alloc_on((uint64_t)H_HEAP+(1ull<<32),10,0));
    CHECK(!w32_heap_free_on(H_HEAP,RES_LO+64));
    /* Mapping failure is atomic and does not publish a block or leak a quota. */
    uint32_t before=heap_end;fail_map=1;
    CHECK(!w32_heap_alloc(20u<<20,0));CHECK(heap_end==before);invariant();fail_map=0;
    uint32_t limit=w32_heap_create(0,0,256),p=w32_heap_alloc_on(limit,120,0);CHECK(p);
    CHECK(!w32_heap_alloc_on(limit,200,0));CHECK(!w32_heap_realloc_on(limit,p,500,0,0));
    CHECK(w32_heap_size_on(limit,p)==120);CHECK(w32_heap_destroy(limit));invariant();
    CHECK(!w32_heap_create(0,W32_HEAP_HI,0));
    uint32_t live_handles[HEAP_COUNT];
    for(uint32_t i=0;i<HEAP_COUNT-1;i++){live_handles[i]=w32_heap_create(0,0,64);CHECK(live_handles[i]);}
    CHECK(!w32_heap_create(0,0,0));
    for(uint32_t i=0;i<HEAP_COUNT-1;i++)CHECK(w32_heap_destroy(live_handles[i]));
    for(uint32_t i=0;i<1000;i++){
        uint32_t h=w32_heap_create(0,0,64);CHECK(h&&h!=live_handles[0]);
        CHECK(!w32_heap_valid_handle(live_handles[0]));CHECK(w32_heap_destroy(h));live_handles[0]=h;
    }
    invariant();
    printf("heap native width=%u random=150000 invariants=PASS\n",W32_64?64:32);
    return 0;
}
