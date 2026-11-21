/* SPDX-License-Identifier: CC0-1.0. Original engine-shaped frame, no game assets (K57).
 * Reproduces a 2D engine's per-frame GL pattern: 20 canvas batches that each re-specify three stream
 * buffers with glBufferData at varying sizes (60 orphaning calls on 3 buffers), 6 particle emitters
 * advanced by 3 transform-feedback steps each (18 captures, rasterizer discard) and drawn instanced,
 * 4 framebuffer blits (a screen-read copy, two linear downsamples, an inset to the default framebuffer),
 * 8 static background tiles and 4 effect quads that sample the copy, then a composite: 39 draws.
 * Everything depends only on the SwapBuffers count. */
#include <windows.h>
#include <GL/glcorearb.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) \
 X(PFNGLUSEPROGRAMPROC,glUseProgram) X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation) X(PFNGLUNIFORM4FPROC,glUniform4f) \
 X(PFNGLUNIFORM1IPROC,glUniform1i) X(PFNGLUNIFORM1FPROC,glUniform1f) X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) \
 X(PFNGLBUFFERDATAPROC,glBufferData) X(PFNGLBINDBUFFERBASEPROC,glBindBufferBase) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) \
 X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) \
 X(PFNGLVERTEXATTRIBDIVISORPROC,glVertexAttribDivisor) X(PFNGLTRANSFORMFEEDBACKVARYINGSPROC,glTransformFeedbackVaryings) \
 X(PFNGLBEGINTRANSFORMFEEDBACKPROC,glBeginTransformFeedback) X(PFNGLENDTRANSFORMFEEDBACKPROC,glEndTransformFeedback) \
 X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) \
 X(PFNGLTEXPARAMETERIPROC,glTexParameteri) X(PFNGLACTIVETEXTUREPROC,glActiveTexture) \
 X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) \
 X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) X(PFNGLBLITFRAMEBUFFERPROC,glBlitFramebuffer) \
 X(PFNGLVIEWPORTPROC,glViewport) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLCLEARPROC,glClear) X(PFNGLENABLEPROC,glEnable) \
 X(PFNGLDISABLEPROC,glDisable) X(PFNGLBLENDFUNCPROC,glBlendFunc) X(PFNGLDRAWARRAYSPROC,glDrawArrays) \
 X(PFNGLDRAWARRAYSINSTANCEDPROC,glDrawArraysInstanced) X(PFNGLDRAWELEMENTSPROC,glDrawElements) X(PFNGLGETERRORPROC,glGetError)
