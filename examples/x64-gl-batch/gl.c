/* SPDX-License-Identifier: CC0-1.0. Original engine-shaped frame, no game assets (K53 frame batching).
 * Per frame: 24 small sprite draws into a 256x224 RGBA16F scene target, an 8-draw 128x112 RGBA16F glow
 * pass that samples the scene, 8 more scene sprites, then a composite to the default framebuffer.
 * Every sprite streams its 96-byte quad with glBufferSubData at offset 0 and sets per-draw uniforms
 * (uploads between draws, like a 2D engine's canvas batcher); one atlas and one UI texture upload per
 * frame. Four target spans, 41 draws. Animation depends only on the SwapBuffers count. */
#include <windows.h>
#include <GL/glcorearb.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) \
 X(PFNGLUSEPROGRAMPROC,glUseProgram) X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation) X(PFNGLUNIFORM4FPROC,glUniform4f) \
 X(PFNGLUNIFORM1IPROC,glUniform1i) X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) \
 X(PFNGLBUFFERDATAPROC,glBufferData) X(PFNGLBUFFERSUBDATAPROC,glBufferSubData) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) \
 X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) \
 X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) \
 X(PFNGLTEXSUBIMAGE2DPROC,glTexSubImage2D) X(PFNGLTEXPARAMETERIPROC,glTexParameteri) X(PFNGLACTIVETEXTUREPROC,glActiveTexture) \
 X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) \
 X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) X(PFNGLVIEWPORTPROC,glViewport) X(PFNGLCLEARCOLORPROC,glClearColor) \
 X(PFNGLCLEARPROC,glClear) X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable) X(PFNGLBLENDFUNCPROC,glBlendFunc) \
 X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLGETERRORPROC,glGetError)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static GLuint shader(GLenum type,const char *src){GLuint s=glCreateShader(type);glShaderSource(s,1,&src,0);glCompileShader(s);return s;}
