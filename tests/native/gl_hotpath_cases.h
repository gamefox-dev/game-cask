/* Original CC0-1.0. Capacity-independent lookup and dormant-retirement regression. */
#include <time.h>
static void hotpath_cases(void) {
    GlObjects *bo = OBJECTS(buffers), *vo = OBJECTS(vaos);
    CHECK(bo == OBJECTS(buffers) && vo == OBJECTS(vaos) && bo->index && vo->index);
    /* First-table high names, collisions (including wrap), and arbitrary deletion order.
     * No growth can hide a tombstone accumulation or an initial linear fallback. */
    uint32_t names[64], slots[64], found = 0;
    for (uint32_t name = 0xf0000000u; found < 64; name++)
        if ((name_hash(name) & (N * 2u - 1u)) == N * 2u - 3u) names[found++] = name;
    for (uint32_t cycle = 0; cycle < 8; cycle++) {
        for (uint32_t i = 0; i < 64; i++) { slots[i] = BIND(buffers, names[i]); CHECK(slots[i] && slots[i] < BN); }
        for (uint32_t i = 0; i < 64; i++) {
            uint32_t j = (i * 17u) % 64u; CHECK(SLOT(buffers, names[j]) == slots[j]); erase_name(bo, slots[j]);
            CHECK(SLOT(buffers, names[j]) == BN);
            for (uint32_t k = i + 1; k < 64; k++) { uint32_t left = (k * 17u) % 64u; CHECK(SLOT(buffers, names[left]) == slots[left]); }
        }
        for (uint32_t i = 0; i < N * 2u; i++) CHECK(!bo->index[i]);
    }
    /* Keep an old generation attached to an unbound VAO. Unrelated hot calls must
     * not repeatedly revisit it, and the final detach must enqueue it exactly once. */
    call(call_GenVertexArrays,1,4096,0,0); uint32_t v=x86_rd32(4096);
    call(call_BindVertexArray,v,0,0,0);
    call(call_BindBuffer,ELEMENT_BUFFER,7,0,0); call(call_BufferData,ELEMENT_BUFFER,4,0,0x88e4); uint32_t old=SLOT(buffers,7), gpu=buffers[old].gpu; CHECK(gpu);
    call(call_BindVertexArray,0,0,0,0); x86_wr32(4096,7);call(call_DeleteBuffers,1,4096,0,0);
    CHECK(bo->retired[old] && !retired_buffer_head && buffers[old].vao_refs == 1);
    uint64_t allocations=w32_gl_frontend_allocations; uint32_t submits=submissions;
    call(call_BindBuffer,ARRAY_BUFFER,8,0,0);
#ifdef W32_GL_TEST_WORK
    gl_test_work = 0;
#endif
    for(uint32_t i=0;i<100000;i++) { call(call_BindBuffer,ARRAY_BUFFER,8,0,0); call(call_IsBuffer,8,0,0,0); }
#ifdef W32_GL_TEST_WORK
    CHECK(gl_test_work == 0);
#endif
    CHECK(!error && bo->retired[old] && !retired_buffer_head && !image_collection_dirty);
    CHECK(w32_gl_frontend_allocations == allocations && submissions == submits);
    reject_opcode=0x42; x86_wr32(4096,v);call(call_DeleteVertexArrays,1,4096,0,0);
    CHECK(error==OOM && retired_buffer_head==old && bo->retired[old] && gpu_buffer[gpu] && live_buffers[gpu]);
    reject_opcode=error=0;call(call_IsBuffer,8,0,0,0);
    CHECK(!gpu_buffer[gpu] && !live_buffers[gpu]);
    CHECK(!retired_buffer_head && !gl_retired && !buffers[old].used);
    x86_wr32(4096,8);call(call_DeleteBuffers,1,4096,0,0);CHECK(!object_live(bo));
    CHECK(!abandoned_buffers && !abandoned_shaders && !abandoned_pipelines);
    for(uint32_t i=100;i<116;i++) { uint32_t slot=BIND(buffers,i); CHECK(slot==i); retire_name(bo,slot); }
    retired_buffer_head=sort_retired_buffers(retired_buffer_head);
    uint32_t next=retired_buffer_head;
    for(uint32_t i=100;i<116;i++) { CHECK(next==i); next=buffers[next].collect_next; }
    CHECK(!next); collect_deleted(); CHECK(!retired_buffer_head && !gl_retired);
    /* Native handle selection is amortized linear across a large creation wave,
     * and still chooses precisely the lowest unreserved free ID after churn. */
    buffer_handles_enabled = 1;
#ifdef W32_GL_TEST_WORK
    gl_test_work = 0;
#endif
    uint32_t handles[12000];
    for (uint32_t i=0;i<12000;i++) {
        uint32_t h=handles[i]=buffer_handle(0,"buffers"); CHECK(h);
        uint32_t create[5]={h,1,4,0,0}; CHECK(send(0x40,create,5));
    }
#ifdef W32_GL_TEST_WORK
    CHECK(gl_test_work < 13000);
#endif
    for (uint32_t i=0;i<12000;i+=2) CHECK(send(0x42,&handles[i],1));
    for (uint32_t i=0;i<12000;i+=2) {
        uint32_t h=buffer_handle(0,"buffers"); CHECK(h==handles[i]);
        uint32_t create[5]={h,1,4,0,0}; CHECK(send(0x40,create,5));
    }
    for (uint32_t i=0;i<12000;i++) CHECK(send(0x42,&handles[i],1));
    CHECK(buffer_handle(0,"buffers")==1);
    puts("hot paths: cached namespaces, direct/hash lookup, collision churn, dormant retirement and final detach OK");
}
static void hotpath_bench(void) {
    uint32_t shader=call(call_CreateShader,0x8b31,0,0,0);CHECK(shader);
    call(call_BindBuffer,ARRAY_BUFFER,1,0,0);
    for(uint32_t mode=0;mode<3;mode++) {
        uint32_t (*fn)(void)=mode==0?call_IsEnabled:mode==1?call_GetShaderiv:call_BindBuffer;
        uint32_t a=mode==0?0x0b71:mode==1?shader:ARRAY_BUFFER,b=mode==1?0x8b80:mode==2?1:0,sum=0;
        clock_t start=clock();
        for(uint32_t i=0;i<1000000;i++)sum+=call(fn,a,b,8192,0);
        printf("hotpath mode=%u calls=1000000 cpu_ms=%.3f checksum=%u\n",mode,1000.0*(clock()-start)/CLOCKS_PER_SEC,sum);
    }
    call(call_DeleteShader,shader,0,0,0);CHECK(!error);
}
