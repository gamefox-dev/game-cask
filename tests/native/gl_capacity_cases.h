/* Original CC0-1.0. Included by the bounded recording-host adapter, not a GPU oracle. */
static void capacity_names(void) {
    uint32_t (*gen[])(void)={call_GenTextures,call_GenBuffers,call_GenVertexArrays,call_GenFramebuffers,call_GenRenderbuffers,call_GenSamplers,call_GenQueries};
    uint32_t (*del[])(void)={call_DeleteTextures,call_DeleteBuffers,call_DeleteVertexArrays,call_DeleteFramebuffers,call_DeleteRenderbuffers,call_DeleteSamplers,call_DeleteQueries};
    for(uint32_t k=0;k<7;k++) {
        call(gen[k],GPU_MAX,4096,0,0);CHECK(!error);
        for(uint32_t i=0;i<GPU_MAX;i++){uint32_t n=x86_rd32(4096+i*4);CHECK(n);for(uint32_t j=0;j<i;j++)CHECK(n!=x86_rd32(4096+j*4));}
        x86_wr32(12288,0xabcdef01);x86_wr32(12292,0x12345678);
        call(gen[k],2,12288,0,0);CHECK(error==OOM&&x86_rd32(12288)==0xabcdef01&&x86_rd32(12292)==0x12345678);error=0;
        call(del[k],1,4096,0,0);call(gen[k],2,12288,0,0);CHECK(error==OOM&&x86_rd32(12288)==0xabcdef01);error=0;
        call(gen[k],1,4096,0,0);CHECK(!error&&x86_rd32(4096));call(del[k],GPU_MAX,4096,0,0);CHECK(!error);
    }
    static uint32_t sh[N],pr[N];
    for(uint32_t i=1;i<N;i++){sh[i]=call(call_CreateShader,0x8b31,0,0,0);pr[i]=call(call_CreateProgram,0,0,0,0);CHECK(sh[i]&&pr[i]&&sh[i]!=pr[i]);}
    CHECK(pr[GPU_MAX]>GPU_MAX);CHECK(call(call_CreateShader,0x8b31,0,0,0)==0&&error==OOM);error=0;
    CHECK(call(call_CreateProgram,0,0,0,0)==0&&error==OOM);error=0;
    call(call_GetShaderiv,sh[GPU_MAX],0x8b4f,12288,0);CHECK(x86_rd32(12288)==0x8b31);
    call(call_AttachShader,pr[GPU_MAX],sh[GPU_MAX],0,0);call(call_DeleteShader,sh[GPU_MAX],0,0,0);
    call(call_GetAttachedShaders,pr[GPU_MAX],1,12288,12292);CHECK(x86_rd32(12288)==1&&x86_rd32(12292)==sh[GPU_MAX]);
    CHECK(call(call_IsShader,sh[GPU_MAX],0,0,0));
    for(uint32_t i=1;i<N;i++)call(call_DeleteProgram,pr[i],0,0,0);
    CHECK(!call(call_IsShader,sh[GPU_MAX],0,0,0));
    for(uint32_t i=1;i<GPU_MAX;i++)call(call_DeleteShader,sh[i],0,0,0);
    uint32_t s=call(call_CreateShader,0x8b31,0,0,0),p=call(call_CreateProgram,0,0,0,0);CHECK(s&&p&&s!=p&&!error);
    call(call_DeleteShader,s,0,0,0);call(call_DeleteProgram,p,0,0,0);
    const uint32_t high=0xf1234567;
    call(call_BindFramebuffer,FRAMEBUFFER,high,0,0);call(call_GetIntegerv,0x8ca6,12288,0,0);CHECK(x86_rd32(12288)==high);
    call(call_BindRenderbuffer,RENDERBUFFER,high,0,0);call(call_RenderbufferStorage,RENDERBUFFER,0x8058,1,1);
    call(call_FramebufferRenderbuffer,FRAMEBUFFER,0x8ce0,RENDERBUFFER,high);
    call(call_GetFramebufferAttachmentParameteriv,FRAMEBUFFER,0x8ce0,0x8cd1,12288);CHECK(x86_rd32(12288)==high);
    CHECK(call(call_CheckFramebufferStatus,FRAMEBUFFER,0,0,0)==0x8cd5&&!error);
    x86_wr32(4096,high);call(call_DeleteRenderbuffers,1,4096,0,0);call(call_DeleteFramebuffers,1,4096,0,0);CHECK(!error);
    init_objects();for(uint32_t i=0;i<gl_object_count;i++){CHECK(object_live(&gl_objects[i])==0);CHECK(gl_objects[i].peak==GPU_MAX);CHECK(gl_objects[i].failures==((!strcmp(gl_objects[i].kind,"shaders")||!strcmp(gl_objects[i].kind,"programs"))?1u:2u));}
    CHECK(w32_gl_frontend_bytes==0);puts("capacity names namespaces=9 slots=1023 high/shared/deferred/atomic/recovery OK");
}
static void capacity_storage(void) {
    const uint32_t high=0xf1234567;uint32_t count=0;
    /* A renderbuffer at preferred handle257 must not collide with texture257. */
    call(call_BindRenderbuffer,RENDERBUFFER,high,0,0);call(call_RenderbufferStorage,RENDERBUFFER,0x8058,1,1);CHECK(!error);
    uint32_t rg=rbos[SLOT(rbos,high)].gpu;CHECK(rg==257);
    for(uint32_t i=1;i<=1000;i++){
        call(call_BindTexture,TEXTURE_2D,i,0,0);Texture *t=&textures[SLOT(textures,i)];CHECK(gpu_create(t,i,0,1,1,1,0));CHECK(t->gpu!=rg);count++;
    }
    call(call_BindTexture,TEXTURE_2D,1001,0,0);Texture *late=&textures[SLOT(textures,1001)];
    CHECK(!gpu_create(late,1001,0,1,1,1,0)&&error==OOM&&!late->gpu);error=0;
    for(uint32_t h=1;h<=GPU_MAX;h++)if(gpu_texture[h])CHECK(h<900||h>921);
    x86_wr32(4096,high);call(call_DeleteRenderbuffers,1,4096,0,0);CHECK(gpu_create(late,1001,0,1,1,1,0)&&!error);
    for(uint32_t i=1;i<=1001;i++){x86_wr32(4096,i);call(call_DeleteTextures,1,4096,0,0);}CHECK(!error);
    /* Distinct accepted buffer handles share the pool with ordinary program uniforms. */
    uint32_t p=build("#version 330 core\nuniform float u;out vec4 c;void main(){c=vec4(u);}");CHECK(programs[SLOT(programs,p)].ubuf);
    for(uint32_t i=1;i<=1014;i++){call(call_BindBuffer,ARRAY_BUFFER,i,0,0);call(call_BufferData,ARRAY_BUFFER,16,0,0x88e4);CHECK(!error&&buffers[SLOT(buffers,i)].gpu);}
    call(call_BindBuffer,ARRAY_BUFFER,1015,0,0);call(call_BufferData,ARRAY_BUFFER,16,0,0x88e4);CHECK(error==OOM&&!buffers[SLOT(buffers,1015)].gpu);error=0;
    drop(p);call(call_BufferData,ARRAY_BUFFER,16,0,0x88e4);CHECK(!error&&buffers[SLOT(buffers,1015)].gpu);
    for(uint32_t i=1;i<=1015;i++){x86_wr32(4096,i);call(call_DeleteBuffers,1,4096,0,0);}CHECK(!error&&w32_gl_frontend_bytes==0);
    /* A rejected create/delete never claims an accepted handle or descriptor-cache entry. */
    call(call_BindTexture,TEXTURE_2D,high,0,0);late=&textures[SLOT(textures,high)];
    reject_opcode=0x59;CHECK(!gpu_create(late,1,0,1,1,1,0)&&error==OOM&&!late->gpu);error=reject_opcode=0;
    CHECK(gpu_create(late,1,0,1,1,1,0));rg=late->gpu;reject_opcode=0x45;
    CHECK(!gpu_destroy(late)&&error==OOM&&late->gpu==rg&&gpu_texture[rg]);error=reject_opcode=0;
    CHECK(gpu_destroy(late)&&!gpu_texture[rg]);x86_wr32(4096,high);call(call_DeleteTextures,1,4096,0,0);
    Texture t={0};params_init(&t.p);t.p.min=0x2600;t.gmips=1;t.maxl=1000;
    reject_opcode=0x46;CHECK(!sampler_id(&t,0,0,0)&&error==OOM&&!sampler_count);error=reject_opcode=0;
    CHECK(sampler_id(&t,0,0,0)==1&&sampler_count==1);CHECK(sampler_id(&t,0,0,0)==1&&sampler_count==1);
    /* Same API boundary used by WGL dispatch counts a backend byte-budget rejection. */
    call(call_BindBuffer,ARRAY_BUFFER,high,0,0);uint32_t before=OBJECTS(buffers)->failures;
    reject_opcode=0x40;call(call_BufferData,ARRAY_BUFFER,16,0,0x88e4);CHECK(error==OOM&&OBJECTS(buffers)->failures==before+1);error=reject_opcode=0;
    call(call_BufferData,ARRAY_BUFFER,16,0,0x88e4);CHECK(!error);x86_wr32(4096,high);call(call_DeleteBuffers,1,4096,0,0);
    CHECK(w32_gl_frontend_bytes==0);printf("capacity storage textures=%u shared/private/byte-budget/rejected/recovery OK\n",count+1);
}
static void capacity_failures(void) {
    native_io.logical_width=320;native_io.logical_height=200;viewport[2]=320;viewport[3]=200;
    uint32_t p=build("#version 330 core\nuniform sampler2D img;out vec4 c;void main(){c=texture(img,vec2(0.0));}");
    call(call_GenVertexArrays,1,4096,0,0);call(call_BindVertexArray,x86_rd32(4096),0,0,0);call(call_UseProgram,p,0,0,0);
    const uint32_t high=0xf1234567;call(call_BindTexture,TEXTURE_2D,high,0,0);
    tex_image(0,0,0,0x8058,1,1,1,0,RGBA,T_UBYTE,0);call(call_TexParameteri,TEXTURE_2D,0x2801,0x2600,0);CHECK(!error);
    reject_opcode=0x46;uint32_t before=OBJECTS(programs)->failures;
    call(call_DrawArrays,4,0,3,0);CHECK(error==OOM&&!invalid_sampler_bindings&&!native_draws&&!sampler_count);
    CHECK(OBJECTS(samplers)->failures==1&&OBJECTS(programs)->failures==before);error=reject_opcode=0;
    call(call_DrawArrays,4,0,3,0);CHECK(!error&&!invalid_sampler_bindings&&native_draws==1&&sampler_count==1);
    /* Deferred image cleanup caused by a program query must remain attributed to textures. */
    x86_wr32(4096,high);reject_opcode=0x45;call(call_DeleteTextures,1,4096,0,0);CHECK(error==OOM);error=0;
    before=OBJECTS(programs)->failures;uint32_t tf=OBJECTS(textures)->failures;
    call(call_GetProgramiv,p,0x8b82,4096,0);CHECK(error==OOM&&gl_retired&&OBJECTS(textures)->failures==tf+1&&OBJECTS(programs)->failures==before);
    error=reject_opcode=0;call(call_GetProgramiv,p,0x8b82,4096,0);CHECK(!error&&!gl_retired);
    uint32_t ub=programs[SLOT(programs,p)].ubuf;CHECK(ub&&gpu_buffer[ub]);call(call_UseProgram,0,0,0,0);
    reject_opcode=0x42;call(call_DeleteProgram,p,0,0,0);CHECK(error==OOM&&abandoned_buffer[ub]&&gpu_buffer[ub]);
    error=reject_opcode=0;call(call_GetIntegerv,0x8b8d,4096,0,0);CHECK(!error&&!abandoned_buffer[ub]&&!gpu_buffer[ub]&&!live_buffers[ub]);
    CHECK(buffer_handle(ub,"buffers")==ub);
    /* Shader retirement after a rejected delete also keeps a real accepted generation for retry. */
    uint32_t s=compile(vertex,0x8b31),sg=shaders[SLOT(shaders,s)].gpu;reject_opcode=0x49;call(call_DeleteShader,s,0,0,0);
    CHECK(error==OOM&&abandoned_shader[sg]&&gpu_shader[sg]&&live_modules[sg]);error=reject_opcode=0;
    call(call_GetIntegerv,0x8b8d,4096,0,0);CHECK(!error&&!abandoned_shader[sg]&&!gpu_shader[sg]&&!live_modules[sg]);
    call(call_GenBuffers,1,4096,0,0);uint32_t b=x86_rd32(4096);CHECK(!call(call_IsBuffer,b,0,0,0));
    call(call_BindBuffer,ARRAY_BUFFER,b,0,0);CHECK(call(call_IsBuffer,b,0,0,0));call(call_DeleteBuffers,1,4096,0,0);
    call(call_BindBuffer,ARRAY_BUFFER,high,0,0);CHECK(call(call_IsBuffer,high,0,0,0));x86_wr32(4096,high);call(call_DeleteBuffers,1,4096,0,0);
    if(current_gpu){send(0x42,&current_gpu,1);current_gpu=0;glp_free(current_data,current_capacity*256u);current_capacity=0;current_data=0;}
    CHECK(!error&&w32_gl_frontend_bytes==0);puts("capacity failure attribution/sampler draw/retirement recovery/IsBuffer OK");
}
static void capacity_shaders(void) {
    static uint32_t names[N];
    for(uint32_t i=1;i<N;i++){names[i]=compile(vertex,0x8b31);CHECK(shaders[SLOT(shaders,names[i])].compiled&&!error);}
    /* Release one guest name while a program retains its compiled generation. */
    uint32_t p=call(call_CreateProgram,0,0,0,0);call(call_AttachShader,p,names[1],0,0);call(call_DeleteShader,names[1],0,0,0);
    /* Still no table slot: deferred shader lifetime is truthful, not an alias. */
    CHECK(!call(call_CreateShader,0x8b31,0,0,0)&&error==OOM);error=0;
    call(call_DeleteProgram,p,0,0,0);uint32_t s=compile(vertex,0x8b31);CHECK(shaders[SLOT(shaders,s)].compiled&&!error);
    /* All wire handles are occupied. A second compile request has no spare handle. */
    char txt[256]={0};GsLog log={txt,sizeof txt,0,0};uint32_t gpu=0;
    char *src=glp_alloc((uint32_t)strlen(vertex)+1);CHECK(src);strcpy(src,vertex);
    CHECK(!send_module(src,(uint32_t)strlen(src),1,&gpu,&log)&&error==OOM&&!gpu&&strstr(txt,"GPU shader handles"));error=0;
    call(call_DeleteShader,names[2],0,0,0);CHECK(send_module(src,(uint32_t)strlen(src),1,&gpu,&log)&&!error);SEND(0x49,gpu);glp_free(src,0);
    call(call_DeleteShader,s,0,0,0);for(uint32_t i=3;i<N;i++)call(call_DeleteShader,names[i],0,0,0);
    CHECK(w32_gl_frontend_bytes==0&&!error);puts("capacity shader handles=1023 shared/deferred/exhaustion/recovery OK");
}
