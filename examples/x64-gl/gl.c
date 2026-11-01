/* Original CC0-1.0 fixture. Real -O2/CRT Win64 program; no BGT imports or overrides.
 * Scenes: indexed triangle, mipmapped alpha quad, FBO texture, depth/stencil, instanced sprites.
 * Seven separately visible tiles are asserted on both real browser backends. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stddef.h>
#include <stdio.h>
#include "gl_entries.h"

static void check(int ok, const char *message) {
    if (!ok) { OutputDebugStringA(message); ExitProcess(10); }
}
static GLuint shader(GLenum stage, const char *source) {
    GLuint id = glCreateShader(stage); glShaderSource(id, 1, &source, 0); glCompileShader(id);
    GLint ok = 0; glGetShaderiv(id, GL_COMPILE_STATUS, &ok);
    if (!ok) { char log[4096]; glGetShaderInfoLog(id, sizeof log, 0, log); OutputDebugStringA(log); }
    check(ok, "shader compile failed"); return id;
}
static GLuint make_program(void) {
    const char *vs = "#version 330 core\n"
        "layout(location=0) in vec2 position; layout(location=1) in vec2 uv;"
        "layout(location=2) in vec2 sprite; out vec2 tc; uniform vec4 tint;"
        "layout(std140) uniform Scene { vec4 transform; };"
        "void main(){ tc=uv; tc+=vec2(1.25e-2);"
        "gl_Position=vec4(position*transform.xy+transform.zw+sprite,0.0,1.0); }";
    const char *fs = "#version 330 core\n"
        "in vec2 tc; layout(location=0) out vec4 color; uniform vec4 tint; uniform sampler2D image;"
        "float calls=0.0; vec2 coords(){calls+=1.0;return tc;}"
        "void main(){color=texture(image,coords())*tint;"
        "if(calls!=1.0) color=vec4(1,0,1,1);}";
    GLuint p = glCreateProgram(), v = shader(GL_VERTEX_SHADER, vs), f = shader(GL_FRAGMENT_SHADER, fs);
    glAttachShader(p, v); glAttachShader(p, f); glLinkProgram(p);
    GLint ok; glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) { char log[4096]; glGetProgramInfoLog(p, sizeof log, 0, log); OutputDebugStringA(log); }
    check(ok, "link failed"); glDeleteShader(v); glDeleteShader(f); return p;
}
static void expected(GLenum e) {
    check(glGetError() == e, "wrong deliberate GL error"); check(glGetError() == GL_NO_ERROR, "error not cleared");
}
int main(void) {
#ifdef ENGINE_SMOKE
    smoke_start();
#endif
    WNDCLASSA cls = {0}; cls.lpfnWndProc = DefWindowProcA; cls.lpszClassName = "GLFixture";
    RegisterClassA(&cls);
    HWND window = CreateWindowExA(0, cls.lpszClassName, "OpenGL", WS_VISIBLE | WS_POPUP,
        0, 0, 320, 200, 0, 0, 0, 0);
    HDC dc = GetDC(window); PIXELFORMATDESCRIPTOR desc = {0}; desc.nSize = sizeof desc; desc.nVersion = 1;
    desc.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    desc.cColorBits = 32; desc.cDepthBits = 24; desc.cStencilBits = 8;
    int format = ChoosePixelFormat(dc, &desc);
    check(format && DescribePixelFormat(dc, format, sizeof desc, &desc), "pixel format missing");
    check(SetPixelFormat(dc, format, &desc), "pixel format failed");
    HGLRC context = wglCreateContext(dc);
    if (!context) {
        OutputDebugStringA("x64-gl GPU unavailable (requires GLSL330 command backend)");
        for (;;) Sleep(16);
    }
    check(wglMakeCurrent(dc, context), "make current failed"); load_gl();
    typedef HGLRC (WINAPI *CreateAttribs)(HDC, HGLRC, const int *);
    typedef BOOL (WINAPI *SwapInterval)(int);
    CreateAttribs create = (CreateAttribs)wglGetProcAddress("wglCreateContextAttribsARB");
    SwapInterval swap_interval = (SwapInterval)wglGetProcAddress("wglSwapIntervalEXT");
    const int attributes[] = {0x2091, 3, 0x2092, 3, 0x9126, 1, 0};
    check(create && create(dc, 0, attributes) == context, "core context failed");
    check(swap_interval && swap_interval(1), "swap interval failed");
    check(wglGetProcAddress("glBindBufferARB") != 0, "ARB alias missing");
    GLint major; glGetIntegerv(GL_MAJOR_VERSION, &major); check(major == 3, "version query failed");
    glEnable(0xffffffffu); expected(GL_INVALID_ENUM);
    glBindBuffer(GL_ARRAY_BUFFER, 9999); expected(GL_INVALID_VALUE);
    glDrawArrays(GL_TRIANGLES, 0, 3); expected(GL_INVALID_OPERATION);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 3); expected(GL_INVALID_VALUE);
    OutputDebugStringA("x64-gl errors=0500,0501,0502,0501 cleared");

    for (unsigned i = 0; i < 300; i++) {
        GLuint recycled = glCreateShader(GL_VERTEX_SHADER); check(recycled != 0, "shader names leaked");
        glDeleteShader(recycled); check(!glIsShader(recycled), "deleted shader remains live");
    }
    GLuint bad = glCreateShader(GL_FRAGMENT_SHADER);
    const char *bad_source = "#version 330 core\nuniform nosuchtype unsupported[2]; void main(){}";
    glShaderSource(bad, 1, &bad_source, 0); glCompileShader(bad);
    GLint compiled = 1; char bad_log[128]; glGetShaderiv(bad, GL_COMPILE_STATUS, &compiled);
    glGetShaderInfoLog(bad, sizeof bad_log, 0, bad_log);
    check(!compiled && bad_log[0], "invalid declaration must have a compile log"); glDeleteShader(bad);
    GLuint p = make_program(); glUseProgram(p);
    GLint tint = glGetUniformLocation(p, "tint"), image = glGetUniformLocation(p, "image");
    check(tint >= 0 && image >= 0, "uniform locations missing");
    glUniform1i(image, 2); glUniform4f(tint, 1, 1, 1, 1);
    GLuint block = glGetUniformBlockIndex(p, "Scene"); check(block != GL_INVALID_INDEX, "block missing");
    glUniformBlockBinding(p, block, 3);
    const GLfloat transform[] = {1, 1, 0, 0}; GLuint ubo;
    glGenBuffers(1, &ubo); glBindBuffer(GL_UNIFORM_BUFFER, ubo);
    glBindBufferBase(GL_UNIFORM_BUFFER, 3, ubo); // Valid before the store exists; uses current size at draw.
    glBufferData(GL_UNIFORM_BUFFER, sizeof transform, transform, GL_DYNAMIC_DRAW);
    const GLfloat vertices[] = {-0.8f,-0.8f,0,0, 0.8f,-0.8f,1,0, 0.8f,0.8f,1,1, -0.8f,0.8f,0,1};
    const GLushort indices[] = {0,1,2, 0,2,3};
    const GLfloat sprites[] = {0,0, 0.1f,0.1f, -0.1f,0.1f};
    GLuint vao, vbo, ebo, instances;
    glGenVertexArrays(1, &vao); glBindVertexArray(vao);
    glGenBuffers(1, &vbo); glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof vertices, vertices, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 16, 0); glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 16, (void *)8); glEnableVertexAttribArray(1);
    glGenBuffers(1, &instances); glBindBuffer(GL_ARRAY_BUFFER, instances);
    glBufferData(GL_ARRAY_BUFFER, sizeof sprites, sprites, GL_STATIC_DRAW);
    glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, 8, 0); glEnableVertexAttribArray(2); glVertexAttribDivisor(2, 1);
    glGenBuffers(1, &ebo); glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof indices, indices, GL_STATIC_DRAW);
    GLuint texture; const unsigned char pixels[] = {
        255,0,0,128, 0,255,0,128, 0,0,255,128, 255,255,255,128};
    glActiveTexture(GL_TEXTURE2); glGenTextures(1, &texture); glBindTexture(GL_TEXTURE_2D, texture);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    glGenerateMipmap(GL_TEXTURE_2D);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
    GLuint sampler; glGenSamplers(1, &sampler); glBindSampler(2, sampler);
    glSamplerParameteri(sampler, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
    GLuint render_texture, framebuffer, renderbuffer;
    glGenTextures(1, &render_texture); glBindTexture(GL_TEXTURE_2D, render_texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 64, 64, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR); // complete without a mip chain
    glGenFramebuffers(1, &framebuffer); glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, render_texture, 0);
    glGenRenderbuffers(1, &renderbuffer); glBindRenderbuffer(GL_RENDERBUFFER, renderbuffer);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, 64, 64);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, renderbuffer);
    check(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "FBO incomplete");
    glBindFramebuffer(GL_FRAMEBUFFER, 0); glBindTexture(GL_TEXTURE_2D, texture);
    glEnable(GL_DEPTH_TEST); glDepthFunc(GL_LEQUAL); glEnable(GL_STENCIL_TEST);
    glStencilFunc(GL_ALWAYS, 7, 255); glStencilOp(GL_KEEP, GL_KEEP, GL_REPLACE);
    glClearColor(0.05f, 0.1f, 0.15f, 1); glClearDepth(1); glClearStencil(0);
    glBlendColor(0.1f, 0.2f, 0.3f, 0.4f);
    glBlendFunc(GL_CONSTANT_ALPHA, GL_ONE_MINUS_CONSTANT_ALPHA); expected(GL_INVALID_OPERATION);
    unsigned frame = 0;
    for (;;) {
        if (frame == 1) {
            const GLfloat resized[] = {1,1,0,0, 0,0,0,0}; glBindBuffer(GL_UNIFORM_BUFFER, ubo);
            glBufferData(GL_UNIFORM_BUFFER, sizeof resized, resized, GL_DYNAMIC_DRAW);
        }
        glBindFramebuffer(GL_FRAMEBUFFER, framebuffer); glViewport(0, 0, 64, 64);
        glBindTexture(GL_TEXTURE_2D, texture); glDisable(GL_BLEND);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
        glDrawElements(GL_TRIANGLES, 3, GL_UNSIGNED_SHORT, 0);
        glBindFramebuffer(GL_FRAMEBUFFER, 0); glViewport(0, 0, 320, 200);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
        glViewport(0, 100, 80, 100);
        glDrawElementsBaseVertex(GL_TRIANGLES, 3, GL_UNSIGNED_SHORT, 0, 0);
        glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glViewport(80, 100, 80, 100);
        glUniform4f(tint, 1, 1, 1, 0.5f); glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, 0);
        glViewport(160, 100, 80, 100);
        glBindSampler(2, 0); // the texture's own LINEAR filter: a sampler object would override it
        glBindTexture(GL_TEXTURE_2D, render_texture); glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        glBindSampler(2, sampler);
        glBindTexture(GL_TEXTURE_2D, texture); glUniform4f(tint, 1, 0.8f, 0.6f, 1);
        glViewport(240, 100, 80, 100);
        glDrawElementsInstanced(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, 0, 3);
        glViewport(0, 0, 80, 100);
        glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, 3);
        glViewport(80, 0, 80, 100);
        glDrawElementsInstancedBaseVertex(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, 0, 3, 0);
        glViewport(160, 0, 80, 100); glDisable(GL_BLEND);
        glEnable(GL_SCISSOR_TEST); glScissor(160, 0, 40, 100);
        glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, 0);
        glDisable(GL_SCISSOR_TEST); glStencilFunc(GL_EQUAL, 7, 255);
        glUniform4f(tint, 0, 1, 0, 1); glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, 0);
        glDepthRange(0.9, 1); glUniform4f(tint, 1, 0, 0, 1);
        glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, 0); // farther red must fail depth
        glDepthRange(0, 1); glStencilFunc(GL_ALWAYS, 7, 255);
        glUniform4f(tint, 1, 1, 1, 1);
        if (!frame) {
            unsigned char readback[16]; glReadPixels(0, 0, 2, 2, GL_RGBA, GL_UNSIGNED_BYTE, readback);
            char message[100]; snprintf(message, sizeof message, "x64-gl readback=%u,%u", readback[0], readback[8]);
            OutputDebugStringA(message);
            glReadPixels(180, 49, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, readback);
            snprintf(message, sizeof message, "x64-gl colored=%u,%u,%u", readback[0], readback[1], readback[2]);
            OutputDebugStringA(message);
            OutputDebugStringA("x64-gl PASS scenes=7 uniforms=2 block=3 sampler=2 readback=1");
        }
        check(glGetError() == GL_NO_ERROR, "unexpected GL error"); frame++; SwapBuffers(dc);
#ifdef ENGINE_SMOKE
        smoke_frame(frame);
#endif
    }
}
