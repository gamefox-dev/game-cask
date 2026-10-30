/* Original CC0-1.0 native §13 conformance scenes. No game/engine content. */
#include "bgt.h"
#include "bgt_cmd.h"
static uint32_t strlen(const char *s) { uint32_t n=0; while(s[n]) n++; return n; }
static void strcpy(char *d,const char *s) { while((*d++=*s++)) {} }
static void strcat(char *d,const char *s) { strcpy(d+strlen(d),s); }
/* Additional native-WGSL/lifetime cases share the one fixture and IO block.
 * arg1=2 selects these cases; arg1=3 selects their GLSLES variant. */
static bgt_io_t *shared_io;
#define io (*shared_io)
static uint8_t async_buf[65536] __attribute__((aligned(16)));
static uint32_t commands[16384], scene, ready, checks, frames, captured;
static bgt_cmdbuf_t cb;
static uint8_t result[8192];
static const float vertices[] = {
    -0.8f,-0.8f, 1,0,0,1, 0,1,
     0.8f,-0.8f, 0,1,0,1, 1,1,
     0.0f, 0.8f, 0,0,1,1, 0.5f,0,
};
static const float quad[] = {
    -1,-1, 1,1,1,1, 0,1,  1,-1, 1,1,1,1, 1,1,
     1, 1, 1,1,1,1, 1,0, -1, 1, 1,1,1,1, 0,0,
};
static const uint16_t indices[] = {0,1,2,0,2,3};
static float instances[2002], uniform_data[4];
static const char common[] =
    "struct V { @builtin(position) p: vec4f, @location(0) c: vec4f, @location(1) uv: vec2f };\n";
static const char vertex[] =
    "@vertex fn vs_main(@location(0) p: vec2f, @location(1) c: vec4f, @location(2) uv: vec2f) -> V {"
    "return V(vec4f(p,0.5,1), c, uv); }\n";
static const char fragment[] =
    "@fragment fn fs_main(v: V) -> @location(0) vec4f { return v.c; }\n";
static const char textured[] =
    "@group(1) @binding(0) var t: texture_2d<f32>; @group(1) @binding(1) var s: sampler;"
    "@fragment fn fs_main(v: V) -> @location(0) vec4f { return textureSampleLevel(t,s,v.uv,1.0); }\n";
static const char mrt[] =
    "struct F { @location(0) a: vec4f, @location(1) b: vec4f };"
    "@fragment fn fs_main(v: V) -> F { return F(vec4f(1,0,0,1), vec4f(0,0,1,1)); }\n";
static const char mrt_sample[] =
    "@group(1) @binding(0) var t: texture_2d<f32>; @group(1) @binding(1) var s: sampler;"
    "@group(1) @binding(2) var t2: texture_2d<f32>; @group(1) @binding(3) var s2: sampler;"
    "@fragment fn fs_main(v: V) -> @location(0) vec4f {"
    "return (textureSample(t,s,v.uv)+textureSample(t2,s2,v.uv))*vec4f(0.5,0.5,0.5,0.5); }\n";
static const char sprite_vertex[] =
    "@vertex fn vs_main(@location(0) p: vec2f, @location(1) c: vec4f, @location(2) uv: vec2f,"
    "@location(3) offset: vec2f, @builtin(instance_index) id: u32) -> V {"
    "return V(vec4f(p*0.015+offset,0.5,1),vec4f(0,1,0,1),uv); }\n";
static const char animated[] =
    "struct U { color: vec4f }; @group(0) @binding(0) var<uniform> u: U;"
    "@fragment fn fs_main(v: V) -> @location(0) vec4f { return u.color; }\n";
static const char stencil_fragment[] =
    "@fragment fn fs_main(v: V) -> @location(0) vec4f { return vec4f(0,1,0,1); }\n";
static const char red_fragment[] =
    "@fragment fn fs_main(v: V) -> @location(0) vec4f { return vec4f(1,0,0,1); }\n";
