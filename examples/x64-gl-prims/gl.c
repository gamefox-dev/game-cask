/* SPDX-License-Identifier: CC0-1.0. Original GL 3.3 known-answer fixture (K61), no game assets or captured sources.
 * Scissored and write-masked glClear, the primitive modes WebGPU/WebGL 2 lack natively (TRIANGLE_FAN, LINE_LOOP, the
 * four adjacency modes) and primitive restart, multi/range draws, separate stencil, line/point/hint/polygon-offset
 * state, sync objects and 64-bit queries. Every check is exact: colour through glReadPixels of an RGBA8 framebuffer,
 * vertex order through transform feedback. `glok(entry)` logs any GL error an entry raised that the check did not
 * expect ("x64-gl-prims glerror <entry> 0x..."), which is the fixture's guest-side error census. The final screen
 * holds eight tiles (see tests/e2e/x64-gl-prims.spec.ts) and is redrawn every later frame without error checks. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#include <string.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLGETSHADERIVPROC,glGetShaderiv) X(PFNGLGETSHADERINFOLOGPROC,glGetShaderInfoLog) X(PFNGLCREATEPROGRAMPROC,glCreateProgram) \
 X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLGETPROGRAMIVPROC,glGetProgramiv) \
 X(PFNGLUSEPROGRAMPROC,glUseProgram) X(PFNGLBINDATTRIBLOCATIONPROC,glBindAttribLocation) X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation) \
 X(PFNGLUNIFORM4FPROC,glUniform4f) X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) X(PFNGLBUFFERDATAPROC,glBufferData) \
 X(PFNGLBINDBUFFERBASEPROC,glBindBufferBase) X(PFNGLGETBUFFERSUBDATAPROC,glGetBufferSubData) X(PFNGLGETBUFFERPARAMETERI64VPROC,glGetBufferParameteri64v) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) \
 X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) X(PFNGLTRANSFORMFEEDBACKVARYINGSPROC,glTransformFeedbackVaryings) \
 X(PFNGLBEGINTRANSFORMFEEDBACKPROC,glBeginTransformFeedback) X(PFNGLENDTRANSFORMFEEDBACKPROC,glEndTransformFeedback) \
 X(PFNGLGENQUERIESPROC,glGenQueries) X(PFNGLBEGINQUERYPROC,glBeginQuery) X(PFNGLENDQUERYPROC,glEndQuery) X(PFNGLGETQUERYOBJECTUIVPROC,glGetQueryObjectuiv) \
 X(PFNGLGETQUERYOBJECTUI64VPROC,glGetQueryObjectui64v) \
 X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) X(PFNGLTEXPARAMETERIPROC,glTexParameteri) \
 X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) \
 X(PFNGLGENRENDERBUFFERSPROC,glGenRenderbuffers) X(PFNGLBINDRENDERBUFFERPROC,glBindRenderbuffer) X(PFNGLRENDERBUFFERSTORAGEPROC,glRenderbufferStorage) \
 X(PFNGLFRAMEBUFFERRENDERBUFFERPROC,glFramebufferRenderbuffer) X(PFNGLDRAWBUFFERSPROC,glDrawBuffers) X(PFNGLREADBUFFERPROC,glReadBuffer) \
 X(PFNGLVIEWPORTPROC,glViewport) X(PFNGLSCISSORPROC,glScissor) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLCLEARDEPTHPROC,glClearDepth) \
 X(PFNGLCLEARSTENCILPROC,glClearStencil) X(PFNGLCLEARPROC,glClear) X(PFNGLCOLORMASKPROC,glColorMask) X(PFNGLCOLORMASKIPROC,glColorMaski) \
 X(PFNGLDEPTHMASKPROC,glDepthMask) X(PFNGLSTENCILMASKPROC,glStencilMask) X(PFNGLDEPTHFUNCPROC,glDepthFunc) X(PFNGLSTENCILFUNCPROC,glStencilFunc) \
 X(PFNGLSTENCILOPPROC,glStencilOp) X(PFNGLSTENCILFUNCSEPARATEPROC,glStencilFuncSeparate) X(PFNGLSTENCILOPSEPARATEPROC,glStencilOpSeparate) \
 X(PFNGLSTENCILMASKSEPARATEPROC,glStencilMaskSeparate) X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable) \
 X(PFNGLPRIMITIVERESTARTINDEXPROC,glPrimitiveRestartIndex) X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLDRAWELEMENTSPROC,glDrawElements) \
 X(PFNGLDRAWELEMENTSBASEVERTEXPROC,glDrawElementsBaseVertex) X(PFNGLDRAWRANGEELEMENTSPROC,glDrawRangeElements) \
 X(PFNGLDRAWRANGEELEMENTSBASEVERTEXPROC,glDrawRangeElementsBaseVertex) X(PFNGLMULTIDRAWARRAYSPROC,glMultiDrawArrays) \
 X(PFNGLMULTIDRAWELEMENTSPROC,glMultiDrawElements) X(PFNGLMULTIDRAWELEMENTSBASEVERTEXPROC,glMultiDrawElementsBaseVertex) \
 X(PFNGLREADPIXELSPROC,glReadPixels) X(PFNGLGETERRORPROC,glGetError) X(PFNGLGETINTEGERVPROC,glGetIntegerv) X(PFNGLGETFLOATVPROC,glGetFloatv) \
 X(PFNGLGETINTEGER64VPROC,glGetInteger64v) X(PFNGLGETINTEGER64I_VPROC,glGetInteger64i_v) X(PFNGLLINEWIDTHPROC,glLineWidth) X(PFNGLPOINTSIZEPROC,glPointSize) \
 X(PFNGLHINTPROC,glHint) X(PFNGLPOLYGONOFFSETPROC,glPolygonOffset) X(PFNGLPOLYGONMODEPROC,glPolygonMode) \
 X(PFNGLFENCESYNCPROC,glFenceSync) X(PFNGLISSYNCPROC,glIsSync) X(PFNGLDELETESYNCPROC,glDeleteSync) X(PFNGLCLIENTWAITSYNCPROC,glClientWaitSync) \
 X(PFNGLWAITSYNCPROC,glWaitSync) X(PFNGLGETSYNCIVPROC,glGetSynciv)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static unsigned checks, failures, glerrors, quiet;
static void note(const char *s,int ok){char b[220];snprintf(b,sizeof b,"x64-gl-prims %s %s",ok?"ok":"FAIL",s);OutputDebugStringA(b);checks++;if(!ok)failures++;}
/* Census: any error an entry raised that the check did not expect. */
static void glok(const char *entry){if(quiet)return;GLenum e=glGetError();if(e){char b[120];snprintf(b,sizeof b,"x64-gl-prims glerror %s 0x%x",entry,e);OutputDebugStringA(b);glerrors++;while(glGetError());}}
static void expect_error(GLenum want,const char *s){GLenum e=glGetError();note(s,e==want&&glGetError()==GL_NO_ERROR);}
static GLuint shader(GLenum stage,const char *s){GLuint a=glCreateShader(stage);GLint ok=0;char log[2048];glShaderSource(a,1,&s,0);glCompileShader(a);glGetShaderiv(a,GL_COMPILE_STATUS,&ok);if(!ok){glGetShaderInfoLog(a,sizeof log,0,log);OutputDebugStringA(log);}note("shader compiled",ok);return a;}
static GLuint link(GLuint p){GLint ok=0;glLinkProgram(p);glGetProgramiv(p,GL_LINK_STATUS,&ok);note("program linked",ok);return p;}
/* Draw program: attribute 0 = clip-space xy, uniform colour. */
static GLuint draw_program,color_loc;
static void color(float r,float g,float b){glUniform4f(color_loc,r,g,b,1);}
static void pixel(int x,int y,unsigned r,unsigned g,unsigned b,unsigned a,const char *s){unsigned char p[4]={1,2,3,4};glReadPixels(x,y,1,1,GL_RGBA,GL_UNSIGNED_BYTE,p);
 int ok=p[0]==r&&p[1]==g&&p[2]==b&&p[3]==a;if(!ok){char m[200];snprintf(m,sizeof m,"%s at %d,%d got %u,%u,%u,%u",s,x,y,p[0],p[1],p[2],p[3]);note(m,0);}else note(s,1);glok("glReadPixels");}
