/* SPDX-License-Identifier: CC0-1.0. Original GL 3.3 known-answer fixture (K62), no game assets or captured sources.
 * Viewports larger than the target, with a negative origin, partially or entirely off the target, empty, with the
 * scissor test and with normal/reversed glDepthRange (GL clips rasterization to the target; GL 3.3 §2.13.1);
 * the provoking vertex of flat (float and integer) varyings for triangles, strips, fans, indexed, GL_UNSIGNED_BYTE
 * indexed, line and line-strip draws, in both conventions (GL 3.3 Table 2.14); many varyings (packed interface),
 * the GL_MAX_VARYING_COMPONENTS boundary; and a dump of every GL 3.3 implementation-dependent limit
 * ("x64-gl-raster limit 0x.... v [v]") that tests/unit/x64-gl-raster.test.ts checks against the GL 3.3 minimums.
 * Colour checks are glReadPixels of an RGBA8 framebuffer (+-1 per channel, values computed from GL's formulas).
 * `glok(entry)` logs any GL error the check did not expect ("x64-gl-raster glerror <entry> 0x..."). The final screen
 * (see tests/e2e/x64-gl-raster.spec.ts) is redrawn every later frame without checks. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#include <string.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLGETSHADERIVPROC,glGetShaderiv) X(PFNGLGETSHADERINFOLOGPROC,glGetShaderInfoLog) X(PFNGLCREATEPROGRAMPROC,glCreateProgram) \
 X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLGETPROGRAMIVPROC,glGetProgramiv) \
 X(PFNGLGETPROGRAMINFOLOGPROC,glGetProgramInfoLog) X(PFNGLUSEPROGRAMPROC,glUseProgram) X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation) \
 X(PFNGLUNIFORM4FPROC,glUniform4f) X(PFNGLUNIFORM1FPROC,glUniform1f) X(PFNGLUNIFORM1IPROC,glUniform1i) X(PFNGLGENBUFFERSPROC,glGenBuffers) \
 X(PFNGLBINDBUFFERPROC,glBindBuffer) X(PFNGLBUFFERDATAPROC,glBufferData) X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) \
 X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) \
 X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) \
 X(PFNGLTEXIMAGE2DPROC,glTexImage2D) X(PFNGLTEXPARAMETERIPROC,glTexParameteri) X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) \
 X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) X(PFNGLGENRENDERBUFFERSPROC,glGenRenderbuffers) \
 X(PFNGLBINDRENDERBUFFERPROC,glBindRenderbuffer) X(PFNGLRENDERBUFFERSTORAGEPROC,glRenderbufferStorage) \
 X(PFNGLFRAMEBUFFERRENDERBUFFERPROC,glFramebufferRenderbuffer) X(PFNGLDRAWBUFFERSPROC,glDrawBuffers) X(PFNGLREADBUFFERPROC,glReadBuffer) \
 X(PFNGLVIEWPORTPROC,glViewport) X(PFNGLSCISSORPROC,glScissor) X(PFNGLDEPTHRANGEPROC,glDepthRange) X(PFNGLCLEARCOLORPROC,glClearColor) \
 X(PFNGLCLEARDEPTHPROC,glClearDepth) X(PFNGLCLEARPROC,glClear) X(PFNGLDEPTHFUNCPROC,glDepthFunc) X(PFNGLENABLEPROC,glEnable) \
 X(PFNGLDISABLEPROC,glDisable) X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLDRAWELEMENTSPROC,glDrawElements) \
 X(PFNGLPROVOKINGVERTEXPROC,glProvokingVertex) X(PFNGLREADPIXELSPROC,glReadPixels) X(PFNGLGETERRORPROC,glGetError) \
 X(PFNGLGETINTEGERVPROC,glGetIntegerv) X(PFNGLGETFLOATVPROC,glGetFloatv) X(PFNGLGETINTEGER64VPROC,glGetInteger64v)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static unsigned checks, failures, glerrors, quiet;
static void note(const char *s,int ok){char b[240];snprintf(b,sizeof b,"x64-gl-raster %s %s",ok?"ok":"FAIL",s);OutputDebugStringA(b);checks++;if(!ok)failures++;}
static void glok(const char *entry){if(quiet)return;GLenum e=glGetError();if(e){char b[120];snprintf(b,sizeof b,"x64-gl-raster glerror %s 0x%x",entry,e);OutputDebugStringA(b);glerrors++;while(glGetError());}}
static char logbuf[4096];
static GLuint shader(GLenum stage,const char *s){GLuint a=glCreateShader(stage);GLint ok=0;glShaderSource(a,1,&s,0);glCompileShader(a);glGetShaderiv(a,GL_COMPILE_STATUS,&ok);
 if(!ok){glGetShaderInfoLog(a,sizeof logbuf,0,logbuf);OutputDebugStringA(logbuf);}note("shader compiled",ok);return a;}
static GLuint program(const char *vs,const char *fs,int want){GLuint p=glCreateProgram();GLint ok=0;glAttachShader(p,shader(GL_VERTEX_SHADER,vs));glAttachShader(p,shader(GL_FRAGMENT_SHADER,fs));
 glLinkProgram(p);glGetProgramiv(p,GL_LINK_STATUS,&ok);logbuf[0]=0;if(!ok)glGetProgramInfoLog(p,sizeof logbuf,0,logbuf);if(want&&!ok)OutputDebugStringA(logbuf);glok("glLinkProgram");return ok?p:0;}
/* Vertex k: position (attribute 0) and colour (attribute 1) = (17k, 255 - 17k, 51) / 255, so red tells k. */
static GLuint vbo,ebo;static float vb[16*5];
static void vtx(int k,float x,float y){vb[k*5]=x;vb[k*5+1]=y;vb[k*5+2]=(float)(17*k)/255.0f;vb[k*5+3]=(float)(255-17*k)/255.0f;vb[k*5+4]=0.2f;}
static void upload(void){glBindBuffer(GL_ARRAY_BUFFER,vbo);glBufferData(GL_ARRAY_BUFFER,sizeof vb,vb,GL_DYNAMIC_DRAW);glok("glBufferData");}
static void indices(const void *d,unsigned n){glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ebo);glBufferData(GL_ELEMENT_ARRAY_BUFFER,n,d,GL_DYNAMIC_DRAW);glok("glBufferData");}
static int near1(unsigned got,double want){int w=(int)(want*255.0+0.5);return (int)got>=w-1&&(int)got<=w+1;}
static void readpx(int x,int y,unsigned char *p){p[0]=1;p[1]=2;p[2]=3;p[3]=4;glReadPixels(x,y,1,1,GL_RGBA,GL_UNSIGNED_BYTE,p);glok("glReadPixels");}
static void expect_rgb(int x,int y,double r,double g,double b,const char *s){unsigned char p[4];readpx(x,y,p);int ok=near1(p[0],r)&&near1(p[1],g)&&near1(p[2],b);
 if(!ok){char m[220];snprintf(m,sizeof m,"%s at %d,%d got %u,%u,%u want %.1f,%.1f,%.1f",s,x,y,p[0],p[1],p[2],r*255,g*255,b*255);note(m,0);}else note(s,1);}
