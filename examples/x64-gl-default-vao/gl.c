/* Original CC0-1.0. Q57: WGL 3.3 core, element buffer uploaded while VAO 0 is bound,
 * then five real VAOs consume exactly those bytes in indexed draws. No BGT imports/overrides. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#include <string.h>
#define GLFUNCS  X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLBINDBUFFERPROC,glBindBuffer)  X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLBUFFERDATAPROC,glBufferData)  X(PFNGLBUFFERSUBDATAPROC,glBufferSubData) X(PFNGLCOMPILESHADERPROC,glCompileShader)  X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLCREATEPROGRAMPROC,glCreateProgram)  X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays)  X(PFNGLGETBUFFERPARAMETERIVPROC,glGetBufferParameteriv) X(PFNGLGETBUFFERSUBDATAPROC,glGetBufferSubData)  X(PFNGLGETBUFFERPOINTERVPROC,glGetBufferPointerv) X(PFNGLGETINTEGERVPROC,glGetIntegerv)  X(PFNGLGETERRORPROC,glGetError) X(PFNGLGETSHADERIVPROC,glGetShaderiv) X(PFNGLGETPROGRAMIVPROC,glGetProgramiv)  X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLUSEPROGRAMPROC,glUseProgram)  X(PFNGLMAPBUFFERPROC,glMapBuffer) X(PFNGLMAPBUFFERRANGEPROC,glMapBufferRange)  X(PFNGLUNMAPBUFFERPROC,glUnmapBuffer) X(PFNGLFLUSHMAPPEDBUFFERRANGEPROC,glFlushMappedBufferRange)  X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray)  X(PFNGLDISABLEVERTEXATTRIBARRAYPROC,glDisableVertexAttribArray) X(PFNGLVERTEXATTRIBDIVISORPROC,glVertexAttribDivisor)  X(PFNGLDRAWELEMENTSPROC,glDrawElements) X(PFNGLDRAWARRAYSPROC,glDrawArrays)  X(PFNGLCLEARPROC,glClear) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLVIEWPORTPROC,glViewport)  X(PFNGLREADPIXELSPROC,glReadPixels) X(PFNGLUNIFORM4FPROC,glUniform4f) X(PFNGLGETUNIFORMLOCATIONPROC,glGetUniformLocation)  X(PFNGLBINDBUFFERBASEPROC,glBindBufferBase) X(PFNGLTRANSFORMFEEDBACKVARYINGSPROC,glTransformFeedbackVaryings)  X(PFNGLBEGINTRANSFORMFEEDBACKPROC,glBeginTransformFeedback) X(PFNGLENDTRANSFORMFEEDBACKPROC,glEndTransformFeedback)  X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable)
#define X(t,n) static t n;
GLFUNCS
#undef X
typedef HGLRC (WINAPI *CreateCore)(HDC,HGLRC,const int *);
static unsigned failures;
static void note(const char *label,int ok) {
    char b[180];snprintf(b,sizeof b,"x64-gl-default-vao %s %s",ok?"ok":"FAIL",label);
    OutputDebugStringA(b);if(!ok)failures++;
}
static void error(GLenum expected,const char *label) { GLenum got=glGetError();note(label,got==expected&&glGetError()==GL_NO_ERROR); }
static GLuint shader(GLenum stage,const char *src) {
    GLuint s=glCreateShader(stage);GLint ok=0;glShaderSource(s,1,&src,0);glCompileShader(s);glGetShaderiv(s,GL_COMPILE_STATUS,&ok);
    if(!ok){OutputDebugStringA("x64-gl-default-vao FAIL shader");ExitProcess(10);}return s;
}
static GLuint link(const char *vs,const char *fs,const char *varying) {
    GLuint p=glCreateProgram();glAttachShader(p,shader(GL_VERTEX_SHADER,vs));
    if(fs)glAttachShader(p,shader(GL_FRAGMENT_SHADER,fs));
    if(varying)glTransformFeedbackVaryings(p,1,&varying,GL_INTERLEAVED_ATTRIBS);
    glLinkProgram(p);GLint ok=0;glGetProgramiv(p,GL_LINK_STATUS,&ok);
    if(!ok){OutputDebugStringA("x64-gl-default-vao FAIL link");ExitProcess(11);}return p;
}
static void generated_mapping(GLuint real) {
    GLuint b;glGenBuffers(1,&b);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,b);
    glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,32,0,GL_STATIC_DRAW);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,b);
    GLuint p=link("#version 330 core\nflat out uint result;void main(){result=0x11223300u+uint(gl_VertexID);gl_Position=vec4(0.0);}",0,"result");
    glUseProgram(p);glBindVertexArray(real);glEnable(GL_RASTERIZER_DISCARD);
    glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,8);glEndTransformFeedback();glDisable(GL_RASTERIZER_DISCARD);
    error(GL_NO_ERROR,"native feedback generation");
    unsigned *r=glMapBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,GL_READ_ONLY);
    int ok=r!=0;for(unsigned i=0;r&&i<8;i++)if(r[i]!=0x11223300u+i)ok=0;
    note("mapped generated native words",ok);if(r)note("unmap native read",glUnmapBuffer(GL_TRANSFORM_FEEDBACK_BUFFER)==GL_TRUE);
    unsigned char *w=glMapBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,1,3,GL_MAP_WRITE_BIT|GL_MAP_FLUSH_EXPLICIT_BIT);
    note("map generated odd range",w!=0);if(w){w[0]=0xaa;w[1]=0xbb;glFlushMappedBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,1);w[0]=0xcc;
        note("unmap native explicit",glUnmapBuffer(GL_TRANSFORM_FEEDBACK_BUFFER)==GL_TRUE);}
    unsigned back[8]={0};glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER,0,sizeof back,back);
    ok=back[0]==0x1122aa00u;for(unsigned i=1;i<8;i++)if(back[i]!=0x11223300u+i)ok=0;
    note("odd flush preserves native neighbours and unflushed bytes",ok);error(GL_NO_ERROR,"native mapping errors");
}
int main(void) {
    WNDCLASSA cls={0};cls.lpfnWndProc=DefWindowProcA;cls.lpszClassName="DefaultVaoCC0";RegisterClassA(&cls);
    HWND win=CreateWindowExA(0,cls.lpszClassName,"Core default VAO",WS_VISIBLE|WS_POPUP,0,0,320,200,0,0,0,0);
    HDC dc=GetDC(win);PIXELFORMATDESCRIPTOR d={0};d.nSize=sizeof d;d.nVersion=1;
    d.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;d.cColorBits=32;
    SetPixelFormat(dc,ChoosePixelFormat(dc,&d),&d);HGLRC legacy=wglCreateContext(dc);wglMakeCurrent(dc,legacy);
    CreateCore create=(CreateCore)wglGetProcAddress("wglCreateContextAttribsARB");
    const int attrs[]={0x2091,3,0x2092,3,0x9126,1,0x2094,2,0};
    HGLRC core=create(dc,0,attrs);note("WGL 3.3 core flags2 context",core!=0);wglMakeCurrent(dc,core);
#define X(t,n) n=(t)wglGetProcAddress(#n);
    GLFUNCS
#undef X
    GLint profile=0;glGetIntegerv(GL_CONTEXT_PROFILE_MASK,&profile);note("core profile query",profile==GL_CONTEXT_CORE_PROFILE_BIT);
    GLuint buffers[10],vaos[18];glGenBuffers(10,buffers);glGenVertexArrays(18,vaos);
    glBindVertexArray(0);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,buffers[6]);glBufferData(GL_ELEMENT_ARRAY_BUFFER,131072,0,GL_DYNAMIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,0);
    glBindBuffer(GL_UNIFORM_BUFFER,buffers[7]);glBufferData(GL_UNIFORM_BUFFER,80,0,GL_DYNAMIC_DRAW);glBindBuffer(GL_UNIFORM_BUFFER,0);
    glBindBuffer(GL_ARRAY_BUFFER,buffers[8]);glBufferData(GL_ARRAY_BUFFER,262144,0,GL_DYNAMIC_DRAW);glBindBuffer(GL_ARRAY_BUFFER,0);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,buffers[9]);
    static unsigned short indices[24576];for(unsigned i=0;i<24576;i++)indices[i]=99;
    const unsigned short quad[]={0,1,2,2,1,3};memcpy(indices,quad,sizeof quad);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof indices,indices,GL_STATIC_DRAW);
    GLint size=0;glGetBufferParameteriv(GL_ELEMENT_ARRAY_BUFFER,GL_BUFFER_SIZE,&size);note("VAO0 upload size49152",size==49152);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,0);
    for(unsigned i=0;i<5;i++){
        glBindVertexArray(vaos[13+i]);glBindBuffer(GL_ARRAY_BUFFER,buffers[8]);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,buffers[9]);
        glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);glEnableVertexAttribArray(0);glBindVertexArray(0);
    }
    GLint element=-1;glGetIntegerv(GL_ELEMENT_ARRAY_BUFFER_BINDING,&element);note("named VAOs do not leak default element state",element==0);
    /* Supplemental upload coverage, not observed in the supplied Q57 call trace. */
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,buffers[9]);
    glBufferSubData(GL_ELEMENT_ARRAY_BUFFER,12,sizeof quad,quad);
    unsigned short *all=glMapBuffer(GL_ELEMENT_ARRAY_BUFFER,GL_READ_WRITE);note("VAO0 map whole",all!=0);
    if(all){memcpy(all+12,quad,sizeof quad);note("VAO0 unmap whole",glUnmapBuffer(GL_ELEMENT_ARRAY_BUFFER)==GL_TRUE);}
    void *part=glMapBufferRange(GL_ELEMENT_ARRAY_BUFFER,36,12,GL_MAP_WRITE_BIT|GL_MAP_FLUSH_EXPLICIT_BIT);
    note("VAO0 map explicit",part!=0);if(part){memcpy(part,quad,12);glFlushMappedBufferRange(GL_ELEMENT_ARRAY_BUFFER,0,12);
        memset(part,0,12);note("VAO0 unmap explicit",glUnmapBuffer(GL_ELEMENT_ARRAY_BUFFER)==GL_TRUE);}
    part=glMapBufferRange(GL_ELEMENT_ARRAY_BUFFER,48,12,GL_MAP_WRITE_BIT|GL_MAP_INVALIDATE_RANGE_BIT|GL_MAP_UNSYNCHRONIZED_BIT);
    note("VAO0 map invalidate",part!=0);if(part){memcpy(part,quad,12);note("VAO0 unmap invalidate",glUnmapBuffer(GL_ELEMENT_ARRAY_BUFFER)==GL_TRUE);}
    unsigned short back[30]={0};glGetBufferSubData(GL_ELEMENT_ARRAY_BUFFER,0,sizeof back,back);
    int ok=1;for(unsigned i=0;i<30;i++)if(back[i]!=quad[i%6])ok=0;note("all five index ranges retained",ok);
    error(GL_NO_ERROR,"VAO0 upload errors");
    /* Deliberately retain strict core attribute and draw policy until target evidence requires more. */
    glBindBuffer(GL_ARRAY_BUFFER,buffers[8]);const float xy[]={-1,-1,1,-1,-1,1,1,1};
    glBufferSubData(GL_ARRAY_BUFFER,0,sizeof xy,xy);
    glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,8,0);error(GL_INVALID_OPERATION,"VAO0 pointer rejected");
    glEnableVertexAttribArray(0);error(GL_INVALID_OPERATION,"VAO0 enable rejected");
    glDisableVertexAttribArray(0);error(GL_INVALID_OPERATION,"VAO0 disable rejected");
    glVertexAttribDivisor(0,0);error(GL_INVALID_OPERATION,"VAO0 divisor rejected");
    /* No active attributes: removing only the explicit VAO0 draw guard must break these tests. */
    GLuint strict=link("#version 330 core\nvoid main(){gl_Position=vec4(0.0,0.0,0.0,1.0);}",
        "#version 330 core\nout vec4 c;void main(){c=vec4(1.0);}",0);glUseProgram(strict);
    glBindVertexArray(vaos[0]);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,buffers[9]);
    glDrawArrays(GL_POINTS,0,1);error(GL_NO_ERROR,"named VAO no-attribute arrays control");
    glDrawElements(GL_POINTS,1,GL_UNSIGNED_SHORT,0);error(GL_NO_ERROR,"named VAO no-attribute indexed control");
    glBindVertexArray(0);
    glDrawArrays(GL_POINTS,0,1);error(GL_INVALID_OPERATION,"VAO0 arrays draw rejected");
    glDrawElements(GL_POINTS,1,GL_UNSIGNED_SHORT,0);error(GL_INVALID_OPERATION,"VAO0 draw rejected");
    glBindVertexArray(vaos[17]);
    GLuint p=link("#version 330 core\nlayout(location=0) in vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}",
        "#version 330 core\nuniform vec4 tint;out vec4 c;void main(){c=tint;}",0);glUseProgram(p);
    /* The mapped-store restrictions apply across targets and real VAOs too. */
    part=glMapBufferRange(GL_ELEMENT_ARRAY_BUFFER,0,12,GL_MAP_WRITE_BIT);
    note("real VAO map",part!=0);
    void *mapped=(void *)(uintptr_t)~(uintptr_t)0;glGetBufferPointerv(GL_ELEMENT_ARRAY_BUFFER,GL_BUFFER_MAP_POINTER,&mapped);
    note("Win64 mapped pointer query",mapped==part);
    glGetBufferParameteriv(GL_ELEMENT_ARRAY_BUFFER,GL_BUFFER_ACCESS_FLAGS,&size);note("mapped flags query",size==GL_MAP_WRITE_BIT);
    glDrawElements(GL_TRIANGLES,6,GL_UNSIGNED_SHORT,0);error(GL_INVALID_OPERATION,"mapped index draw rejected");
    glBufferSubData(GL_ELEMENT_ARRAY_BUFFER,0,12,quad);error(GL_INVALID_OPERATION,"mapped subdata rejected");
    if(part)note("real VAO unmap",glUnmapBuffer(GL_ELEMENT_ARRAY_BUFFER)==GL_TRUE);
    note("Win64 high offset rejected",glMapBufferRange(GL_ELEMENT_ARRAY_BUFFER,(GLintptr)0x100000000ull,12,GL_MAP_WRITE_BIT)==0);
    error(GL_INVALID_VALUE,"Win64 high offset error");
    note("Win64 high length rejected",glMapBufferRange(GL_ELEMENT_ARRAY_BUFFER,0,(GLsizeiptr)0x100000000ull,GL_MAP_WRITE_BIT)==0);
    error(GL_INVALID_VALUE,"Win64 high length error");
    generated_mapping(vaos[0]);glUseProgram(p);
    GLint tint=glGetUniformLocation(p,"tint");error(GL_NO_ERROR,"real VAO setup errors");
    const unsigned char colours[5][4]={{255,0,0,255},{0,255,0,255},{0,0,255,255},{0,255,255,255},{255,255,0,255}};
    unsigned frame=0;for(;;){
        glViewport(0,0,320,200);glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);
        for(unsigned i=0;i<5;i++){
            glBindVertexArray(vaos[13+i]);glViewport(i*64,0,64,200);
            glUniform4f(tint,colours[i][0]/255.0f,colours[i][1]/255.0f,colours[i][2]/255.0f,1);
            glDrawElements(GL_TRIANGLES,6,GL_UNSIGNED_SHORT,(void *)(uintptr_t)(i*12));
            if(!frame){unsigned char px[4]={0};glReadPixels(i*64+32,100,1,1,GL_RGBA,GL_UNSIGNED_BYTE,px);
                char label[40];snprintf(label,sizeof label,"exact pixel %u",i);note(label,!memcmp(px,colours[i],4));}
        }
        if(!frame){error(GL_NO_ERROR,"indexed draw errors");char b[120];snprintf(b,sizeof b,"x64-gl-default-vao %s failures=%u",failures?"FAIL":"PASS",failures);OutputDebugStringA(b);}
        SwapBuffers(dc);frame++;
    }
}
