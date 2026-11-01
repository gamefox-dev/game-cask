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
 X(PFNGLACTIVETEXTUREPROC,glActiveTexture) X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable)
#define X(t,n) static t n;
FUNCS
#undef X
static unsigned failures, checks;
static void check(const char *name,int ok) { char b[200]; checks++; if(!ok)failures++; snprintf(b,sizeof b,"x64-gl-integer %s %s",ok?"ok":"FAIL",name);OutputDebugStringA(b); }
static void err(GLenum e,const char *s) { check(s,glGetError()==e&&glGetError()==GL_NO_ERROR); }
static GLuint shader(GLenum kind,const char *s) { GLuint h=glCreateShader(kind);GLint ok=0;glShaderSource(h,1,&s,0);glCompileShader(h);glGetShaderiv(h,GL_COMPILE_STATUS,&ok);if(!ok){char b[4096];glGetShaderInfoLog(h,sizeof b,0,b);OutputDebugStringA(b);ExitProcess(10);}return h; }
static GLuint prog(const char *fs) { const char *vs="#version 330 core\nvoid main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[gl_VertexID],0,1);}";GLuint h=glCreateProgram();GLint ok=0;glAttachShader(h,shader(GL_VERTEX_SHADER,vs));glAttachShader(h,shader(GL_FRAGMENT_SHADER,fs));glLinkProgram(h);glGetProgramiv(h,GL_LINK_STATUS,&ok);if(!ok){char b[4096];glGetProgramInfoLog(h,sizeof b,0,b);OutputDebugStringA(b);ExitProcess(11);}return h; }
static uint32_t raw[4]={0xfedcba98u,0x80000001u,0x01000001u,17};
static int32_t neg[4]={-2147483647,-16777217,-123456789,17};
static void expected(uint32_t bits,unsigned n,int uns,uint32_t *o) { for(unsigned c=0;c<4;c++){if(c>=n){o[c]=c==3;continue;}if(uns)o[c]=bits==32?raw[c]:raw[c]>((1u<<bits)-1)?(1u<<bits)-1:raw[c];else {int64_t lo=-((int64_t)1<<(bits-1)),hi=((int64_t)1<<(bits-1))-1,v=neg[c];o[c]=(uint32_t)(v<lo?lo:v>hi?hi:v);}} }
static int equal4(const uint32_t *a,const uint32_t *b) { return a[0]==b[0]&&a[1]==b[1]&&a[2]==b[2]&&a[3]==b[3]; }
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
 char msg[180];snprintf(msg,sizeof msg,"x64-gl-integer %s failures=%u checks=%u",failures?"FAIL":"PASS",failures,checks);OutputDebugStringA(msg);
 glBindFramebuffer(GL_FRAMEBUFFER,0);glViewport(0,0,320,200);glActiveTexture(GL_TEXTURE5);glBindTexture(GL_TEXTURE_2D,color);
 GLuint display=prog("#version 330 core\nlayout(location=0) out vec4 o;void main(){o=vec4(0,1,0,1);}");glUseProgram(display);
 for(;;){glDrawArrays(GL_TRIANGLES,0,3);SwapBuffers(dc);}
}
