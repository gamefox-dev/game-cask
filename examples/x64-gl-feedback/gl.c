/* Original CC0-1.0. GL 3.3 feedback known answers; no BGT imports, captured shaders or overrides. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#include <string.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) X(PFNGLGETSHADERIVPROC,glGetShaderiv) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLGETPROGRAMIVPROC,glGetProgramiv) X(PFNGLUSEPROGRAMPROC,glUseProgram) \
 X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) X(PFNGLTEXPARAMETERIPROC,glTexParameteri) \
 X(PFNGLGETUNIFORMBLOCKINDEXPROC,glGetUniformBlockIndex) X(PFNGLUNIFORMBLOCKBINDINGPROC,glUniformBlockBinding) \
 X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation) X(PFNGLUNIFORM1FPROC,glUniform1f) \
 X(PFNGLGETPROGRAMINFOLOGPROC,glGetProgramInfoLog) X(PFNGLGETSHADERINFOLOGPROC,glGetShaderInfoLog) \
 X(PFNGLTRANSFORMFEEDBACKVARYINGSPROC,glTransformFeedbackVaryings) X(PFNGLGETTRANSFORMFEEDBACKVARYINGPROC,glGetTransformFeedbackVarying) \
 X(PFNGLBEGINTRANSFORMFEEDBACKPROC,glBeginTransformFeedback) X(PFNGLENDTRANSFORMFEEDBACKPROC,glEndTransformFeedback) \
 X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) X(PFNGLBUFFERDATAPROC,glBufferData) X(PFNGLBUFFERSUBDATAPROC,glBufferSubData) \
 X(PFNGLBINDBUFFERBASEPROC,glBindBufferBase) X(PFNGLBINDBUFFERRANGEPROC,glBindBufferRange) X(PFNGLGETBUFFERSUBDATAPROC,glGetBufferSubData) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) X(PFNGLDISABLEVERTEXATTRIBARRAYPROC,glDisableVertexAttribArray) \
 X(PFNGLVERTEXATTRIBIPOINTERPROC,glVertexAttribIPointer) X(PFNGLVERTEXATTRIBDIVISORPROC,glVertexAttribDivisor) \
 X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLDRAWARRAYSINSTANCEDPROC,glDrawArraysInstanced) X(PFNGLDRAWELEMENTSPROC,glDrawElements) \
 X(PFNGLGENQUERIESPROC,glGenQueries) X(PFNGLBEGINQUERYPROC,glBeginQuery) X(PFNGLENDQUERYPROC,glEndQuery) X(PFNGLGETQUERYOBJECTUIVPROC,glGetQueryObjectuiv) X(PFNGLGETQUERYIVPROC,glGetQueryiv) X(PFNGLISQUERYPROC,glIsQuery) X(PFNGLDELETEQUERIESPROC,glDeleteQueries) \
 X(PFNGLGETINTEGERI_VPROC,glGetIntegeri_v) X(PFNGLGETINTEGERVPROC,glGetIntegerv) X(PFNGLGETERRORPROC,glGetError) X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable) X(PFNGLISENABLEDPROC,glIsEnabled) \
 X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLCLEARPROC,glClear) X(PFNGLVIEWPORTPROC,glViewport) X(PFNGLREADPIXELSPROC,glReadPixels)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static unsigned checks,failures;
static void note(const char*s,int ok){char b[200];snprintf(b,sizeof b,"x64-gl-feedback %s %s",ok?"ok":"FAIL",s);OutputDebugStringA(b);checks++;if(!ok)failures++;}
static void error(GLenum e,const char*s){note(s,glGetError()==e&&glGetError()==GL_NO_ERROR);}
static GLuint shader(GLenum stage,const char*s){GLuint a=glCreateShader(stage);GLint ok=0;char log[2048];glShaderSource(a,1,&s,0);glCompileShader(a);glGetShaderiv(a,GL_COMPILE_STATUS,&ok);if(!ok){glGetShaderInfoLog(a,sizeof log,0,log);OutputDebugStringA(log);}note("shader compiled",ok);return a;}
static void link(GLuint p){GLint ok=0;char log[2048];glLinkProgram(p);glGetProgramiv(p,GL_LINK_STATUS,&ok);if(!ok){glGetProgramInfoLog(p,sizeof log,0,log);OutputDebugStringA(log);}note("program linked",ok);if(ok){glUseProgram(p);glUniform1f(glGetUniformLocation(p,"gain"),.25f);GLuint block=glGetUniformBlockIndex(p,"Data");if(block!=GL_INVALID_INDEX)glUniformBlockBinding(p,block,2);}}
static GLuint store(unsigned size,const void*data){GLuint b;glGenBuffers(1,&b);glBindBuffer(GL_ARRAY_BUFFER,b);glBufferData(GL_ARRAY_BUFFER,size,data,GL_DYNAMIC_DRAW);return b;}
static void bytes(GLuint b,unsigned offset,unsigned n,const void*expected,const char*s){unsigned char got[1024];memset(got,0xcd,sizeof got);glBindBuffer(GL_ARRAY_BUFFER,b);glGetBufferSubData(GL_ARRAY_BUFFER,offset,n,got);note(s,!memcmp(got,expected,n));error(GL_NO_ERROR,"buffer read error");}
static void captured(GLenum mode,GLenum drawmode,unsigned first,unsigned count){glBeginTransformFeedback(mode);glDrawArrays(drawmode,first,count);glEndTransformFeedback();}
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="FeedbackContract";RegisterClassA(&c);
 HWND win=CreateWindowExA(0,c.lpszClassName,"Feedback",WS_VISIBLE|WS_POPUP,0,0,320,200,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;
 SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);HGLRC rc=wglCreateContext(dc);if(!rc){OutputDebugStringA("x64-gl-feedback unavailable");for(;;)Sleep(16);}wglMakeCurrent(dc,rc);
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 GLuint vao;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glViewport(0,0,320,200);
 const float block_values[]={.25f,0,0,0};GLuint block_buffer=store(sizeof block_values,block_values);glBindBufferBase(GL_UNIFORM_BUFFER,2,block_buffer);
 GLuint tex;glGenTextures(1,&tex);glBindTexture(GL_TEXTURE_2D,tex);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
 const unsigned char white[]={255,127,0,255};glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,1,1,0,GL_RGBA,GL_UNSIGNED_BYTE,white);
 GLuint p=glCreateProgram();
 glAttachShader(p,shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=0) in vec2 pos;uniform float gain;layout(std140) uniform Data{float addition;};uniform sampler2D sample_input;out vec2 next;flat out uint serial;flat out ivec2 signed_value;out vec4 bgt_tf_position;void main(){bgt_tf_position=vec4(2.0,3.0,4.0,5.0);next=pos*(gain+addition)*textureLod(sample_input,vec2(0.5),0.0).r;serial=uint(gl_VertexID)+uint(gl_InstanceID)*16u+7u;signed_value=ivec2(-123456789,gl_VertexID-10);gl_PointSize=5.0;gl_Position=vec4(pos,0.0,1.0);}"));
 glAttachShader(p,shader(GL_FRAGMENT_SHADER,"#version 330 core\nlayout(location=0) out vec4 color;void main(){color=vec4(1.0,0.0,0.0,1.0);}"));
 const char *names[]={"next","serial"};glTransformFeedbackVaryings(p,2,names,GL_INTERLEAVED_ATTRIBS);link(p);glUseProgram(p);
 GLint n=0,mode=0,type=0,size=0,length=0;char name[32];glGetProgramiv(p,GL_TRANSFORM_FEEDBACK_VARYINGS,&n);glGetProgramiv(p,GL_TRANSFORM_FEEDBACK_BUFFER_MODE,&mode);note("linked interface",n==2&&mode==GL_INTERLEAVED_ATTRIBS);
 glGetTransformFeedbackVarying(p,1,sizeof name,&length,&size,(GLenum*)&type,name);note("varying reflection",!strcmp(name,"serial")&&length==6&&size==1&&type==GL_UNSIGNED_INT);
 glGetTransformFeedbackVarying(p,2,sizeof name,0,0,0,name);error(GL_INVALID_VALUE,"varying index error");
 const float positions[]={-1,-1,3,-1,-1,3,1,1};GLuint input=store(sizeof positions,positions);
 glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);
 unsigned char sentinel[512];memset(sentinel,0x5a,sizeof sentinel);GLuint output=store(sizeof sentinel,sentinel),separate=store(sizeof sentinel,sentinel);
 glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,output,16,256);glGetIntegeri_v(GL_TRANSFORM_FEEDBACK_BUFFER_START,0,&n);note("indexed range",n==16);
 glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,output,2,64);error(GL_INVALID_VALUE,"range alignment");glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,4,output);error(GL_INVALID_VALUE,"binding index");
 glBeginTransformFeedback(GL_LINE_STRIP);error(GL_INVALID_ENUM,"begin primitive enum");glEndTransformFeedback();error(GL_INVALID_OPERATION,"end inactive");
 glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glEnable(GL_RASTERIZER_DISCARD);note("discard enabled",glIsEnabled(GL_RASTERIZER_DISCARD));
 glDrawElements(GL_POINTS,1,GL_FLOAT,0);error(GL_INVALID_ENUM,"discard still validates index type");glDrawArrays(GL_POINTS,0,1);error(GL_NO_ERROR,"discard without feedback valid draw");
 GLuint q;glGenQueries(1,&q);note("query generated not object",!glIsQuery(q));glBeginQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN,q);note("query object",glIsQuery(q));
 glBeginTransformFeedback(GL_POINTS);glBeginTransformFeedback(GL_POINTS);error(GL_INVALID_OPERATION,"begin active");
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,separate);error(GL_INVALID_OPERATION,"binding active");glUseProgram(0);error(GL_INVALID_OPERATION,"program active");glLinkProgram(p);error(GL_INVALID_OPERATION,"relink active");
 glDrawArrays(GL_LINES,0,2);error(GL_INVALID_OPERATION,"primitive mismatch");glDrawArrays(GL_POINTS,0,2);glDrawArrays(GL_POINTS,2,2);glEndTransformFeedback();glEndQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN);error(GL_NO_ERROR,"interleaved capture");
 GLuint result=0;glGetQueryObjectuiv(q,GL_QUERY_RESULT,&result);note("primitives query",result==4);glGetQueryObjectuiv(q,GL_QUERY_RESULT_AVAILABLE,&result);note("query available",result==1);
 struct V {float x,y;unsigned id;} expected[]={{-.5f,-.5f,7},{1.5f,-.5f,8},{-.5f,1.5f,9},{.5f,.5f,10}};
 bytes(output,16,sizeof expected,expected,"interleaved exact bytes");bytes(output,0,16,sentinel,"range prefix preserved");bytes(output,64,16,sentinel,"range suffix preserved");
 glDisable(GL_RASTERIZER_DISCARD);unsigned char pixel[4]={0};glReadPixels(160,100,1,1,GL_RGBA,GL_UNSIGNED_BYTE,pixel);note("discard preserved black",pixel[0]==0&&pixel[1]==0&&pixel[2]==0);
 // Pending declaration does not change the already linked executable or reflection.
 glTransformFeedbackVaryings(p,2,names,GL_SEPARATE_ATTRIBS);glGetProgramiv(p,GL_TRANSFORM_FEEDBACK_BUFFER_MODE,&mode);note("pending relink unchanged",mode==GL_INTERLEAVED_ATTRIBS);link(p);glGetProgramiv(p,GL_TRANSFORM_FEEDBACK_BUFFER_MODE,&mode);note("separate relink",mode==GL_SEPARATE_ATTRIBS);
 glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,output,32,128);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,1,separate);glEnable(GL_RASTERIZER_DISCARD);
 glBeginQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN,q);glBeginTransformFeedback(GL_POINTS);glDrawArraysInstanced(GL_POINTS,1,2,2);glEndTransformFeedback();glEndQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN);error(GL_NO_ERROR,"separate instanced capture");
 const float xy[]={1.5f,-.5f,-.5f,1.5f,1.5f,-.5f,-.5f,1.5f};const unsigned ids[]={8,9,24,25};bytes(output,32,sizeof xy,xy,"separate exact positions");bytes(separate,0,sizeof ids,ids,"separate exact integer IDs");glGetQueryObjectuiv(q,GL_QUERY_RESULT,&result);note("instanced query",result==4);
 // Incomplete list primitives ignored; strips expand in GL primitive order/winding.
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,output);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,1,separate);
 captured(GL_LINES,GL_LINES,0,3);const unsigned lineids[]={7,8};bytes(separate,0,8,lineids,"incomplete line ignored");
 captured(GL_TRIANGLES,GL_TRIANGLE_STRIP,0,4);const unsigned stripids[]={7,8,9,9,8,10};bytes(separate,0,sizeof stripids,stripids,"triangle strip winding");
 captured(GL_LINES,GL_LINE_STRIP,0,3);const unsigned lsids[]={7,8,8,9};bytes(separate,0,sizeof lsids,lsids,"line strip ordering");
 // Indexed feedback must preserve invocation order, not unique-vertex cache order.
 unsigned short indices[]={2,0,1};GLuint ib;glGenBuffers(1,&ib);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ib);glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof indices,indices,GL_STATIC_DRAW);
 glBeginTransformFeedback(GL_TRIANGLES);glDrawElements(GL_TRIANGLES,3,GL_UNSIGNED_SHORT,0);glEndTransformFeedback();const unsigned indexedids[]={9,7,8};bytes(separate,0,sizeof indexedids,indexedids,"indexed capture order");
 const char *builtins[]={"gl_Position","signed_value","gl_PointSize","bgt_tf_position"};glTransformFeedbackVaryings(p,4,builtins,GL_SEPARATE_ATTRIBS);link(p);
 GLuint point_sizes=store(sizeof sentinel,sentinel);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,2,point_sizes);
 GLuint user_builtin=store(sizeof sentinel,sentinel);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,3,user_builtin);
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,output);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,1,separate);captured(GL_POINTS,GL_POINTS,0,3);
 const float clips[]={-1,-1,0,1,3,-1,0,1,-1,3,0,1};const int signed_values[]={-123456789,-10,-123456789,-9,-123456789,-8};
 bytes(output,0,sizeof clips,clips,"original clip position");bytes(separate,0,sizeof signed_values,signed_values,"signed exact bytes");const float sizes[]={5,5,5};bytes(point_sizes,0,sizeof sizes,sizes,"original point size");const float user_clip[]={2,3,4,5,2,3,4,5,2,3,4,5};bytes(user_builtin,0,sizeof user_clip,user_clip,"builtin names hygienic");
 glTransformFeedbackVaryings(p,2,names,GL_SEPARATE_ATTRIBS);link(p);
 glDisable(GL_RASTERIZER_DISCARD);glClear(GL_COLOR_BUFFER_BIT);captured(GL_TRIANGLES,GL_TRIANGLES,0,3);error(GL_NO_ERROR,"capture with rasterization");
 glReadPixels(160,100,1,1,GL_RGBA,GL_UNSIGNED_BYTE,pixel);note("capture raster red",pixel[0]==255&&pixel[1]==0&&pixel[2]==0);glEnable(GL_RASTERIZER_DISCARD);
 GLuint ping=store(sizeof sentinel,sentinel);glBindBuffer(GL_ARRAY_BUFFER,output);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,ping);captured(GL_TRIANGLES,GL_TRIANGLES,0,3);const float pingxy[]={-.25f,-.25f,.75f,-.25f,-.25f,.75f};bytes(ping,0,sizeof pingxy,pingxy,"GPU ping pong ordering");
 float updated=.125f;glBindBuffer(GL_ARRAY_BUFFER,ping);glBufferSubData(GL_ARRAY_BUFFER,4,4,&updated);const float pingfirst[]={-.25f,.125f};bytes(ping,0,8,pingfirst,"partial GPU update preserves neighbors");
 glBindBuffer(GL_ARRAY_BUFFER,input);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);
 glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,output,0,8);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,3);error(GL_INVALID_OPERATION,"capture overflow rejected");glEndTransformFeedback();
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,input);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,1);error(GL_INVALID_OPERATION,"input output alias rejected");glEndTransformFeedback();
 glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,output,0,16);glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,1,separate,0,8);
 glBeginTransformFeedback(GL_LINES);glDrawArrays(GL_LINES,0,2);glDrawArrays(GL_LINES,0,1);glEndTransformFeedback();error(GL_NO_ERROR,"zero output after full range");
 const unsigned short clean_indices[]={2,0,1,0};GLuint clean_index=store(sizeof clean_indices,clean_indices);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,clean_index);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,1,separate);
 captured(GL_LINES,GL_LINES,0,1);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,clean_index);glDrawElements(GL_TRIANGLES,3,GL_UNSIGNED_SHORT,0);error(GL_NO_ERROR,"zero output preserves index authority");
 const GLint saved_gain=glGetUniformLocation(p,"gain");
 const char *missing[]={"not_an_output"};glTransformFeedbackVaryings(p,1,missing,GL_INTERLEAVED_ATTRIBS);glLinkProgram(p);glGetProgramiv(p,GL_LINK_STATUS,&n);note("missing varying link failure",!n);
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,output);glUniform1f(saved_gain,.5f);captured(GL_POINTS,GL_POINTS,0,1);const unsigned retained_id=7;bytes(separate,0,4,&retained_id,"failed link retains current executable");
 const float retained_xy[]={-.75f,-.75f};bytes(output,0,8,retained_xy,"failed link uniform update");glUniform1f(saved_gain,.25f);
 glTransformFeedbackVaryings(p,2,names,GL_SEPARATE_ATTRIBS);link(p);
 // ES 3.00 vertex-only capture, integer attributes/divisor and a legal WGSL-keyword identifier.
 GLuint vp=glCreateProgram();glAttachShader(vp,shader(GL_VERTEX_SHADER,"#version 300 es\nprecision highp float;precision highp int;layout(location=0) in uint bits;layout(location=1) in uint per_instance;flat out uvec2 var;void main(){var=uvec2(bits^4275878552u,per_instance+uint(gl_InstanceID));gl_Position=vec4(0.0);}"));
 const char *vn[]={"var"};glTransformFeedbackVaryings(vp,1,vn,GL_INTERLEAVED_ATTRIBS);link(vp);
 const unsigned ints[]={0x12345678u,0xffffffffu,100u,200u};GLuint integer_input=store(sizeof ints,ints);
 glVertexAttribIPointer(0,1,GL_UNSIGNED_INT,4,0);glVertexAttribIPointer(1,1,GL_UNSIGNED_INT,4,(void*)8);glVertexAttribDivisor(1,1);glEnableVertexAttribArray(1);
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,output);glBeginTransformFeedback(GL_POINTS);glDrawArraysInstanced(GL_POINTS,0,2,2);glEndTransformFeedback();
 const unsigned int_expected[]={0xece8ece0u,100u,0x01234567u,100u,0xece8ece0u,201u,0x01234567u,201u};bytes(output,0,sizeof int_expected,int_expected,"ES integer divisor exact bytes");
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,block_buffer);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,2);glEndTransformFeedback();bytes(block_buffer,0,16,int_expected,"former UBO becomes feedback");
 glBindBuffer(GL_ARRAY_BUFFER,block_buffer);glBufferSubData(GL_ARRAY_BUFFER,0,sizeof block_values,block_values);
 glDisable(GL_RASTERIZER_DISCARD);glDrawArrays(GL_POINTS,0,1);error(GL_INVALID_OPERATION,"vertex only raster rejected");glEnable(GL_RASTERIZER_DISCARD);glUseProgram(p);glDisableVertexAttribArray(1);glVertexAttribDivisor(1,0);
 GLuint np=glCreateProgram();glAttachShader(np,shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=0) in vec4 bytes;out vec4 normalized;void main(){normalized=bytes;gl_Position=vec4(0.0);}"));const char *nn[]={"normalized"};glTransformFeedbackVaryings(np,1,nn,GL_INTERLEAVED_ATTRIBS);link(np);
 unsigned char packed[16];GLuint packed_buffer=store(sizeof packed,0);const float normalized[]={0,1,0,1};
 for(unsigned off=1;off<=3;off++){memset(packed,0xee,sizeof packed);packed[off]=0;packed[off+1]=255;packed[off+2]=0;packed[off+3]=255;
  glBindBuffer(GL_ARRAY_BUFFER,packed_buffer);glBufferSubData(GL_ARRAY_BUFFER,0,sizeof packed,packed);glVertexAttribPointer(0,4,GL_UNSIGNED_BYTE,GL_TRUE,8,(void*)(uintptr_t)off);
  glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,output);captured(GL_POINTS,GL_POINTS,0,1);bytes(output,0,sizeof normalized,normalized,"byte aligned normalized capture");}
 GLuint linear=glCreateProgram();glAttachShader(linear,shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=0) in vec2 pos;noperspective out float ramp;void main(){ramp=7.0;gl_Position=vec4(pos*2.0,0.0,2.0);}"));
 glAttachShader(linear,shader(GL_FRAGMENT_SHADER,"#version 330 core\nnoperspective in float ramp;layout(location=0) out vec4 c;void main(){c=vec4(ramp/7.0,0.0,0.0,1.0);}"));
 const char *ln[]={"ramp"};glTransformFeedbackVaryings(linear,1,ln,GL_INTERLEAVED_ATTRIBS);link(linear);glBindBuffer(GL_ARRAY_BUFFER,input);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,output);
 glDisable(GL_RASTERIZER_DISCARD);glClear(GL_COLOR_BUFFER_BIT);captured(GL_TRIANGLES,GL_TRIANGLES,0,3);const float ramps[]={7,7,7};bytes(output,0,sizeof ramps,ramps,"noperspective raw value nonunit w");
 glReadPixels(160,100,1,1,GL_RGBA,GL_UNSIGNED_BYTE,pixel);note("noperspective capture raster",pixel[0]==255&&pixel[1]==0&&pixel[2]==0);glEnable(GL_RASTERIZER_DISCARD);glUseProgram(p);
 // Populate real captured positions and draw directly from the resulting GPU buffer. No CPU reupload.
 const float final_positions[]={-2,-2,6,-2,-2,6};GLuint final_input=store(sizeof final_positions,final_positions);
 glBindBuffer(GL_ARRAY_BUFFER,final_input);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);
 glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,output);captured(GL_TRIANGLES,GL_TRIANGLES,0,3);glDisable(GL_RASTERIZER_DISCARD);
 glBindBuffer(GL_ARRAY_BUFFER,output);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glClear(GL_COLOR_BUFFER_BIT);glViewport(80,50,160,100);glDrawArrays(GL_TRIANGLES,0,3);error(GL_NO_ERROR,"draw captured buffer");
 memset(pixel,0,sizeof pixel);glReadPixels(160,100,1,1,GL_RGBA,GL_UNSIGNED_BYTE,pixel);note("captured draw red",pixel[0]==255&&pixel[1]==0&&pixel[2]==0);
 glReadPixels(8,8,1,1,GL_RGBA,GL_UNSIGNED_BYTE,pixel);note("captured draw outside black",pixel[0]==0&&pixel[1]==0&&pixel[2]==0);
 glDeleteQueries(1,&q);note("deleted query",!glIsQuery(q));error(GL_NO_ERROR,"final errors");char summary[160];snprintf(summary,sizeof summary,"x64-gl-feedback PASS failures=%u checks=%u",failures,checks);OutputDebugStringA(summary);
 for(;;){SwapBuffers(dc);Sleep(16);}
}