static GLuint program(const char *fs){
 GLuint p=glCreateProgram();
 glAttachShader(p,shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=0) in vec4 v;out vec2 uv;"
  "void main(){uv=v.zw;gl_Position=vec4(v.xy,0.0,1.0);}"));
 glAttachShader(p,shader(GL_FRAGMENT_SHADER,fs));glLinkProgram(p);return p;
}
static float quad[24];
static void rect(float x,float y,float w,float h){
 const float c[6][2]={{0,0},{1,0},{0,1},{1,0},{1,1},{0,1}};
 for(unsigned i=0;i<6;i++){quad[i*4]=x+c[i][0]*w;quad[i*4+1]=y+c[i][1]*h;quad[i*4+2]=c[i][0];quad[i*4+3]=c[i][1];}
}
static GLuint target(GLuint tex,int w,int h){
 GLuint fb;glBindTexture(GL_TEXTURE_2D,tex);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA16F,w,h,0,GL_RGBA,GL_FLOAT,0);
 glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
 glGenFramebuffers(1,&fb);glBindFramebuffer(GL_FRAMEBUFFER,fb);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex,0);
 return fb;
}
static GLint tint;
static void sprite(unsigned f,unsigned i,float alpha){
 float x=-0.95f+(float)((i*37u+f*3u)%180u)/100.0f,y=-0.95f+(float)((i*53u+f)%170u)/100.0f;
 rect(x,y,0.12f+(float)(i%3)*0.04f,0.10f+(float)(i%4)*0.03f);
 glBufferSubData(GL_ARRAY_BUFFER,0,sizeof quad,quad);
 glUniform4f(tint,(float)(i%5)/4.0f,(float)(i%7)/6.0f,(float)(i%3)/2.0f,alpha);
 glDrawArrays(GL_TRIANGLES,0,6);
}
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="BatchCC0";RegisterClassA(&c);
 HWND win=CreateWindowExA(0,c.lpszClassName,"Batch CC0",WS_VISIBLE|WS_POPUP,0,0,256,224,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;
 SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);wglMakeCurrent(dc,wglCreateContext(dc));
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 GLuint sprites=program("#version 330 core\nin vec2 uv;uniform sampler2D atlas;uniform vec4 tint;layout(location=0) out vec4 color;"
  "void main(){vec4 t=texture(atlas,uv);color=vec4(t.rgb*0.5+tint.rgb*0.5,t.a*tint.a);}");
 GLuint composite=program("#version 330 core\nin vec2 uv;uniform sampler2D scene;uniform sampler2D glow;uniform sampler2D ui;"
  "layout(location=0) out vec4 color;void main(){vec3 c=texture(scene,uv).rgb+0.5*texture(glow,uv).rgb;"
  "vec4 u=texture(ui,uv*4.0);color=vec4(mix(c,u.rgb,u.a*0.25),1.0);}");
 glUseProgram(sprites);tint=glGetUniformLocation(sprites,"tint");glUniform1i(glGetUniformLocation(sprites,"atlas"),0);
 glUseProgram(composite);glUniform1i(glGetUniformLocation(composite,"scene"),0);
 glUniform1i(glGetUniformLocation(composite,"glow"),1);glUniform1i(glGetUniformLocation(composite,"ui"),2);
 GLuint vao,vbo,tex[4];glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&vbo);glBindBuffer(GL_ARRAY_BUFFER,vbo);
 glBufferData(GL_ARRAY_BUFFER,4096,0,GL_STREAM_DRAW);glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,16,0);glEnableVertexAttribArray(0);
 glGenTextures(4,tex);
 GLuint scene=target(tex[0],256,224),glow=target(tex[1],128,112);
 static unsigned char pixels[16*16*4];
 for(unsigned i=0;i<sizeof pixels;i++)pixels[i]=(unsigned char)(i*29u+(i>>2)*7u);
 for(unsigned t=2;t<4;t++){glBindTexture(GL_TEXTURE_2D,tex[t]);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,16,16,0,GL_RGBA,GL_UNSIGNED_BYTE,pixels);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);}
 for(unsigned f=0;;f++){
  unsigned char patch[4*4*4];
  for(unsigned i=0;i<sizeof patch;i++)patch[i]=(unsigned char)(f*11u+i*5u);
  glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,tex[2]);glTexSubImage2D(GL_TEXTURE_2D,0,(int)(f%4u)*4,0,4,4,GL_RGBA,GL_UNSIGNED_BYTE,patch);
  glBindFramebuffer(GL_FRAMEBUFFER,scene);glViewport(0,0,256,224);glClearColor(0.05f,0.05f,0.1f,1.0f);glClear(GL_COLOR_BUFFER_BIT);
  glUseProgram(sprites);glEnable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);
  for(unsigned i=0;i<24;i++)sprite(f,i,0.75f);
  glBindFramebuffer(GL_FRAMEBUFFER,glow);glViewport(0,0,128,112);glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);
  glBindTexture(GL_TEXTURE_2D,tex[0]);rect(-1,-1,2,2);glBufferSubData(GL_ARRAY_BUFFER,0,sizeof quad,quad);
  glUniform4f(tint,0.2f,0.3f,0.6f,0.8f);glDrawArrays(GL_TRIANGLES,0,6);
  glBindTexture(GL_TEXTURE_2D,tex[2]);for(unsigned i=0;i<7;i++)sprite(f,40u+i,0.5f);
  glActiveTexture(GL_TEXTURE2);glBindTexture(GL_TEXTURE_2D,tex[3]);glTexSubImage2D(GL_TEXTURE_2D,0,(int)(f%4u)*4,12,4,4,GL_RGBA,GL_UNSIGNED_BYTE,patch);
  glActiveTexture(GL_TEXTURE0);glBindFramebuffer(GL_FRAMEBUFFER,scene);glViewport(0,0,256,224);
  for(unsigned i=0;i<8;i++)sprite(f,24u+i,0.6f);
  glDisable(GL_BLEND);glBindFramebuffer(GL_FRAMEBUFFER,0);glViewport(0,0,256,224);glUseProgram(composite);
  glBindTexture(GL_TEXTURE_2D,tex[0]);glActiveTexture(GL_TEXTURE1);glBindTexture(GL_TEXTURE_2D,tex[1]);
  glActiveTexture(GL_TEXTURE2);glBindTexture(GL_TEXTURE_2D,tex[3]);glActiveTexture(GL_TEXTURE0);
  rect(-1,-1,2,2);glBufferSubData(GL_ARRAY_BUFFER,0,sizeof quad,quad);glDrawArrays(GL_TRIANGLES,0,6);
  if(glGetError()!=GL_NO_ERROR)OutputDebugStringA("batch FAIL guest error");
  SwapBuffers(dc);
 }
}
