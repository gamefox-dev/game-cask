/* Original CC0-1.0 native §13 conformance scenes; no engine, profile or game input. */
#include "bgt.h"
#include "bgt_cmd.h"
BGT_DEFINE_IO(io)
int32_t wgsl_init(bgt_io_t *io);
void wgsl_update(uint32_t dt);
void wgsl_render(void);
uint32_t wgsl_state_hash(void);
#define PTR(p) ((uint32_t)(uintptr_t)(p))
static uint32_t memory[8192], result[2048], scene, phase, frame, read_ok, compile_ok, events;
static int32_t submit_error;
static bgt_cmdbuf_t cb;
static bgt_gpu_limits_v3_t limits;
static float uniforms[192], instances[2002], padded[1536];
static const float triangle[] = {-.8f,-.8f,1,0,0, .8f,-.8f,0,1,0, 0,.8f,0,0,1};
static const uint16_t indices[] = {1,2,3}; /* negative base vertex exercises backend rebasing */
static const uint32_t texels[] = { BGT_RGBA(255,0,0,128), BGT_RGBA(0,255,0,128),
    BGT_RGBA(0,0,255,128), BGT_RGBA(255,255,255,128) };
static const uint32_t mip[] = {BGT_RGBA(255,0,255,128)};
#define VERSION "#version 330 core\n"
#define QUAD "vec2 p[6]=vec2[6](vec2(-1,1),vec2(-1,-1),vec2(1,-1)," \
    "vec2(-1,1),vec2(1,-1),vec2(1,1));vec2 q=p[bgt_vertex_index];"
