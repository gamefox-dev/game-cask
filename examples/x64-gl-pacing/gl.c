/* SPDX-License-Identifier: CC0-1.0. Original GPU-bound engine-shaped frame, no game assets (K67, Q115/Q116).
 * Every frame: 32 stream batches that re-specify a vertex and an index buffer with glBufferData at varying
 * sizes inside one offscreen pass (WebGPU copy-on-write renames inside one merged frame), 4 instanced sprite
 * draws whose colour is a generic current attribute (glVertexAttrib4f on a disabled array; Q115: no
 * synchronous per-instance upload), a full-screen effect whose fragment shader runs a long arithmetic loop
 * (a GPU frame cost above one display interval of an 85 Hz display), then a composite to the default
 * framebuffer. One glGetError per frame. WebKit paces a WebGPU canvas from the GPU execution window of the
 * command buffer that touches the canvas texture (Q116): this fixture makes that window long. Everything
 * depends only on the SwapBuffers count. */
#include <windows.h>
#include <GL/glcorearb.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) \
 X(PFNGLUSEPROGRAMPROC,glUseProgram) X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation) X(PFNGLUNIFORM4FPROC,glUniform4f) \
 X(PFNGLUNIFORM1IPROC,glUniform1i) X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) \
 X(PFNGLBUFFERDATAPROC,glBufferData) X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) \
 X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) \
 X(PFNGLDISABLEVERTEXATTRIBARRAYPROC,glDisableVertexAttribArray) X(PFNGLVERTEXATTRIB4FPROC,glVertexAttrib4f) \
 X(PFNGLVERTEXATTRIBDIVISORPROC,glVertexAttribDivisor) X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) \
 X(PFNGLTEXIMAGE2DPROC,glTexImage2D) X(PFNGLTEXPARAMETERIPROC,glTexParameteri) X(PFNGLACTIVETEXTUREPROC,glActiveTexture) \
 X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) \
 X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) X(PFNGLVIEWPORTPROC,glViewport) X(PFNGLCLEARCOLORPROC,glClearColor) \
 X(PFNGLCLEARPROC,glClear) X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable) X(PFNGLBLENDFUNCPROC,glBlendFunc) \
 X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLDRAWARRAYSINSTANCEDPROC,glDrawArraysInstanced) X(PFNGLDRAWELEMENTSPROC,glDrawElements) \
 X(PFNGLGETERRORPROC,glGetError)
