/* SPDX-License-Identifier: CC0-1.0. Original engine-shaped frame, no game assets (K60).
 * Reproduces a 2D engine's per-frame GL pattern around per-item state: every frame resets capabilities the
 * renderer never uses (glDisable of DITHER, MULTISAMPLE, POLYGON_OFFSET_FILL, DEPTH_TEST, CULL_FACE), then
 * draws 48 canvas items, each with its own uniforms (rect, modulate) and a generic current colour
 * (glVertexAttrib4f on a disabled array), alternating a flat and a textured program; 8 polygon batches that
 * re-specify a stream buffer (capacity reuse); 4 particle emitters advanced by 2 transform-feedback captures
 * each and drawn instanced; a mid-frame screen copy (blit), a composite and an inset blit. One deliberately
 * invalid call per frame (glBlendEquation(GL_ZERO)) must surface as GL_INVALID_ENUM at the frame's single
 * glGetError, after every draw of the frame. Everything depends only on the SwapBuffers count. */
#include <windows.h>
#include <GL/glcorearb.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) \
 X(PFNGLUSEPROGRAMPROC,glUseProgram) X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation) X(PFNGLUNIFORM4FPROC,glUniform4f) \
 X(PFNGLUNIFORM1IPROC,glUniform1i) X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) \
 X(PFNGLBUFFERDATAPROC,glBufferData) X(PFNGLBINDBUFFERBASEPROC,glBindBufferBase) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) \
 X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) \
 X(PFNGLDISABLEVERTEXATTRIBARRAYPROC,glDisableVertexAttribArray) X(PFNGLVERTEXATTRIB4FPROC,glVertexAttrib4f) \
 X(PFNGLVERTEXATTRIBDIVISORPROC,glVertexAttribDivisor) X(PFNGLTRANSFORMFEEDBACKVARYINGSPROC,glTransformFeedbackVaryings) \
 X(PFNGLBEGINTRANSFORMFEEDBACKPROC,glBeginTransformFeedback) X(PFNGLENDTRANSFORMFEEDBACKPROC,glEndTransformFeedback) \
 X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) \
 X(PFNGLTEXPARAMETERIPROC,glTexParameteri) X(PFNGLACTIVETEXTUREPROC,glActiveTexture) \
 X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) \
 X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) X(PFNGLBLITFRAMEBUFFERPROC,glBlitFramebuffer) \
 X(PFNGLVIEWPORTPROC,glViewport) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLCLEARPROC,glClear) X(PFNGLENABLEPROC,glEnable) \
 X(PFNGLDISABLEPROC,glDisable) X(PFNGLISENABLEDPROC,glIsEnabled) X(PFNGLBLENDFUNCPROC,glBlendFunc) X(PFNGLBLENDEQUATIONPROC,glBlendEquation) \
 X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLDRAWARRAYSINSTANCEDPROC,glDrawArraysInstanced) X(PFNGLDRAWELEMENTSPROC,glDrawElements) \
 X(PFNGLGETERRORPROC,glGetError)