static void expect_clear(int x,int y,const char *s){expect_rgb(x,y,1,0,1,s);}
/* Gradient program: colour = (viewport-relative x, y, window depth): (px+0.5-vx)/vw, (py+0.5-vy)/vh, zw. */
static GLuint grad,solid,flatp,grad_z,solid_z,solid_tint,flat_show;
static void expect_grad(int x,int y,int vx,int vy,int vw,int vh,double zw,const char *s){expect_rgb(x,y,(x+0.5-vx)/vw,(y+0.5-vy)/vh,zw,s);}
static void full_quad(void){vtx(0,-1,-1);vtx(1,1,-1);vtx(2,1,1);vtx(3,-1,-1);vtx(4,1,1);vtx(5,-1,1);upload();glDrawArrays(GL_TRIANGLES,0,6);glok("glDrawArrays");}
static GLuint fbo,tex,rbo;
static void target(void){glBindFramebuffer(GL_FRAMEBUFFER,fbo);glReadBuffer(GL_COLOR_ATTACHMENT0);glClearColor(1,0,1,1);glClearDepth(1);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);glok("glClear");}
static void viewports(void){
 glUseProgram(grad);glUniform1f(grad_z,0.2f);
 /* The 256x160 initial (window) viewport left in place while drawing into the 32x32 target (K61's finding). */
 target();full_quad();expect_grad(5,7,0,0,256,160,0.6,"window viewport into a smaller FBO");expect_grad(31,31,0,0,256,160,0.6,"window viewport, last target pixel");
 target();glViewport(-16,-8,48,40);full_quad();
 expect_grad(0,0,-16,-8,48,40,0.6,"negative origin, first pixel");expect_grad(31,31,-16,-8,48,40,0.6,"negative origin, last pixel");expect_grad(10,20,-16,-8,48,40,0.6,"negative origin, inner pixel");
 target();glViewport(20,24,40,40);full_quad();
 expect_grad(25,28,20,24,40,40,0.6,"partially off-target viewport");expect_grad(31,31,20,24,40,40,0.6,"partially off-target, corner");expect_clear(19,30,"left of the partial viewport");expect_clear(28,23,"below the partial viewport");
 target();glViewport(40,0,10,10);full_quad();expect_clear(31,0,"viewport right of the target draws nothing");expect_clear(0,0,"viewport off the target, origin");
 target();glViewport(-60,-60,20,20);full_quad();expect_clear(0,0,"viewport below/left of the target draws nothing");
 target();glViewport(0,0,0,32);full_quad();expect_clear(4,4,"zero-width viewport draws nothing");
 target();glViewport(-16,-8,48,40);glEnable(GL_SCISSOR_TEST);glScissor(4,4,8,8);full_quad();glDisable(GL_SCISSOR_TEST);
 expect_grad(4,4,-16,-8,48,40,0.6,"scissor inside an off-target viewport");expect_grad(11,11,-16,-8,48,40,0.6,"scissor box last pixel");
 expect_clear(3,5,"left of the scissor box");expect_clear(12,8,"right of the scissor box");
 /* glDepthRange: zd = 0.2 -> zw = (f-n)/2 zd + (n+f)/2 (n > f is legal). */
 target();glViewport(0,0,32,32);glDepthRange(0.25,0.75);glok("glDepthRange");full_quad();expect_grad(8,8,0,0,32,32,0.55,"depth range (0.25, 0.75)");
 target();glDepthRange(0.75,0.25);glok("glDepthRange");full_quad();expect_grad(8,8,0,0,32,32,0.45,"reversed depth range (0.75, 0.25)");
 {GLfloat r[2]={9,9};glGetFloatv(GL_DEPTH_RANGE,r);note("reversed depth range query",r[0]==0.75f&&r[1]==0.25f);glok("glGetFloatv");}
 target();glViewport(-16,-8,48,40);glDepthRange(1,0);full_quad();expect_grad(31,31,-16,-8,48,40,0.4,"off-target viewport with depth range (1, 0)");
 /* Depth buffer with a reversed range: zd 0.5 -> 0.375 is nearer than zd -0.5 -> 0.625, so the zd 0.5 quad (green) wins
  * over the later red one; with the normal range red (0.375) wins. */
 glUseProgram(solid);glEnable(GL_DEPTH_TEST);glDepthFunc(GL_LESS);
 for(int rev=0;rev<2;rev++){target();glViewport(-16,-8,48,40);rev?glDepthRange(0.75,0.25):glDepthRange(0.25,0.75);
  glUniform1f(solid_z,0.5f);glUniform4f(solid_tint,0,1,0,1);full_quad();glUniform1f(solid_z,-0.5f);glUniform4f(solid_tint,1,0,0,1);full_quad();
  if(rev)expect_rgb(16,16,0,1,0,"reversed depth range: depth test keeps the zd 0.5 quad");else expect_rgb(16,16,1,0,0,"normal depth range: depth test keeps the zd -0.5 quad");}
 glDisable(GL_DEPTH_TEST);glDepthRange(0,1);
 {GLint v[4]={0,0,0,0};glViewport(-5,-7,20000,30000);glGetIntegerv(GL_VIEWPORT,v);note("viewport size clamped to MAX_VIEWPORT_DIMS, origin kept",v[0]==-5&&v[1]==-7&&v[2]==16384&&v[3]==16384);
  glGetIntegerv(GL_MAX_VIEWPORT_DIMS,v);note("MAX_VIEWPORT_DIMS 16384",v[0]==16384&&v[1]==16384);glok("glGetIntegerv");}
 glViewport(-5,0,-1,4);note("negative viewport width is GL_INVALID_VALUE",glGetError()==GL_INVALID_VALUE);
 /* Default framebuffer: a viewport twice the window, centred. */
 glBindFramebuffer(GL_FRAMEBUFFER,0);glClearColor(1,0,1,1);glClear(GL_COLOR_BUFFER_BIT);glUseProgram(grad);glViewport(-128,-80,512,320);full_quad();
 expect_grad(0,0,-128,-80,512,320,0.6,"window: viewport larger than the window, first pixel");expect_grad(255,159,-128,-80,512,320,0.6,"window: last pixel");
 expect_grad(100,50,-128,-80,512,320,0.6,"window: inner pixel");
}
/* Provoking vertex: red = 17 * the vertex whose colour a flat-shaded primitive takes. */
static void expect_vertex(int x,int y,int k,const char *s){unsigned char p[4];readpx(x,y,p);int ok=p[0]==17*k&&p[1]==255-17*k;
 if(!ok){char m[200];snprintf(m,sizeof m,"%s at %d,%d got vertex %.2f (%u,%u) want %d",s,x,y,p[0]/17.0,p[0],p[1],k);note(m,0);}else note(s,1);}