/* Vertex store: 16 vertices, vertex k has xy[k] and id 100+k. */
static GLuint vbo,ebo;static float verts[16*3];
static void set_vertex(int k,float x,float y){verts[k*3]=x;verts[k*3+1]=y;verts[k*3+2]=100.0f+(float)k;}
static void upload(void){glBindBuffer(GL_ARRAY_BUFFER,vbo);glBufferData(GL_ARRAY_BUFFER,sizeof verts,verts,GL_DYNAMIC_DRAW);glok("glBufferData");}
static void indices(const void *d,unsigned n){glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ebo);glBufferData(GL_ELEMENT_ARRAY_BUFFER,n,d,GL_DYNAMIC_DRAW);glok("glBufferData");}
/* Rectangle in FBO pixels (bottom-left origin) -> clip space, for a 32x32 target. */
static float cx(float x,float w){return x/w*2.0f-1.0f;}
/* Transform feedback capture of the vertex ids a draw produces. */
static GLuint tf_program,tf_buffer,tf_query;
static void capture_begin(GLenum prim){static const float zero[64]={0};glUseProgram(tf_program);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,tf_buffer);glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,sizeof zero,zero,GL_DYNAMIC_READ);
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,tf_buffer);glEnable(GL_RASTERIZER_DISCARD);glBeginQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN,tf_query);glBeginTransformFeedback(prim);glok("glBeginTransformFeedback");}
static void capture_end(const char *what,const int *want,unsigned n,unsigned prims){float got[64];GLuint written=0;glEndTransformFeedback();glEndQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN);glDisable(GL_RASTERIZER_DISCARD);glok("glEndTransformFeedback");
 glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER,0,sizeof got,got);glGetQueryObjectuiv(tf_query,GL_QUERY_RESULT,&written);glok("glGetBufferSubData");
 int ok=written==prims;for(unsigned i=0;i<64;i++)ok&=got[i]==(i<n?100.0f+(float)want[i]:0.0f);
 char m[400];int at=snprintf(m,sizeof m,"%s vertex order (prims %u)",what,written);if(!ok){at+=snprintf(m+at,sizeof m-at," got");for(unsigned i=0;i<n+1&&i<20&&at<380;i++)at+=snprintf(m+at,sizeof m-at," %g",got[i]-100.0f);}note(m,ok);}
