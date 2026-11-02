/* Original CC0-1.0. Same source compiled against old/new real guest allocator.
 * 250,000 mallocs, 216,667 reallocs, interleaved holes and growing 40,000 live set. */
#include <stdio.h>
#include <time.h>
static uint32_t pointers[50000];
int main(void) {
    const unsigned batch=5000;
    uint64_t checksum=0;unsigned live=0;
    for(unsigned phase=0;phase<10;phase++) {
        clock_t start=clock();unsigned operations=0;
        for(unsigned i=phase*batch;i<(phase+1)*batch;i++) {
            unsigned size=24+(i%23)*16;
            uint32_t p=w32_heap_alloc(size,0);operations++;
            if(!p)return 2;
            x86_wr32(p,i);
            if(i%3==0) {
                uint32_t q=w32_heap_realloc(p,size+80);operations++;
                if(!q||x86_rd32(q)!=i)return 3;
                p=q;
            }
            pointers[i]=p;live++;
            for(unsigned j=0;j<4;j++) {
                uint32_t t=w32_heap_alloc(33+j*32,0);operations++;
                if(!t)return 4;
                x86_wr32(t,i+j);
                uint32_t u=w32_heap_realloc(t,145+j*32);operations++;
                if(!u||x86_rd32(u)!=i+j)return 5;
                w32_heap_free(u);operations++;
            }
            if(i%5==0&&i>20) {w32_heap_free(pointers[i-17]);operations++;pointers[i-17]=0;live--;}
            checksum+=x86_rd32(p);
        }
        double cpu_ns=(double)(clock()-start)*1e9/CLOCKS_PER_SEC;
        printf("{\"phase\":%u,\"live\":%u,\"allocations\":%u,\"operations\":%u,\"ns_per_operation\":%.3f,\"ns_per_allocation_mixed_work\":%.3f,\"extent\":%u}\n",
            phase,live,batch*5,operations,cpu_ns/operations,cpu_ns/(batch*5),heap_end-W32_HEAP_LO);
        fflush(stdout);
    }
    for(unsigned i=0;i<50000;i++)if(pointers[i])w32_heap_free(pointers[i]);
    printf("{\"checksum\":%llu}\n",(unsigned long long)checksum);
    return 0;
}