#define X(t,n) static t n;
FUNCTIONS
#undef X
#define ITEMS 48
#define BATCHES 8
#define EMITTERS 4
#define PARTICLES 48
static GLuint shader(GLenum type,const char *src){GLuint s=glCreateShader(type);glShaderSource(s,1,&src,0);glCompileShader(s);return s;}
static GLuint program(const char *vs,const char *fs,const char *varying){
 GLuint p=glCreateProgram();glAttachShader(p,shader(GL_VERTEX_SHADER,vs));glAttachShader(p,shader(GL_FRAGMENT_SHADER,fs));
 if(varying)glTransformFeedbackVaryings(p,1,&varying,GL_INTERLEAVED_ATTRIBS);
 glLinkProgram(p);return p;
}
static GLuint target(GLuint tex,int w,int h){
 GLuint fb;glBindTexture(GL_TEXTURE_2D,tex);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,w,h,0,GL_RGBA,GL_UNSIGNED_BYTE,0);
 glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
 glGenFramebuffers(1,&fb);glBindFramebuffer(GL_FRAMEBUFFER,fb);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex,0);
 return fb;
}
static float verts[12*4*4];static unsigned char colors[12*4*4];static unsigned short indices[12*6];
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="FrameCC0";RegisterClassA(&c);
 HWND win=CreateWindowExA(0,c.lpszClassName,"Frame CC0",WS_VISIBLE|WS_POPUP,0,0,256,224,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;
 SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);wglMakeCurrent(dc,wglCreateContext(dc));
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 const char *tinted="#version 330 core\nin vec4 tint;layout(location=0) out vec4 color;void main(){color=tint;}";
 /* Canvas items: corner from a static quad, colour from the generic current attribute (array disabled). */
 GLuint flat=program("#version 330 core\nlayout(location=0) in vec2 corner;layout(location=1) in vec4 color;uniform vec4 rect;uniform vec4 modulate;out vec4 tint;"
  "void main(){tint=color*modulate;gl_Position=vec4(rect.xy+corner*rect.zw,0.0,1.0);}",tinted,0);
 GLuint textured=program("#version 330 core\nlayout(location=0) in vec2 corner;layout(location=1) in vec4 color;uniform vec4 rect;uniform vec4 modulate;out vec4 tint;out vec2 uv;"
  "void main(){tint=color*modulate;uv=corner;gl_Position=vec4(rect.xy+corner*rect.zw,0.0,1.0);}",
  "#version 330 core\nin vec4 tint;in vec2 uv;uniform sampler2D src;layout(location=0) out vec4 color;void main(){color=texture(src,uv)*tint;}",0);
 GLuint canvas=program("#version 330 core\nlayout(location=0) in vec4 v;layout(location=1) in vec4 c;out vec4 tint;"
  "void main(){tint=c;gl_Position=vec4(v.xy,0.0,1.0);}",tinted,0);
 /* Particle process shader with an unrolled noise field (engine particle shaders are large: their capture
  * translation is what K60's per-pipeline cache saves). */
 GLuint step=program("#version 330 core\nlayout(location=0) in vec4 s;uniform vec4 force;out vec4 state;"
  "float field(vec2 p){float n=0.0;n+=sin(p.x*1.0+p.y*1.0+force.z*0.0)*cos(p.y*1.0-p.x*1.0)*0.50000;n+=sin(p.x*8.0+p.y*12.0+force.z*1.0)*cos(p.y*12.0-p.x*8.0)*0.33333;n+=sin(p.x*2.0+p.y*6.0+force.z*2.0)*cos(p.y*6.0-p.x*2.0)*0.25000;n+=sin(p.x*9.0+p.y*17.0+force.z*3.0)*cos(p.y*17.0-p.x*9.0)*0.20000;n+=sin(p.x*3.0+p.y*11.0+force.z*4.0)*cos(p.y*11.0-p.x*3.0)*0.16667;n+=sin(p.x*10.0+p.y*5.0+force.z*5.0)*cos(p.y*5.0-p.x*10.0)*0.14286;n+=sin(p.x*4.0+p.y*16.0+force.z*6.0)*cos(p.y*16.0-p.x*4.0)*0.12500;n+=sin(p.x*11.0+p.y*10.0+force.z*7.0)*cos(p.y*10.0-p.x*11.0)*0.11111;n+=sin(p.x*5.0+p.y*4.0+force.z*8.0)*cos(p.y*4.0-p.x*5.0)*0.10000;n+=sin(p.x*12.0+p.y*15.0+force.z*9.0)*cos(p.y*15.0-p.x*12.0)*0.09091;n+=sin(p.x*6.0+p.y*9.0+force.z*10.0)*cos(p.y*9.0-p.x*6.0)*0.08333;n+=sin(p.x*13.0+p.y*3.0+force.z*11.0)*cos(p.y*3.0-p.x*13.0)*0.07692;n+=sin(p.x*7.0+p.y*14.0+force.z*12.0)*cos(p.y*14.0-p.x*7.0)*0.07143;n+=sin(p.x*1.0+p.y*8.0+force.z*13.0)*cos(p.y*8.0-p.x*1.0)*0.06667;n+=sin(p.x*8.0+p.y*2.0+force.z*14.0)*cos(p.y*2.0-p.x*8.0)*0.06250;n+=sin(p.x*2.0+p.y*13.0+force.z*15.0)*cos(p.y*13.0-p.x*2.0)*0.05882;n+=sin(p.x*9.0+p.y*7.0+force.z*16.0)*cos(p.y*7.0-p.x*9.0)*0.05556;n+=sin(p.x*3.0+p.y*1.0+force.z*17.0)*cos(p.y*1.0-p.x*3.0)*0.05263;n+=sin(p.x*10.0+p.y*12.0+force.z*18.0)*cos(p.y*12.0-p.x*10.0)*0.05000;n+=sin(p.x*4.0+p.y*6.0+force.z*19.0)*cos(p.y*6.0-p.x*4.0)*0.04762;n+=sin(p.x*11.0+p.y*17.0+force.z*20.0)*cos(p.y*17.0-p.x*11.0)*0.04545;n+=sin(p.x*5.0+p.y*11.0+force.z*21.0)*cos(p.y*11.0-p.x*5.0)*0.04348;n+=sin(p.x*12.0+p.y*5.0+force.z*22.0)*cos(p.y*5.0-p.x*12.0)*0.04167;n+=sin(p.x*6.0+p.y*16.0+force.z*23.0)*cos(p.y*16.0-p.x*6.0)*0.04000;return n;}"
  "void main(){vec2 v=s.zw*0.98+force.xy+vec2(field(s.xy),-field(s.yx))*0.00002;vec2 p=s.xy+v;p=mod(p+1.0,2.0)-1.0;state=vec4(p,v);gl_Position=vec4(p,0.0,1.0);}",
  "#version 330 core\nlayout(location=0) out vec4 color;void main(){color=vec4(1.0);}","state");
 GLuint sprite=program("#version 330 core\nlayout(location=0) in vec2 corner;layout(location=1) in vec4 s;uniform vec4 hue;out vec4 tint;"
  "void main(){tint=vec4(hue.rgb*(0.5+0.5*abs(s.z)*40.0),0.8);gl_Position=vec4(s.xy+corner*0.03,0.0,1.0);}",tinted,0);
 GLuint quad=program("#version 330 core\nlayout(location=0) in vec2 corner;uniform vec4 rect;out vec2 uv;"
  "void main(){uv=corner;gl_Position=vec4(rect.xy+corner*rect.zw,0.0,1.0);}",
  "#version 330 core\nin vec2 uv;uniform sampler2D src;layout(location=0) out vec4 color;void main(){color=vec4(texture(src,uv).rgb,1.0);}",0);
 GLint frect=glGetUniformLocation(flat,"rect"),fmod=glGetUniformLocation(flat,"modulate");
 GLint trect=glGetUniformLocation(textured,"rect"),tmod=glGetUniformLocation(textured,"modulate");
 GLint force=glGetUniformLocation(step,"force"),hue=glGetUniformLocation(sprite,"hue"),qrect=glGetUniformLocation(quad,"rect");
 glUseProgram(textured);glUniform1i(glGetUniformLocation(textured,"src"),0);glUseProgram(quad);glUniform1i(glGetUniformLocation(quad,"src"),0);
 GLuint tex[3],fb[2];glGenTextures(3,tex);fb[0]=target(tex[0],256,224);fb[1]=target(tex[1],256,224);
 static unsigned char tile[8*8*4];for(unsigned i=0;i<sizeof tile;i++)tile[i]=(unsigned char)(90u+(i*13u+(i>>5)*29u)%160u);
 glBindTexture(GL_TEXTURE_2D,tex[2]);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,8,8,0,GL_RGBA,GL_UNSIGNED_BYTE,tile);
 glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
 GLuint unit,stream[3],part[EMITTERS][2],vao[3];glGenBuffers(1,&unit);glGenBuffers(3,stream);glGenVertexArrays(3,vao);
 const float corners[12]={0,0,1,0,0,1,1,0,1,1,0,1};
 glBindVertexArray(vao[0]);glBindBuffer(GL_ARRAY_BUFFER,unit);glBufferData(GL_ARRAY_BUFFER,sizeof corners,corners,GL_STATIC_DRAW);
 glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);glDisableVertexAttribArray(1);
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
  /* Per-frame capability reset, as engines do before drawing 2D. */
  glDisable(GL_DITHER);glDisable(GL_MULTISAMPLE);glDisable(GL_POLYGON_OFFSET_FILL);glDisable(GL_DEPTH_TEST);glDisable(GL_CULL_FACE);
  glBindFramebuffer(GL_FRAMEBUFFER,fb[0]);glViewport(0,0,256,224);glClearColor(0.05f,0.04f,0.08f,1.0f);glClear(GL_COLOR_BUFFER_BIT);
  glEnable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);
  glBlendEquation(GL_ZERO); /* invalid on purpose: GL_INVALID_ENUM, reported at the frame's glGetError */
  /* 48 canvas items: own uniforms and a generic current colour each. */
  glBindVertexArray(vao[0]);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,tex[2]);
  for(unsigned i=0;i<ITEMS;i++){
   int t=i%3==0;glUseProgram(t?textured:flat);
   float x=-0.95f+(float)((i*37u+f*3u)%170u)/100.0f,y=-0.95f+(float)((i*53u+f)%165u)/100.0f,w=0.08f+(float)(i%4)*0.04f;
   glUniform4f(t?trect:frect,x,y,w,w*1.1f);
   glUniform4f(t?tmod:fmod,1.0f,0.8f+0.2f*(float)(i%2),1.0f,0.85f);
   glVertexAttrib4f(1,(float)(40u+(i*41u)%215u)/255.0f,(float)(40u+(i*67u+f)%215u)/255.0f,(float)(60u+(i*29u)%195u)/255.0f,1.0f);
   glDrawArrays(GL_TRIANGLES,0,6);
   if(i==ITEMS/2){glBindFramebuffer(GL_READ_FRAMEBUFFER,fb[0]);glBindFramebuffer(GL_DRAW_FRAMEBUFFER,fb[1]);
    glBlitFramebuffer(0,0,256,224,0,0,256,224,GL_COLOR_BUFFER_BIT,GL_NEAREST);glBindFramebuffer(GL_FRAMEBUFFER,fb[0]);}
  }
  /* 8 polygon batches re-specifying the stream buffers (sizes vary per batch). */
  glUseProgram(canvas);glBindVertexArray(vao[1]);
  for(unsigned b=0;b<BATCHES;b++){
   unsigned q=1u+(b*5u+f)%12u;
   for(unsigned i=0;i<q;i++){
    float x=-0.95f+(float)((b*41u+i*23u+f*2u)%180u)/100.0f,y=-0.95f+(float)((b*29u+i*31u+f)%170u)/100.0f,w=0.05f+(float)(i%3)*0.03f;
    const float cc[4][2]={{0,0},{1,0},{0,1},{1,1}};
    for(unsigned k=0;k<4;k++){float*o=verts+(i*4+k)*4;o[0]=x+cc[k][0]*w;o[1]=y+cc[k][1]*w;o[2]=cc[k][0];o[3]=cc[k][1];
     unsigned char*cl=colors+(i*4+k)*4;cl[0]=(unsigned char)(60u+(b*37u)%190u);cl[1]=(unsigned char)(60u+(i*53u+b*11u)%190u);
     cl[2]=(unsigned char)(80u+(k*40u+f)%170u);cl[3]=210;}
    const unsigned short tri[6]={0,1,2,1,3,2};for(unsigned k=0;k<6;k++)indices[i*6+k]=(unsigned short)(i*4u+tri[k]);
   }
   glBindBuffer(GL_ARRAY_BUFFER,stream[0]);glBufferData(GL_ARRAY_BUFFER,q*4*16,verts,GL_STREAM_DRAW);
   glBindBuffer(GL_ARRAY_BUFFER,stream[1]);glBufferData(GL_ARRAY_BUFFER,q*4*4,colors,GL_STREAM_DRAW);
   glBufferData(GL_ELEMENT_ARRAY_BUFFER,q*6*2,indices,GL_STREAM_DRAW);
   glDrawElements(GL_TRIANGLES,(GLsizei)(q*6),GL_UNSIGNED_SHORT,0);
  }
  /* 4 emitters x 2 feedback steps, then instanced sprites from the captured state. */
  glUseProgram(step);glEnable(GL_RASTERIZER_DISCARD);glBindVertexArray(vao[0]);
  for(unsigned e=0;e<EMITTERS;e++)for(unsigned k=0;k<2;k++){
   GLuint src=part[e][k&1],dst=part[e][(k&1)^1];
   glBindBuffer(GL_ARRAY_BUFFER,src);glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,16,0);
   glUniform4f(force,(float)((int)((f+e)%5u)-2)*0.0004f,(float)((int)((f/3u+k)%5u)-2)*0.0004f,0,0);
   glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,dst);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,PARTICLES);glEndTransformFeedback();
  }
  glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,0);glDisable(GL_RASTERIZER_DISCARD);
  glBindBuffer(GL_ARRAY_BUFFER,unit);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);
  glUseProgram(sprite);glBindVertexArray(vao[2]);
  for(unsigned e=0;e<EMITTERS;e++){
   glBindBuffer(GL_ARRAY_BUFFER,part[e][0]);glVertexAttribPointer(1,4,GL_FLOAT,GL_FALSE,16,0);
   glUniform4f(hue,(float)(e%3)/2.0f,(float)((e+1)%3)/2.0f,(float)((e+2)%3)/2.0f,1);glDrawArraysInstanced(GL_TRIANGLES,0,6,PARTICLES);
  }
  glDisable(GL_BLEND);
  /* Composite to the default framebuffer, then an inset of the mid-frame copy (blit). */
  glBindFramebuffer(GL_FRAMEBUFFER,0);glViewport(0,0,256,224);glUseProgram(quad);glBindVertexArray(vao[0]);glBindTexture(GL_TEXTURE_2D,tex[0]);
  glUniform4f(qrect,-1,-1,2,2);glDrawArrays(GL_TRIANGLES,0,6);
  glBindFramebuffer(GL_READ_FRAMEBUFFER,fb[1]);glBindFramebuffer(GL_DRAW_FRAMEBUFFER,0);
  glBlitFramebuffer(0,0,256,224,176,152,248,216,GL_COLOR_BUFFER_BIT,GL_LINEAR);
  GLenum err=glGetError();
  if(err!=GL_INVALID_ENUM||glGetError()!=GL_NO_ERROR||glIsEnabled(GL_DITHER)||glIsEnabled(GL_POLYGON_OFFSET_FILL))OutputDebugStringA("frame FAIL guest error state");
  else if(f==2)OutputDebugStringA("x64-gl-frame PASS frame state");
  SwapBuffers(dc);
 }
}
