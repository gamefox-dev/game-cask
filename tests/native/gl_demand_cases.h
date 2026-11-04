/* Original CC0-1.0. Counting probe, not a GPU rendering oracle.
 * Demand-first commit32195e3 compared frozen1023 and test-only16383 capacities.
 * Current production tables grow dynamically; this adapter explicitly enables the capability.
 * Production transports must NEVER use test overrides as capability negotiation. */
#ifndef W32_GL_DEMAND_COUNT
#define W32_GL_DEMAND_COUNT 12000u
#endif
static void demand_probe(void) {
    buffer_handles_enabled = 1;
    uint32_t buffers_created=0, stores=0, vaos_created=0;
    for (uint32_t i=0;i<W32_GL_DEMAND_COUNT;i+=2) {
        call(call_GenBuffers,2,4096,0,0);
        if(error){CHECK(error==OOM);error=0;break;}
        buffers_created+=2;
        for(uint32_t j=0;j<2;j++) {
            call(call_BindBuffer,ARRAY_BUFFER,x86_rd32(4096+4*j),0,0);
            call(call_BufferData,ARRAY_BUFFER,16,0,0x88e4);
            if(error){CHECK(error==OOM);error=0;goto buffers_done;}
            stores++;
        }
    }
buffers_done:
    for (uint32_t i=0;i<W32_GL_DEMAND_COUNT;i+=2) {
        call(call_GenVertexArrays,2,4096,0,0);
        if(error){CHECK(error==OOM);error=0;break;}
        vaos_created+=2;
    }
    CHECK(buffers_created==W32_GL_DEMAND_COUNT && stores==W32_GL_DEMAND_COUNT && vaos_created==W32_GL_DEMAND_COUNT);
    printf("demand requested=%u buffers=%u stores=%u vaos=%u host_peak=%llu metrics=%s\n",
        W32_GL_DEMAND_COUNT,buffers_created,stores,vaos_created,
        (unsigned long long)w32_gl_frontend_peak,w32_gl_objects_json());
}
