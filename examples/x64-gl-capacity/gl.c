/* Original CC0-1.0. Q62: full GLuint names, >255 simultaneous objects and real limit errors.
 * Normal Win64 PE/CRT pipeline; no BGT imports, overrides, captured bytes or engine logic. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#define GLFUNCS \
 X(PFNGLATTACHSHADERPROC, glAttachShader) \
 X(PFNGLBINDBUFFERPROC, glBindBuffer) \
 X(PFNGLBINDBUFFERBASEPROC, glBindBufferBase) \
 X(PFNGLBINDTEXTUREPROC, glBindTexture) \
 X(PFNGLBINDVERTEXARRAYPROC, glBindVertexArray) \
 X(PFNGLBUFFERDATAPROC, glBufferData) \
 X(PFNGLCLEARPROC, glClear) \
 X(PFNGLCLEARCOLORPROC, glClearColor) \
 X(PFNGLCOMPILESHADERPROC, glCompileShader) \
 X(PFNGLCREATEPROGRAMPROC, glCreateProgram) \
 X(PFNGLCREATESHADERPROC, glCreateShader) \
 X(PFNGLDELETEBUFFERSPROC, glDeleteBuffers) \
 X(PFNGLDELETETEXTURESPROC, glDeleteTextures) \
 X(PFNGLDELETESHADERPROC, glDeleteShader) \
 X(PFNGLDELETEPROGRAMPROC, glDeleteProgram) \
 X(PFNGLDRAWARRAYSPROC, glDrawArrays) \
 X(PFNGLENABLEVERTEXATTRIBARRAYPROC, glEnableVertexAttribArray) \
 X(PFNGLGENBUFFERSPROC, glGenBuffers) \
 X(PFNGLGENTEXTURESPROC, glGenTextures) \
 X(PFNGLGENVERTEXARRAYSPROC, glGenVertexArrays) \
 X(PFNGLGETERRORPROC, glGetError) \
 X(PFNGLGETINTEGERVPROC, glGetIntegerv) \
 X(PFNGLGETPROGRAMIVPROC, glGetProgramiv) \
 X(PFNGLGETSHADERIVPROC, glGetShaderiv) \
 X(PFNGLGETUNIFORMLOCATIONPROC, glGetUniformLocation) \
 X(PFNGLLINKPROGRAMPROC, glLinkProgram) \
 X(PFNGLREADPIXELSPROC, glReadPixels) \
 X(PFNGLSHADERSOURCEPROC, glShaderSource) \
 X(PFNGLTEXIMAGE2DPROC, glTexImage2D) \
 X(PFNGLTEXPARAMETERIPROC, glTexParameteri) \
 X(PFNGLTEXSUBIMAGE2DPROC, glTexSubImage2D) \
 X(PFNGLGENERATEMIPMAPPROC, glGenerateMipmap) \
 X(PFNGLUNIFORM1IPROC, glUniform1i) \
 X(PFNGLUSEPROGRAMPROC, glUseProgram) \
 X(PFNGLVERTEXATTRIBPOINTERPROC, glVertexAttribPointer) \
 X(PFNGLVIEWPORTPROC, glViewport) \
 X(PFNGLGENSAMPLERSPROC, glGenSamplers) \
 X(PFNGLBINDSAMPLERPROC, glBindSampler) \
 X(PFNGLSAMPLERPARAMETERIPROC, glSamplerParameteri) \
 X(PFNGLDELETESAMPLERSPROC, glDeleteSamplers) \
 X(PFNGLGENFRAMEBUFFERSPROC, glGenFramebuffers) \
 X(PFNGLBINDFRAMEBUFFERPROC, glBindFramebuffer) \
 X(PFNGLFRAMEBUFFERTEXTURE2DPROC, glFramebufferTexture2D) \
 X(PFNGLCHECKFRAMEBUFFERSTATUSPROC, glCheckFramebufferStatus) \
 X(PFNGLGETFRAMEBUFFERATTACHMENTPARAMETERIVPROC, glGetFramebufferAttachmentParameteriv) \
 X(PFNGLDELETEFRAMEBUFFERSPROC, glDeleteFramebuffers) \
 X(PFNGLGENRENDERBUFFERSPROC, glGenRenderbuffers) \
 X(PFNGLBINDRENDERBUFFERPROC, glBindRenderbuffer) \
 X(PFNGLRENDERBUFFERSTORAGEPROC, glRenderbufferStorage) \
 X(PFNGLFRAMEBUFFERRENDERBUFFERPROC, glFramebufferRenderbuffer) \
 X(PFNGLDELETERENDERBUFFERSPROC, glDeleteRenderbuffers) \
 X(PFNGLGENQUERIESPROC, glGenQueries) \
 X(PFNGLBEGINQUERYPROC, glBeginQuery) \
 X(PFNGLENDQUERYPROC, glEndQuery) \
 X(PFNGLGETQUERYOBJECTUIVPROC, glGetQueryObjectuiv) \
 X(PFNGLDELETEQUERIESPROC, glDeleteQueries) \
 X(PFNGLISTEXTUREPROC, glIsTexture) \
 X(PFNGLISBUFFERPROC, glIsBuffer)
#define X(t,n) static t n;
GLFUNCS
#undef X
static unsigned failures;
static void note(const char *label, int ok) {
    char b[160]; snprintf(b,sizeof b,"x64-gl-capacity %s %s",ok?"ok":"FAIL",label);
    OutputDebugStringA(b); if(!ok)failures++;
}
static void error(GLenum want,const char *label) { GLenum e=glGetError();note(label,e==want&&glGetError()==GL_NO_ERROR); }
static GLuint shader(GLenum type,const char *source) {
    GLuint s=glCreateShader(type);GLint ok=0;glShaderSource(s,1,&source,0);glCompileShader(s);glGetShaderiv(s,GL_COMPILE_STATUS,&ok);
    note("compile",ok);return s;
}
static void pixel(unsigned x,unsigned r,unsigned g,unsigned b,const char *label) {
    unsigned char px[4]={0};glReadPixels(x,100,1,1,GL_RGBA,GL_UNSIGNED_BYTE,px);
    note(label,px[0]==r&&px[1]==g&&px[2]==b&&px[3]==255);
}
static void image(unsigned r,unsigned g,unsigned b) {
    unsigned char px[4]={(unsigned char)r,(unsigned char)g,(unsigned char)b,255};
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,1,1,0,GL_RGBA,GL_UNSIGNED_BYTE,px);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
}
static const float quad[]={-1,-1,1,-1,-1,1,1,1};
int main(void) {
    WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="CapacityCC0";RegisterClassA(&c);
    HWND win=CreateWindowExA(0,c.lpszClassName,"GL name capacity",WS_VISIBLE|WS_POPUP,0,0,320,200,0,0,0,0);
    HDC dc=GetDC(win);PIXELFORMATDESCRIPTOR d={0};d.nSize=sizeof d;d.nVersion=1;d.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;d.cColorBits=32;
    SetPixelFormat(dc,ChoosePixelFormat(dc,&d),&d);HGLRC ctx=wglCreateContext(dc);wglMakeCurrent(dc,ctx);
#define X(t,n) n=(t)wglGetProcAddress(#n);
    GLFUNCS
#undef X
    GLuint vs=shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=0) in vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}");
    GLuint fs=shader(GL_FRAGMENT_SHADER,"#version 330 core\nlayout(location=0) out vec4 c;uniform sampler2D img;void main(){c=texelFetch(img,ivec2(0),0);}");
    GLuint prog=glCreateProgram();glAttachShader(prog,vs);glAttachShader(prog,fs);glLinkProgram(prog);GLint linked=0;glGetProgramiv(prog,GL_LINK_STATUS,&linked);note("link",linked);
    glUseProgram(prog);glUniform1i(glGetUniformLocation(prog,"img"),0);
    /* Arbitrary high names must not be array indices, and must not consume the driver's generated name1. */
    const GLuint high=0xf1234567u;GLint name=0;
    glBindTexture(GL_TEXTURE_2D,high);image(255,0,0);glGetIntegerv(GL_TEXTURE_BINDING_2D,&name);note("full GLuint texture binding",(GLuint)name==high&&glIsTexture(high));
    glBindBuffer(GL_ARRAY_BUFFER,high);glBufferData(GL_ARRAY_BUFFER,sizeof quad,quad,GL_STATIC_DRAW);glGetIntegerv(GL_ARRAY_BUFFER_BINDING,&name);note("full GLuint buffer binding",(GLuint)name==high&&glIsBuffer(high));
    static GLuint tex[1023],buf[1023],vao[600],samp[600],fbo[600],rbo[600],query[600],sh[600],pr[600];
    glGenTextures(600,tex);glGenBuffers(600,buf);glGenVertexArrays(600,vao);glGenSamplers(600,samp);glGenFramebuffers(600,fbo);glGenRenderbuffers(600,rbo);glGenQueries(600,query);
    int unique=1;for(unsigned i=0;i<600;i++) {
        if(!tex[i]||!buf[i]||!vao[i]||!samp[i]||!fbo[i]||!rbo[i]||!query[i]||tex[i]==high||buf[i]==high)unique=0;
        for(unsigned j=0;j<i;j++)if(tex[i]==tex[j]||buf[i]==buf[j]||vao[i]==vao[j]||samp[i]==samp[j]||fbo[i]==fbo[j]||rbo[i]==rbo[j]||query[i]==query[j])unique=0;
        glBindTexture(GL_TEXTURE_2D,tex[i]);image(0,255,0);
        glBindBuffer(GL_ARRAY_BUFFER,buf[i]);glBufferData(GL_ARRAY_BUFFER,sizeof quad,quad,GL_STATIC_DRAW);
        sh[i]=glCreateShader(GL_VERTEX_SHADER);pr[i]=glCreateProgram();if(!sh[i]||!pr[i]||sh[i]==pr[i])unique=0;
    }
    note("600 distinct live names in all nine namespaces",unique);error(GL_NO_ERROR,"600 objects setup");
    for(unsigned i=0;i<600;i++){glDeleteShader(sh[i]);glDeleteProgram(pr[i]);}
    glBindVertexArray(vao[599]);glBindBuffer(GL_ARRAY_BUFFER,buf[599]);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);
    glSamplerParameteri(samp[599],GL_TEXTURE_MIN_FILTER,GL_NEAREST);glSamplerParameteri(samp[599],GL_TEXTURE_MAG_FILTER,GL_NEAREST);glBindSampler(0,samp[599]);
    glBindFramebuffer(GL_FRAMEBUFFER,fbo[599]);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex[599],0);
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,&name);
    note("late FBO attachment name",(GLuint)name==tex[599]&&glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE);
    glBindRenderbuffer(GL_RENDERBUFFER,rbo[599]);glRenderbufferStorage(GL_RENDERBUFFER,GL_RGBA8,1,1);error(GL_NO_ERROR,"late renderbuffer storage");
    glBindFramebuffer(GL_FRAMEBUFFER,0);glBindTexture(GL_TEXTURE_2D,tex[599]);glViewport(0,0,160,200);glDrawArrays(GL_TRIANGLE_STRIP,0,4);pixel(80,0,255,0,"late texture and buffer pixel");
    glBeginQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN,query[599]);glEndQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN);GLuint result=99;glGetQueryObjectuiv(query[599],GL_QUERY_RESULT,&result);note("late query result",result==0);
    /* Deleted objects retained by UNBOUND containers must not alias a regenerated name. */
    GLuint old=tex[599];glDeleteTextures(1,&old);note("deleted texture not a name",!glIsTexture(old));
    glBindTexture(GL_TEXTURE_2D,old);image(0,0,255);
    glBindFramebuffer(GL_FRAMEBUFFER,fbo[599]);note("unbound FBO keeps deleted generation",glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE);
    glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,(unsigned char[4]){0});
    unsigned char saved[4]={0};glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,saved);note("retained FBO is green",saved[0]==0&&saved[1]==255&&saved[2]==0&&saved[3]==255);
    glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,old,0);glBindFramebuffer(GL_FRAMEBUFFER,0);
    GLuint oldbuf=buf[599];glDeleteBuffers(1,&oldbuf);glGenBuffers(1,&buf[599]);glBindBuffer(GL_ARRAY_BUFFER,buf[599]);glBufferData(GL_ARRAY_BUFFER,sizeof quad,quad,GL_STATIC_DRAW);
    glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glBindTexture(GL_TEXTURE_2D,old);glViewport(160,0,160,200);glDrawArrays(GL_TRIANGLE_STRIP,0,4);pixel(240,0,0,255,"delete regen pixel");
    glBindTexture(GL_TEXTURE_2D,high);glViewport(0,0,80,200);glDrawArrays(GL_TRIANGLE_STRIP,0,4);pixel(40,255,0,0,"full GLuint pixel");error(GL_NO_ERROR,"late draws errors");
    /* Release extra storage so the exact shared-pool ceiling is tested, not the old255 limit. */
    glDeleteRenderbuffers(600,rbo);glDeleteFramebuffers(600,fbo);glDeleteTextures(1,&high);glDeleteBuffers(1,&high);
    glGenTextures(402,tex+600); // 1002 names: 1001 storage handles plus one failed upload.
    for(unsigned i=600;i<1001;i++){glBindTexture(GL_TEXTURE_2D,tex[i]);image(0,255,0);}
    error(GL_NO_ERROR,"1001 texture storage handles");glBindTexture(GL_TEXTURE_2D,tex[1001]);image(0,255,0);error(GL_OUT_OF_MEMORY,"real texture handle exhaustion");
    glGenTextures(21,tex+1002);GLuint sentinel=0xabcdef01u;glGenTextures(1,&sentinel);note("GenTextures OOM leaves output untouched",sentinel==0xabcdef01u);error(GL_OUT_OF_MEMORY,"real texture name exhaustion");
    glDeleteTextures(1,tex+1000);glBindTexture(GL_TEXTURE_2D,tex[1001]);image(0,255,0);error(GL_NO_ERROR,"texture handle reuse after exhaustion");
    glGenBuffers(415,buf+600);for(unsigned i=600;i<1014;i++){glBindBuffer(GL_ARRAY_BUFFER,buf[i]);glBufferData(GL_ARRAY_BUFFER,sizeof quad,quad,GL_STATIC_DRAW);}
    error(GL_NO_ERROR,"1014 public buffer handles plus uniform");glBindBuffer(GL_ARRAY_BUFFER,buf[1014]);glBufferData(GL_ARRAY_BUFFER,sizeof quad,quad,GL_STATIC_DRAW);error(GL_NO_ERROR,"buffer handles grow beyond legacy pool");
    glGenBuffers(8,buf+1015);sentinel=0xabcdef01u;glGenBuffers(1,&sentinel);note("GenBuffers grows beyond 1023",sentinel!=0xabcdef01u&&sentinel!=0);error(GL_NO_ERROR,"dynamic buffer names");
    glDeleteBuffers(1,buf+1013);glBindBuffer(GL_ARRAY_BUFFER,buf[1014]);glBufferData(GL_ARRAY_BUFFER,sizeof quad,quad,GL_STATIC_DRAW);error(GL_NO_ERROR,"buffer handle reuse after exhaustion");
    char done[96];snprintf(done,sizeof done,"x64-gl-capacity %s failures=%u",failures?"FAIL":"PASS",failures);OutputDebugStringA(done);
    for(;;){SwapBuffers(dc);Sleep(16);}
}