#define N_(a) (sizeof(a)/sizeof((a)[0]))
static void primitive_orders(void){
 for(int k=0;k<16;k++)set_vertex(k,0,0);upload();
 {int w[]={1,2,3,1,3,4,1,4,5};capture_begin(GL_TRIANGLES);glDrawArrays(GL_TRIANGLE_FAN,1,5);glok("glDrawArrays");capture_end("fan arrays first=1",w,N_(w),3);}
 {unsigned short e[]={4,0,1,2};indices(e,sizeof e);int w[]={6,2,3,6,3,4};capture_begin(GL_TRIANGLES);glDrawElementsBaseVertex(GL_TRIANGLE_FAN,4,GL_UNSIGNED_SHORT,0,2);glok("glDrawElementsBaseVertex");capture_end("fan elements base=2",w,N_(w),2);}
 {int w[]={0,1,1,2,2,3,3,0};capture_begin(GL_LINES);glDrawArrays(GL_LINE_LOOP,0,4);glok("glDrawArrays");capture_end("line loop arrays",w,N_(w),4);}
 {unsigned e[]={9,5,3,1};indices(e,sizeof e);int w[]={5,3,3,1,1,5};capture_begin(GL_LINES);glDrawElements(GL_LINE_LOOP,3,GL_UNSIGNED_INT,(void*)4);glok("glDrawElements");capture_end("line loop elements offset=4",w,N_(w),3);}
 {int w[]={1,2,5,6};capture_begin(GL_LINES);glDrawArrays(GL_LINES_ADJACENCY,0,8);glok("glDrawArrays");capture_end("lines adjacency",w,N_(w),2);}
 {int w[]={1,2,2,3};capture_begin(GL_LINES);glDrawArrays(GL_LINE_STRIP_ADJACENCY,0,5);glok("glDrawArrays");capture_end("line strip adjacency",w,N_(w),2);}
 {int w[]={0,2,4,6,8,10};capture_begin(GL_TRIANGLES);glDrawArrays(GL_TRIANGLES_ADJACENCY,0,12);glok("glDrawArrays");capture_end("triangles adjacency",w,N_(w),2);}
 {int w[]={0,2,4,4,2,6,4,6,8};capture_begin(GL_TRIANGLES);glDrawArrays(GL_TRIANGLE_STRIP_ADJACENCY,0,10);glok("glDrawArrays");capture_end("triangle strip adjacency",w,N_(w),3);}
 {int w[]={0};capture_begin(GL_TRIANGLES);glDrawArrays(GL_TRIANGLE_FAN,0,2);glok("glDrawArrays");capture_end("two-vertex fan draws nothing",w,0,0);}
 glEnable(GL_PRIMITIVE_RESTART);glPrimitiveRestartIndex(7);glok("glPrimitiveRestartIndex");
 {GLint v=0;glGetIntegerv(GL_PRIMITIVE_RESTART_INDEX,&v);note("restart index query",v==7);glok("glGetIntegerv");}
 {unsigned short e[]={0,1,2,3,7,4,5,6};indices(e,sizeof e);int w[]={0,1,2,2,1,3,4,5,6};capture_begin(GL_TRIANGLES);glDrawElements(GL_TRIANGLE_STRIP,8,GL_UNSIGNED_SHORT,0);glok("glDrawElements");capture_end("restart triangle strip",w,N_(w),3);}
 {unsigned short e[]={0,1,9,2,3,4,5};indices(e,sizeof e);glPrimitiveRestartIndex(9);int w[]={2,3,4};capture_begin(GL_TRIANGLES);glDrawElements(GL_TRIANGLES,7,GL_UNSIGNED_SHORT,0);glok("glDrawElements");capture_end("restart triangle list",w,N_(w),1);}
 {unsigned short e[]={0,1,2,3,0xffff,4,5,6,7};indices(e,sizeof e);glPrimitiveRestartIndex(0xffff);int w[]={0,1,2,0,2,3,4,5,6,4,6,7};capture_begin(GL_TRIANGLES);glDrawElements(GL_TRIANGLE_FAN,9,GL_UNSIGNED_SHORT,0);glok("glDrawElements");capture_end("restart fans",w,N_(w),4);}
 {unsigned e[]={0,1,2,0xffffffffu,3,4};indices(e,sizeof e);glPrimitiveRestartIndex(0xffffffffu);int w[]={1,2,2,3,4,5};capture_begin(GL_LINES);glDrawElementsBaseVertex(GL_LINE_STRIP,6,GL_UNSIGNED_INT,0,1);glok("glDrawElementsBaseVertex");capture_end("restart line strip base=1",w,N_(w),3);}
 {unsigned short e[]={0,1,2,3,7,4,5};indices(e,sizeof e);glPrimitiveRestartIndex(7);glDisable(GL_PRIMITIVE_RESTART);int w[]={0,1,2,2,1,3,2,3,7,7,3,4,7,4,5};capture_begin(GL_TRIANGLES);glDrawElements(GL_TRIANGLE_STRIP,7,GL_UNSIGNED_SHORT,0);glok("glDrawElements");capture_end("restart disabled: index 7 is a vertex",w,N_(w),5);}
 {GLint f[]={0,4};GLsizei c[]={4,3};int w[]={0,1,2,0,2,3,4,5,6};capture_begin(GL_TRIANGLES);glMultiDrawArrays(GL_TRIANGLE_FAN,f,c,2);glok("glMultiDrawArrays");capture_end("multi-draw fans",w,N_(w),3);}
 {unsigned short e[]={3,4,5,0};indices(e,sizeof e);int w[]={3,4,5,3,5,0};capture_begin(GL_TRIANGLES);glDrawRangeElements(GL_TRIANGLE_FAN,0,5,4,GL_UNSIGNED_SHORT,0);glok("glDrawRangeElements");capture_end("range fan",w,N_(w),2);}
 {unsigned short e[]={1,0,2};indices(e,sizeof e);int w[]={5,4,6};capture_begin(GL_TRIANGLES);glDrawRangeElementsBaseVertex(GL_TRIANGLES,4,6,3,GL_UNSIGNED_SHORT,0,4);glok("glDrawRangeElementsBaseVertex");capture_end("range base vertex",w,N_(w),1);}
 {unsigned short e[]={0,1,2,0,1};indices(e,sizeof e);GLsizei c[]={3,2};const void *o[]={(void*)0,(void*)6};GLint b[]={0,4};int w[]={0,1,1,2,2,0,4,5,5,4};
  capture_begin(GL_LINES);glMultiDrawElementsBaseVertex(GL_LINE_LOOP,c,GL_UNSIGNED_SHORT,o,2,b);glok("glMultiDrawElementsBaseVertex");capture_end("multi-draw loops base",w,N_(w),5);}
 {unsigned short e[]={2,1,0,5,4,3};indices(e,sizeof e);GLsizei c[]={3,3};const void *o[]={(void*)0,(void*)6};int w[]={2,1,0,5,4,3};
  capture_begin(GL_TRIANGLES);glMultiDrawElements(GL_TRIANGLES,c,GL_UNSIGNED_SHORT,o,2);glok("glMultiDrawElements");capture_end("multi-draw elements",w,N_(w),2);}
 glDrawArrays(0x7,0,3);expect_error(GL_INVALID_ENUM,"GL_QUADS is not a core mode");
 glDrawRangeElements(GL_TRIANGLES,5,4,3,GL_UNSIGNED_SHORT,0);expect_error(GL_INVALID_VALUE,"range end before start");
 {GLuint64 r=0;glGetQueryObjectui64v(tf_query,GL_QUERY_RESULT,&r);note("64-bit query result",r==2);glok("glGetQueryObjectui64v");}
}
/* 32x32 RGBA8 + D24S8 target, colour attachment 1 a second RGBA8 texture. */
static GLuint fbo,tex[2],rbo;
static void target(void){glBindFramebuffer(GL_FRAMEBUFFER,fbo);glViewport(0,0,32,32);glReadBuffer(GL_COLOR_ATTACHMENT0);}
static void quad(float x0,float y0,float x1,float y1,int ccw){/* pixel rect in a 32x32 target */
 set_vertex(0,cx(x0,32),cx(y0,32));set_vertex(1,cx(x1,32),cx(y0,32));set_vertex(2,cx(x1,32),cx(y1,32));set_vertex(3,cx(x0,32),cx(y1,32));
 if(!ccw){float t[3];memcpy(t,verts+3,12);memcpy(verts+3,verts+9,12);memcpy(verts+9,t,12);}upload();glDrawArrays(GL_TRIANGLE_FAN,0,4);glok("glDrawArrays");}