#define X(t,n) static t n;
FUNCTIONS
#undef X
#define EMITTERS 6
#define PARTICLES 64
static GLuint shader(GLenum type,const char *src){GLuint s=glCreateShader(type);glShaderSource(s,1,&src,0);glCompileShader(s);return s;}
static GLuint program(const char *vs,const char *fs,const char *varying){
 GLuint p=glCreateProgram();glAttachShader(p,shader(GL_VERTEX_SHADER,vs));glAttachShader(p,shader(GL_FRAGMENT_SHADER,fs));
 if(varying)glTransformFeedbackVaryings(p,1,&varying,GL_INTERLEAVED_ATTRIBS);
 glLinkProgram(p);return p;
}
static GLuint target(GLuint tex,int w,int h,GLenum filter){
 GLuint fb;glBindTexture(GL_TEXTURE_2D,tex);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,w,h,0,GL_RGBA,GL_UNSIGNED_BYTE,0);
 glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,filter);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,filter);
 glGenFramebuffers(1,&fb);glBindFramebuffer(GL_FRAMEBUFFER,fb);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex,0);
 return fb;
}
static float verts[8*4*4];static unsigned char colors[8*4*4];static unsigned short indices[8*6];
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="RespecCC0";RegisterClassA(&c);
 HWND win=CreateWindowExA(0,c.lpszClassName,"Respec CC0",WS_VISIBLE|WS_POPUP,0,0,256,224,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;
 SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);wglMakeCurrent(dc,wglCreateContext(dc));
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 const char *flat="#version 330 core\nin vec4 tint;layout(location=0) out vec4 color;void main(){color=tint;}";
 GLuint canvas=program("#version 330 core\nlayout(location=0) in vec4 v;layout(location=1) in vec4 c;out vec4 tint;"
  "void main(){tint=c;gl_Position=vec4(v.xy,0.0,1.0);}",flat,0);
 GLuint step=program("#version 330 core\nlayout(location=0) in vec4 s;uniform vec4 force;out vec4 state;"
  "void main(){vec2 v=s.zw*0.98+force.xy;vec2 p=s.xy+v;p=mod(p+1.0,2.0)-1.0;state=vec4(p,v);gl_Position=vec4(p,0.0,1.0);}",
  "#version 330 core\nlayout(location=0) out vec4 color;void main(){color=vec4(1.0);}","state");
 GLuint sprite=program("#version 330 core\nlayout(location=0) in vec2 corner;layout(location=1) in vec4 s;uniform vec4 hue;out vec4 tint;"
  "void main(){tint=vec4(hue.rgb*(0.5+0.5*abs(s.z)*40.0),0.8);gl_Position=vec4(s.xy+corner*0.025,0.0,1.0);}",flat,0);
 GLuint quad=program("#version 330 core\nlayout(location=0) in vec2 corner;uniform vec4 rect;out vec2 uv;"
  "void main(){uv=corner;gl_Position=vec4(rect.xy+corner*rect.zw,0.0,1.0);}",
  "#version 330 core\nin vec2 uv;uniform sampler2D src;uniform vec4 tone;layout(location=0) out vec4 color;"
  "void main(){vec4 t=texture(src,uv);color=vec4(mix(t.rgb,tone.rgb,tone.a),1.0);}",0);
 GLint force=glGetUniformLocation(step,"force"),hue=glGetUniformLocation(sprite,"hue");
 GLint rect=glGetUniformLocation(quad,"rect"),tone=glGetUniformLocation(quad,"tone");
 glUseProgram(quad);glUniform1i(glGetUniformLocation(quad,"src"),0);
 GLuint tex[5],fb[4];glGenTextures(5,tex);
 fb[0]=target(tex[0],256,224,GL_LINEAR);fb[1]=target(tex[1],256,224,GL_LINEAR);
 fb[2]=target(tex[2],128,112,GL_LINEAR);fb[3]=target(tex[3],64,56,GL_LINEAR);
 static unsigned char tile[8*8*4];for(unsigned i=0;i<sizeof tile;i++)tile[i]=(unsigned char)(40u+(i*13u+(i>>5)*29u)%120u);
 glBindTexture(GL_TEXTURE_2D,tex[4]);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,8,8,0,GL_RGBA,GL_UNSIGNED_BYTE,tile);
 glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
 /* Static unit quad (two triangles) shared by tiles, effects, composite and particle sprites. */
 GLuint unit,stream[3],part[EMITTERS][2],vao[3];glGenBuffers(1,&unit);glGenBuffers(3,stream);glGenVertexArrays(3,vao);
 const float corners[12]={0,0,1,0,0,1,1,0,1,1,0,1};
 glBindVertexArray(vao[0]);glBindBuffer(GL_ARRAY_BUFFER,unit);glBufferData(GL_ARRAY_BUFFER,sizeof corners,corners,GL_STATIC_DRAW);
 glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);
 glBindVertexArray(vao[1]);glBindBuffer(GL_ARRAY_BUFFER,stream[0]);glBufferData(GL_ARRAY_BUFFER,64,0,GL_STREAM_DRAW);
 glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,16,0);glEnableVertexAttribArray(0);
 glBindBuffer(GL_ARRAY_BUFFER,stream[1]);glBufferData(GL_ARRAY_BUFFER,16,0,GL_STREAM_DRAW);
 glVertexAttribPointer(1,4,GL_UNSIGNED_BYTE,GL_TRUE,4,0);glEnableVertexAttribArray(1);
 glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,stream[2]);glBufferData(GL_ELEMENT_ARRAY_BUFFER,12,0,GL_STREAM_DRAW);
 for(unsigned e=0;e<EMITTERS;e++){
  static float init[PARTICLES*4];
  for(unsigned i=0;i<PARTICLES;i++){init[i*4]=(float)((i*37u+e*11u)%200u)/100.0f-1.0f;init[i*4+1]=(float)((i*53u+e*7u)%200u)/100.0f-1.0f;
   init[i*4+2]=(float)((int)(i%9u)-4)*0.002f;init[i*4+3]=(float)((int)((i+e)%7u)-3)*0.002f;}
  glGenBuffers(2,part[e]);
  for(unsigned k=0;k<2;k++){glBindBuffer(GL_ARRAY_BUFFER,part[e][k]);glBufferData(GL_ARRAY_BUFFER,sizeof init,init,GL_DYNAMIC_COPY);}
 }
 glBindVertexArray(vao[2]);glBindBuffer(GL_ARRAY_BUFFER,unit);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);
 glEnableVertexAttribArray(1);glVertexAttribDivisor(1,1);
 for(unsigned f=0;;f++){
  glBindFramebuffer(GL_FRAMEBUFFER,fb[0]);glViewport(0,0,256,224);glClearColor(0.04f,0.05f,0.09f,1.0f);glClear(GL_COLOR_BUFFER_BIT);
  /* 8 static background tiles (no buffer traffic). */
  glUseProgram(quad);glBindVertexArray(vao[0]);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,tex[4]);
  for(unsigned i=0;i<8;i++){glUniform4f(rect,-1.0f+(float)(i%4)*0.5f,-1.0f+(float)(i/4)*1.0f,0.5f,1.0f);
   glUniform4f(tone,(float)(i%3)/2.0f,0.3f,(float)((i+f/16u)%4)/3.0f,0.35f);glDrawArrays(GL_TRIANGLES,0,6);}
  /* 6 emitters x 3 feedback steps (ping-pong), rasterizer discard. */
  glUseProgram(step);glEnable(GL_RASTERIZER_DISCARD);glBindVertexArray(vao[0]);
  for(unsigned e=0;e<EMITTERS;e++)for(unsigned k=0;k<3;k++){
   GLuint src=part[e][k&1],dst=part[e][(k&1)^1];
   glBindBuffer(GL_ARRAY_BUFFER,src);glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,16,0);
   glUniform4f(force,(float)((int)((f+e)%5u)-2)*0.0004f,(float)((int)((f/3u+k)%5u)-2)*0.0004f,0,0);
   glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,dst);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,PARTICLES);glEndTransformFeedback();
  }
  glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,0);glDisable(GL_RASTERIZER_DISCARD);
  glBindBuffer(GL_ARRAY_BUFFER,unit);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);
  /* 20 canvas batches; each re-specifies positions, colours and indices at a size that varies per batch. */
  glUseProgram(canvas);glBindVertexArray(vao[1]);glEnable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);
  for(unsigned b=0;b<20;b++){
   unsigned q=1u+(b*5u+f)%8u;
   for(unsigned i=0;i<q;i++){
    float x=-0.95f+(float)((b*41u+i*23u+f*2u)%180u)/100.0f,y=-0.95f+(float)((b*29u+i*31u+f)%170u)/100.0f,w=0.06f+(float)(i%3)*0.03f;
    const float cc[4][2]={{0,0},{1,0},{0,1},{1,1}};
    for(unsigned k=0;k<4;k++){float*o=verts+(i*4+k)*4;o[0]=x+cc[k][0]*w;o[1]=y+cc[k][1]*w;o[2]=cc[k][0];o[3]=cc[k][1];
     unsigned char*cl=colors+(i*4+k)*4;cl[0]=(unsigned char)(60u+(b*37u)%190u);cl[1]=(unsigned char)(60u+(i*53u+b*11u)%190u);
     cl[2]=(unsigned char)(80u+(k*40u+f)%170u);cl[3]=200;}
    const unsigned short tri[6]={0,1,2,1,3,2};for(unsigned k=0;k<6;k++)indices[i*6+k]=(unsigned short)(i*4u+tri[k]);
   }
   glBindBuffer(GL_ARRAY_BUFFER,stream[0]);glBufferData(GL_ARRAY_BUFFER,q*4*16,verts,GL_STREAM_DRAW);
   glBindBuffer(GL_ARRAY_BUFFER,stream[1]);glBufferData(GL_ARRAY_BUFFER,q*4*4,colors,GL_STREAM_DRAW);
   glBufferData(GL_ELEMENT_ARRAY_BUFFER,q*6*2,indices,GL_STREAM_DRAW);
   glDrawElements(GL_TRIANGLES,(GLsizei)(q*6),GL_UNSIGNED_SHORT,0);
   if(b==9){ /* screen-read copy mid-frame (blit 1) */
    glBindFramebuffer(GL_READ_FRAMEBUFFER,fb[0]);glBindFramebuffer(GL_DRAW_FRAMEBUFFER,fb[1]);
    glBlitFramebuffer(0,0,256,224,0,0,256,224,GL_COLOR_BUFFER_BIT,GL_NEAREST);glBindFramebuffer(GL_FRAMEBUFFER,fb[0]);
   }
  }
  /* Particles, instanced from the feedback output. */
  glUseProgram(sprite);glBindVertexArray(vao[2]);
  for(unsigned e=0;e<EMITTERS;e++){
   glBindBuffer(GL_ARRAY_BUFFER,part[e][1]);glVertexAttribPointer(1,4,GL_FLOAT,GL_FALSE,16,0);
   glUniform4f(hue,(float)(e%3)/2.0f,(float)((e+1)%3)/2.0f,(float)((e+2)%3)/2.0f,1);glDrawArraysInstanced(GL_TRIANGLES,0,6,PARTICLES);
  }
  glDisable(GL_BLEND);
  /* 4 effect quads sampling the mid-frame copy. */
  glUseProgram(quad);glBindVertexArray(vao[0]);glBindTexture(GL_TEXTURE_2D,tex[1]);
  for(unsigned i=0;i<4;i++){glUniform4f(rect,-0.9f+(float)i*0.45f,0.55f,0.35f,0.3f);glUniform4f(tone,0.9f,0.6f,0.2f,0.25f+0.1f*(float)i);glDrawArrays(GL_TRIANGLES,0,6);}
  /* Two linear downsamples (blits 2, 3), composite, and an inset blit to the default framebuffer (blit 4). */
  glBindFramebuffer(GL_READ_FRAMEBUFFER,fb[0]);glBindFramebuffer(GL_DRAW_FRAMEBUFFER,fb[2]);
  glBlitFramebuffer(0,0,256,224,0,0,128,112,GL_COLOR_BUFFER_BIT,GL_LINEAR);
  glBindFramebuffer(GL_READ_FRAMEBUFFER,fb[2]);glBindFramebuffer(GL_DRAW_FRAMEBUFFER,fb[3]);
  glBlitFramebuffer(0,0,128,112,0,0,64,56,GL_COLOR_BUFFER_BIT,GL_LINEAR);
  glBindFramebuffer(GL_FRAMEBUFFER,0);glViewport(0,0,256,224);glBindTexture(GL_TEXTURE_2D,tex[0]);
  glUniform4f(rect,-1,-1,2,2);glUniform4f(tone,0,0,0,0);glDrawArrays(GL_TRIANGLES,0,6);
  glBindFramebuffer(GL_READ_FRAMEBUFFER,fb[3]);glBindFramebuffer(GL_DRAW_FRAMEBUFFER,0);
  glBlitFramebuffer(0,0,64,56,184,160,248,216,GL_COLOR_BUFFER_BIT,GL_NEAREST);
  if(glGetError()!=GL_NO_ERROR)OutputDebugStringA("respec FAIL guest error");
  SwapBuffers(dc);
 }
}
