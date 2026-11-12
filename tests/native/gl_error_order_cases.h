/* SPDX-License-Identifier: CC0-1.0. Guest error/completeness observation is CPU owned. */
static void error_order_cases(void) {
    error=0;
    uint32_t before=submissions;
    call(call_BindBuffer,0xffffffffu,0,0,0); /* BAD_ENUM wins until GetError. */
    call(call_BindBuffer,ARRAY_BUFFER,1,0,0);
    call(call_BufferData,ARRAY_BUFFER,0xffffffffu,0,0x88e4); /* BAD_VALUE must not replace. */
    CHECK(call(call_GetError,0,0,0,0)==BAD_ENUM);
    CHECK(call(call_GetError,0,0,0,0)==0);
    call(call_BufferData,ARRAY_BUFFER,0xffffffffu,0,0x88e4);
    call(call_BindBuffer,0xffffffffu,0,0,0);
    CHECK(call(call_GetError,0,0,0,0)==BAD_VALUE);
    CHECK(call(call_GetError,0,0,0,0)==0);
    call(call_BindFramebuffer,FB_BOTH,1,0,0);
    CHECK(call(call_CheckFramebufferStatus,FB_BOTH,0,0,0)==0x8cd7);
    CHECK(!call(call_GetError,0,0,0,0)); /* Incomplete status is not a GL error. */
    call(call_CheckFramebufferStatus,0xffffffffu,0,0,0);
    CHECK(call(call_GetError,0,0,0,0)==BAD_ENUM);
    CHECK(!call(call_GetError,0,0,0,0));
    CHECK(submissions==before); /* Neither query creates a hidden driver/transport round trip. */
    /* Attach, redefine, detach and name reuse must be visible immediately to the next query. */
    call(call_BindRenderbuffer,RENDERBUFFER,1,0,0);
    call(call_RenderbufferStorage,RENDERBUFFER,0x8058,8,8);
    call(call_FramebufferRenderbuffer,FB_BOTH,0x8ce0,RENDERBUFFER,1);
    CHECK(call(call_CheckFramebufferStatus,FB_BOTH,0,0,0)==0x8cd5);
    before=submissions;
    call(call_RenderbufferStorage,RENDERBUFFER,0x8058,0,8);
    CHECK(call(call_CheckFramebufferStatus,FB_BOTH,0,0,0)==0x8cd6);
    call(call_RenderbufferStorage,RENDERBUFFER,0x8058,16,8);
    CHECK(call(call_CheckFramebufferStatus,FB_BOTH,0,0,0)==0x8cd5);
    call(call_FramebufferRenderbuffer,FB_BOTH,0x8ce0,RENDERBUFFER,0);
    CHECK(call(call_CheckFramebufferStatus,FB_BOTH,0,0,0)==0x8cd7);
    call(call_FramebufferRenderbuffer,FB_BOTH,0x8ce0,RENDERBUFFER,1);
    CHECK(call(call_CheckFramebufferStatus,FB_BOTH,0,0,0)==0x8cd5);
    CHECK(!call(call_GetError,0,0,0,0));
    call(call_BindFramebuffer,FB_BOTH,0,0,0);
    x86_wr32(4096,1);call(call_DeleteFramebuffers,1,4096,0,0);call(call_DeleteRenderbuffers,1,4096,0,0);
    call(call_DeleteBuffers,1,4096,0,0);
    CHECK(!error);
    puts("guest first-error ordering and immediate framebuffer completeness OK");
}
