/* Original CC0-1.0. GL3.3 reserved-name identity, immutable-state churn and wire framing. */
static void object_identity(void) {
    uint32_t (*gen[])(void)={call_GenTextures,call_GenBuffers,call_GenVertexArrays,call_GenFramebuffers,call_GenRenderbuffers,call_GenSamplers,call_GenQueries};
    uint32_t (*is[])(void)={call_IsTexture,call_IsBuffer,call_IsVertexArray,call_IsFramebuffer,call_IsRenderbuffer,call_IsSampler,call_IsQuery};
    uint32_t (*del[])(void)={call_DeleteTextures,call_DeleteBuffers,call_DeleteVertexArrays,call_DeleteFramebuffers,call_DeleteRenderbuffers,call_DeleteSamplers,call_DeleteQueries};
    for(uint32_t k=0;k<7;k++) {
        CHECK(!call(is[k],0,0,0,0)&&!call(is[k],0xf1234567,0,0,0));
        call(gen[k],1,4096,0,0);uint32_t n=x86_rd32(4096);CHECK(n&&!error);
        /* Samplers are instantiated by Gen; the other six are reserved until bind/begin. */
        CHECK(call(is[k],n,0,0,0)==(k==5));
        if(k==2){call(call_BindVertexArray,0xf1234567,0,0,0);CHECK(error==BAD_OP&&!call(is[k],n,0,0,0));error=0;}
        if(k==3||k==4){call(k==3?call_BindFramebuffer:call_BindRenderbuffer,0,n,0,0);CHECK(error==BAD_ENUM&&!call(is[k],n,0,0,0));error=0;}
        if(k==0)call(call_BindTexture,TEXTURE_2D,n,0,0);
        if(k==1)call(call_BindBuffer,ARRAY_BUFFER,n,0,0);
        if(k==2)call(call_BindVertexArray,n,0,0,0);
        if(k==3)call(call_BindFramebuffer,FRAMEBUFFER,n,0,0);
        if(k==4)call(call_BindRenderbuffer,RENDERBUFFER,n,0,0);
        if(k==5)call(call_BindSampler,0,n,0,0);
        if(k==6){call(call_BeginQuery,0x8c88,n,0,0);call(call_EndQuery,0x8c88,0,0,0);}
        CHECK(call(is[k],n,0,0,0)&&!error);
        /* Instantiation does not require storage and survives unbind. */
        if(k==0)call(call_BindTexture,TEXTURE_2D,0,0,0);
        if(k==1)call(call_BindBuffer,ARRAY_BUFFER,0,0,0);
        if(k==2)call(call_BindVertexArray,0,0,0,0);
        if(k==3)call(call_BindFramebuffer,FRAMEBUFFER,0,0,0);
        if(k==4)call(call_BindRenderbuffer,RENDERBUFFER,0,0,0);
        if(k==5)call(call_BindSampler,0,0,0,0);
        CHECK(call(is[k],n,0,0,0));call(del[k],1,4096,0,0);CHECK(!call(is[k],n,0,0,0));
        call(gen[k],1,4096,0,0);n=x86_rd32(4096);CHECK(call(is[k],n,0,0,0)==(k==5));
        call(del[k],1,4096,0,0);CHECK(!error);
    }
    /* Shader/program identity is immediate, not contingent on compile/link/use. */
    uint32_t s=call(call_CreateShader,0x8b31,0,0,0),p=call(call_CreateProgram,0,0,0,0);
    CHECK(s&&p&&s!=p&&call(call_IsShader,s,0,0,0)&&call(call_IsProgram,p,0,0,0));
    CHECK(!call(call_IsShader,p,0,0,0)&&!call(call_IsProgram,s,0,0,0));
    CHECK(!call(call_IsShader,0,0,0,0)&&!call(call_IsProgram,0,0,0,0));
    call(call_DeleteShader,s,0,0,0);call(call_DeleteProgram,p,0,0,0);
    CHECK(!call(call_IsShader,s,0,0,0)&&!call(call_IsProgram,p,0,0,0)&&!error);
    /* TF object names are not exposed by this bounded GL3.3 subset (only capture/query APIs). */
#define API(name, fn, nargs, mutates) CHECK(!eq(name,"glGenTransformFeedbacks")&&!eq(name,"glIsTransformFeedback"));
#define GLSTUB API
#include "../../platforms/win32/w32_gl_api.h"
#undef API
#undef GLSTUB
    puts("object identity namespaces=9 reserved/instantiated/unbind/delete/regen OK");
}
static void sampler_churn(void) {
    native_io.logical_width=320;native_io.logical_height=200;viewport[2]=320;viewport[3]=200;
    uint32_t p=build("#version 330 core\nuniform sampler2D img;out vec4 c;void main(){c=texture(img,vec2(0.0));}");
    call(call_UseProgram,p,0,0,0);call(call_GenVertexArrays,1,4096,0,0);call(call_BindVertexArray,x86_rd32(4096),0,0,0);
    call(call_BindTexture,TEXTURE_2D,1,0,0);tex_image(0,0,0,0x8058,2,2,1,0,RGBA,T_UBYTE,0);
    tex_image(0,0,1,0x8058,1,1,1,0,RGBA,T_UBYTE,0);CHECK(!error);
    for(uint32_t kind=0;kind<2;kind++)for(uint32_t i=0;i<GPU_MAX+65;i++) {
        uint32_t n=0;
        if(!kind){call(call_GenSamplers,1,4096,0,0);n=x86_rd32(4096);call(call_BindSampler,0,n,0,0);
            call(call_SamplerParameterf,n,0x813a,bits((float)i/2048.0f),0);}
        else call(call_TexParameterf,TEXTURE_2D,0x813a,bits((float)(i+1200)/4096.0f),0);
        uint32_t before=native_draws;call(call_DrawArrays,4,0,3,0);
        CHECK(!error&&native_draws==before+1&&!invalid_sampler_bindings);
        if(!kind){call(call_DeleteSamplers,1,4096,0,0);CHECK(!call(call_IsSampler,n,0,0,0)&&object_live(OBJECTS(samplers))==0);}
        uint32_t live=0;for(uint32_t h=1;h<N;h++)live+=live_samplers[h];CHECK(live==sampler_count&&live<=GPU_MAX);
    }
    CHECK(!OBJECTS(samplers)->failures);
    /* Full-cache failed retirement retains the accepted descriptor; failed recreation leaves
     * a hole. Neither may issue a draw, and both must recover on the next unchanged draw. */
    call(call_TexParameterf,TEXTURE_2D,0x813a,bits(0.75f),0);
    uint32_t before=native_draws, victim=sampler_victim;
    reject_opcode=0x47;call(call_DrawArrays,4,0,3,0);
    CHECK(error==OOM&&native_draws==before&&sampler_count==GPU_MAX&&live_samplers[victim+1]);error=reject_opcode=0;
    reject_opcode=0x5b;call(call_DrawArrays,4,0,3,0);
    CHECK(error==OOM&&native_draws==before&&sampler_count==GPU_MAX-1&&!live_samplers[victim+1]);error=reject_opcode=0;
    call(call_DrawArrays,4,0,3,0);CHECK(!error&&native_draws==before+1&&sampler_count==GPU_MAX);
    /* Eight slots in one real draw: pin a hit exactly at the next eviction cursor, then
     * select seven novel states. The hit must not be destroyed underneath slot zero. */
    uint32_t multi=build("#version 330 core\nuniform sampler2D a,b,c,d,e,f,g,h;out vec4 c0;void main(){c0=texture(a,vec2(0.0))+texture(b,vec2(0.0))+texture(c,vec2(0.0))+texture(d,vec2(0.0))+texture(e,vec2(0.0))+texture(f,vec2(0.0))+texture(g,vec2(0.0))+texture(h,vec2(0.0));}");
    call(call_UseProgram,multi,0,0,0);victim=sampler_victim;uint32_t saved[12];memcpy(saved,sampler_cache[victim],sizeof saved);
    call(call_GenSamplers,8,4096,0,0);
    for(uint32_t i=0;i<8;i++) {
        uint32_t n=x86_rd32(4096+i*4);call(call_ActiveTexture,0x84c0+i,0,0,0);call(call_BindTexture,TEXTURE_2D,1,0,0);
        call(call_BindSampler,i,n,0,0);call(call_SamplerParameterf,n,0x813a,i?bits(0.8f+(float)i/100.0f):saved[9],0);
        char name[2]={(char)('a'+i),0};strcpy((char *)memory+8192,name);
        uint32_t loc=call(call_GetUniformLocation,multi,8192,0,0);CHECK(loc!=UINT32_MAX);call(call_Uniform1i,loc,i,0,0);
    }
    before=native_draws;call(call_DrawArrays,4,0,3,0);
    CHECK(!error&&native_draws==before+1&&!memcmp(saved,sampler_cache[victim],sizeof saved));
    call(call_DeleteSamplers,8,4096,0,0);CHECK(!object_live(OBJECTS(samplers))&&OBJECTS(samplers)->failures==2);
    call(call_UseProgram,0,0,0,0);drop(multi);drop(p);
    puts("sampler churn sampler+texture states draws=2176 bounded/reclaimed OK");
}
static void batch_framing(const char *mode) {
    uint32_t w[10]={BGT_CMD_MAGIC,BGT_CMD_VERSION,24,1,0x4d,0,0x4d,0,0,0};
    if(eq(mode,"batch-valid")){w[2]=32;w[3]=2;CHECK(!bgt_submit_commands(w,32));puts("batch framing valid multi-command OK");return;}
    if(eq(mode,"batch-count-high"))w[3]=7;
    if(eq(mode,"batch-count-low")){w[2]=32;w[3]=1;}
    if(eq(mode,"batch-prefix")){w[2]=28;w[3]=2;}
    if(eq(mode,"batch-payload")){w[3]=2;w[5]=4;}
    if(eq(mode,"batch-overflow")){w[3]=2;w[5]=0xfffffff8u;}
    if(eq(mode,"batch-alignment")){w[3]=2;w[5]=1;}
    if(eq(mode,"batch-single-prefix"))w[2]=20;
    if(eq(mode,"batch-single-payload"))w[5]=4;
    if(eq(mode,"batch-magic"))w[0]=0;
    if(eq(mode,"batch-version"))w[1]=2;
    bgt_submit_commands(w,w[2]);puts("malformed batch was accepted");
}
