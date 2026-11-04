/* Original CC0-1.0. Large profile tables and truthful host-allocation failure. */
static void scale_churn(void) {
    const uint32_t count=24000, out=32768;
    buffer_handles_enabled=1;
    for(uint32_t cycle=0;cycle<4;cycle++) {
        call(call_GenBuffers,count,out,0,0);CHECK(!error);
        CHECK(object_live(OBJECTS(buffers))==count);
        for(uint32_t i=0;i<count;i++)CHECK(SLOT(buffers,x86_rd32(out+4*i))<BN);
        call(call_DeleteBuffers,count,out,0,0);CHECK(!error&&!object_live(OBJECTS(buffers)));
        call(call_GenVertexArrays,count,out,0,0);CHECK(!error);
        CHECK(object_live(OBJECTS(vaos))==count);
        for(uint32_t i=0;i<count;i++)CHECK(SLOT(vaos,x86_rd32(out+4*i))<VN);
        call(call_DeleteVertexArrays,count,out,0,0);CHECK(!error&&!object_live(OBJECTS(vaos)));
    }
    for(uint32_t name=UINT32_MAX;name>UINT32_MAX-32;name--){call(call_BindBuffer,ARRAY_BUFFER,name,0,0);CHECK(!error&&call(call_IsBuffer,name,0,0,0));}
    call(call_GenVertexArrays,1,out,0,0);uint32_t v=x86_rd32(out);call(call_BindVertexArray,v,0,0,0);
    call(call_BindBuffer,ARRAY_BUFFER,UINT32_MAX,0,0);call(call_BufferData,ARRAY_BUFFER,32,0,0x88e4);
    call(call_VertexAttribPointer,0,2,F32,0);CHECK(!error);uint32_t slot=SLOT(buffers,UINT32_MAX),gpu=buffers[slot].gpu;
    call(call_BindVertexArray,0,0,0,0);x86_wr32(out,UINT32_MAX);call(call_DeleteBuffers,1,out,0,0);CHECK(!error&&buffers[slot].used&&gpu_buffer[gpu]);
    call(call_BindBuffer,ARRAY_BUFFER,UINT32_MAX,0,0);CHECK(!error&&SLOT(buffers,UINT32_MAX)!=slot);
    x86_wr32(out,v);call(call_DeleteVertexArrays,1,out,0,0);CHECK(!error&&!buffers[slot].used&&!gpu_buffer[gpu]);
    void *held[4096];uint32_t nheld=0;
    for(uint32_t n=1u<<20;n>=32;n/=2){void *p;while((p=glp_alloc(n))!=0){CHECK(nheld<4096);held[nheld++]=p;}}
    uint32_t cap=BN,live=object_live(OBJECTS(buffers)),failures=OBJECTS(buffers)->failures;
    x86_wr32(out,0xabcdef01);call(call_GenBuffers,cap,out,0,0);
    CHECK(error==OOM&&BN==cap&&x86_rd32(out)==0xabcdef01&&object_live(OBJECTS(buffers))==live&&OBJECTS(buffers)->failures==failures+1);
    CHECK(SLOT(buffers,UINT32_MAX)<BN);error=0;
    for(uint32_t i=0;i<nheld;i++)glp_free(held[i],0);
    call(call_GenBuffers,cap,out,0,0);CHECK(!error&&BN>cap);call(call_DeleteBuffers,cap,out,0,0);CHECK(!error);
    for(uint32_t name=UINT32_MAX;name>UINT32_MAX-32;name--){x86_wr32(out,name);call(call_DeleteBuffers,1,out,0,0);}
    CHECK(!error&&!object_live(OBJECTS(buffers))&&!gl_retired);
    puts("scale churn=4 count=24000 atomic/retained/host-OOM/recovery OK");
}
