/* Original CC0-1.0. Engine-independent GL 3.3 framebuffer-transfer regression, no BGT imports. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#define FUNCTIONS \
 X(PFNGLGENFRAMEBUFFERSPROC,glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC,glBindFramebuffer) \
 X(PFNGLFRAMEBUFFERTEXTURE2DPROC,glFramebufferTexture2D) X(PFNGLCHECKFRAMEBUFFERSTATUSPROC,glCheckFramebufferStatus) \
 X(PFNGLGENTEXTURESPROC,glGenTextures) X(PFNGLBINDTEXTUREPROC,glBindTexture) X(PFNGLTEXIMAGE2DPROC,glTexImage2D) \
 X(PFNGLTEXPARAMETERIPROC,glTexParameteri) X(PFNGLBLITFRAMEBUFFERPROC,glBlitFramebuffer) X(PFNGLTEXSUBIMAGE2DPROC,glTexSubImage2D) \
 X(PFNGLCLEARBUFFERIVPROC,glClearBufferiv) X(PFNGLCLEARPROC,glClear) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLCLEARDEPTHPROC,glClearDepth) X(PFNGLCLEARSTENCILPROC,glClearStencil) \
 X(PFNGLCOLORMASKPROC,glColorMask) X(PFNGLDEPTHMASKPROC,glDepthMask) X(PFNGLSTENCILMASKPROC,glStencilMask) \
 X(PFNGLREADPIXELSPROC,glReadPixels) X(PFNGLGETERRORPROC,glGetError) X(PFNGLREADBUFFERPROC,glReadBuffer) X(PFNGLDRAWBUFFERPROC,glDrawBuffer) \
 X(PFNGLDRAWBUFFERSPROC,glDrawBuffers) X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable) X(PFNGLSCISSORPROC,glScissor) \
 X(PFNGLVIEWPORTPROC,glViewport) X(PFNGLDEPTHFUNCPROC,glDepthFunc) X(PFNGLSTENCILFUNCPROC,glStencilFunc) \
 X(PFNGLSTENCILOPPROC,glStencilOp) X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) \
 X(PFNGLCOMPILESHADERPROC,glCompileShader) X(PFNGLGETSHADERIVPROC,glGetShaderiv) X(PFNGLCREATEPROGRAMPROC,glCreateProgram) \
 X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLGETPROGRAMIVPROC,glGetProgramiv) \
 X(PFNGLUSEPROGRAMPROC,glUseProgram) X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) \
 X(PFNGLDRAWARRAYSPROC,glDrawArrays)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static unsigned failures,checks;
static void note(const char *s,int ok){char b[180];snprintf(b,sizeof b,"x64-gl-blit %s %s",ok?"ok":"FAIL",s);OutputDebugStringA(b);checks++;if(!ok)failures++;}
static void error(GLenum e,const char *s){GLenum got=glGetError();note(s,got==e&&glGetError()==GL_NO_ERROR);}
static void pixel(int x,int y,int r,int g,int b,const char *s){unsigned char p[4]={0};glReadPixels(x,y,1,1,GL_RGBA,GL_UNSIGNED_BYTE,p);note(s,abs((int)p[0]-r)<=1&&abs((int)p[1]-g)<=1&&abs((int)p[2]-b)<=1&&p[3]==255);}
static GLuint image(GLenum internal,unsigned size,GLenum format,GLenum type,const void *data){GLuint t;glGenTextures(1,&t);glBindTexture(GL_TEXTURE_2D,t);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexImage2D(GL_TEXTURE_2D,0,internal,size,size,0,format,type,data);return t;}
static GLuint framebuffer(GLuint color,GLuint ds){GLuint f;glGenFramebuffers(1,&f);glBindFramebuffer(GL_FRAMEBUFFER,f);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,color,0);if(ds)glFramebufferTexture2D(GL_FRAMEBUFFER,GL_DEPTH_STENCIL_ATTACHMENT,GL_TEXTURE_2D,ds,0);note("framebuffer complete",glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE);return f;}
static GLuint shader(GLenum stage,const char *s){GLuint id=glCreateShader(stage);GLint ok=0;glShaderSource(id,1,&s,0);glCompileShader(id);glGetShaderiv(id,GL_COMPILE_STATUS,&ok);note("shader compile",ok);return id;}
static void clear(void){glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);}
#define bind bind_fbos
static void bind(GLuint src,GLuint dst){glBindFramebuffer(GL_READ_FRAMEBUFFER,src);glBindFramebuffer(GL_DRAW_FRAMEBUFFER,dst);}
static void blit(GLbitfield mask){glBlitFramebuffer(0,0,4,4,0,0,8,8,mask,GL_NEAREST);}
int main(void){
 WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="BlitContract";RegisterClassA(&c);
 HWND win=CreateWindowExA(0,c.lpszClassName,"GL transfers",WS_VISIBLE|WS_POPUP,0,0,320,200,0,0,0,0);HDC dc=GetDC(win);
 PIXELFORMATDESCRIPTOR pfd={0};pfd.nSize=sizeof pfd;pfd.nVersion=1;pfd.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;pfd.cColorBits=32;
 SetPixelFormat(dc,ChoosePixelFormat(dc,&pfd),&pfd);HGLRC rc=wglCreateContext(dc);if(!rc){OutputDebugStringA("x64-gl-blit unavailable");for(;;)Sleep(16);}wglMakeCurrent(dc,rc);
#define X(t,n) n=(t)wglGetProcAddress(#n);
 FUNCTIONS
#undef X
 unsigned char data[64];unsigned ds[16];
 for(unsigned y=0;y<4;y++)for(unsigned x=0;x<4;x++){unsigned i=y*4+x;data[i*4]=(x<2)==(y<2)?255:0;data[i*4+1]=x>=2?255:0;data[i*4+2]=y>=2?255:0;data[i*4+3]=255;ds[i]=0xe00000a5;}
 GLuint color=image(GL_RGBA8,4,GL_RGBA,GL_UNSIGNED_BYTE,data),depth=image(GL_DEPTH24_STENCIL8,4,GL_DEPTH_STENCIL,GL_UNSIGNED_INT_24_8,ds),src=framebuffer(color,depth);
 /* These rendered values deliberately differ from the upload shadow. Both stencil bit polarities and all eight bits matter. */
 glClearDepth(.25);glClearStencil(0x96);glClear(GL_DEPTH_BUFFER_BIT|GL_STENCIL_BUFFER_BIT);
 glEnable(GL_SCISSOR_TEST);glScissor(2,0,2,2);const GLint altered=0x69;glClearBufferiv(GL_STENCIL,0,&altered);glDisable(GL_SCISSOR_TEST);error(GL_NO_ERROR,"rendered source stencil clear");
 GLuint dstColor=image(GL_RGBA8,8,GL_RGBA,GL_UNSIGNED_BYTE,0),dstDepth=image(GL_DEPTH24_STENCIL8,8,GL_DEPTH_STENCIL,GL_UNSIGNED_INT_24_8,0),dst=framebuffer(dstColor,dstDepth);
 clear();glClearDepth(.75);glClearStencil(0x5a);glClear(GL_DEPTH_BUFFER_BIT|GL_STENCIL_BUFFER_BIT);error(GL_NO_ERROR,"allocation");
 bind(src,dst);blit(GL_COLOR_BUFFER_BIT);error(GL_NO_ERROR,"scaled color");glBindFramebuffer(GL_READ_FRAMEBUFFER,dst);
 pixel(1,1,255,0,0,"scaled bottom left");pixel(6,1,0,255,0,"scaled bottom right");pixel(1,6,0,0,255,"scaled top left");pixel(6,6,255,255,255,"scaled top right");
 bind(src,dst);glBlitFramebuffer(4,0,0,4,0,0,8,8,GL_COLOR_BUFFER_BIT,GL_NEAREST);glBindFramebuffer(GL_READ_FRAMEBUFFER,dst);pixel(1,1,0,255,0,"source flipped");
 bind(src,dst);glBlitFramebuffer(0,0,4,4,0,8,8,0,GL_COLOR_BUFFER_BIT,GL_NEAREST);glBindFramebuffer(GL_READ_FRAMEBUFFER,dst);pixel(1,1,0,0,255,"destination flipped");
 // LINEAR and scissor must not inherit write masks, blending or viewport.
 glBindFramebuffer(GL_FRAMEBUFFER,dst);clear();glEnable(GL_SCISSOR_TEST);glScissor(2,2,4,4);glColorMask(0,0,0,0);glDepthMask(0);glStencilMask(0);
 bind(src,dst);glBlitFramebuffer(0,0,4,4,0,0,8,8,GL_COLOR_BUFFER_BIT,GL_LINEAR);glBindFramebuffer(GL_READ_FRAMEBUFFER,dst);
 pixel(0,0,0,0,0,"scissor untouched");pixel(2,2,255,0,0,"linear interior ignores masks");pixel(3,3,159,64,64,"linear interpolated");
 glDisable(GL_SCISSOR_TEST);glColorMask(1,1,1,1);glDepthMask(1);glStencilMask(255);
 bind(src,dst);glBlitFramebuffer(-4,0,4,4,0,0,8,8,GL_COLOR_BUFFER_BIT,GL_NEAREST);glBindFramebuffer(GL_READ_FRAMEBUFFER,dst);pixel(4,0,255,0,0,"source clipped mapping");
 bind(src,dst);glBlitFramebuffer(0,0,4,4,0,0,8,8,GL_COLOR_BUFFER_BIT,GL_NEAREST);glBlitFramebuffer(0,0,4,4,0,0,8,8,GL_COLOR_BUFFER_BIT,GL_NEAREST);
 glBindFramebuffer(GL_READ_FRAMEBUFFER,dst);pixel(6,6,255,255,255,"ordered repeat");
 GLuint prog=glCreateProgram();glAttachShader(prog,shader(GL_VERTEX_SHADER,"#version 330 core\nvoid main(){vec2 a=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(a*2.0-1.0,0.0,1.0);}"));
 glAttachShader(prog,shader(GL_FRAGMENT_SHADER,"#version 330 core\nlayout(location=0)out vec4 c;void main(){c=vec4(1.0);}"));glLinkProgram(prog);GLint linked=0;glGetProgramiv(prog,GL_LINK_STATUS,&linked);note("program linked",linked);
 GLuint vao;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glUseProgram(prog);glViewport(0,0,8,8);
 // Probe the scissored source before the transfer, so a source-generation error cannot be misattributed to blit.
 glBindFramebuffer(GL_FRAMEBUFFER,src);glViewport(0,0,4,4);glEnable(GL_STENCIL_TEST);glStencilFunc(GL_EQUAL,0x69,255);glStencilOp(GL_KEEP,GL_KEEP,GL_KEEP);
 glDrawArrays(GL_TRIANGLES,0,3);pixel(3,1,255,255,255,"source stencil region before blit");glDisable(GL_STENCIL_TEST);glViewport(0,0,8,8);
 glBindTexture(GL_TEXTURE_2D,color);glTexSubImage2D(GL_TEXTURE_2D,0,0,0,4,4,GL_RGBA,GL_UNSIGNED_BYTE,data);
 // Scissor clips destination stencil writes; it does not alter the affine source mapping.
 bind(src,dst);glEnable(GL_SCISSOR_TEST);glScissor(2,2,4,4);blit(GL_STENCIL_BUFFER_BIT);glDisable(GL_SCISSOR_TEST);
 glBindFramebuffer(GL_FRAMEBUFFER,dst);clear();glEnable(GL_STENCIL_TEST);glStencilFunc(GL_EQUAL,0x5a,255);glDrawArrays(GL_TRIANGLES,0,3);
 pixel(0,0,255,255,255,"stencil scissor preserves outside");pixel(3,3,0,0,0,"stencil scissor updates inside");glDisable(GL_STENCIL_TEST);
 // Stencil-only copy, then a draw probes both transferred stencil and preserved destination depth.
 bind(src,dst);glDepthMask(0);glStencilMask(0);blit(GL_STENCIL_BUFFER_BIT);error(GL_NO_ERROR,"scaled stencil");glDepthMask(1);glStencilMask(255);
 glBlitFramebuffer(0,0,0,4,0,0,8,8,GL_STENCIL_BUFFER_BIT,GL_NEAREST);glBlitFramebuffer(0,0,4,4,0,0,0,8,GL_STENCIL_BUFFER_BIT,GL_NEAREST);
 glEnable(GL_SCISSOR_TEST);glScissor(0,0,0,0);glBlitFramebuffer(0,0,4,4,0,0,8,8,GL_STENCIL_BUFFER_BIT,GL_NEAREST);glDisable(GL_SCISSOR_TEST);
 error(GL_NO_ERROR,"empty rectangle and scissor no-op");
 glBindFramebuffer(GL_FRAMEBUFFER,dst);clear();glEnable(GL_DEPTH_TEST);glDepthFunc(GL_LESS);glDrawArrays(GL_TRIANGLES,0,3);pixel(3,3,255,255,255,"stencil blit preserves depth");glDisable(GL_DEPTH_TEST);clear();
 glEnable(GL_STENCIL_TEST);glStencilFunc(GL_EQUAL,0x96,255);glStencilOp(GL_KEEP,GL_KEEP,GL_KEEP);glDrawArrays(GL_TRIANGLES,0,3);pixel(3,3,255,255,255,"stencil transferred bits");pixel(6,1,0,0,0,"stencil distinct region rejected");
 glStencilFunc(GL_EQUAL,0x69,255);glDrawArrays(GL_TRIANGLES,0,3);pixel(6,1,255,255,255,"stencil rendered region transferred");
 glStencilFunc(GL_EQUAL,0x96,255);glDisable(GL_STENCIL_TEST);
 // Depth-only copy preserves the stencil value; rendering observes real depth, not the original .875 upload.
 bind(src,dst);blit(GL_DEPTH_BUFFER_BIT);error(GL_NO_ERROR,"scaled depth");glBindFramebuffer(GL_FRAMEBUFFER,dst);clear();glEnable(GL_DEPTH_TEST);glDrawArrays(GL_TRIANGLES,0,3);pixel(3,3,0,0,0,"depth transferred");glDisable(GL_DEPTH_TEST);
 glEnable(GL_STENCIL_TEST);glDrawArrays(GL_TRIANGLES,0,3);pixel(3,3,255,255,255,"depth blit preserves stencil");glDisable(GL_STENCIL_TEST);
 bind(src,dst);blit(GL_DEPTH_BUFFER_BIT|GL_STENCIL_BUFFER_BIT);error(GL_NO_ERROR,"combined depth stencil");
 glBlitFramebuffer(0,0,4,4,0,0,8,8,GL_DEPTH_BUFFER_BIT,GL_LINEAR);error(GL_INVALID_OPERATION,"depth linear rejected");
 glBlitFramebuffer(0,0,4,4,0,0,8,8,GL_COLOR_BUFFER_BIT,0);error(GL_INVALID_ENUM,"bad filter");
 glBlitFramebuffer(0,0,4,4,0,0,8,8,1,GL_NEAREST);error(GL_INVALID_VALUE,"bad mask");
 GLuint empty;glGenFramebuffers(1,&empty);bind(empty,dst);blit(GL_COLOR_BUFFER_BIT);error(GL_INVALID_FRAMEBUFFER_OPERATION,"incomplete source");
 // Disabled read color is a no-op, not an invalid command or a black fill.
 bind(src,dst);glReadBuffer(GL_NONE);blit(GL_COLOR_BUFFER_BIT);error(GL_NO_ERROR,"NONE read no-op");glReadBuffer(GL_COLOR_ATTACHMENT0);
 // Exact 1:1 copy and same-image nonoverlapping transfers observe previously copied pixels.
 GLuint tiny=framebuffer(image(GL_RGBA8,4,GL_RGBA,GL_UNSIGNED_BYTE,0),0);bind(src,tiny);
 glBlitFramebuffer(0,0,4,4,0,0,4,4,GL_COLOR_BUFFER_BIT,GL_NEAREST);glBindFramebuffer(GL_READ_FRAMEBUFFER,tiny);pixel(0,0,255,0,0,"one to one copy");
 bind(tiny,tiny);glBlitFramebuffer(0,0,2,2,2,2,4,4,GL_COLOR_BUFFER_BIT,GL_NEAREST);pixel(3,3,255,0,0,"same image snapshot");error(GL_NO_ERROR,"same image error");
 GLuint integer=framebuffer(image(GL_R32UI,4,GL_RED_INTEGER,GL_UNSIGNED_INT,0),0);bind(integer,dst);blit(GL_COLOR_BUFFER_BIT);error(GL_INVALID_OPERATION,"integer color class rejected");
 // Default framebuffer participates in both directions, including stencil/depth attachment lowering.
 bind(src,0);glBlitFramebuffer(0,0,4,4,0,0,320,200,GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT|GL_STENCIL_BUFFER_BIT,GL_NEAREST);error(GL_NO_ERROR,"default destination");
 bind(0,dst);glBlitFramebuffer(0,0,320,200,0,0,8,8,GL_COLOR_BUFFER_BIT,GL_NEAREST);error(GL_NO_ERROR,"default source");glBindFramebuffer(GL_READ_FRAMEBUFFER,dst);pixel(1,1,255,0,0,"default round trip");
 char summary[128];snprintf(summary,sizeof summary,"x64-gl-blit PASS failures=%u checks=%u",failures,checks);OutputDebugStringA(summary);
 for(;;){bind(src,0);glBlitFramebuffer(0,0,4,4,0,0,320,200,GL_COLOR_BUFFER_BIT,GL_NEAREST);SwapBuffers(dc);}
}
