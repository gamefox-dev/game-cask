/* Original CC0-1.0: exact GL 3.3 integer conversions, sampling, render outputs and readback. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#include <stdint.h>
#define FUNCS \
 X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLDELETETEXTURESPROC,glDeleteTextures) \
 X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) X(PFNGLTEXSUBIMAGE2DPROC,glTexSubImage2D) \
 X(PFNGLGETTEXIMAGEPROC,glGetTexImage) X(PFNGLTEXPARAMETERIPROC,glTexParameteri) X(PFNGLPIXELSTOREIPROC,glPixelStorei) \
 X(PFNGLGETERRORPROC,glGetError) X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) \
 X(PFNGLCOMPILESHADERPROC,glCompileShader) X(PFNGLGETSHADERIVPROC,glGetShaderiv) X(PFNGLGETSHADERINFOLOGPROC,glGetShaderInfoLog) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) \
 X(PFNGLGETPROGRAMIVPROC,glGetProgramiv) X(PFNGLGETPROGRAMINFOLOGPROC,glGetProgramInfoLog) X(PFNGLUSEPROGRAMPROC,glUseProgram) \
 X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation) X(PFNGLUNIFORM1IPROC,glUniform1i) X(PFNGLUNIFORM4IPROC,glUniform4i) X(PFNGLUNIFORM4UIPROC,glUniform4ui) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLDRAWARRAYSPROC,glDrawArrays) \
 X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) \
 X(PFNGLCHECKFRAMEBUFFERSTATUSPROC,glCheckFramebufferStatus) X(PFNGLREADPIXELSPROC,glReadPixels) X(PFNGLVIEWPORTPROC,glViewport) \
 X(PFNGLACTIVETEXTUREPROC,glActiveTexture) X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable) \
 X(PFNGLCLEARBUFFERFVPROC,glClearBufferfv) X(PFNGLCLEARBUFFERIVPROC,glClearBufferiv) X(PFNGLCLEARBUFFERUIVPROC,glClearBufferuiv) X(PFNGLCLEARBUFFERFIPROC,glClearBufferfi) \
 X(PFNGLDRAWBUFFERSPROC,glDrawBuffers) X(PFNGLDRAWBUFFERPROC,glDrawBuffer) X(PFNGLREADBUFFERPROC,glReadBuffer) \
 X(PFNGLCOLORMASKPROC,glColorMask) X(PFNGLCOLORMASKIPROC,glColorMaski) X(PFNGLSCISSORPROC,glScissor) X(PFNGLDEPTHMASKPROC,glDepthMask) \
 X(PFNGLSTENCILMASKPROC,glStencilMask) X(PFNGLSTENCILFUNCPROC,glStencilFunc) X(PFNGLSTENCILOPPROC,glStencilOp) X(PFNGLDEPTHFUNCPROC,glDepthFunc) \
 X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLCLEARDEPTHPROC,glClearDepth) X(PFNGLCLEARSTENCILPROC,glClearStencil) \
 X(PFNGLGETFLOATVPROC,glGetFloatv) X(PFNGLGETINTEGERVPROC,glGetIntegerv) X(PFNGLVERTEXATTRIB4FPROC,glVertexAttrib4f)
#define X(t,n) static t n;
FUNCS
#undef X
static unsigned failures, checks;
static GLuint finish_images[4];
static void check(const char *name,int ok) { char b[200]; checks++; if(!ok)failures++; snprintf(b,sizeof b,"x64-gl-integer %s %s",ok?"ok":"FAIL",name);OutputDebugStringA(b); }
static void err(GLenum e,const char *s) { check(s,glGetError()==e&&glGetError()==GL_NO_ERROR); }
static GLuint shader(GLenum kind,const char *s) { GLuint h=glCreateShader(kind);GLint ok=0;glShaderSource(h,1,&s,0);glCompileShader(h);glGetShaderiv(h,GL_COMPILE_STATUS,&ok);if(!ok){char b[4096];glGetShaderInfoLog(h,sizeof b,0,b);OutputDebugStringA(b);ExitProcess(10);}return h; }
static const char *default_vs="#version 330 core\nvoid main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[gl_VertexID],0,1);}";
static GLuint prog_vertex(const char *vs,const char *fs) { GLuint h=glCreateProgram();GLint ok=0;glAttachShader(h,shader(GL_VERTEX_SHADER,vs));glAttachShader(h,shader(GL_FRAGMENT_SHADER,fs));glLinkProgram(h);glGetProgramiv(h,GL_LINK_STATUS,&ok);if(!ok){char b[4096];glGetProgramInfoLog(h,sizeof b,0,b);OutputDebugStringA(b);ExitProcess(11);}return h; }
static GLuint prog(const char *fs) { return prog_vertex(default_vs,fs); }
static uint32_t raw[4]={0xfedcba98u,0x80000001u,0x01000001u,17};
static int32_t neg[4]={-2147483647,-16777217,-123456789,17};
static void expected(uint32_t bits,unsigned n,int uns,uint32_t *o) { for(unsigned c=0;c<4;c++){if(c>=n){o[c]=c==3;continue;}if(uns)o[c]=bits==32?raw[c]:raw[c]>((1u<<bits)-1)?(1u<<bits)-1:raw[c];else {int64_t lo=-((int64_t)1<<(bits-1)),hi=((int64_t)1<<(bits-1))-1,v=neg[c];o[c]=(uint32_t)(v<lo?lo:v>hi?hi:v);}} }
static int equal4(const uint32_t *a,const uint32_t *b) { return a[0]==b[0]&&a[1]==b[1]&&a[2]==b[2]&&a[3]==b[3]; }
static void extra_contracts(void) {
 GLuint fbo,t[5];glGenFramebuffers(1,&fbo);glGenTextures(5,t);glBindFramebuffer(GL_FRAMEBUFFER,fbo);
 GLenum internal[5]={GL_RGBA8,GL_RGBA8,GL_RGBA32UI,GL_RGBA32I,GL_DEPTH24_STENCIL8};
 for(unsigned i=0;i<5;i++) {
  glBindTexture(GL_TEXTURE_2D,t[i]);
  glTexImage2D(GL_TEXTURE_2D,0,internal[i],4,4,0,i==4?GL_DEPTH_STENCIL:i>=2?GL_RGBA_INTEGER:GL_RGBA,
   i==4?GL_UNSIGNED_INT_24_8:i==3?GL_INT:i==2?GL_UNSIGNED_INT:GL_UNSIGNED_BYTE,0);
  glFramebufferTexture2D(GL_FRAMEBUFFER,i==4?GL_DEPTH_STENCIL_ATTACHMENT:GL_COLOR_ATTACHMENT0+i,GL_TEXTURE_2D,t[i],0);
 }
 GLenum maps[4]={GL_COLOR_ATTACHMENT1,GL_COLOR_ATTACHMENT0,GL_COLOR_ATTACHMENT2,GL_COLOR_ATTACHMENT3};glDrawBuffers(4,maps);
 check("clear framebuffer complete",glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE);
 float a[4]={.25f,.5f,.75f,1},b[4]={1,.25f,.5f,1},v[4]={0,1,0,0};uint32_t pixel[4];unsigned char bytes[4];
 glViewport(1,1,1,1); /* clears must ignore viewport */
 glClearColor(.125f,.25f,.375f,.5f);glClearDepth(.625);glClearStencil(73);
 glClearBufferfv(GL_COLOR,0,a);glClearBufferfv(GL_COLOR,1,b);
 glClearBufferuiv(GL_COLOR,2,raw);glClearBufferiv(GL_COLOR,3,neg);glClearBufferfi(GL_DEPTH_STENCIL,0,1,0xa5);
 glEnable(GL_SCISSOR_TEST);glScissor(1,1,2,2);
 glColorMaski(0,GL_TRUE,GL_FALSE,GL_FALSE,GL_FALSE);glClearBufferfv(GL_COLOR,0,v);
 glColorMaski(2,GL_TRUE,GL_FALSE,GL_TRUE,GL_FALSE);uint32_t uv[4]={17,18,19,20};glClearBufferuiv(GL_COLOR,2,uv);
 glColorMaski(3,GL_FALSE,GL_TRUE,GL_FALSE,GL_TRUE);int32_t iv[4]={-17,-18,-19,-20};glClearBufferiv(GL_COLOR,3,iv);
 glDepthMask(GL_FALSE);glStencilMask(15);glClearBufferfi(GL_DEPTH_STENCIL,0,.25f,0x3c);
 glDepthMask(GL_TRUE);float half=.5f;glClearBufferfv(GL_DEPTH,0,&half);
 glStencilMask(0xf0);int stencil_value=0x5e;glClearBufferiv(GL_STENCIL,0,&stencil_value);
 glDisable(GL_SCISSOR_TEST);glColorMask(GL_TRUE,GL_TRUE,GL_TRUE,GL_TRUE);glStencilMask(255);
 glReadBuffer(GL_COLOR_ATTACHMENT1);glReadPixels(1,1,1,1,GL_RGBA,GL_UNSIGNED_BYTE,bytes);
 check("indexed float masked center",bytes[0]==0&&bytes[1]==128&&bytes[2]==191&&bytes[3]==255);
 glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,bytes);check("indexed float untouched corner",bytes[0]==64&&bytes[1]==128&&bytes[2]==191&&bytes[3]==255);
 glReadBuffer(GL_COLOR_ATTACHMENT0);glReadPixels(1,1,1,1,GL_RGBA,GL_UNSIGNED_BYTE,bytes);check("permuted clear target",bytes[0]==255&&bytes[1]==64&&bytes[2]==128&&bytes[3]==255);
 glReadBuffer(GL_COLOR_ATTACHMENT2);glReadPixels(1,1,1,1,GL_RGBA_INTEGER,GL_UNSIGNED_INT,pixel);
 check("unsigned masked indexed clear",pixel[0]==17&&pixel[1]==raw[1]&&pixel[2]==19&&pixel[3]==raw[3]);
 glReadPixels(0,0,1,1,GL_RGBA_INTEGER,GL_UNSIGNED_INT,pixel);check("unsigned clear untouched corner",equal4(pixel,raw));
 glReadBuffer(GL_COLOR_ATTACHMENT3);glReadPixels(1,1,1,1,GL_RGBA_INTEGER,GL_INT,pixel);
 check("signed masked indexed clear",pixel[0]==(uint32_t)neg[0]&&pixel[1]==(uint32_t)-18&&pixel[2]==(uint32_t)neg[2]&&pixel[3]==(uint32_t)-20);
 glReadPixels(0,0,1,1,GL_RGBA_INTEGER,GL_INT,pixel);check("signed clear untouched corner",equal4(pixel,(const uint32_t*)neg));
 float saved[4],saved_depth=0;int saved_stencil=0;glGetFloatv(GL_COLOR_CLEAR_VALUE,saved);glGetFloatv(GL_DEPTH_CLEAR_VALUE,&saved_depth);glGetIntegerv(GL_STENCIL_CLEAR_VALUE,&saved_stencil);
 check("indexed clears preserve clear state",saved[0]==.125f&&saved[1]==.25f&&saved[2]==.375f&&saved[3]==.5f&&saved_depth==.625f&&saved_stencil==73);
 glClearBufferiv(GL_COLOR,0,iv);err(GL_INVALID_OPERATION,"signed clear on float rejects");
 glClearBufferfv(GL_COLOR,2,v);err(GL_INVALID_OPERATION,"float clear on integer rejects");
 glClearBufferiv(GL_COLOR,2,iv);err(GL_INVALID_OPERATION,"signed clear on unsigned rejects");
 glClearBufferuiv(GL_COLOR,3,uv);err(GL_INVALID_OPERATION,"unsigned clear on signed rejects");
 glClearBufferfv(GL_COLOR,4,v);err(GL_INVALID_VALUE,"clear draw index bound");
 glClearBufferfv(GL_DEPTH,1,&half);err(GL_INVALID_VALUE,"clear depth index bound");
 glClearBufferfv(GL_STENCIL,0,v);err(GL_INVALID_ENUM,"clear value form rejects stencil float");
 glClearBufferuiv(GL_DEPTH,0,uv);err(GL_INVALID_ENUM,"clear value form rejects depth uint");
 GLenum none[4]={GL_NONE,GL_COLOR_ATTACHMENT0,GL_COLOR_ATTACHMENT2,GL_COLOR_ATTACHMENT3};glDrawBuffers(4,none);
 glClearBufferuiv(GL_COLOR,0,0);err(GL_NO_ERROR,"NONE clear ignores format and null value");glDrawBuffers(4,maps);
 GLuint white=prog("#version 330 core\nlayout(location=0) out vec4 o;void main(){o=vec4(1);}");
 glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);glViewport(0,0,4,4);
 glUseProgram(white);glEnable(GL_STENCIL_TEST);glStencilFunc(GL_EQUAL,0x5c,255);glStencilOp(GL_KEEP,GL_KEEP,GL_KEEP);
 glEnable(GL_DEPTH_TEST);glDepthFunc(GL_EQUAL);glDepthMask(GL_FALSE);glDrawArrays(GL_TRIANGLES,0,3);
 glReadPixels(1,1,1,1,GL_RGBA,GL_UNSIGNED_BYTE,bytes);check("masked stencil and depth clear via tests",bytes[0]==255&&bytes[1]==255&&bytes[2]==255&&bytes[3]==255);
 glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,bytes);check("stencil clear outside scissor unchanged",bytes[0]==255&&bytes[1]==64&&bytes[2]==128&&bytes[3]==255);
 glDisable(GL_STENCIL_TEST);glDisable(GL_DEPTH_TEST);glDepthMask(GL_TRUE);
 GLuint constant=prog_vertex("#version 330 core\nlayout(location=3) in vec4 tint;out vec4 tc;void main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[gl_VertexID],0,1);tc=tint;}",
  "#version 330 core\nin vec4 tc;layout(location=0) out vec4 o;void main(){o=tc;}");
 glUseProgram(constant);glVertexAttrib4f(3,.25f,.5f,.75f,.5f);glDrawArrays(GL_TRIANGLES,0,3);glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,bytes);
 check("finish current attribute pixel",bytes[0]==64&&bytes[1]==128&&bytes[2]==191&&bytes[3]==128);
 /* Small non-NULL depth transfers with each required external representation. */
 GLuint sample=prog("#version 330 core\nuniform sampler2D img;layout(location=0) out vec4 o;void main(){o=vec4(textureLod(img,vec2(.5),0.0).r,0,0,1);}");
 GLuint depth_tex;glGenTextures(1,&depth_tex);glActiveTexture(GL_TEXTURE5);glBindTexture(GL_TEXTURE_2D,depth_tex);
 GLenum df[3]={GL_DEPTH_COMPONENT16,GL_DEPTH_COMPONENT24,GL_DEPTH_COMPONENT32F},dt[3]={GL_UNSIGNED_SHORT,GL_UNSIGNED_INT,GL_FLOAT};
 unsigned short d16[64];uint32_t d24[64];float d32[64];for(unsigned i=0;i<64;i++){d16[i]=16384;d24[i]=0x40000000;d32[i]=.25f;}
 for(unsigned i=0;i<3;i++) {
  glTexImage2D(GL_TEXTURE_2D,0,df[i],8,8,0,GL_DEPTH_COMPONENT,dt[i],i==0?(void*)d16:i==1?(void*)d24:(void*)d32);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
  glUseProgram(sample);glUniform1i(glGetUniformLocation(sample,"img"),5);glDrawArrays(GL_TRIANGLES,0,3);glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,bytes);
  check("nonNULL depth upload sample",bytes[0]==64&&bytes[1]==0&&bytes[2]==0&&bytes[3]==255);
  float back[64];glGetTexImage(GL_TEXTURE_2D,0,GL_DEPTH_COMPONENT,GL_FLOAT,back);check("depth uploaded GetTexImage",back[0]>.2499f&&back[0]<.2501f&&back[63]>.2499f&&back[63]<.2501f);
 }
 /* 4096-square logical chain: each later allocation must preserve already uploaded level zero. */
 glTexImage2D(GL_TEXTURE_2D,0,GL_DEPTH_COMPONENT32F,4096,4096,0,GL_DEPTH_COMPONENT,GL_FLOAT,0);
 float quarter=.25f;glTexSubImage2D(GL_TEXTURE_2D,0,0,0,1,1,GL_DEPTH_COMPONENT,GL_FLOAT,&quarter);
 for(unsigned level=1;level<13;level++)glTexImage2D(GL_TEXTURE_2D,level,GL_DEPTH_COMPONENT32F,4096>>level,4096>>level,0,GL_DEPTH_COMPONENT,GL_FLOAT,0);
 err(GL_NO_ERROR,"large depth lazy mip allocation");
 glBindFramebuffer(GL_FRAMEBUFFER,fbo);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,0,0);
 glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT1,GL_TEXTURE_2D,0,0);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT2,GL_TEXTURE_2D,0,0);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT3,GL_TEXTURE_2D,0,0);
 glFramebufferTexture2D(GL_FRAMEBUFFER,GL_DEPTH_STENCIL_ATTACHMENT,GL_TEXTURE_2D,0,0);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_TEXTURE_2D,depth_tex,0);
 glDrawBuffer(GL_NONE);glReadBuffer(GL_NONE);float back_depth=0;glReadPixels(0,0,1,1,GL_DEPTH_COMPONENT,GL_FLOAT,&back_depth);
 check("large depth growth preserves texel",back_depth==.25f);err(GL_NO_ERROR,"finish clear/depth errors");
 glBindFramebuffer(GL_FRAMEBUFFER,0);glDeleteTextures(1,&depth_tex);glDeleteTextures(1,&t[4]);
 for(unsigned i=0;i<4;i++)finish_images[i]=t[i];
}
int main(void) {
 WNDCLASSA cls={0};cls.lpfnWndProc=DefWindowProcA;cls.lpszClassName="IntegerGL";RegisterClassA(&cls);
 HWND w=CreateWindowExA(0,cls.lpszClassName,"Integer GL",WS_VISIBLE|WS_POPUP,0,0,320,200,0,0,0,0);HDC dc=GetDC(w);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;
 SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);HGLRC ctx=wglCreateContext(dc);if(!ctx)ExitProcess(12);wglMakeCurrent(dc,ctx);
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCS
#undef X
 GLuint vao,fbo,color;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenFramebuffers(1,&fbo);
 glGenTextures(1,&color);glBindTexture(GL_TEXTURE_2D,color);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,2,2,0,GL_RGBA,GL_UNSIGNED_BYTE,0);
 GLuint u=prog("#version 330 core\nuniform usampler2D img;uniform uvec4 ref;layout(location=0) out vec4 o;void main(){uvec4 a=texture(img,vec2(-.25,.25));uvec4 b=textureLod(img,vec2(.75,.25),0.0);uvec4 c=textureGrad(img,vec2(.75,.25),vec2(0),vec2(0));uvec4 d=texelFetch(img,ivec2(1,0),0);o=all(equal(a,ref))&&all(equal(b,ref))&&all(equal(c,ref))&&all(equal(d,ref))?vec4(0,1,0,1):vec4(1,0,0,1);}");
 GLuint s=prog("#version 330 core\nuniform isampler2D img;uniform ivec4 ref;layout(location=0) out vec4 o;void main(){ivec4 a=texture(img,vec2(-.25,.25));ivec4 b=textureLod(img,vec2(.75,.25),0.0);ivec4 c=textureGrad(img,vec2(.75,.25),vec2(0),vec2(0));ivec4 d=texelFetch(img,ivec2(1,0),0);o=all(equal(a,ref))&&all(equal(b,ref))&&all(equal(c,ref))&&all(equal(d,ref))?vec4(0,1,0,1):vec4(1,0,0,1);}");
 GLuint ur=prog("#version 330 core\nuniform uvec4 raster;layout(location=0) out uvec4 o;void main(){o=raster;}");
 GLuint sr=prog("#version 330 core\nuniform ivec4 raster;layout(location=0) out ivec4 o;void main(){o=raster;}");
 GLenum fmts[18]={GL_R8UI,GL_R8I,GL_R16UI,GL_R16I,GL_R32UI,GL_R32I,GL_RG8UI,GL_RG8I,GL_RG16UI,GL_RG16I,GL_RG32UI,GL_RG32I,GL_RGBA8UI,GL_RGBA8I,GL_RGBA16UI,GL_RGBA16I,GL_RGBA32UI,GL_RGBA32I};
 glPixelStorei(GL_PACK_ALIGNMENT,1);glPixelStorei(GL_UNPACK_ALIGNMENT,1);
 for(unsigned i=0;i<18;i++) {
  int uns=!(i&1);unsigned n=i<6?1:i<12?2:4,bits=(i%6)<2?8:(i%6)<4?16:32;uint32_t exp[4],back[16]={0};expected(bits,n,uns,exp);
  GLenum ext=n==1?GL_RED_INTEGER:n==2?GL_RG_INTEGER:GL_RGBA_INTEGER,typ=uns?GL_UNSIGNED_INT:GL_INT;
  GLuint image;glGenTextures(1,&image);glActiveTexture(GL_TEXTURE5);glBindTexture(GL_TEXTURE_2D,image);
  glTexImage2D(GL_TEXTURE_2D,0,fmts[i],2,2,0,ext,typ,0);err(GL_NO_ERROR,"integer allocation");
  glTexSubImage2D(GL_TEXTURE_2D,0,1,0,1,1,GL_RGBA_INTEGER,typ,uns?(const void*)raw:(const void*)neg);err(GL_NO_ERROR,"integer conversion upload");
  glGetTexImage(GL_TEXTURE_2D,0,GL_RGBA_INTEGER,typ,back);check("exact converted storage",equal4(back+4,exp));
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
  glBindFramebuffer(GL_FRAMEBUFFER,fbo);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,color,0);glViewport(0,0,2,2);
  GLuint pr=uns?u:s;glUseProgram(pr);glUniform1i(glGetUniformLocation(pr,"img"),5);
  if(uns)glUniform4ui(glGetUniformLocation(pr,"ref"),exp[0],exp[1],exp[2],exp[3]);else glUniform4i(glGetUniformLocation(pr,"ref"),(int)exp[0],(int)exp[1],(int)exp[2],(int)exp[3]);
  glDrawArrays(GL_TRIANGLES,0,3);unsigned char pixel[4]={0};glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,pixel);check("typed sampling pixel",pixel[0]==0&&pixel[1]==255&&pixel[2]==0&&pixel[3]==255);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_SWIZZLE_R,GL_ALPHA);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_SWIZZLE_G,GL_RED);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_SWIZZLE_B,GL_ZERO);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_SWIZZLE_A,GL_ONE);
  if(uns)glUniform4ui(glGetUniformLocation(pr,"ref"),exp[3],exp[0],0,1);else glUniform4i(glGetUniformLocation(pr,"ref"),(int)exp[3],(int)exp[0],0,1);
  glDrawArrays(GL_TRIANGLES,0,3);glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,pixel);check("integer swizzle pixel",pixel[0]==0&&pixel[1]==255&&pixel[2]==0&&pixel[3]==255);
  glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,image,0);check("integer framebuffer complete",glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE);
  glEnable(GL_BLEND);glUseProgram(uns?ur:sr);
  GLint raster=glGetUniformLocation(uns?ur:sr,"raster");
  if(uns)glUniform4ui(raster,exp[0],exp[1],exp[2],exp[3]);else glUniform4i(raster,(int)exp[0],(int)exp[1],(int)exp[2],(int)exp[3]);
  glDrawArrays(GL_TRIANGLES,0,3);glDisable(GL_BLEND);
  glReadPixels(0,0,1,1,GL_RGBA_INTEGER,typ,back);check("integer output and readpixels",equal4(back,exp));
  glGetTexImage(GL_TEXTURE_2D,0,GL_RGBA_INTEGER,typ,back);check("rendered GetTexImage",equal4(back,exp));
  if(i<2) {
   if(uns)glUniform4ui(raster,raw[0],raw[1],raw[2],raw[3]);else glUniform4i(raster,neg[0],neg[1],neg[2],neg[3]);
   glDrawArrays(GL_TRIANGLES,0,3);glReadPixels(0,0,1,1,GL_RGBA_INTEGER,typ,back);
   char boundary[128];snprintf(boundary,sizeof boundary,"x64-gl-integer native-boundary unsigned=%d value=%u",uns,back[0]);OutputDebugStringA(boundary);
  }
  glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,back);err(GL_INVALID_OPERATION,"integer read class mismatch");
  glTexSubImage2D(GL_TEXTURE_2D,0,0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,raw);err(GL_INVALID_OPERATION,"integer upload class mismatch");
  glBindFramebuffer(GL_FRAMEBUFFER,0);glDeleteTextures(1,&image);err(GL_NO_ERROR,"integer final error");
 }
 extra_contracts();
 char msg[180];snprintf(msg,sizeof msg,"x64-gl-integer %s failures=%u checks=%u",failures?"FAIL":"PASS",failures,checks);OutputDebugStringA(msg);
 glBindFramebuffer(GL_FRAMEBUFFER,0);glActiveTexture(GL_TEXTURE5);
 const char *display_vs="#version 330 core\nout vec2 uv;void main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[gl_VertexID],0,1);uv=p[gl_VertexID]*.5+vec2(.5);}";
 GLuint display[3];
 display[0]=prog_vertex(display_vs,"#version 330 core\nin vec2 uv;uniform sampler2D img;layout(location=0) out vec4 o;void main(){o=texture(img,uv);}");
 display[1]=prog_vertex(display_vs,"#version 330 core\nin vec2 uv;uniform usampler2D img;layout(location=0) out vec4 o;void main(){uvec4 v=texture(img,uv);o=vec4(vec3(v.rgb&uvec3(255u))/255.0,1.0);}");
 display[2]=prog_vertex(display_vs,"#version 330 core\nin vec2 uv;uniform isampler2D img;layout(location=0) out vec4 o;void main(){uvec4 v=uvec4(texture(img,uv));o=vec4(vec3(v.rgb&uvec3(255u))/255.0,1.0);}");
 for(unsigned i=0;i<4;i++){glBindTexture(GL_TEXTURE_2D,finish_images[i]);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);}
 OutputDebugStringA("x64-gl-integer display ready");
 for(;;){for(unsigned i=0;i<4;i++){GLuint p=display[i<2?0:i-1];glViewport(i*80,0,80,200);glBindTexture(GL_TEXTURE_2D,finish_images[i]);glUseProgram(p);glUniform1i(glGetUniformLocation(p,"img"),5);glDrawArrays(GL_TRIANGLES,0,3);}SwapBuffers(dc);}
}
