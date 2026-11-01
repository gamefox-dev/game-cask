/* Original CC0-1.0. Normal -O2 Win64/CRT fixture; no overrides/BGT imports.
 * Regression: disabled float attributes are context-current values, not missing inputs, and texture
 * swizzle applies to sampling (including fetch/LOD/grad), never to stored pixels or sampler objects. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#define GLFUNCS \
 X(PFNGLATTACHSHADERPROC, glAttachShader) X(PFNGLBINDBUFFERPROC, glBindBuffer) \
 X(PFNGLBINDTEXTUREPROC, glBindTexture) X(PFNGLBINDVERTEXARRAYPROC, glBindVertexArray) \
 X(PFNGLBUFFERDATAPROC, glBufferData) X(PFNGLCLEARPROC, glClear) X(PFNGLCLEARCOLORPROC, glClearColor) \
 X(PFNGLCOMPILESHADERPROC, glCompileShader) X(PFNGLCREATEPROGRAMPROC, glCreateProgram) \
 X(PFNGLCREATESHADERPROC, glCreateShader) X(PFNGLDISABLEVERTEXATTRIBARRAYPROC, glDisableVertexAttribArray) \
 X(PFNGLDRAWARRAYSPROC, glDrawArrays) X(PFNGLDRAWARRAYSINSTANCEDPROC, glDrawArraysInstanced) \
 X(PFNGLENABLEVERTEXATTRIBARRAYPROC, glEnableVertexAttribArray) X(PFNGLGENBUFFERSPROC, glGenBuffers) \
 X(PFNGLGENTEXTURESPROC, glGenTextures) X(PFNGLGENVERTEXARRAYSPROC, glGenVertexArrays) \
 X(PFNGLGETERRORPROC, glGetError) X(PFNGLGETPROGRAMIVPROC, glGetProgramiv) \
 X(PFNGLGETPROGRAMINFOLOGPROC, glGetProgramInfoLog) X(PFNGLGETSHADERIVPROC, glGetShaderiv) \
 X(PFNGLGETSHADERINFOLOGPROC, glGetShaderInfoLog) X(PFNGLGETTEXIMAGEPROC, glGetTexImage) \
 X(PFNGLGETTEXPARAMETERIVPROC, glGetTexParameteriv) X(PFNGLGETUNIFORMLOCATIONPROC, glGetUniformLocation) \
 X(PFNGLLINKPROGRAMPROC, glLinkProgram) X(PFNGLREADPIXELSPROC, glReadPixels) \
 X(PFNGLSHADERSOURCEPROC, glShaderSource) X(PFNGLTEXIMAGE2DPROC, glTexImage2D) \
 X(PFNGLTEXPARAMETERIPROC, glTexParameteri) X(PFNGLTEXPARAMETERIVPROC, glTexParameteriv) \
 X(PFNGLUNIFORM1IPROC, glUniform1i) X(PFNGLUSEPROGRAMPROC, glUseProgram) \
 X(PFNGLVERTEXATTRIBPOINTERPROC, glVertexAttribPointer) X(PFNGLVIEWPORTPROC, glViewport) \
 X(PFNGLVERTEXATTRIB1FPROC, glVertexAttrib1f) X(PFNGLVERTEXATTRIB1FVPROC, glVertexAttrib1fv) \
 X(PFNGLVERTEXATTRIB2FPROC, glVertexAttrib2f) X(PFNGLVERTEXATTRIB2FVPROC, glVertexAttrib2fv) \
 X(PFNGLVERTEXATTRIB3FPROC, glVertexAttrib3f) X(PFNGLVERTEXATTRIB3FVPROC, glVertexAttrib3fv) \
 X(PFNGLVERTEXATTRIB4FPROC, glVertexAttrib4f) X(PFNGLVERTEXATTRIB4FVPROC, glVertexAttrib4fv) \
 X(PFNGLACTIVETEXTUREPROC, glActiveTexture) X(PFNGLGENSAMPLERSPROC, glGenSamplers) \
 X(PFNGLBINDSAMPLERPROC, glBindSampler) X(PFNGLSAMPLERPARAMETERIPROC, glSamplerParameteri) \
 X(PFNGLGENFRAMEBUFFERSPROC, glGenFramebuffers) X(PFNGLBINDFRAMEBUFFERPROC, glBindFramebuffer) \
 X(PFNGLFRAMEBUFFERTEXTURE2DPROC, glFramebufferTexture2D) X(PFNGLCHECKFRAMEBUFFERSTATUSPROC, glCheckFramebufferStatus)
#define X(t,n) static t n;
GLFUNCS
#undef X
static unsigned failures;
static void note(const char *label, int ok) {
    char b[160]; snprintf(b, sizeof b, "x64-gl-current %s %s", ok ? "ok" : "FAIL", label);
    OutputDebugStringA(b); if (!ok) failures++;
}
static void error(GLenum want, const char *label) {
    GLenum got = glGetError(), again = glGetError(); note(label, got == want && again == GL_NO_ERROR);
}
static GLuint shader(GLenum stage, const char *source) {
    GLuint id = glCreateShader(stage); GLint ok = 0; glShaderSource(id, 1, &source, 0); glCompileShader(id);
    glGetShaderiv(id, GL_COMPILE_STATUS, &ok);
    if (!ok) { char b[4096]; glGetShaderInfoLog(id, sizeof b, 0, b); OutputDebugStringA(b); ExitProcess(10); }
    return id;
}
static GLuint program(const char *vs, const char *fs) {
    GLuint p = glCreateProgram(); GLint ok = 0;
    glAttachShader(p, shader(GL_VERTEX_SHADER, vs)); glAttachShader(p, shader(GL_FRAGMENT_SHADER, fs));
    glLinkProgram(p); glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) { char b[4096]; glGetProgramInfoLog(p, sizeof b, 0, b); OutputDebugStringA(b); ExitProcess(11); }
    return p;
}
static void tile(unsigned i) { glViewport((i % 4) * 80, (3 - i / 4) * 50, 80, 50); }
static const unsigned char expected[16][4] = {
    {0,0,0,255}, {64,0,0,255}, {191,0,0,255}, {64,128,0,255},
    {191,64,0,255}, {64,128,191,255}, {191,128,64,255}, {64,128,191,128},
    {191,64,128,191}, {255,128,0,255}, {255,255,255,255}, {128,255,64,255},
    {64,128,192,255}, {192,128,64,255}, {0,64,255,128}, {0,64,255,128}
};
static void pixel(unsigned i) {
    unsigned char p[4] = {0}; char label[64];
    glReadPixels((i % 4)*80+40, (3-i/4)*50+25, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, p);
    int ok = 1; for (int c = 0; c < 4; c++) {
        int d = (int)p[c] - expected[i][c]; if (d < -1 || d > 1) ok = 0;
    }
    snprintf(label, sizeof label, "pixel %u", i); note(label, ok);
}
int main(void) {
    WNDCLASSA cls = {0}; cls.lpfnWndProc = DefWindowProcA; cls.lpszClassName = "GLCurrentFixture";
    RegisterClassA(&cls);
    HWND win = CreateWindowExA(0, cls.lpszClassName, "GL contracts", WS_VISIBLE | WS_POPUP,
        0, 0, 320, 200, 0, 0, 0, 0);
    HDC dc = GetDC(win); PIXELFORMATDESCRIPTOR d = {0}; d.nSize = sizeof d; d.nVersion = 1;
    d.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; d.cColorBits = 32;
    SetPixelFormat(dc, ChoosePixelFormat(dc, &d), &d); HGLRC context = wglCreateContext(dc);
    if (!context) { OutputDebugStringA("x64-gl-current GPU unavailable"); for (;;) Sleep(16); }
    wglMakeCurrent(dc, context);
#define X(t,n) n = (t)wglGetProcAddress(#n);
    GLFUNCS
#undef X
    GLuint flat = program("#version 330 core\nlayout(location=0) in vec2 position;"
        "layout(location=3) in vec4 tint; out vec4 tc; uniform int instances;"
        "void main(){gl_Position=vec4(position,0.0,1.0);tc=tint;if(instances!=0){"
        "float n=float(gl_InstanceID);gl_Position.x=position.x/3.0+(n-1.0)*2.0/3.0;"
        "tc=tint*vec4(1.0+(n-1.0)*0.25,1.0,1.0,1.0);}}",
        "#version 330 core\nin vec4 tc; layout(location=0) out vec4 c;void main(){c=tc;}");
    GLuint tex = program("#version 330 core\nlayout(location=0) in vec2 position;out vec2 uv;"
        "void main(){gl_Position=vec4(position,0.0,1.0);uv=position*0.5+vec2(0.5);}",
        "#version 330 core\nin vec2 uv;layout(location=0) out vec4 c;uniform sampler2D img;uniform int mode;"
        "void main(){if(mode==0)c=texture(img,uv);else if(mode==1)c=textureLod(img,uv,0.0);"
        "else if(mode==2)c=textureGrad(img,uv,vec2(0.0),vec2(0.0));else c=texelFetch(img,ivec2(0),0);}");
    GLuint vaos[2], buf; glGenVertexArrays(2, vaos); glGenBuffers(1, &buf); glBindBuffer(GL_ARRAY_BUFFER, buf);
    const float vertices[] = {-1,-1,1,.5f,0,1, 1,-1,1,.5f,0,1, -1,1,1,.5f,0,1, 1,1,1,.5f,0,1};
    glBufferData(GL_ARRAY_BUFFER, sizeof vertices, vertices, GL_STATIC_DRAW);
    for (int v = 0; v < 2; v++) {
        glBindVertexArray(vaos[v]); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 24, 0);
        glEnableVertexAttribArray(0); glVertexAttribPointer(3, 4, GL_FLOAT, GL_FALSE, 24, (void *)8);
    }
    GLuint image, sampler; glGenTextures(1, &image); glActiveTexture(GL_TEXTURE5); glBindTexture(GL_TEXTURE_2D, image);
    const unsigned char data[4] = {64,128,192,255}; unsigned char back[4] = {0};
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, data);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenSamplers(1, &sampler); glSamplerParameteri(sampler, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glSamplerParameteri(sampler, GL_TEXTURE_MAG_FILTER, GL_NEAREST); glBindSampler(5, sampler);
    glUseProgram(tex); glUniform1i(glGetUniformLocation(tex, "img"), 5);
    GLint mode = glGetUniformLocation(tex, "mode"), instances = glGetUniformLocation(flat, "instances");
    error(GL_NO_ERROR, "setup errors");
    glVertexAttrib4f(16, 1, 1, 1, 1); error(GL_INVALID_VALUE, "invalid current index");
    glVertexAttrib1fv(16, 0); error(GL_INVALID_VALUE, "invalid vector index before pointer read");
    const GLint swz[4] = {GL_BLUE, GL_GREEN, GL_RED, GL_ONE};
    glTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_RGBA, swz);
    const GLint bad[4] = {GL_RED, GL_GREEN, GL_BLUE, GL_TEXTURE_2D};
    glTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_RGBA, bad); error(GL_INVALID_ENUM, "atomic invalid swizzle vector");
    GLint queried[4] = {0}; glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_RGBA, queried);
    note("invalid swizzle preserves vector", queried[0] == swz[0] && queried[1] == swz[1] && queried[2] == swz[2] && queried[3] == swz[3]);
    glGetTexImage(GL_TEXTURE_2D, 0, GL_RGBA, GL_UNSIGNED_BYTE, back);
    note("swizzle does not mutate storage", back[0] == 64 && back[1] == 128 && back[2] == 192 && back[3] == 255);
    error(GL_NO_ERROR, "parameter errors");
    GLuint incomplete; glGenTextures(1, &incomplete); glBindTexture(GL_TEXTURE_2D, incomplete);
    const GLint ones[4] = {GL_ONE,GL_ONE,GL_ONE,GL_ONE};
    glTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_RGBA, ones);
    /* Explicit RGBA8 attachment: the default Windows pixel format need not have alpha bits. */
    GLuint target, fbo; glGenTextures(1, &target); glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, target);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 320, 200, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenFramebuffers(1, &fbo); glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target, 0);
    note("RGBA framebuffer complete", glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE);
    error(GL_NO_ERROR, "framebuffer errors");
    unsigned frame = 0;
    for (;;) {
        glActiveTexture(GL_TEXTURE5); glBindTexture(GL_TEXTURE_2D, image); glBindFramebuffer(GL_FRAMEBUFFER, fbo);
        /* Different from the default-current panel: a dropped draw must fail its black pixel assertion. */
        glViewport(0, 0, 320, 200); glClearColor(.12f,.08f,.1f,1); glClear(GL_COLOR_BUFFER_BIT);
        glUseProgram(flat); glBindVertexArray(vaos[0]);
        if (frame) glVertexAttrib4f(3,0,0,0,1); /* first draw must use the actual default current value */
        for (unsigned i = 0; i < 12; i++) {
            const float a[4] = {.75f,.25f,.5f,.75f}, b[3] = {.75f,.5f,.25f};
            if (i == 1) glVertexAttrib1f(3,.25f);
            if (i == 2) glVertexAttrib1fv(3,a);
            if (i == 3) glVertexAttrib2f(3,.25f,.5f);
            if (i == 4) glVertexAttrib2fv(3,a);
            if (i == 5) glVertexAttrib3f(3,.25f,.5f,.75f);
            if (i == 6) glVertexAttrib3fv(3,b);
            if (i == 7) glVertexAttrib4f(3,.25f,.5f,.75f,.5f);
            if (i == 8) glVertexAttrib4fv(3,a);
            if (i == 9) { glEnableVertexAttribArray(3); glVertexAttrib4f(3,0,0,1,1); }
            if (i == 10) { glDisableVertexAttribArray(3); glVertexAttrib4f(3,1,1,1,1); glBindVertexArray(vaos[1]); }
            if (i == 11) glVertexAttrib4f(3,.5f,1,.25f,1);
            tile(i); glUniform1i(instances, i == 11);
            if (i == 11) glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, 3);
            else glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
            if (!frame) {
                pixel(i);
                if (i == 11) {
                    unsigned char p[4]; glReadPixels(3*80+13, 50+25, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, p);
                    note("instance zero distinct pixel", p[0] >= 95 && p[0] <= 97 && p[1] == 255 && p[2] == 64 && p[3] == 255);
                    glReadPixels(3*80+66, 50+25, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, p);
                    note("instance two distinct pixel", p[0] >= 158 && p[0] <= 160 && p[1] == 255 && p[2] == 64 && p[3] == 255);
                }
            }
        }
        glUseProgram(tex);
        for (unsigned i = 12; i < 16; i++) {
            if (i == 12) { const GLint identity[4] = {GL_RED,GL_GREEN,GL_BLUE,GL_ALPHA};
                glTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_RGBA, identity); }
            if (i == 13) glTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_RGBA, swz);
            if (i == 14) { glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_R, GL_ZERO);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_G, GL_RED);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_B, GL_ONE);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_A, GL_GREEN); }
            tile(i); glUniform1i(mode, (GLint)i-12); glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
            if (!frame) pixel(i);
        }
        if (!frame) {
            unsigned char p[4]; glBindTexture(GL_TEXTURE_2D, incomplete); glUniform1i(mode, 0);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
            glReadPixels(3*80+40, 25, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, p);
            note("incomplete texture ignores object swizzle", p[0] == 0 && p[1] == 0 && p[2] == 0 && p[3] == 255);
            glBindTexture(GL_TEXTURE_2D, image); glUniform1i(mode, 3); glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        }
        glBindFramebuffer(GL_FRAMEBUFFER, 0); glBindTexture(GL_TEXTURE_2D, target);
        glViewport(0, 0, 320, 200); glUniform1i(mode, 0); glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        error(GL_NO_ERROR, "frame errors");
        if (!frame) { char b[80]; snprintf(b, sizeof b, "x64-gl-current %s failures=%u", failures ? "FAIL" : "PASS", failures); OutputDebugStringA(b); }
        frame++; SwapBuffers(dc);
    }
}