static void flat_target(void){target();glViewport(0,0,32,32);glUseProgram(flatp);glUniform1i(flat_show,0);}
static void provoking(int first){
 char m[120];const char *conv=first?"first":"last";
#define CASE(what) (snprintf(m,sizeof m,"%s: %s",conv,what),m)
 /* Triangles: lower-left (sample 4,8) and upper-right (27,23) halves. */
 flat_target();vtx(0,-1,-1);vtx(1,0,-1);vtx(2,-1,1);vtx(3,1,1);vtx(4,0,1);vtx(5,1,-1);upload();glDrawArrays(GL_TRIANGLES,0,6);glok("glDrawArrays");
 expect_vertex(4,8,first?0:2,CASE("triangles, first triangle"));expect_vertex(27,23,first?3:5,CASE("triangles, second triangle"));
 /* Strip 0..3: triangle 0 (0,1,2) lower-left, triangle 1 (2,1,3) upper-right; GL: first i, last i+2. */
 flat_target();vtx(0,-1,-1);vtx(1,1,-1);vtx(2,-1,1);vtx(3,1,1);upload();glDrawArrays(GL_TRIANGLE_STRIP,0,4);glok("glDrawArrays");
 expect_vertex(4,8,first?0:2,CASE("strip, even triangle"));expect_vertex(27,23,first?1:3,CASE("strip, odd triangle"));
 /* Fan 0..3 around vertex 0: triangle 0 (0,1,2) lower-right, triangle 1 (0,2,3) upper-left; GL: first i+1, last i+2. */
 flat_target();vtx(0,-1,-1);vtx(1,1,-1);vtx(2,1,1);vtx(3,-1,1);upload();glDrawArrays(GL_TRIANGLE_FAN,0,4);glok("glDrawArrays");
 expect_vertex(27,8,first?1:2,CASE("fan, first triangle"));expect_vertex(4,23,first?2:3,CASE("fan, second triangle"));
 /* Indexed triangles (u16 and GL_UNSIGNED_BYTE) over the triangle-list geometry, each triangle rotated. */
 flat_target();vtx(0,-1,-1);vtx(1,0,-1);vtx(2,-1,1);vtx(3,1,1);vtx(4,0,1);vtx(5,1,-1);upload();
 {unsigned short e[]={1,2,0,4,5,3};indices(e,sizeof e);glDrawElements(GL_TRIANGLES,6,GL_UNSIGNED_SHORT,0);glok("glDrawElements");
  expect_vertex(4,8,first?1:0,CASE("u16 indexed, first triangle"));expect_vertex(27,23,first?4:3,CASE("u16 indexed, second triangle"));}
 flat_target();{unsigned char e[]={9,2,0,1,5,3,4};indices(e,sizeof e);glDrawElements(GL_TRIANGLES,6,GL_UNSIGNED_BYTE,(void*)1);glok("glDrawElements");
  expect_vertex(4,8,first?2:1,CASE("u8 indexed (offset 1), first triangle"));expect_vertex(27,23,first?5:4,CASE("u8 indexed, second triangle"));}
 /* Fan through GL_UNSIGNED_BYTE indices {3,2,1,0}: triangle 0 (3,2,1) upper-right, triangle 1 (3,1,0) lower-left
  * over the quad 0(-1,-1) 1(1,-1) 2(1,1) 3(-1,1). */
 flat_target();vtx(0,-1,-1);vtx(1,1,-1);vtx(2,1,1);vtx(3,-1,1);upload();{unsigned char e[]={3,2,1,0};indices(e,sizeof e);glDrawElements(GL_TRIANGLE_FAN,4,GL_UNSIGNED_BYTE,0);glok("glDrawElements");}
 expect_vertex(27,23,first?2:1,CASE("u8 fan, first triangle"));expect_vertex(4,8,first?1:0,CASE("u8 fan, second triangle"));
 /* Lines on pixel row 16: GL_LINES (0 -> 1) and a strip 2 -> 3 -> 4 on row 8. */
 flat_target();{float y=16.5f/16.0f-1.0f,y2=8.5f/16.0f-1.0f;vtx(0,-1,y);vtx(1,1,y);vtx(2,-1,y2);vtx(3,0.0f,y2);vtx(4,1,y2);upload();}
 glDrawArrays(GL_LINES,0,2);glDrawArrays(GL_LINE_STRIP,2,3);glok("glDrawArrays");
 expect_vertex(16,16,first?0:1,CASE("line"));expect_vertex(8,8,first?2:3,CASE("line strip, first segment"));expect_vertex(24,8,first?3:4,CASE("line strip, second segment"));
 /* Integer flat varying (gl_VertexID): the strip from first=6 shows ids 8 / 9 (last) or 6 / 7 (first). */
 flat_target();glUniform1i(flat_show,1);vtx(6,-1,-1);vtx(7,1,-1);vtx(8,-1,1);vtx(9,1,1);upload();glDrawArrays(GL_TRIANGLE_STRIP,6,4);glok("glDrawArrays");
 {unsigned char p[4];char n[160];readpx(4,8,p);snprintf(n,sizeof n,"%s at 4,8 got %u",CASE("integer flat varying, even strip triangle"),p[0]);note(n,p[0]==(first?6:8));
  readpx(27,23,p);snprintf(n,sizeof n,"%s at 27,23 got %u",CASE("integer flat varying, odd strip triangle"),p[0]);note(n,p[0]==(first?7:9));}
#undef CASE
}
/* N float varyings, each 1/255: red = N. */
static GLuint many(int n,int want){static char vs[16384],fs[16384];int a=snprintf(vs,sizeof vs,"#version 330 core\nlayout(location=0) in vec2 p;"),b=snprintf(fs,sizeof fs,"#version 330 core\nout vec4 o;");
 for(int i=0;i<n;i++){a+=snprintf(vs+a,sizeof vs-a,"out float f%d;",i);b+=snprintf(fs+b,sizeof fs-b,"in float f%d;",i);}
 a+=snprintf(vs+a,sizeof vs-a,"void main(){");b+=snprintf(fs+b,sizeof fs-b,"void main(){float s=0.0;");
 for(int i=0;i<n;i++){a+=snprintf(vs+a,sizeof vs-a,"f%d=1.0/255.0;",i);b+=snprintf(fs+b,sizeof fs-b,"s+=f%d;",i);}
 snprintf(vs+a,sizeof vs-a,"gl_Position=vec4(p,0.0,1.0);}");snprintf(fs+b,sizeof fs-b,"o=vec4(s,0.0,0.0,1.0);}");return program(vs,fs,want);}