static const char glsl_vs[] =
    "#version 330 core\nlayout(location=0) in vec2 pos; layout(location=1) in vec4 color;"
    "layout(location=2) in vec2 uv; out vec4 v_color; out vec2 v_uv;"
    "void main() { gl_Position=vec4(pos,0.5,1.0); v_color=color; v_uv=uv; }";
static const char glsl_fs[] =
    "#version 330 core\nlayout(std140) uniform bgt_u0 { vec4 tint; };"
    "uniform sampler2D bgt_t0; in vec4 v_color; in vec2 v_uv; layout(location=0) out vec4 out_color;"
    "void main() { if (gl_FragCoord.x < 16.0) discard; out_color=texture(bgt_t0,v_uv)*tint; }";
static char source[8192];
BGT_EXPORT(bgt_async_buffer) uint32_t bgt_async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t bgt_async_buffer_size(void) { return sizeof async_buf; }
static void submit(void) { if (bgt_cmd_submit(&cb)) checks|=0x80000000u; bgt_cmd_reset(&cb); }
static void buffer(uint32_t h,uint32_t usage,const void *p,uint32_t size) {
    bgt_gpu_buffer_create_t a={h,usage,size,(uint32_t)(uintptr_t)p,p?size:0}; bgt_cmd_gpu_buffer_create(&cb,&a);
}
static void shader(uint32_t h,uint32_t stage,uint32_t language,const char *p) {
    bgt_gpu_shader_create_t a={h,stage,language,(uint32_t)(uintptr_t)p,(uint32_t)strlen(p),h};
    bgt_cmd_gpu_shader_create(&cb,&a);
}
static void texture(uint32_t h,uint32_t size,uint32_t mips,uint32_t format,uint32_t usage) {
    bgt_gpu_texture_create_t a={h,size,size,mips,format,usage}; bgt_cmd_gpu_texture_create(&cb,&a);
}
static void update_texture(uint32_t h,uint32_t mip,uint32_t size,const void *data) {
    bgt_gpu_texture_update_t a={h,mip,0,0,size,size,(uint32_t)(uintptr_t)data,size*size*4};
    bgt_cmd_gpu_texture_update(&cb,&a);
}
static void pipeline(uint32_t h,uint32_t vs,uint32_t fs,uint32_t colors,uint32_t depth,uint32_t stencil) {
    bgt_gpu_pipeline_create_t p={0};
    p.handle=h; p.vertex_shader=vs; p.fragment_shader=fs; p.topology=3; p.depth_format=depth;
    p.depth_test=depth!=0xffffffffu; p.depth_write=p.depth_test; p.depth_compare=3;
    p.stencil_enable=!!stencil; p.stencil_read_mask=255; p.stencil_write_mask=stencil==1?255:0;
    p.front_compare=p.back_compare=stencil==2?2:7;
    p.front_pass=p.back_pass=stencil==1?2:0;
    p.uniform_mask=scene==5||scene==6; p.texture_mask=scene==1||scene==6?1:scene==2&&h==2?3:0;
    p.buffer_count=scene==4?2:1; p.attribute_count=scene==4?4:3; p.color_count=colors;
    bgt_gpu_vertex_layout_t layouts[2]={{32,0},{8,1}};
    bgt_gpu_attribute_t attrs[4]={{0,0,0,1},{1,0,8,3},{2,0,24,1},{3,1,0,1}};
    bgt_gpu_color_target_t targets[2]={{0,0,6,7,0,1,7,0,15},{0,0,1,0,0,1,0,0,15}};
    if (scene==1) targets[0].blend=1;
    if (scene==3 && h==1) targets[0].write_mask=0;
    bgt_cmd_gpu_pipeline_create(&cb,&p,layouts,attrs,targets);
}
static void pass(uint32_t colors,uint32_t target,uint32_t depth,uint32_t load) {
    bgt_gpu_pass_begin_t p={colors,depth,0,depth?1:0,depth?1:0,1,0};
    bgt_gpu_color_attachment_t a[2]={{target,0,load,0,0,0,1},{3,0,1,0,0,0,1}};
    bgt_cmd_gpu_pass_begin(&cb,&p,a);
}
static void bind(uint32_t p) {
    bgt_gpu_pipeline_t a={p}; bgt_cmd_gpu_pipeline(&cb,&a);
    bgt_gpu_vertex_buffer_t b={0,1,0,scene==0?sizeof vertices:sizeof quad}; bgt_cmd_gpu_vertex_buffer(&cb,&b);
    bgt_gpu_index_buffer_t i={2,0,0,sizeof indices}; bgt_cmd_gpu_index_buffer(&cb,&i);
    if(scene==4) { bgt_gpu_vertex_buffer_t c={1,3,0,sizeof instances}; bgt_cmd_gpu_vertex_buffer(&cb,&c); }
    if(scene==5||scene==6) { bgt_gpu_uniform_buffer_t u={0,4,0,16}; bgt_cmd_gpu_uniform_buffer(&cb,&u); }
    if(scene==1||scene==6||(scene==2&&p==2)) {
        bgt_gpu_texture_t t={0,scene==2?2:1,1}; bgt_cmd_gpu_texture(&cb,&t);
        if(scene==2) { t.slot=1; t.handle=3; bgt_cmd_gpu_texture(&cb,&t); }
    }
}
static void draw(void) {
    bgt_gpu_draw_indexed_t a={scene==0?3:6,scene==4?1000:1,0,0,scene==4?1:0};
    bgt_cmd_gpu_draw_indexed(&cb,&a);
}
int32_t wgsl_init(bgt_io_t *p) {
    shared_io=p; io.logical_width=64; io.logical_height=64; scene=io.arg0;
    if (!(io.caps&BGT_CAP_GPU)) return 0;
    bgt_cmd_init(&cb,commands,sizeof commands);
    buffer(1,1,scene==0?vertices:quad,scene==0?sizeof vertices:sizeof quad);
    buffer(2,2,indices,sizeof indices);
    instances[0]=instances[1]=100;
    for(uint32_t i=0;i<1000;i++) {
        instances[i*2+2]=-0.98f+(i%40)*0.05f; instances[i*2+3]=-0.96f+(i/40)*0.08f;
    }
    if(scene==4) buffer(3,1,instances,sizeof instances);
    if(scene==5||scene==6) { uniform_data[0]=1;uniform_data[1]=1;uniform_data[2]=1;uniform_data[3]=1;
        buffer(4,4,uniform_data,sizeof uniform_data); }
    if(scene==1||scene==2||scene==6) {
        bgt_gpu_sampler_create_t s={1,0,0,1,0,0,0,7}; bgt_cmd_gpu_sampler_create(&cb,&s);
        if(scene==2) { texture(2,64,1,0,3); texture(3,64,1,0,3); }
        else {
            static const uint32_t pixels[16]={0xff0000ff,0xff0000ff,0xff0000ff,0xff0000ff,
                0xff0000ff,0xff0000ff,0xff0000ff,0xff0000ff,0xff0000ff,0xff0000ff,0xff0000ff,0xff0000ff,
                0xff0000ff,0xff0000ff,0xff0000ff,0xff0000ff};
            static const uint32_t mip[4]={0x8000ff00,0x8000ff00,0x8000ff00,0x8000ff00};
            texture(1,4,2,0,1); update_texture(1,0,4,pixels); update_texture(1,1,2,mip);
        }
    }
    if(scene==3) texture(4,64,1,5,2);
    if(scene==6) {
        if(io.arg1==3) {
            strcpy(source,"#version 300 es\nprecision highp float;\n");
            strcat(source,glsl_vs+18); shader(1,1,2,source); submit();
            strcpy(source,"#version 300 es\nprecision highp float;\n");
            strcat(source,glsl_fs+18); shader(2,2,2,source);
        } else { shader(1,1,1,glsl_vs); shader(2,2,1,glsl_fs); }
    }
    else {
        strcpy(source,common); strcat(source,scene==4?sprite_vertex:vertex);
        strcat(source,scene==1?textured:scene==2?mrt:scene==3?stencil_fragment:scene==5?animated:fragment);
        shader(1,3,0,source);
        if(scene==2 || scene==3) {
            submit(); strcpy(source,common); strcat(source,vertex);
            strcat(source,scene==2?mrt_sample:red_fragment); shader(2,3,0,source);
        }
    }
    /* Deleting a pending shader must still complete its request, not affect a reused handle. */
    shader(9,1,1,glsl_vs);
    bgt_gpu_shader_delete_t shd={9}; bgt_cmd_gpu_shader_delete(&cb,&shd);
    static const char bad[]="@vertex fn vs_main( {";
    bgt_gpu_shader_create_t bad_shader={9,1,0,(uint32_t)(uintptr_t)bad,sizeof bad-1,10};
    bgt_cmd_gpu_shader_create(&cb,&bad_shader); bgt_cmd_gpu_shader_delete(&cb,&shd);
    static const char bad_glsl[]="#version 330 core\nvoid main() { missing=1.0; }";
    bad_shader.language=1; bad_shader.source_ptr=(uint32_t)(uintptr_t)bad_glsl;
    bad_shader.source_len=sizeof bad_glsl-1; bad_shader.request=11;
    bgt_cmd_gpu_shader_create(&cb,&bad_shader); bgt_cmd_gpu_shader_delete(&cb,&shd);
    /* Exercise deletion/reuse in stream order without disturbing scene resources. */
    buffer(9,1,quad,sizeof quad);
    bgt_gpu_buffer_delete_t bd={9}; bgt_cmd_gpu_buffer_delete(&cb,&bd);
    texture(9,1,1,0,1);
    bgt_gpu_texture_delete_t td={9}; bgt_cmd_gpu_texture_delete(&cb,&td);
    bgt_gpu_sampler_create_t sc={9,0,0,0,0,0,0,7}; bgt_cmd_gpu_sampler_create(&cb,&sc);
    bgt_gpu_sampler_delete_t sd={9}; bgt_cmd_gpu_sampler_delete(&cb,&sd);
    submit(); return 0;
}
void wgsl_update(uint32_t dt) {
    (void)dt;
    if(!(io.caps&BGT_CAP_GPU)) { for(;;) bgt_yield(); }
    while(!ready) {
        while(bgt_request_status(1)==0) bgt_yield();
        int32_t n=bgt_request_read(1,result,sizeof result);
        if(n>=4 && *(int32_t*)result==0) checks|=1;
        else if(n>4) bgt_log(1,(const char*)result+4,n-4);
        bgt_request_close(1);
        if(scene==2||scene==3||scene==6) {
            while(bgt_request_status(2)==0) bgt_yield();
            int32_t n=bgt_request_read(2,result,sizeof result);
            if(n<4||*(int32_t*)result) { checks|=0x40000000u; if(n>4) bgt_log(1,(const char*)result+4,n-4); }
            bgt_request_close(2);
        }
        while(bgt_request_status(9)==0 || bgt_request_status(10)==0) bgt_yield();
        if(bgt_request_read(9,result,sizeof result)<4 || *(int32_t*)result!=0) checks|=0x20000000u;
        bgt_request_close(9);
        n=bgt_request_read(10,result,sizeof result);
        if(n<=4 || *(int32_t*)result!=BGT_E_IO) checks|=0x10000000u;
        bgt_request_close(10);
        while(bgt_request_status(11)==0) bgt_yield();
        n=bgt_request_read(11,result,sizeof result);
        if(n<=4 || *(int32_t*)result!=BGT_E_IO) checks|=0x10000000u;
        bgt_request_close(11);
        ready=1;
        pipeline(1,1,scene==6?2:1,scene==2?2:1,scene==3?5:0xffffffffu,scene==3?1:0);
        if(scene==2) pipeline(2,2,2,1,0xffffffffu,0);
        if(scene==3) { pipeline(2,1,1,1,5,2); pipeline(3,2,2,1,5,2); }
        pipeline(9,1,scene==6?2:1,scene==2?2:1,scene==3?5:0xffffffffu,scene==3?1:0);
        bgt_gpu_pipeline_delete_t pd={9}; bgt_cmd_gpu_pipeline_delete(&cb,&pd);
        submit();
    }
    for(;;) {
        if(captured && bgt_request_status(77)==1) {
            if(bgt_request_read(77,result,sizeof result)==4) {
                uint32_t pixel=*(uint32_t*)result;
                static const uint32_t expected[8]={0,0xff008000,0xff800080,0xff00ff00,
                    0xff00ff00,0,0xff0000ff,0xffffffff};
                if(scene==0) {
                    if((pixel&255)>40 && ((pixel>>16)&255)>80) checks|=2;
                } else if(scene==5) {
                    if(pixel==0xff0000ff || pixel==0xff00ff00) checks|=2;
                } else if(pixel==expected[scene]) checks|=2;
            }
            bgt_request_close(77); captured=2;
        }
        frames++; bgt_yield();
    }
}
void wgsl_render(void) {
    if(!ready) return;
    bgt_cmd_reset(&cb);
    if(scene==5) {
        uniform_data[0]=frames%2?1:0; uniform_data[1]=frames%2?0:1; uniform_data[2]=0; uniform_data[3]=1;
        bgt_gpu_buffer_update_t u={4,0,(uint32_t)(uintptr_t)uniform_data,16}; bgt_cmd_gpu_buffer_update(&cb,&u);
    }
    bgt_cmd_clear(&cb,BGT_RGBA(0,0,100,255));
    pass(scene==2?2:1,scene==2?2:0,scene==3?4:0,scene==7?0:1); bind(1);
    bgt_gpu_viewport_t v={0,0,64,64,0,1}; bgt_cmd_gpu_viewport(&cb,&v);
    bgt_gpu_blend_constant_t c={0,0,0,0}; bgt_cmd_gpu_blend_constant(&cb,&c);
    if(scene==3) {
        bgt_gpu_scissor_t s={0,0,32,64}; bgt_cmd_gpu_scissor(&cb,&s);
        bgt_gpu_stencil_ref_t ref={7}; bgt_cmd_gpu_stencil_ref(&cb,&ref); draw();
        s.width=64; bgt_cmd_gpu_scissor(&cb,&s); bind(2); draw();
        /* Farther red geometry passes stencil but must fail depth, preserving green. */
        v.min_depth=v.max_depth=0.8f; bgt_cmd_gpu_viewport(&cb,&v); bind(3); draw();
    } else draw();
    bgt_cmd_gpu_pass_end(&cb);
    if(scene==2) { pass(1,0,0,1); bind(2); draw(); bgt_cmd_gpu_pass_end(&cb); }
    if(scene==7) {
        bgt_cmd_blend(&cb,BGT_BLEND_OPAQUE); bgt_cmd_rect(&cb,0,0,8,64,BGT_RGBA(255,255,0,255));
        pass(1,0,0,0); bind(1);
        bgt_gpu_scissor_t s={56,0,8,64}; bgt_cmd_gpu_scissor(&cb,&s);
        bgt_gpu_draw_t a={3,1,0,0}; bgt_cmd_gpu_draw(&cb,&a); bgt_cmd_gpu_pass_end(&cb);
    }
    if(!captured) {
        bgt_cmd_readback(&cb,77,0,scene==4?0:scene==7?60:20,scene==4?1:32,1,1); captured=1;
    }
    submit();
}
uint32_t wgsl_state_hash(void) { return checks; }

