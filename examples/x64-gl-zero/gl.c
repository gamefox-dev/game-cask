/* SPDX-License-Identifier: CC0-1.0. Original engine-shaped workload, no game assets (K66, Q120).
 * 2D batching that orphans each vertex/index buffer with glBufferData(target, 0, NULL, usage) before every batch
 * upload (the "send null" pattern), 40 batches per frame. Startup checks the zero-size store semantics of
 * GL 3.3 §2.9.2 and logs one line; two deliberate invalid calls (a negative size and a draw that reads past a
 * zero-size store) exercise the error-code census, as do copies, uniform/feedback bindings and a uniform-block draw
 * or feedback capture on a zero-size store (vK66). A last batch re-specifies and then orphans a live store while a
 * unit-test host may reject the batch (log "zero inject"): the replay must still leave the zero size. Every frame
 * checks glGetError. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stdio.h>
#define FUNCTIONS \
 X(PFNGLCREATESHADERPROC,glCreateShader) X(PFNGLSHADERSOURCEPROC,glShaderSource) X(PFNGLCOMPILESHADERPROC,glCompileShader) \
 X(PFNGLCREATEPROGRAMPROC,glCreateProgram) X(PFNGLATTACHSHADERPROC,glAttachShader) X(PFNGLLINKPROGRAMPROC,glLinkProgram) X(PFNGLUSEPROGRAMPROC,glUseProgram) \
 X(PFNGLGENBUFFERSPROC,glGenBuffers) X(PFNGLBINDBUFFERPROC,glBindBuffer) X(PFNGLBUFFERDATAPROC,glBufferData) X(PFNGLBUFFERSUBDATAPROC,glBufferSubData) \
 X(PFNGLGETBUFFERPARAMETERIVPROC,glGetBufferParameteriv) X(PFNGLMAPBUFFERRANGEPROC,glMapBufferRange) \
 X(PFNGLGENVERTEXARRAYSPROC,glGenVertexArrays) X(PFNGLBINDVERTEXARRAYPROC,glBindVertexArray) X(PFNGLVERTEXATTRIBPOINTERPROC,glVertexAttribPointer) X(PFNGLENABLEVERTEXATTRIBARRAYPROC,glEnableVertexAttribArray) \
 X(PFNGLDRAWELEMENTSPROC,glDrawElements) X(PFNGLDRAWARRAYSPROC,glDrawArrays) X(PFNGLGETERRORPROC,glGetError) \
 X(PFNGLCLEARPROC,glClear) X(PFNGLCLEARCOLORPROC,glClearColor) X(PFNGLREADPIXELSPROC,glReadPixels) \
 X(PFNGLCOPYBUFFERSUBDATAPROC,glCopyBufferSubData) X(PFNGLBINDBUFFERBASEPROC,glBindBufferBase) X(PFNGLBINDBUFFERRANGEPROC,glBindBufferRange) \
 X(PFNGLTRANSFORMFEEDBACKVARYINGSPROC,glTransformFeedbackVaryings) X(PFNGLBEGINTRANSFORMFEEDBACKPROC,glBeginTransformFeedback) \
 X(PFNGLENDTRANSFORMFEEDBACKPROC,glEndTransformFeedback) X(PFNGLUNIFORMBLOCKBINDINGPROC,glUniformBlockBinding) \
 X(PFNGLGETUNIFORMBLOCKINDEXPROC,glGetUniformBlockIndex) X(PFNGLENABLEPROC,glEnable) X(PFNGLDISABLEPROC,glDisable)
#define X(t,n) static t n;
FUNCTIONS
#undef X
static unsigned checks, failed;
static void check(const char *what, int ok) { checks++; if (!ok) { failed++; char t[160]; snprintf(t, sizeof t, "zero FAIL %s", what); OutputDebugStringA(t); } }
static GLint size_of(GLenum target) { GLint v = -1; glGetBufferParameteriv(target, GL_BUFFER_SIZE, &v); return v; }
static GLuint shader(GLenum type, const char *src) { GLuint s = glCreateShader(type); glShaderSource(s, 1, &src, 0); glCompileShader(s); return s; }
int main(void) {
    WNDCLASSA c = {0}; c.lpfnWndProc = DefWindowProcA; c.lpszClassName = "ZeroCC0"; RegisterClassA(&c);
    HWND win = CreateWindowExA(0, c.lpszClassName, "Zero CC0", WS_VISIBLE | WS_POPUP, 0, 0, 32, 32, 0, 0, 0, 0); HDC dc = GetDC(win);
    PIXELFORMATDESCRIPTOR pfd = {0}; pfd.nSize = sizeof pfd; pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER; pfd.cColorBits = 32;
    SetPixelFormat(dc, ChoosePixelFormat(dc, &pfd), &pfd); wglMakeCurrent(dc, wglCreateContext(dc));
#define X(t,n) n = (t)wglGetProcAddress(#n);
    FUNCTIONS
#undef X
    GLuint p = glCreateProgram();
    glAttachShader(p, shader(GL_VERTEX_SHADER, "#version 330 core\nlayout(location=0) in vec2 pos;void main(){gl_Position=vec4(pos,0.0,1.0);}"));
    glAttachShader(p, shader(GL_FRAGMENT_SHADER, "#version 330 core\nlayout(location=0) out vec4 color;void main(){color=vec4(1.0,0.0,0.0,1.0);}"));
    glLinkProgram(p); glUseProgram(p);
    GLuint vao, b[2]; glGenVertexArrays(1, &vao); glBindVertexArray(vao); glGenBuffers(2, b);
    const float v[6] = {-1, -1, 3, -1, -1, 3}; const unsigned short idx[3] = {0, 1, 2};
    /* Startup: zero-size store semantics. */
    glBindBuffer(GL_ARRAY_BUFFER, b[0]);
    glBufferData(GL_ARRAY_BUFFER, 0, 0, GL_STREAM_DRAW); check("zero size on a new buffer", glGetError() == GL_NO_ERROR && size_of(GL_ARRAY_BUFFER) == 0);
    glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STREAM_DRAW); check("upload", glGetError() == GL_NO_ERROR && size_of(GL_ARRAY_BUFFER) == 24);
    glBufferData(GL_ARRAY_BUFFER, 0, v, GL_STREAM_DRAW); check("zero size orphans a live store", glGetError() == GL_NO_ERROR && size_of(GL_ARRAY_BUFFER) == 0);
    glBufferSubData(GL_ARRAY_BUFFER, 0, 4, v); check("sub-data past a zero-size store", glGetError() == GL_INVALID_VALUE);
    check("map of a zero-size store", !glMapBufferRange(GL_ARRAY_BUFFER, 0, 0, GL_MAP_WRITE_BIT) && glGetError() != GL_NO_ERROR);
    glBufferData(GL_ARRAY_BUFFER, -1, 0, GL_STREAM_DRAW); check("negative size", glGetError() == GL_INVALID_VALUE && size_of(GL_ARRAY_BUFFER) == 0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, 0); glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLES, 0, 3); check("draw reading a zero-size store", glGetError() == GL_INVALID_OPERATION);
    glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STREAM_DRAW); glDrawArrays(GL_TRIANGLES, 0, 3);
    unsigned char px[4] = {0}; glReadPixels(16, 16, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
    check("draw after re-specification", glGetError() == GL_NO_ERROR);
    /* Pixels need a rasterizing backend (browser specs check this line; the unit recorder does not draw). */
    /* vK66: copies, indexed bindings, a uniform-block draw and a feedback capture on a zero-size store. */
    GLuint z[3]; glGenBuffers(3, z);
    glBindBuffer(GL_COPY_READ_BUFFER, z[0]); glBufferData(GL_COPY_READ_BUFFER, 0, 0, GL_STREAM_DRAW);
    glBindBuffer(GL_COPY_WRITE_BUFFER, z[1]); glBufferData(GL_COPY_WRITE_BUFFER, 16, 0, GL_STREAM_DRAW);
    glCopyBufferSubData(GL_COPY_READ_BUFFER, GL_COPY_WRITE_BUFFER, 0, 0, 4); check("copy from a zero-size store", glGetError() == GL_INVALID_VALUE);
    glCopyBufferSubData(GL_COPY_READ_BUFFER, GL_COPY_WRITE_BUFFER, 0, 0, 0); check("empty copy from a zero-size store", glGetError() == GL_NO_ERROR);
    glBindBufferRange(GL_UNIFORM_BUFFER, 0, z[0], 0, 16); check("uniform range on a zero-size store", glGetError() == GL_INVALID_VALUE);
    GLuint up = glCreateProgram();
    glAttachShader(up, shader(GL_VERTEX_SHADER, "#version 330 core\nlayout(location=0) in vec2 pos;void main(){gl_Position=vec4(pos,0.0,1.0);}"));
    glAttachShader(up, shader(GL_FRAGMENT_SHADER, "#version 330 core\nlayout(std140) uniform Tint{vec4 tint;};layout(location=0) out vec4 color;void main(){color=tint;}"));
    glLinkProgram(up); glUniformBlockBinding(up, glGetUniformBlockIndex(up, "Tint"), 0);
    glBindBufferBase(GL_UNIFORM_BUFFER, 0, z[0]); check("uniform base binding of a zero-size store", glGetError() == GL_NO_ERROR);
    glUseProgram(up); glDrawArrays(GL_TRIANGLES, 0, 3); check("uniform-block draw from a zero-size store", glGetError() == GL_INVALID_OPERATION);
    glBindBufferBase(GL_UNIFORM_BUFFER, 0, 0);
    GLuint tp = glCreateProgram(); const char *varying = "o";
    glAttachShader(tp, shader(GL_VERTEX_SHADER, "#version 330 core\nlayout(location=0) in vec2 pos;out vec2 o;void main(){o=pos;gl_Position=vec4(pos,0.0,1.0);}"));
    glTransformFeedbackVaryings(tp, 1, &varying, GL_INTERLEAVED_ATTRIBS); glLinkProgram(tp);
    glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER, z[2]); glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER, 0, 0, GL_STREAM_READ);
    glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER, 0, z[2], 0, 16); check("feedback range on a zero-size store", glGetError() == GL_INVALID_VALUE);
    glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER, 0, z[2]); glUseProgram(tp); glEnable(GL_RASTERIZER_DISCARD);
    glBeginTransformFeedback(GL_TRIANGLES); check("feedback capture into a zero-size store", glGetError() == GL_INVALID_OPERATION);
    glDisable(GL_RASTERIZER_DISCARD); glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER, 0, 0); glUseProgram(p);
    char text[160]; snprintf(text, sizeof text, "zero checks=%u failed=%u pixel=%u,%u,%u,%u", checks, failed, px[0], px[1], px[2], px[3]);
    OutputDebugStringA(text);
    /* vK66: a deferred in-place re-specification, then a zero-size orphan of the same store, in one batch. A host that
     * rejects that batch (unit test: "zero inject") replays it per call: the update fails (GL_OUT_OF_MEMORY) and the
     * orphan's journaled size change must survive, exactly as unbatched calls would leave it. */
    GLuint r; glGenBuffers(1, &r); glBindBuffer(GL_ARRAY_BUFFER, r); glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STREAM_DRAW); glGetError();
    OutputDebugStringA("zero inject");
    glBufferData(GL_ARRAY_BUFFER, 16, v, GL_STREAM_DRAW); glBufferData(GL_ARRAY_BUFFER, 0, 0, GL_STREAM_DRAW);
    GLenum replay_error = glGetError(); GLint replay_size = size_of(GL_ARRAY_BUFFER);
    OutputDebugStringA("zero restore");
    snprintf(text, sizeof text, "zero replay size=%d error=0x%x", (int)replay_size, (unsigned)replay_error); OutputDebugStringA(text);
    glBindBuffer(GL_ARRAY_BUFFER, b[0]);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, b[1]);
    for (unsigned frame = 0;; frame++) {
        glClearColor(0, 0, frame & 1, 1); glClear(GL_COLOR_BUFFER_BIT);
        for (unsigned i = 0; i < 40; i++) {
            glBufferData(GL_ARRAY_BUFFER, 0, 0, GL_STREAM_DRAW); glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STREAM_DRAW);
            glBufferData(GL_ELEMENT_ARRAY_BUFFER, 0, 0, GL_STREAM_DRAW); glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof idx, idx, GL_STREAM_DRAW);
            glDrawElements(GL_TRIANGLES, 3, GL_UNSIGNED_SHORT, 0);
        }
        if (glGetError() != GL_NO_ERROR) OutputDebugStringA("zero FAIL frame error");
        SwapBuffers(dc);
    }
}