static void varyings(void){
 /* 40 smooth floats + vec3 + noperspective float + flat ivec2: 46 components in 13 packed locations (unpacked: 43). */
 static char vs[8192],fs[8192];int a=snprintf(vs,sizeof vs,"#version 330 core\nlayout(location=0) in vec2 p;out vec3 c3;noperspective out float np;flat out ivec2 iv;"),
  b=snprintf(fs,sizeof fs,"#version 330 core\nin vec3 c3;noperspective in float np;flat in ivec2 iv;out vec4 o;");
 for(int i=0;i<40;i++){a+=snprintf(vs+a,sizeof vs-a,"out float f%d;",i);b+=snprintf(fs+b,sizeof fs-b,"in float f%d;",i);}
 a+=snprintf(vs+a,sizeof vs-a,"void main(){c3=vec3(0.2,0.4,0.6);np=0.8;iv=ivec2(3,-5);");b+=snprintf(fs+b,sizeof fs-b,"void main(){float s=0.0;");
 for(int i=0;i<40;i++){a+=snprintf(vs+a,sizeof vs-a,"f%d=1.0/255.0;",i);b+=snprintf(fs+b,sizeof fs-b,"s+=f%d;",i);}
 snprintf(vs+a,sizeof vs-a,"gl_Position=vec4(p,0.0,1.0);}");snprintf(fs+b,sizeof fs-b,"o=vec4(s,c3.y,iv.x==3&&iv.y==-5?c3.z:0.0,np);}");
 GLint limit=0;glGetIntegerv(GL_MAX_VARYING_COMPONENTS,&limit);glok("glGetIntegerv");
 /* Links iff the device's capacity allows 46 components (every real backend so far; a minimal WebGL 2 device has 42). */
 GLuint p=program(vs,fs,limit>=46);note("46-component varying interface links iff within MAX_VARYING_COMPONENTS",(p!=0)==(limit>=46));
 if(p){target();glViewport(0,0,32,32);glUseProgram(p);full_quad();unsigned char px[4];readpx(9,9,px);
  note("46-component varying interface values",near1(px[0],40/255.0)&&near1(px[1],0.4)&&near1(px[2],0.6)&&near1(px[3],0.8));}
 else note("46-component varying interface values (not linked on this device)",1);
 {char m[80];snprintf(m,sizeof m,"x64-gl-raster varying-limit=%d",limit);OutputDebugStringA(m);}
 GLuint at=many(limit>255?255:limit,1);note("MAX_VARYING_COMPONENTS float varyings link",at!=0);
 if(at){target();glViewport(0,0,32,32);glUseProgram(at);full_quad();unsigned char px[4];readpx(20,20,px);note("MAX_VARYING_COMPONENTS float varyings values",near1(px[0],(limit>255?255:limit)/255.0));}
 GLuint over=many(limit+1,0);note("one varying component over the limit fails to link with an info log",!over&&strstr(logbuf,"GL_MAX_VARYING_COMPONENTS")!=0);
}
/* Every GL 3.3 implementation-dependent value (Tables 6.38-6.47) as "x64-gl-raster limit 0x.... v [v]" or "... error 0x...". */
static void limits(void){
 static const struct{GLenum e;int kind;}q[]={ /* kind 0 int, 1 int pair, 2 float, 3 float pair, 4 int64 */
  {0x0D32,0},{0x0D50,0},{0x8073,0},{0x0D33,0},{0x88FF,0},{0x84FD,2},{0x851C,0},{0x84E8,0},{0x0D3A,1},{0x0B12,3},{0x846E,3},{0x0B22,3},
  {0x86A2,0},{0x8C2B,0},{0x84F8,0},{0x821B,0},{0x821C,0},{0x8869,0},{0x8B4A,0},{0x8A2B,0},{0x9122,0},{0x8B4C,0},{0x8A2C,0},{0x9123,0},
  {0x9124,0},{0x8DE0,0},{0x8DE1,0},{0x8C29,0},{0x8DDF,0},{0x8B49,0},{0x8A2D,0},{0x9125,0},{0x8872,0},{0x8904,0},{0x8905,0},{0x8A2F,0},
  {0x8A30,0},{0x8A34,0},{0x8A2E,0},{0x8A31,0},{0x8A32,0},{0x8A33,0},{0x8B4B,0},{0x8B4D,0},{0x8E59,0},{0x910E,0},{0x910F,0},{0x9110,0},
  {0x9111,4},{0x8C8A,0},{0x8C8B,0},{0x8C80,0},{0x8824,0},{0x88FC,0},{0x8CDF,0},{0x8D57,0},{0x80E8,0},{0x80E9,0}};
 for(unsigned i=0;i<sizeof q/sizeof q[0];i++){char m[120];GLint v[2]={0,0};GLfloat f[2]={0,0};GLint64 l=0;GLenum e;
  if(q[i].kind<2)glGetIntegerv(q[i].e,v);else if(q[i].kind<4)glGetFloatv(q[i].e,f);else glGetInteger64v(q[i].e,&l);
  if((e=glGetError())){while(glGetError()){}snprintf(m,sizeof m,"x64-gl-raster limit 0x%04x error 0x%x",q[i].e,e);}
  else if(q[i].kind==0)snprintf(m,sizeof m,"x64-gl-raster limit 0x%04x %d",q[i].e,v[0]);
  else if(q[i].kind==1)snprintf(m,sizeof m,"x64-gl-raster limit 0x%04x %d %d",q[i].e,v[0],v[1]);
  else if(q[i].kind==2)snprintf(m,sizeof m,"x64-gl-raster limit 0x%04x %g",q[i].e,f[0]);
  else if(q[i].kind==3)snprintf(m,sizeof m,"x64-gl-raster limit 0x%04x %g %g",q[i].e,f[0],f[1]);
  else snprintf(m,sizeof m,"x64-gl-raster limit 0x%04x %lld",q[i].e,(long long)l);
  OutputDebugStringA(m);}
 {GLint pv=0;glGetIntegerv(GL_PROVOKING_VERTEX,&pv);note("provoking vertex query (initial last)",pv==GL_LAST_VERTEX_CONVENTION);glok("glGetIntegerv");}
 glProvokingVertex(0x1234);note("bad provoking vertex mode is GL_INVALID_ENUM",glGetError()==GL_INVALID_ENUM);
}
/* Final screen 256x160: the whole window a gradient drawn with a viewport twice its size; a flat fan (vertices 0..3,
 * last convention) in the top-right 64x64 tile drawn with a viewport that extends 32 pixels past the right edge. */
