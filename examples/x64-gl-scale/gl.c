/* Original CC0-1.0. Q67: 12,000 buffers/VAOs, churn, native draws and byte-budget OOM.
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
 X(PFNGLISBUFFERPROC, glIsBuffer) \
 X(PFNGLDELETEVERTEXARRAYSPROC, glDeleteVertexArrays) \
 X(PFNGLMAPBUFFERRANGEPROC, glMapBufferRange) \
 X(PFNGLUNMAPBUFFERPROC, glUnmapBuffer) \
 X(PFNGLBUFFERSUBDATAPROC, glBufferSubData) \
 X(PFNGLBINDBUFFERRANGEPROC, glBindBufferRange) \
 X(PFNGLTRANSFORMFEEDBACKVARYINGSPROC, glTransformFeedbackVaryings) \
 X(PFNGLBEGINTRANSFORMFEEDBACKPROC, glBeginTransformFeedback) \
 X(PFNGLENDTRANSFORMFEEDBACKPROC, glEndTransformFeedback) \
 X(PFNGLGETBUFFERSUBDATAPROC, glGetBufferSubData) \
 X(PFNGLENABLEPROC, glEnable) \
 X(PFNGLDISABLEPROC, glDisable)
#define X(t,n) static t n;
GLFUNCS
#undef X
static unsigned failures;
static void note(const char *label, int ok) {
    char b[160]; snprintf(b,sizeof b,"x64-gl-scale %s %s",ok?"ok":"FAIL",label);
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
static const float quad[]={-1,-1,1,-1,-1,1,1,1};

#define COUNT 12000u
static GLuint buf[COUNT], vao[COUNT];
static void setup(unsigned i) {
    glBindVertexArray(vao[i]); glBindBuffer(GL_ARRAY_BUFFER,buf[i]);
    glBufferData(GL_ARRAY_BUFFER,sizeof quad,quad,GL_STATIC_DRAW);
    glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);
}
int main(void) {
    WNDCLASSA c={0};c.lpfnWndProc=DefWindowProcA;c.lpszClassName="ScaleCC0";RegisterClassA(&c);
    HWND win=CreateWindowExA(0,c.lpszClassName,"GL buffer/VAO scale",WS_VISIBLE|WS_POPUP,0,0,320,200,0,0,0,0);
    HDC dc=GetDC(win);PIXELFORMATDESCRIPTOR d={0};d.nSize=sizeof d;d.nVersion=1;d.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;d.cColorBits=32;
    SetPixelFormat(dc,ChoosePixelFormat(dc,&d),&d);HGLRC ctx=wglCreateContext(dc);wglMakeCurrent(dc,ctx);
#define X(t,n) n=(t)wglGetProcAddress(#n);
    GLFUNCS
#undef X
    GLuint vs=shader(GL_VERTEX_SHADER,"#version 330 core\nlayout(location=0) in vec2 p;out vec2 value;void main(){value=p;gl_Position=vec4(p,0.0,1.0);}");
    GLuint fs=shader(GL_FRAGMENT_SHADER,"#version 330 core\nlayout(location=0) out vec4 c;uniform vec4 color;void main(){c=color;}");
    PFNGLUNIFORM4FPROC uniform4f=(PFNGLUNIFORM4FPROC)wglGetProcAddress("glUniform4f");
    GLuint prog=glCreateProgram();glAttachShader(prog,vs);glAttachShader(prog,fs);glLinkProgram(prog);GLint linked=0;glGetProgramiv(prog,GL_LINK_STATUS,&linked);note("link",linked);
    glUseProgram(prog);GLint color=glGetUniformLocation(prog,"color");
    glGenBuffers(COUNT,buf);glGenVertexArrays(COUNT,vao);error(GL_NO_ERROR,"12000 generated buffer/VAO pairs");
    /* Fail closed on the old profile instead of issuing thousands of irrelevant follow-on errors. */
    if(!buf[COUNT-1]||!vao[COUNT-1])goto done;
    for(unsigned i=0;i<COUNT;i++)setup(i);
    error(GL_NO_ERROR,"12000 distinct uploaded stores and VAO references");
    /* Link ordinary uniforms only AFTER every old pool handle is occupied. */
    GLuint after=glCreateProgram();glAttachShader(after,vs);glAttachShader(after,fs);
    const char *varying="value";glTransformFeedbackVaryings(after,1,&varying,GL_INTERLEAVED_ATTRIBS);glLinkProgram(after);
    glGetProgramiv(after,GL_LINK_STATUS,&linked);note("uniform program not starved by 12000 buffers",linked);
    glUseProgram(after);glDeleteProgram(prog);color=glGetUniformLocation(after,"color");
    glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);
    /* Every live VAO/buffer is actually fetched. Tiny draws avoid an overdraw benchmark. */
    uniform4f(color,1,0,0,1);glViewport(0,0,1,1);
    for(unsigned i=0;i<COUNT;i++){glBindVertexArray(vao[i]);glDrawArrays(GL_TRIANGLE_STRIP,0,4);}
    error(GL_NO_ERROR,"all 12000 native fetches");
    glBindVertexArray(vao[COUNT-1]);glViewport(0,0,160,200);glDrawArrays(GL_TRIANGLE_STRIP,0,4);pixel(80,255,0,0,"late red pixel");
    /* Delete a name while an unbound late VAO retains the old store. Reuse the name and
     * grow tables, then draw the retained generation. No slot or handle may alias it. */
    glBindVertexArray(vao[0]);GLuint old=buf[COUNT-1];glDeleteBuffers(1,&old);note("retired not a buffer name",!glIsBuffer(old));
    glGenBuffers(1,&buf[COUNT-1]);glBindBuffer(GL_ARRAY_BUFFER,buf[COUNT-1]);
    glBufferData(GL_ARRAY_BUFFER,sizeof quad,quad,GL_STATIC_DRAW);error(GL_NO_ERROR,"new store beside retained generation");
    glBindVertexArray(vao[COUNT-1]);uniform4f(color,0,1,0,1);glViewport(160,0,160,200);glDrawArrays(GL_TRIANGLE_STRIP,0,4);pixel(240,0,255,0,"retained late green pixel");
    /* Reattach releases the retired store; exercise orphan/map writes at a high slot. */
    glBindBuffer(GL_ARRAY_BUFFER,buf[COUNT-1]);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);
    glBufferData(GL_ARRAY_BUFFER,sizeof quad,0,GL_DYNAMIC_DRAW);
    float *mapped=(float *)glMapBufferRange(GL_ARRAY_BUFFER,0,sizeof quad,GL_MAP_WRITE_BIT|GL_MAP_INVALIDATE_BUFFER_BIT);
    note("late map",mapped!=0);if(mapped){for(unsigned i=0;i<8;i++)mapped[i]=quad[i];note("late unmap",glUnmapBuffer(GL_ARRAY_BUFFER));}
    uniform4f(color,0,0,1,1);glViewport(240,0,80,200);glDrawArrays(GL_TRIANGLE_STRIP,0,4);pixel(280,0,0,255,"mapped late blue pixel");error(GL_NO_ERROR,"late mapping errors");
    /* Feedback capture/readback and aligned uniform-block ranges use extended wire IDs too. */
    GLuint feedback;unsigned char sentinels[64],captured[64];for(unsigned i=0;i<64;i++)sentinels[i]=0x5a;
    glGenBuffers(1,&feedback);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,feedback);glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,64,sentinels,GL_DYNAMIC_DRAW);
    glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,feedback,16,sizeof quad);glEnable(GL_RASTERIZER_DISCARD);
    glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,4);glEndTransformFeedback();glDisable(GL_RASTERIZER_DISCARD);
    glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER,0,64,captured);int exact=1,neighbors=1;
    for(unsigned i=0;i<8;i++)if(((float *)(captured+16))[i]!=quad[i])exact=0;
    for(unsigned i=0;i<64;i++)if((i<16||i>=48)&&captured[i]!=0x5a)neighbors=0;
    note("high feedback exact bytes",exact);note("high feedback range sentinels",neighbors);glDeleteBuffers(1,&feedback);
    GLuint blockfs=shader(GL_FRAGMENT_SHADER,"#version 330 core\nlayout(std140) uniform Tint {vec4 shade;};layout(location=0) out vec4 c;void main(){c=shade;}");
    GLuint block=glCreateProgram();glAttachShader(block,vs);glAttachShader(block,blockfs);glLinkProgram(block);glGetProgramiv(block,GL_LINK_STATUS,&linked);note("late UBO program",linked);
    glBindBuffer(GL_ARRAY_BUFFER,buf[COUNT-1]);glBufferData(GL_ARRAY_BUFFER,512,0,GL_STATIC_DRAW);glBufferSubData(GL_ARRAY_BUFFER,0,sizeof quad,quad);
    float blue[]={0,0,1,1};glBufferSubData(GL_ARRAY_BUFFER,256,sizeof blue,blue);glBindBufferRange(GL_UNIFORM_BUFFER,0,buf[COUNT-1],256,16);
    glUseProgram(block);glDrawArrays(GL_TRIANGLE_STRIP,0,4);pixel(280,0,0,255,"late UBO blue pixel");glUseProgram(after);glDeleteProgram(block);glDeleteShader(blockfs);error(GL_NO_ERROR,"high feedback and UBO rules");
    for(unsigned cycle=0;cycle<3;cycle++) {
        glBindVertexArray(0);glDeleteVertexArrays(COUNT,vao);glDeleteBuffers(COUNT,buf);
        glGenBuffers(COUNT,buf);glGenVertexArrays(COUNT,vao);
        for(unsigned i=0;i<COUNT;i++)setup(i);
        glBindVertexArray(vao[COUNT-1]);uniform4f(color,0,0,1,1);glViewport(240,0,80,200);glDrawArrays(GL_TRIANGLE_STRIP,0,4);
        pixel(280,0,0,255,"churn late blue pixel");error(GL_NO_ERROR,"churn stores and references");
        /* Distinct frames keep load/churn work within existing per-frame transport budgets. */
        SwapBuffers(dc);Sleep(16);
    }
    /* Real byte budget, not a count ceiling: 16MiB configured, 12k stores remain live.
     * First 8MiB fits, second must fail before replacing any other object's store. */
    GLuint large[2];glGenBuffers(2,large);glBindBuffer(GL_ARRAY_BUFFER,large[0]);glBufferData(GL_ARRAY_BUFFER,8*1024*1024,0,GL_STATIC_DRAW);error(GL_NO_ERROR,"first budget allocation");
    glBindBuffer(GL_ARRAY_BUFFER,large[1]);glBufferData(GL_ARRAY_BUFFER,8*1024*1024,0,GL_STATIC_DRAW);error(GL_OUT_OF_MEMORY,"real GPU byte exhaustion");
    glDeleteBuffers(1,large);SwapBuffers(dc);Sleep(16);glBufferData(GL_ARRAY_BUFFER,8*1024*1024,0,GL_STATIC_DRAW);error(GL_NO_ERROR,"byte exhaustion recovery");glDeleteBuffers(1,large+1);
    glBindVertexArray(vao[COUNT-1]);glDrawArrays(GL_TRIANGLE_STRIP,0,4);pixel(280,0,0,255,"post exhaustion blue pixel");
done:;
    char text[96];snprintf(text,sizeof text,"x64-gl-scale %s failures=%u",failures?"FAIL":"PASS",failures);OutputDebugStringA(text);
    for(;;){SwapBuffers(dc);Sleep(16);}
}