static const char *sources[] = {
    VERSION "layout(location=0) in vec2 pos;layout(location=1) in vec3 col;out vec3 v;"
    "void main(){gl_Position=vec4(pos,.5,1);v=col;}",
    VERSION "in vec3 v;layout(location=0) out vec4 o;void main(){o=vec4(v,1);}",
    VERSION "out vec2 uv;void main(){" QUAD "uv=vec2((q.x+1.)*.5,(1.-q.y)*.5);gl_Position=vec4(q,.5,1);}",
    VERSION "in vec2 uv;uniform sampler2D bgt_t0;layout(location=0) out vec4 o;"
    "void main(){o=textureLod(bgt_t0,uv,1.);}",
    VERSION "layout(location=0) out vec4 a;layout(location=1) out vec4 b;"
    "void main(){a=bgt_frag_coord.y<64.?vec4(1,0,0,1):vec4(0,1,0,1);b=vec4(0,0,1,1);}",
    VERSION "in vec2 uv;uniform sampler2D bgt_t0;uniform sampler2D bgt_t1;"
    "layout(location=0) out vec4 o;void main(){o=(texture(bgt_t0,uv)+texture(bgt_t1,uv))*.5;}",
    VERSION "layout(std140) uniform bgt_u0 {vec4 anim;};void main(){" QUAD
    "gl_Position=vec4(q.x+anim.x,q.y,anim.y,1);}",
    VERSION "layout(std140) uniform bgt_u0 {vec4 anim;};layout(location=0) out vec4 o;"
    "void main(){o=vec4(anim.z,anim.w,0,1);}",
    VERSION "layout(location=0) in vec2 offset;out vec3 v;void main(){" QUAD
    "gl_Position=vec4(q*vec2(.018,.03)+offset,.5,1);"
    "v=(bgt_instance_index==999u)?vec3(1,0,1):vec3(0,1,1);}",
    ("#version 300 es\nprecision highp float;layout(location=0) out vec4 o;"
    "void main(){o=bgt_frag_coord.y<64.?vec4(1,1,0,1):vec4(0,1,1,1);}"),
    ("#version 300 es\nprecision highp float;void main(){" QUAD "gl_Position=vec4(q,.5,1);}"),
    VERSION "in vec3 v;layout(location=0) out vec4 o;void main(){o=vec4(v,1);}"
};
static uint32_t length(const char *s) { uint32_t n=0;while(s[n])n++;return n; }
static void submit(void) {
    int32_t e=bgt_cmd_submit(&cb);if(e && !submit_error)submit_error=e;bgt_cmd_reset(&cb);
}
static void buffer(uint32_t h,uint32_t usage,const void *data,uint32_t bytes) {
    bgt_gpu_buffer_create_t b={h,usage,bytes,PTR(data),bytes};bgt_cmd_gpu_buffer_create(&cb,&b);
}
static void texture(uint32_t h,uint32_t w,uint32_t hgt,uint32_t mips,uint32_t format) {
    bgt_gpu_texture_create_t t={h,w,hgt,mips,format,3};bgt_cmd_gpu_texture_create(&cb,&t);
}
static void pipeline(uint32_t h,uint32_t vs,uint32_t fs,uint32_t buffers,uint32_t attrs,
    uint32_t colors,uint32_t umask,uint32_t tmask,uint32_t depth,uint32_t stencil,uint32_t blend) {
    bgt_gpu_pipeline_create_t p={0};p.handle=h;p.vertex_shader=vs;p.fragment_shader=fs;
    p.topology=3;p.depth_format=depth?5:0xffffffff;p.depth_test=depth;p.depth_write=depth;
    p.depth_compare=1;p.stencil_enable=stencil?1:0;p.stencil_read_mask=255;p.stencil_write_mask=255;
    p.front_compare=p.back_compare=stencil==1?7:2;p.front_pass=p.back_pass=stencil==1?2:0;
    p.uniform_mask=umask;p.texture_mask=tmask;p.buffer_count=buffers;p.attribute_count=attrs;p.color_count=colors;
    bgt_gpu_vertex_layout_t layouts[1]={{h==6?8:scene==8?2048:20,h==6?1:0}};
    bgt_gpu_attribute_t attributes[2]={{0,0,0,1},{1,0,8,2}};
    bgt_gpu_color_target_t targets[2]={{0,blend,6,7,0,1,7,0,15},{0,0,1,0,0,1,0,0,15}};
    bgt_cmd_gpu_pipeline_create(&cb,&p,layouts,attributes,targets);
}
static void begin(uint32_t target,uint32_t second,uint32_t depth,uint32_t load) {
    bgt_gpu_pass_begin_t p={second?2:1,depth,0,depth?1:0,depth?1:0,1,0};
    bgt_gpu_color_attachment_t a[2]={{target,0,load,0,0,0,1},{second,0,1,0,0,0,1}};
    bgt_cmd_gpu_pass_begin(&cb,&p,a);
}
static void bind_pipeline(uint32_t h) {bgt_gpu_pipeline_t p={h};bgt_cmd_gpu_pipeline(&cb,&p);}
static void bind_texture(uint32_t slot,uint32_t h) {
    bgt_gpu_texture_t t={slot,h,1};bgt_cmd_gpu_texture(&cb,&t);
}
static void bind_uniform(uint32_t offset) {
    bgt_gpu_uniform_buffer_t u={0,3,offset,16};bgt_cmd_gpu_uniform_buffer(&cb,&u);
}
static void draw(uint32_t n,uint32_t instances_count) {
    bgt_gpu_draw_t d={n,instances_count,0,0};bgt_cmd_gpu_draw(&cb,&d);
}
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    if(io.arg1>=2) return wgsl_init(&io);
    (void)p;io.logical_width=160;io.logical_height=128;scene=io.arg0;
    bgt_cmd_init(&cb,memory,sizeof memory);
    bgt_gpu_limits(&limits.base,sizeof limits);
    if (!(io.caps&BGT_CAP_GPU)) {phase=99;return 0;}
    for(uint32_t i=0;i<12;i++) {
        bgt_gpu_shader_create_t s={i+1,(i==0||i==2||i==6||i==8||i==10)?1:2,(i==9||i==10)?2:1,
            PTR(sources[i]),length(sources[i]),100+i};bgt_cmd_gpu_shader_create(&cb,&s);
    }
    for(uint32_t i=0;i<3;i++)for(uint32_t j=0;j<5;j++)padded[i*512+j]=triangle[i*5+j];
    buffer(1,1,scene==8?padded:triangle,scene==8?sizeof padded:sizeof triangle);
    buffer(2,2,indices,sizeof indices);
    uniforms[1]=.25f;uniforms[3]=1;uniforms[65]=.1f;uniforms[66]=1;
    uniforms[129]=.75f;uniforms[131]=1;
    buffer(3,4,uniforms,sizeof uniforms);
    for(uint32_t i=0;i<1000;i++) {
        uint32_t at=(i+(scene==9?1:0))*2;
        instances[at]=-0.975f+(i%40)*.05f;instances[at+1]=.96f-(i/40)*.08f;
    }
    buffer(4,1,instances,sizeof instances);
    texture(1,2,2,2,0);texture(2,160,128,1,0);texture(3,160,128,1,0);texture(4,160,128,1,5);
    bgt_gpu_texture_update_t t={1,0,0,0,2,2,PTR(texels),sizeof texels};bgt_cmd_gpu_texture_update(&cb,&t);
    t=(bgt_gpu_texture_update_t){1,1,0,0,1,1,PTR(mip),sizeof mip};bgt_cmd_gpu_texture_update(&cb,&t);
    bgt_gpu_sampler_create_t s={1,0,0,1,0,0,0,7};bgt_cmd_gpu_sampler_create(&cb,&s);
    /* Execute every delete op, then reuse the same handles in their separate namespaces. */
    buffer(9,1,triangle,sizeof triangle);bgt_gpu_buffer_delete_t bd={9};bgt_cmd_gpu_buffer_delete(&cb,&bd);
    texture(9,1,1,1,0);bgt_gpu_texture_delete_t td={9};bgt_cmd_gpu_texture_delete(&cb,&td);
    s.handle=9;bgt_cmd_gpu_sampler_create(&cb,&s);bgt_gpu_sampler_delete_t sd={9};bgt_cmd_gpu_sampler_delete(&cb,&sd);
    submit();return 0;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    if(io.arg1>=2) { wgsl_update(dt); return; }
    (void)dt;events|=io.events;if(phase==99)return;
    if(!phase) {
        for(uint32_t i=0;i<12;i++)if(bgt_request_status(100+i)!=1)return;
        for(uint32_t i=0;i<12;i++) {
            int32_t size=bgt_request_read(100+i,result,sizeof result);bgt_request_close(100+i);
            int32_t status=(int32_t)result[0];
            if(status) { if(size>4)bgt_log(1,(const char *)result+4,size-4); return; } compile_ok++;
        }
        pipeline(1,1,2,1,2,1,0,0,0,0,0); /* indexed colored triangle */
        pipeline(2,3,4,0,0,1,0,1,0,0,1); /* textured alpha + mip */
        pipeline(3,3,5,0,0,2,0,0,0,0,0); /* MRT */
        pipeline(4,3,6,0,0,1,0,3,0,0,0); /* sampled MRT */
        pipeline(5,7,8,0,0,1,1,0,1,1,0); /* write stencil and depth */
        pipeline(6,9,2,1,1,1,0,0,0,0,0); /* instanced sprites */
        pipeline(7,7,8,0,0,1,1,0,0,0,0); /* uniform animation */
        pipeline(8,7,8,0,0,1,1,0,1,2,0); /* stencil equality */
        pipeline(9,11,10,0,0,1,0,0,0,0,0); /* ES300 + top-left fragment coordinates */
        pipeline(10,1,12,1,2,1,0,0,0,0,0);
        bgt_gpu_pipeline_delete_t pd={10};bgt_cmd_gpu_pipeline_delete(&cb,&pd);
        bgt_gpu_shader_delete_t sd={12};bgt_cmd_gpu_shader_delete(&cb,&sd);
        submit();phase=1;
    }
    frame++;
    if(scene==5) {
        uniforms[0]=0;uniforms[2]=(frame%60)/59.f;uniforms[3]=1-uniforms[2];
        bgt_gpu_buffer_update_t u={3,0,PTR(uniforms),16};bgt_cmd_gpu_buffer_update(&cb,&u);submit();
    }
    if(bgt_request_status(200)==1) {
        if(bgt_request_read(200,result,sizeof result)==4)read_ok=1;
        bgt_request_close(200);
    }
}
BGT_EXPORT(bgt_render) void bgt_render(void) {
    if(io.arg1>=2) { wgsl_render(); return; }
    if(io.arg1==1 && read_ok) { /* Freeze, or replace with 2D-only output on virtual A. */
        if(io.buttons&BGT_BTN_A) { bgt_cmd_clear(&cb,BGT_RGBA(10,20,30,255)); submit(); }
        return;
    }
    bgt_cmd_clear(&cb,BGT_RGBA(0,0,0,255));
    if(phase!=1) {submit();return;}
    if(scene==7) {
        bgt_cmd_blend(&cb,BGT_BLEND_OPAQUE);bgt_cmd_rect(&cb,0,0,160,128,BGT_RGBA(30,40,50,255));
        begin(0,0,0,0);
    } else if(scene==2) {
        begin(2,3,0,1);bind_pipeline(3);draw(6,1);bgt_cmd_gpu_pass_end(&cb);begin(0,0,0,1);
    } else begin(0,0,scene==3?4:0,1);
    if(scene==0 || scene==8) {
        bind_pipeline(1);bgt_gpu_vertex_buffer_t v={0,1,0,scene==8?sizeof padded:sizeof triangle};
        bgt_cmd_gpu_vertex_buffer(&cb,&v);
        bgt_gpu_index_buffer_t i={2,0,0,sizeof indices};bgt_cmd_gpu_index_buffer(&cb,&i);
        bgt_gpu_draw_indexed_t d={3,1,0,-1,0};bgt_cmd_gpu_draw_indexed(&cb,&d);
    } else if(scene==1) {
        bind_pipeline(2);bind_texture(0,1);bgt_gpu_blend_constant_t c={.25f,.5f,.75f,1};
        bgt_cmd_gpu_blend_constant(&cb,&c);draw(6,1);
    } else if(scene==2) {bind_pipeline(4);bind_texture(0,2);bind_texture(1,3);draw(6,1);
    } else if(scene==3) {
        bgt_gpu_stencil_ref_t r={7};bgt_cmd_gpu_stencil_ref(&cb,&r);
        bind_pipeline(5);bind_uniform(0);bgt_gpu_scissor_t s={0,0,80,128};bgt_cmd_gpu_scissor(&cb,&s);draw(6,1);
        s.width=160;bgt_cmd_gpu_scissor(&cb,&s);bind_pipeline(8);bind_uniform(256);draw(6,1);
        bind_uniform(512);draw(6,1); /* farther green fails; stencil excludes the right half */
    } else if(scene==4 || scene==9) {
        bind_pipeline(6);bgt_gpu_vertex_buffer_t v={0,4,0,sizeof instances};bgt_cmd_gpu_vertex_buffer(&cb,&v);
        bgt_gpu_draw_t d={6,1000,0,scene==9?1:0};bgt_cmd_gpu_draw(&cb,&d);
    } else if(scene==5) {bind_pipeline(7);bind_uniform(0);draw(6,1);
    } else if(scene==6) {bind_pipeline(9);draw(6,1);
    } else {
        bind_pipeline(7);bind_uniform(0);bgt_gpu_viewport_t v={40,32,80,64,0,1};bgt_cmd_gpu_viewport(&cb,&v);draw(6,1);
    }
    bgt_cmd_gpu_pass_end(&cb);
    if(scene==7) {bgt_cmd_blend(&cb,BGT_BLEND_OPAQUE);bgt_cmd_rect(&cb,70,50,20,20,BGT_RGBA(255,0,0,255));}
    if(!read_ok && bgt_request_status(200)<0)bgt_cmd_readback(&cb,200,0,80,64,1,1);
    submit();
}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) {return io.arg1>=2?wgsl_state_hash():(compile_ok<<16)|(read_ok<<8)|phase;}
BGT_EXPORT(bgt_debug_state) uint32_t bgt_debug_state(void) {
    static char debug[256];char *p=debug;
    const char *keys[]={"phase","frame","pixel","read","error","compiled","events","caps","languages"};
    uint32_t values[]={phase,frame,result[0],read_ok,(uint32_t)submit_error,compile_ok,events,io.caps,
        limits.shader_languages};
    *p++='{';
    for(uint32_t i=0;i<9;i++) {
        if(i)*p++=',';*p++='"';const char *k=keys[i];while(*k)*p++=*k++;*p++='"';*p++=':';
        char digits[10];uint32_t n=0,v=values[i];do{digits[n++]='0'+v%10;v/=10;}while(v);
        while(n)*p++=digits[--n];
    }
    *p++='}';*p=0;return PTR(debug);
}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