static void screen(void){
 glBindFramebuffer(GL_FRAMEBUFFER,0);glClearColor(0.25f,0.25f,0.25f,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");
 glUseProgram(grad);glUniform1f(grad_z,0.2f);glViewport(-128,-80,512,320);full_quad();
 glUseProgram(flatp);glUniform1i(flat_show,0);glViewport(192,96,96,64);
 vtx(0,-1,-1);vtx(1,1.0f/3.0f,-1);vtx(2,1.0f/3.0f,1);vtx(3,-1,1);upload();glDrawArrays(GL_TRIANGLE_FAN,0,4);glok("glDrawArrays");
}
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="RasterContract";RegisterClassA(&c);HWND win=CreateWindowExA(0,c.lpszClassName,"Raster",WS_VISIBLE|WS_POPUP,0,0,256,160,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;pfd.cDepthBits=24;pfd.cStencilBits=8;SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);wglMakeCurrent(dc,wglCreateContext(dc));
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 GLuint vao;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&vbo);glGenBuffers(1,&ebo);
 glBindBuffer(GL_ARRAY_BUFFER,vbo);glBufferData(GL_ARRAY_BUFFER,sizeof vb,vb,GL_DYNAMIC_DRAW);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,20,0);glVertexAttribPointer(1,3,GL_FLOAT,GL_FALSE,20,(void*)8);
 glEnableVertexAttribArray(0);glEnableVertexAttribArray(1);
 grad=program("#version 330 core\nlayout(location=0) in vec2 p;uniform float z;out vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,z,1.0);}",
  "#version 330 core\nin vec2 v;layout(location=0) out vec4 o;void main(){o=vec4(v,gl_FragCoord.z,1.0);}",1);grad_z=glGetUniformLocation(grad,"z");
 solid=program("#version 330 core\nlayout(location=0) in vec2 p;uniform float z;void main(){gl_Position=vec4(p,z,1.0);}",
  "#version 330 core\nuniform vec4 tint;layout(location=0) out vec4 o;void main(){o=tint;}",1);solid_z=glGetUniformLocation(solid,"z");solid_tint=glGetUniformLocation(solid,"tint");
 flatp=program("#version 330 core\nlayout(location=0) in vec2 p;layout(location=1) in vec3 col;flat out vec3 c;flat out int id;void main(){c=col;id=gl_VertexID;gl_Position=vec4(p,0.0,1.0);}",
  "#version 330 core\nflat in vec3 c;flat in int id;uniform int show;layout(location=0) out vec4 o;void main(){o=show!=0?vec4(float(id)/255.0,0.0,0.0,1.0):vec4(c,1.0);}",1);
 flat_show=glGetUniformLocation(flatp,"show");
 glGenFramebuffers(1,&fbo);glBindFramebuffer(GL_FRAMEBUFFER,fbo);glGenTextures(1,&tex);glBindTexture(GL_TEXTURE_2D,tex);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);
 glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,32,32,0,GL_RGBA,GL_UNSIGNED_BYTE,0);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex,0);
 glGenRenderbuffers(1,&rbo);glBindRenderbuffer(GL_RENDERBUFFER,rbo);glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH24_STENCIL8,32,32);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_STENCIL_ATTACHMENT,GL_RENDERBUFFER,rbo);
 GLenum one[1]={GL_COLOR_ATTACHMENT0};glDrawBuffers(1,one);glok("setup");
 limits();viewports();provoking(0);glProvokingVertex(GL_FIRST_VERTEX_CONVENTION);glok("glProvokingVertex");
 {GLint pv=0;glGetIntegerv(GL_PROVOKING_VERTEX,&pv);note("provoking vertex query (first)",pv==GL_FIRST_VERTEX_CONVENTION);}
 provoking(1);glProvokingVertex(GL_LAST_VERTEX_CONVENTION);varyings();screen();
 /* Screen readback: gradient (viewport -128,-80,512,320) and the fan tile (viewport 192,96,96,64). */
 expect_grad(10,10,-128,-80,512,320,0.6,"screen gradient");expect_grad(150,130,-128,-80,512,320,0.6,"screen gradient top");
 expect_vertex(250,100,2,"screen fan first triangle");expect_vertex(200,150,3,"screen fan second triangle");
 SwapBuffers(dc);char summary[160];snprintf(summary,sizeof summary,"x64-gl-raster PASS failures=%u checks=%u glerrors=%u",failures,checks,glerrors);OutputDebugStringA(summary);
 quiet=1;for(;;){screen();SwapBuffers(dc);}
}
