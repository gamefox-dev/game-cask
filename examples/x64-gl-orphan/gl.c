/* SPDX-License-Identifier: CC0-1.0. Original engine-shaped workload, no game assets.
 * Forty draw/pass pairs, same-size vertex/index orphaning, 3 texture uploads/frame.
 * Hold F9 for alternating store sizes (deliberately retains allocation boundaries). */
#include <windows.h>
#include <GL/glcorearb.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLUSEPROGRAMPROC,glUseProgram) \
 X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) X(PFNGLBUFFERDATAPROC,glBufferData) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) \
 X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) X(PFNGLTEXSUBIMAGE2DPROC,glTexSubImage2D) \
 X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) \
 X(PFNGLDRAWELEMENTSPROC,glDrawElements) X(PFNGLGETERRORPROC,glGetError)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static GLuint shader(GLenum type,const char *src){GLuint s=glCreateShader(type);glShaderSource(s,1,&src,0);glCompileShader(s);return s;}
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="OrphanCC0";RegisterClassA(&c);
 HWND win=CreateWindowExA(0,c.lpszClassName,"Orphan CC0",WS_VISIBLE|WS_POPUP,0,0,32,32,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;
 SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);wglMakeCurrent(dc,wglCreateContext(dc));
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 GLuint p=glCreateProgram();glAttachShader(p,shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=0) in vec2 pos;void main(){gl_Position=vec4(pos,0.0,1.0);}"));
 glAttachShader(p,shader(GL_FRAGMENT_SHADER,"#version 330 core\nlayout(location=0) out vec4 color;void main(){color=vec4(1.0,0.0,0.0,1.0);}"));glLinkProgram(p);glUseProgram(p);
 GLuint vao,b[2],tex[3],fb[2];glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(2,b);glBindBuffer(GL_ARRAY_BUFFER,b[0]);
 glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,b[1]);
 glGenTextures(3,tex);glGenFramebuffers(2,fb);
 for(unsigned i=0;i<3;i++){glBindTexture(GL_TEXTURE_2D,tex[i]);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,i<2?32:1,i<2?32:1,0,GL_RGBA,GL_UNSIGNED_BYTE,0);if(i<2){glBindFramebuffer(GL_FRAMEBUFFER,fb[i]);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex[i],0);}}
 const float v[8]={-1,-1,3,-1,-1,3,0,0};const unsigned short indices[4]={0,1,2,0};const unsigned char white[4]={255,255,255,255};
 for(;;){
  unsigned varying=(GetAsyncKeyState(VK_F9)&0x8000)!=0;
  for(unsigned i=0;i<40;i++){
   glBindBuffer(GL_ARRAY_BUFFER,b[0]);glBufferData(GL_ARRAY_BUFFER,24+(varying?(i%2)*8:0),v,GL_STREAM_DRAW);
   glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,b[1]);glBufferData(GL_ELEMENT_ARRAY_BUFFER,6+(varying?(i%2)*2:0),indices,GL_STREAM_DRAW);
   if(i<3){glBindTexture(GL_TEXTURE_2D,tex[2]);glTexSubImage2D(GL_TEXTURE_2D,0,0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,white);}
   glBindFramebuffer(GL_FRAMEBUFFER,i==39?0:fb[i%2]);glDrawElements(GL_TRIANGLES,3,GL_UNSIGNED_SHORT,0);
  }
  if(glGetError()!=GL_NO_ERROR)OutputDebugStringA("orphan FAIL guest error");
  SwapBuffers(dc);
 }
}