static void clears(void){
 target();glUseProgram(draw_program);
 glClearColor(1,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");
 glEnable(GL_SCISSOR_TEST);glScissor(8,8,8,8);glClearColor(0,1,0,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");glDisable(GL_SCISSOR_TEST);
 pixel(10,10,0,255,0,255,"scissored clear inside");pixel(2,2,255,0,0,255,"scissored clear outside");pixel(16,16,255,0,0,255,"scissor box end exclusive");pixel(15,15,0,255,0,255,"scissor box last pixel");
 glEnable(GL_SCISSOR_TEST);glScissor(-5,28,100,100);glClearColor(0,0,1,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");glScissor(4,4,0,9);glClearColor(1,1,1,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");glDisable(GL_SCISSOR_TEST);
 pixel(0,29,0,0,255,255,"scissor box clipped to target");pixel(4,5,255,0,0,255,"empty scissor box clears nothing");
 glClearColor(0,0,0,0);glClear(GL_COLOR_BUFFER_BIT);glColorMask(GL_TRUE,GL_FALSE,GL_TRUE,GL_FALSE);glClearColor(1,1,1,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");glColorMask(1,1,1,1);
 pixel(20,20,255,0,255,0,"colour-masked clear");
 glColorMask(0,0,0,0);glClearColor(0,1,0,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");glColorMask(1,1,1,1);pixel(20,20,255,0,255,0,"all-masked clear writes nothing");
 /* depth: masked depth clear keeps 1.0; a quad at z=0 with LESS passes only where depth is still 1 */
 glClearDepth(1);glClear(GL_DEPTH_BUFFER_BIT);glDepthMask(GL_FALSE);glClearDepth(0);glClear(GL_DEPTH_BUFFER_BIT);glok("glClear");glDepthMask(GL_TRUE);
 glEnable(GL_SCISSOR_TEST);glScissor(0,0,8,32);glClear(GL_DEPTH_BUFFER_BIT);glok("glClear");glDisable(GL_SCISSOR_TEST);
 glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glEnable(GL_DEPTH_TEST);glDepthFunc(GL_LESS);color(0,1,0);quad(0,0,32,32,1);glDisable(GL_DEPTH_TEST);
 pixel(20,4,0,255,0,255,"depth-masked clear kept depth");pixel(4,4,0,0,0,255,"scissored depth clear");
 /* stencil: masked + scissored clear, then EQUAL tests */
 glClearStencil(0);glClear(GL_STENCIL_BUFFER_BIT);glStencilMask(0x0f);glClearStencil(0xff);glEnable(GL_SCISSOR_TEST);glScissor(16,0,16,32);glClear(GL_STENCIL_BUFFER_BIT);glok("glClear");glDisable(GL_SCISSOR_TEST);glStencilMask(0xff);
 glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glEnable(GL_STENCIL_TEST);glStencilOp(GL_KEEP,GL_KEEP,GL_KEEP);glStencilFunc(GL_EQUAL,0x0f,0xff);color(0,0,1);quad(0,0,32,32,1);glDisable(GL_STENCIL_TEST);
 pixel(24,4,0,0,255,255,"stencil-masked scissored clear wrote 0x0f");pixel(4,4,0,0,0,255,"stencil outside scissor kept 0");
 /* depth+stencil in one scissored clear with a partial stencil mask */
 glClearDepth(1);glClearStencil(0);glClear(GL_DEPTH_BUFFER_BIT|GL_STENCIL_BUFFER_BIT);glStencilMask(0xf0);glClearStencil(0x3c);glClearDepth(0);glEnable(GL_SCISSOR_TEST);glScissor(0,16,32,16);
 glClear(GL_DEPTH_BUFFER_BIT|GL_STENCIL_BUFFER_BIT);glok("glClear");glDisable(GL_SCISSOR_TEST);glStencilMask(0xff);
 glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glEnable(GL_STENCIL_TEST);glStencilFunc(GL_EQUAL,0x30,0xff);color(1,1,0);quad(0,0,32,32,1);glDisable(GL_STENCIL_TEST);
 glEnable(GL_DEPTH_TEST);glDepthFunc(GL_LESS);color(0,1,1);quad(0,0,32,32,1);glDisable(GL_DEPTH_TEST);
 pixel(4,24,255,255,0,255,"combined clear: stencil masked to 0x30");pixel(4,4,0,255,255,255,"combined clear: depth outside box stays 1");
 /* per-draw-buffer masks: attachment 1 fully masked keeps its contents; partially masked attachment 0 */
 GLenum both[2]={GL_COLOR_ATTACHMENT0,GL_COLOR_ATTACHMENT1};glDrawBuffers(2,both);glClearColor(0,0,1,1);glClear(GL_COLOR_BUFFER_BIT);
 glColorMaski(1,0,0,0,0);glClearColor(1,1,0,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");pixel(3,3,255,255,0,255,"MRT attachment 0 cleared");
 glReadBuffer(GL_COLOR_ATTACHMENT1);pixel(3,3,0,0,255,255,"MRT masked attachment 1 kept");
 glColorMaski(1,1,0,0,0);glColorMaski(0,0,1,0,1);glClearColor(1,0,1,0);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");
 pixel(3,3,255,0,255,255,"MRT attachment 1 red-only clear");glReadBuffer(GL_COLOR_ATTACHMENT0);pixel(3,3,255,0,0,0,"MRT attachment 0 green+alpha clear");
 glColorMask(1,1,1,1);GLenum one[1]={GL_COLOR_ATTACHMENT0};glDrawBuffers(1,one);
}
static void raster(void){
 target();glUseProgram(draw_program);glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);
 /* fan from first=2 over the right half: both triangles cover their quadrants */
 for(int k=0;k<16;k++)set_vertex(k,5,5);set_vertex(2,cx(16,32),-1);set_vertex(3,1,-1);set_vertex(4,1,1);set_vertex(5,cx(16,32),1);upload();
 color(0,0,1);glDrawArrays(GL_TRIANGLE_FAN,2,4);glok("glDrawArrays");
 pixel(30,2,0,0,255,255,"fan first triangle");pixel(17,30,0,0,255,255,"fan second triangle");pixel(8,8,0,0,0,255,"fan leaves left half");
 /* strip with restart: two separate quads with a gap between them */
 glClear(GL_COLOR_BUFFER_BIT);set_vertex(0,-1,-1);set_vertex(1,-1,1);set_vertex(2,cx(8,32),-1);set_vertex(3,cx(8,32),1);set_vertex(4,cx(24,32),-1);set_vertex(5,cx(24,32),1);set_vertex(6,1,-1);set_vertex(7,1,1);upload();
 {unsigned short e[]={0,1,2,3,0xffff,4,5,6,7};indices(e,sizeof e);glEnable(GL_PRIMITIVE_RESTART);glPrimitiveRestartIndex(0xffff);color(0,1,1);glDrawElements(GL_TRIANGLE_STRIP,9,GL_UNSIGNED_SHORT,0);glok("glDrawElements");glDisable(GL_PRIMITIVE_RESTART);}
 pixel(4,16,0,255,255,255,"restart strip first quad");pixel(28,16,0,255,255,255,"restart strip second quad");pixel(16,16,0,0,0,255,"restart leaves the gap");
 /* line loop on pixel centres: the closing edge (3 -> 0) exists, unlike the strip */
 glClear(GL_COLOR_BUFFER_BIT);set_vertex(0,cx(4.5f,32),cx(4.5f,32));set_vertex(1,cx(27.5f,32),cx(4.5f,32));set_vertex(2,cx(27.5f,32),cx(27.5f,32));set_vertex(3,cx(4.5f,32),cx(27.5f,32));upload();
 color(1,1,1);glDrawArrays(GL_LINE_STRIP,0,4);glok("glDrawArrays");pixel(4,16,0,0,0,255,"line strip has no closing edge");
 glDrawArrays(GL_LINE_LOOP,0,4);glok("glDrawArrays");pixel(4,16,255,255,255,255,"line loop closing edge");pixel(16,4,255,255,255,255,"line loop first edge");
 /* triangles with adjacency: the adjacent vertices (far right) are ignored */
 glClear(GL_COLOR_BUFFER_BIT);set_vertex(0,-1,-1);set_vertex(1,1,1);set_vertex(2,cx(16,32),-1);set_vertex(3,1,1);set_vertex(4,-1,cx(16,32));set_vertex(5,1,1);upload();
 color(1,0,1);glDrawArrays(GL_TRIANGLES_ADJACENCY,0,6);glok("glDrawArrays");pixel(3,3,255,0,255,255,"adjacency main triangle");pixel(18,6,0,0,0,255,"adjacency vertices ignored");
 /* separate stencil: back faces fail (NEVER), front faces pass */
 glClearStencil(0);glClear(GL_COLOR_BUFFER_BIT|GL_STENCIL_BUFFER_BIT);glEnable(GL_STENCIL_TEST);glStencilFuncSeparate(GL_FRONT,GL_ALWAYS,0,0xff);glStencilFuncSeparate(GL_BACK,GL_NEVER,0,0xff);glok("glStencilFuncSeparate");
 glStencilOpSeparate(GL_FRONT,GL_KEEP,GL_KEEP,GL_INCR);glStencilOpSeparate(GL_BACK,GL_KEEP,GL_KEEP,GL_KEEP);glok("glStencilOpSeparate");
 color(0,1,0);quad(0,0,16,32,1);quad(16,0,32,32,0);glStencilFunc(GL_EQUAL,1,0xff);glStencilOp(GL_KEEP,GL_KEEP,GL_KEEP);color(1,0,0);quad(0,0,32,32,1);glDisable(GL_STENCIL_TEST);
 pixel(8,16,255,0,0,255,"front face passed and incremented");pixel(24,16,0,0,0,255,"back face failed");
 {GLint f=0,bf=0,bp=0;glGetIntegerv(GL_STENCIL_BACK_FUNC,&bf);glGetIntegerv(GL_STENCIL_FUNC,&f);glStencilFuncSeparate(GL_BACK,GL_LESS,3,0x0f);glStencilOpSeparate(GL_BACK,GL_ZERO,GL_INVERT,GL_DECR_WRAP);glGetIntegerv(GL_STENCIL_BACK_PASS_DEPTH_PASS,&bp);
  GLint br=0,bm=0;glGetIntegerv(GL_STENCIL_BACK_REF,&br);glGetIntegerv(GL_STENCIL_BACK_VALUE_MASK,&bm);glStencilMaskSeparate(GL_BACK,0x33);GLint bw=0,fw=0;glGetIntegerv(GL_STENCIL_BACK_WRITEMASK,&bw);glGetIntegerv(GL_STENCIL_WRITEMASK,&fw);
  note("separate stencil state queries",f==GL_EQUAL&&bf==GL_EQUAL&&bp==GL_DECR_WRAP&&br==3&&bm==0x0f&&bw==0x33&&fw==0xff);glok("glGetIntegerv");glStencilMask(0xff);glStencilFunc(GL_ALWAYS,0,0xff);}
 glStencilFuncSeparate(0x1234,GL_ALWAYS,0,0);expect_error(GL_INVALID_ENUM,"separate stencil bad face");
}
static void state(void){
 GLfloat f[2]={0,0};glLineWidth(2.0f);glok("glLineWidth");glGetFloatv(GL_LINE_WIDTH,f);note("line width state",f[0]==2.0f);glGetFloatv(GL_ALIASED_LINE_WIDTH_RANGE,f);note("aliased line width range is [1,1]",f[0]==1&&f[1]==1);
 glLineWidth(0);expect_error(GL_INVALID_VALUE,"line width 0");glLineWidth(1);
 glPointSize(3.0f);glok("glPointSize");glGetFloatv(GL_POINT_SIZE,f);note("point size state",f[0]==3.0f);glPointSize(-1);expect_error(GL_INVALID_VALUE,"negative point size");glPointSize(1);
 glHint(GL_LINE_SMOOTH_HINT,GL_NICEST);glHint(GL_FRAGMENT_SHADER_DERIVATIVE_HINT,GL_FASTEST);glok("glHint");{GLint h=0;glGetIntegerv(GL_LINE_SMOOTH_HINT,&h);note("hint state",h==GL_NICEST);}glHint(GL_LINE_SMOOTH_HINT,0x1234);expect_error(GL_INVALID_ENUM,"bad hint mode");
 glPolygonOffset(1.5f,-2.0f);glok("glPolygonOffset");glGetFloatv(GL_POLYGON_OFFSET_FACTOR,f);glGetFloatv(GL_POLYGON_OFFSET_UNITS,f+1);note("polygon offset state",f[0]==1.5f&&f[1]==-2.0f);
 glPolygonMode(GL_FRONT_AND_BACK,GL_FILL);glok("glPolygonMode");glPolygonMode(GL_FRONT,GL_FILL);expect_error(GL_INVALID_ENUM,"core polygon mode face");
 GLint64 big=0;glGetInteger64v(GL_MAX_TEXTURE_SIZE,&big);note("64-bit integer query",big==4096);glok("glGetInteger64v");
 GLint v[2]={0,0};glGetIntegerv(GL_MAX_VIEWPORT_DIMS,v);note("viewport dims",v[0]>=4096&&v[1]>=4096);glGetIntegerv(GL_MAX_VERTEX_UNIFORM_COMPONENTS,v);note("vertex uniform components",v[0]>=1024);glok("glGetIntegerv");
 glGetIntegerv(GL_BLEND_DST_RGB,v);glGetIntegerv(GL_BLEND_EQUATION_RGB,v+1);note("blend state queries",v[0]==GL_ZERO&&v[1]==GL_FUNC_ADD);glok("glGetIntegerv");
 GLint mask[4]={9,9,9,9};glColorMask(1,0,1,0);glGetIntegerv(GL_COLOR_WRITEMASK,mask);glColorMask(1,1,1,1);note("colour writemask query",mask[0]==1&&mask[1]==0&&mask[2]==1&&mask[3]==0);glok("glGetIntegerv");
 GLuint b;glGenBuffers(1,&b);glBindBuffer(GL_UNIFORM_BUFFER,b);glBufferData(GL_UNIFORM_BUFFER,96,0,GL_DYNAMIC_DRAW);glBindBufferBase(GL_UNIFORM_BUFFER,2,b);GLint64 size=0,bound=0;glGetBufferParameteri64v(GL_UNIFORM_BUFFER,GL_BUFFER_SIZE,&size);glGetInteger64i_v(GL_UNIFORM_BUFFER_BINDING,2,&bound);
 note("64-bit buffer queries",size==96&&bound==(GLint64)b);glok("glGetBufferParameteri64v");
 GLsync s=glFenceSync(GL_SYNC_GPU_COMMANDS_COMPLETE,0);glok("glFenceSync");note("fence is a sync",s&&glIsSync(s));
 GLint status=0,len=-1;glGetSynciv(s,GL_SYNC_STATUS,1,&len,&status);note("fence signaled",status==GL_SIGNALED&&len==1);glok("glGetSynciv");
 note("client wait signaled",glClientWaitSync(s,GL_SYNC_FLUSH_COMMANDS_BIT,1000000)==GL_ALREADY_SIGNALED);glok("glClientWaitSync");glWaitSync(s,0,GL_TIMEOUT_IGNORED);glok("glWaitSync");
 glDeleteSync(s);glok("glDeleteSync");note("deleted fence",!glIsSync(s));glClientWaitSync(s,0,0);expect_error(GL_INVALID_VALUE,"wait on deleted fence");glDeleteSync(0);glok("glDeleteSync");
}
/* Final screen 256x160, eight 64x80 tiles: 0 scissored clear, 1 masked clear, 2 fan arrays, 3 fan elements,
 * 4 restart strip, 5 adjacency, 6 separate stencil, 7 depth-masked clear. */
static float sx(float x){return x/128.0f-1.0f;}static float sy(float y){return y/80.0f-1.0f;}
static void screen_quad(float x0,float y0,float x1,float y1){set_vertex(0,sx(x0),sy(y0));set_vertex(1,sx(x1),sy(y0));set_vertex(2,sx(x1),sy(y1));set_vertex(3,sx(x0),sy(y1));upload();glDrawArrays(GL_TRIANGLE_FAN,0,4);glok("glDrawArrays");}
static void screen(void){
 glBindFramebuffer(GL_FRAMEBUFFER,0);glViewport(0,0,256,160);glUseProgram(draw_program);
 glClearColor(0.25f,0.25f,0.25f,1);glClearDepth(1);glClearStencil(0);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT|GL_STENCIL_BUFFER_BIT);glok("glClear");
 glEnable(GL_SCISSOR_TEST);
 glScissor(16,96,32,48);glClearColor(0,1,0,1);glClear(GL_COLOR_BUFFER_BIT);glok("glClear");                       /* tile 0 (top-left) */
 glScissor(80,96,32,48);glClearColor(1,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glColorMask(0,1,0,0);glClearColor(1,1,1,1);glClear(GL_COLOR_BUFFER_BIT);glColorMask(1,1,1,1);glok("glClear"); /* tile 1 */
 glDisable(GL_SCISSOR_TEST);
 for(int k=0;k<16;k++)set_vertex(k,5,5);set_vertex(3,sx(144),sy(96));set_vertex(4,sx(176),sy(96));set_vertex(5,sx(176),sy(144));set_vertex(6,sx(144),sy(144));upload();
 color(0,0,1);glDrawArrays(GL_TRIANGLE_FAN,3,4);glok("glDrawArrays");                                                    /* tile 2 */
 set_vertex(8,sx(208),sy(96));set_vertex(9,sx(240),sy(96));set_vertex(10,sx(240),sy(144));set_vertex(11,sx(208),sy(144));upload();
 {unsigned short e[]={2,3,0,1};indices(e,sizeof e);color(1,0,1);glDrawElementsBaseVertex(GL_TRIANGLE_FAN,4,GL_UNSIGNED_SHORT,0,8);glok("glDrawElementsBaseVertex");} /* tile 3 */
 set_vertex(0,sx(8),sy(16));set_vertex(1,sx(8),sy(64));set_vertex(2,sx(24),sy(16));set_vertex(3,sx(24),sy(64));set_vertex(4,sx(40),sy(16));set_vertex(5,sx(40),sy(64));set_vertex(6,sx(56),sy(16));set_vertex(7,sx(56),sy(64));upload();
 {unsigned short e[]={0,1,2,3,0xffff,4,5,6,7};indices(e,sizeof e);glEnable(GL_PRIMITIVE_RESTART);glPrimitiveRestartIndex(0xffff);color(0,1,1);glDrawElements(GL_TRIANGLE_STRIP,9,GL_UNSIGNED_SHORT,0);glDisable(GL_PRIMITIVE_RESTART);glok("glDrawElements");} /* tile 4 */
 set_vertex(0,sx(72),sy(8));set_vertex(1,sx(120),sy(72));set_vertex(2,sx(120),sy(8));set_vertex(3,sx(120),sy(72));set_vertex(4,sx(72),sy(72));set_vertex(5,sx(120),sy(8));upload();
 color(1,0.5f,0);glDrawArrays(GL_TRIANGLES_ADJACENCY,0,6);glok("glDrawArrays");                                         /* tile 5 */
 glEnable(GL_STENCIL_TEST);glStencilFuncSeparate(GL_FRONT,GL_ALWAYS,0,0xff);glStencilFuncSeparate(GL_BACK,GL_NEVER,0,0xff);color(1,1,0);
 screen_quad(136,16,160,64);set_vertex(0,sx(160),sy(16));set_vertex(1,sx(160),sy(64));set_vertex(2,sx(184),sy(64));set_vertex(3,sx(184),sy(16));upload();glDrawArrays(GL_TRIANGLE_FAN,0,4);glok("glDrawArrays"); /* tile 6: right half back-facing */
 glStencilFunc(GL_ALWAYS,0,0xff);glDisable(GL_STENCIL_TEST);
 glDepthMask(GL_FALSE);glClearDepth(0);glClear(GL_DEPTH_BUFFER_BIT);glDepthMask(GL_TRUE);glok("glClear");
 glEnable(GL_DEPTH_TEST);glDepthFunc(GL_LESS);color(1,1,1);screen_quad(208,16,240,64);glDisable(GL_DEPTH_TEST);           /* tile 7: depth kept 1 -> drawn */
}
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="PrimsContract";RegisterClassA(&c);HWND win=CreateWindowExA(0,c.lpszClassName,"Prims",WS_VISIBLE|WS_POPUP,0,0,256,160,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;pfd.cDepthBits=24;pfd.cStencilBits=8;SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);wglMakeCurrent(dc,wglCreateContext(dc));
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 GLuint vao;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&vbo);glGenBuffers(1,&ebo);glGenBuffers(1,&tf_buffer);glGenQueries(1,&tf_query);
 glBindBuffer(GL_ARRAY_BUFFER,vbo);glBufferData(GL_ARRAY_BUFFER,sizeof verts,verts,GL_DYNAMIC_DRAW);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,12,0);glVertexAttribPointer(1,1,GL_FLOAT,GL_FALSE,12,(void*)8);glEnableVertexAttribArray(0);glEnableVertexAttribArray(1);
 draw_program=glCreateProgram();glAttachShader(draw_program,shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=0) in vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}"));
 glAttachShader(draw_program,shader(GL_FRAGMENT_SHADER,"#version 330 core\nuniform vec4 tint;layout(location=0) out vec4 c;void main(){c=tint;}"));link(draw_program);color_loc=glGetUniformLocation(draw_program,"tint");
 tf_program=glCreateProgram();glAttachShader(tf_program,shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=1) in float id;out float cap;void main(){cap=id;gl_Position=vec4(0.0,0.0,0.0,1.0);}"));
 const char *names[]={"cap"};glTransformFeedbackVaryings(tf_program,1,names,GL_INTERLEAVED_ATTRIBS);link(tf_program);
 glGenFramebuffers(1,&fbo);glBindFramebuffer(GL_FRAMEBUFFER,fbo);glGenTextures(2,tex);
 for(int i=0;i<2;i++){glBindTexture(GL_TEXTURE_2D,tex[i]);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,32,32,0,GL_RGBA,GL_UNSIGNED_BYTE,0);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0+i,GL_TEXTURE_2D,tex[i],0);}
 glGenRenderbuffers(1,&rbo);glBindRenderbuffer(GL_RENDERBUFFER,rbo);glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH24_STENCIL8,32,32);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_STENCIL_ATTACHMENT,GL_RENDERBUFFER,rbo);
 GLenum one[1]={GL_COLOR_ATTACHMENT0};glDrawBuffers(1,one);glok("setup");
 {GLint vp[4]={9,9,9,9};glBindFramebuffer(GL_FRAMEBUFFER,0);glGetIntegerv(GL_VIEWPORT,vp);note("initial viewport is the window",vp[0]==0&&vp[1]==0&&vp[2]==256&&vp[3]==160);
  char m[80];snprintf(m,sizeof m,"x64-gl-prims viewport %d %d %d %d",vp[0],vp[1],vp[2],vp[3]);OutputDebugStringA(m);}
 primitive_orders();clears();raster();state();screen();
 /* screen readback of the default framebuffer: tile centres */
 static const struct{int x,y;unsigned char c[3];const char *s;}t[]={{32,120,{0,255,0},"screen tile 0 scissored clear"},{8,120,{64,64,64},"screen tile 0 outside box"},
  {96,120,{255,255,0},"screen tile 1 masked clear"},{160,120,{0,0,255},"screen tile 2 fan arrays"},{224,120,{255,0,255},"screen tile 3 fan elements"},
  {16,40,{0,255,255},"screen tile 4 first strip"},{32,40,{64,64,64},"screen tile 4 restart gap"},{80,16,{255,128,0},"screen tile 5 adjacency"},
  {116,60,{64,64,64},"screen tile 5 adjacency vertices ignored"},{148,40,{255,255,0},"screen tile 6 front face"},{172,40,{64,64,64},"screen tile 6 back face culled by stencil"},
  {224,40,{255,255,255},"screen tile 7 depth-masked clear"}};
 for(unsigned i=0;i<sizeof t/sizeof t[0];i++){unsigned char p[4]={1,2,3,4};glReadPixels(t[i].x,t[i].y,1,1,GL_RGBA,GL_UNSIGNED_BYTE,p);int ok=1;for(int k=0;k<3;k++)ok&=p[k]>=t[i].c[k]-1&&p[k]<=t[i].c[k]+1;note(t[i].s,ok);}
 glok("screen readback");
 SwapBuffers(dc);char summary[160];snprintf(summary,sizeof summary,"x64-gl-prims PASS failures=%u checks=%u glerrors=%u",failures,checks,glerrors);OutputDebugStringA(summary);
 /* Steady frames redraw the screen with no error checks or readbacks: one batched list per frame. */
 quiet=1;for(;;){screen();SwapBuffers(dc);}
}