#define X(t,n) static t n;
FUNCTIONS
#undef X
#define W 512
#define H 288
#define BATCHES 32
#define QUADS 24
#define SPRITES 4
#define INSTANCES 64
static GLuint shader(GLenum type,const char *src){GLuint s=glCreateShader(type);glShaderSource(s,1,&src,0);glCompileShader(s);return s;}
static GLuint program(const char *vs,const char *fs){
 GLuint p=glCreateProgram();glAttachShader(p,shader(GL_VERTEX_SHADER,vs));glAttachShader(p,shader(GL_FRAGMENT_SHADER,fs));glLinkProgram(p);return p;
}
static float verts[QUADS*4*6];static unsigned short indices[QUADS*6];static float offsets[INSTANCES*2];
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="PacingCC0";RegisterClassA(&c);
 HWND win=CreateWindowExA(0,c.lpszClassName,"Pacing CC0",WS_VISIBLE|WS_POPUP,0,0,W,H,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;
 SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);wglMakeCurrent(dc,wglCreateContext(dc));
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 const char *tinted="#version 330 core\nin vec4 tint;layout(location=0) out vec4 color;void main(){color=tint;}";
 GLuint canvas=program("#version 330 core\nlayout(location=0) in vec2 p;layout(location=1) in vec4 c;out vec4 tint;"
  "void main(){tint=c;gl_Position=vec4(p,0.0,1.0);}",tinted);
 /* Instanced sprites: per-instance offset array, colour from the generic current attribute 2 (array disabled). */
 GLuint sprite=program("#version 330 core\nlayout(location=0) in vec2 corner;layout(location=1) in vec2 at;layout(location=2) in vec4 glow;out vec4 tint;"
  "void main(){tint=glow;gl_Position=vec4(at+corner*0.05,0.0,1.0);}",tinted);
 /* Full-screen effect: a long, uniform-driven arithmetic loop per fragment (GPU cost), faint additive output. */
 GLuint effect=program("#version 330 core\nlayout(location=0) in vec2 corner;out vec2 uv;void main(){uv=corner;gl_Position=vec4(corner*2.0-1.0,0.0,1.0);}",
  "#version 330 core\nin vec2 uv;uniform vec4 knob;layout(location=0) out vec4 color;"
  "void main(){float v=uv.x*0.731+uv.y*0.277+knob.x;for(int k=0;k<16000;k++){v=fract(sin(v*12.9898+knob.y)*43758.5453);}"
  "color=vec4(v*0.04,uv.y*0.04,0.03,1.0);}");
 GLuint quad=program("#version 330 core\nlayout(location=0) in vec2 corner;out vec2 uv;void main(){uv=corner;gl_Position=vec4(corner*2.0-1.0,0.0,1.0);}",
  "#version 330 core\nin vec2 uv;uniform sampler2D src;layout(location=0) out vec4 color;void main(){color=vec4(texture(src,uv).rgb,1.0);}");
 GLint knob=glGetUniformLocation(effect,"knob");
 glUseProgram(quad);glUniform1i(glGetUniformLocation(quad,"src"),0);
 GLuint tex,fb;glGenTextures(1,&tex);glBindTexture(GL_TEXTURE_2D,tex);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,W,H,0,GL_RGBA,GL_UNSIGNED_BYTE,0);
 glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
 glGenFramebuffers(1,&fb);glBindFramebuffer(GL_FRAMEBUFFER,fb);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex,0);
 GLuint unit,stream[2],inst,vao[3];glGenBuffers(1,&unit);glGenBuffers(2,stream);glGenBuffers(1,&inst);glGenVertexArrays(3,vao);
 const float corners[12]={0,0,1,0,0,1,1,0,1,1,0,1};
 glBindVertexArray(vao[0]);glBindBuffer(GL_ARRAY_BUFFER,unit);glBufferData(GL_ARRAY_BUFFER,sizeof corners,corners,GL_STATIC_DRAW);
 glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);
 glBindVertexArray(vao[1]);glBindBuffer(GL_ARRAY_BUFFER,stream[0]);glBufferData(GL_ARRAY_BUFFER,sizeof verts,0,GL_STREAM_DRAW);
 glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,24,0);glEnableVertexAttribArray(0);
 glVertexAttribPointer(1,4,GL_FLOAT,GL_FALSE,24,(void*)8);glEnableVertexAttribArray(1);
 glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,stream[1]);glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof indices,0,GL_STREAM_DRAW);
 for(unsigned i=0;i<INSTANCES;i++){offsets[i*2]=-0.9f+(float)(i%8)*0.24f;offsets[i*2+1]=-0.9f+(float)(i/8)*0.24f;}
 glBindVertexArray(vao[2]);glBindBuffer(GL_ARRAY_BUFFER,unit);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);
 glBindBuffer(GL_ARRAY_BUFFER,inst);glBufferData(GL_ARRAY_BUFFER,sizeof offsets,offsets,GL_STATIC_DRAW);
 glVertexAttribPointer(1,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(1);glVertexAttribDivisor(1,1);glDisableVertexAttribArray(2);
 for(unsigned f=0;;f++){
  glBindFramebuffer(GL_FRAMEBUFFER,fb);glViewport(0,0,W,H);glClearColor(0.04f,0.05f,0.09f,1.0f);glClear(GL_COLOR_BUFFER_BIT);
  glEnable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);
  /* Stream batches: both buffers re-specified per batch while earlier batches of the frame still read them. */
  glUseProgram(canvas);glBindVertexArray(vao[1]);
  for(unsigned b=0;b<BATCHES;b++){
   unsigned q=4u+(b*7u+f)%(QUADS-4u);
   for(unsigned i=0;i<q;i++){
    float x=-0.95f+(float)((b*41u+i*23u+f*2u)%180u)/100.0f,y=-0.95f+(float)((b*29u+i*31u+f)%170u)/100.0f,s=0.04f+(float)(i%3)*0.02f;
    const float cc[4][2]={{0,0},{1,0},{0,1},{1,1}};
    for(unsigned k=0;k<4;k++){float*o=verts+(i*4+k)*6;o[0]=x+cc[k][0]*s;o[1]=y+cc[k][1]*s;
     o[2]=(float)(60u+(b*37u)%190u)/255.0f;o[3]=(float)(60u+(i*53u+b*11u)%190u)/255.0f;o[4]=(float)(80u+(k*40u+f)%170u)/255.0f;o[5]=0.85f;}
    const unsigned short tri[6]={0,1,2,1,3,2};for(unsigned k=0;k<6;k++)indices[i*6+k]=(unsigned short)(i*4u+tri[k]);
   }
   glBindBuffer(GL_ARRAY_BUFFER,stream[0]);glBufferData(GL_ARRAY_BUFFER,q*4*24,verts,GL_STREAM_DRAW);
   glBufferData(GL_ELEMENT_ARRAY_BUFFER,q*6*2,indices,GL_STREAM_DRAW);
   glDrawElements(GL_TRIANGLES,(GLsizei)(q*6),GL_UNSIGNED_SHORT,0);
  }
  /* Instanced sprites with a per-draw generic current colour. */
  glUseProgram(sprite);glBindVertexArray(vao[2]);
  for(unsigned e=0;e<SPRITES;e++){
   glVertexAttrib4f(2,0.3f+0.2f*(float)e,0.9f-0.15f*(float)e,0.4f+0.1f*(float)((e+f)%3),0.7f);
   glDrawArraysInstanced(GL_TRIANGLES,0,6,INSTANCES-(GLsizei)e*8);
  }
  /* GPU-heavy full-screen effect (additive). */
  glUseProgram(effect);glBindVertexArray(vao[0]);glBlendFunc(GL_ONE,GL_ONE);
  glUniform4f(knob,(float)(f%97u)*0.01f,0.5f,0,0);glDrawArrays(GL_TRIANGLES,0,6);
  glDisable(GL_BLEND);
  glBindFramebuffer(GL_FRAMEBUFFER,0);glViewport(0,0,W,H);glUseProgram(quad);glBindTexture(GL_TEXTURE_2D,tex);glDrawArrays(GL_TRIANGLES,0,6);
  if(glGetError()!=GL_NO_ERROR)OutputDebugStringA("x64-gl-pacing FAIL guest error state");
  else if(f==2)OutputDebugStringA("x64-gl-pacing PASS frame state");
  SwapBuffers(dc);
 }
}
