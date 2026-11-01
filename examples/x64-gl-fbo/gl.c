/* Original CC0-1.0 fixture. Real -O2/CRT Win64 program; no BGT imports or overrides.
 * Exercises GL 3.3 texture and framebuffer contracts through the §13 GPU layer: depth-texture FBO then sampling,
 * depth-stencil renderbuffer, float texture parameters, 3D and 2D-array textures, explicit mip levels, packed and
 * float formats, multiple colour attachments, completeness status codes, GL error codes and read-back checks.
 * The guest verifies exact stored values itself (GetTexImage / ReadPixels); the browser tests additionally probe the
 * eight screen tiles on WebGL 2 and WebGPU. */
#include <windows.h>
#include <GL/glcorearb.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#define GLFUNCS \
    X(PFNGLACTIVETEXTUREPROC, glActiveTexture) X(PFNGLATTACHSHADERPROC, glAttachShader) \
    X(PFNGLBINDBUFFERPROC, glBindBuffer) X(PFNGLBINDFRAMEBUFFERPROC, glBindFramebuffer) \
    X(PFNGLBINDRENDERBUFFERPROC, glBindRenderbuffer) X(PFNGLBINDTEXTUREPROC, glBindTexture) \
    X(PFNGLBINDVERTEXARRAYPROC, glBindVertexArray) X(PFNGLBUFFERDATAPROC, glBufferData) \
    X(PFNGLCHECKFRAMEBUFFERSTATUSPROC, glCheckFramebufferStatus) X(PFNGLCLEARPROC, glClear) \
    X(PFNGLCLEARCOLORPROC, glClearColor) X(PFNGLCLEARDEPTHPROC, glClearDepth) X(PFNGLCLEARSTENCILPROC, glClearStencil) \
    X(PFNGLCOMPILESHADERPROC, glCompileShader) X(PFNGLCREATEPROGRAMPROC, glCreateProgram) \
    X(PFNGLCREATESHADERPROC, glCreateShader) X(PFNGLDEPTHFUNCPROC, glDepthFunc) X(PFNGLDEPTHMASKPROC, glDepthMask) \
    X(PFNGLDISABLEPROC, glDisable) X(PFNGLDRAWARRAYSPROC, glDrawArrays) X(PFNGLDRAWBUFFERPROC, glDrawBuffer) \
    X(PFNGLDRAWBUFFERSPROC, glDrawBuffers) X(PFNGLENABLEPROC, glEnable) \
    X(PFNGLENABLEVERTEXATTRIBARRAYPROC, glEnableVertexAttribArray) \
    X(PFNGLFRAMEBUFFERRENDERBUFFERPROC, glFramebufferRenderbuffer) \
    X(PFNGLFRAMEBUFFERTEXTURE2DPROC, glFramebufferTexture2D) X(PFNGLGENBUFFERSPROC, glGenBuffers) \
    X(PFNGLGENFRAMEBUFFERSPROC, glGenFramebuffers) X(PFNGLGENRENDERBUFFERSPROC, glGenRenderbuffers) \
    X(PFNGLGENTEXTURESPROC, glGenTextures) X(PFNGLGENVERTEXARRAYSPROC, glGenVertexArrays) \
    X(PFNGLGENERATEMIPMAPPROC, glGenerateMipmap) X(PFNGLGETERRORPROC, glGetError) \
    X(PFNGLGETFRAMEBUFFERATTACHMENTPARAMETERIVPROC, glGetFramebufferAttachmentParameteriv) \
    X(PFNGLGETINTEGERVPROC, glGetIntegerv) X(PFNGLGETPROGRAMINFOLOGPROC, glGetProgramInfoLog) \
    X(PFNGLGETPROGRAMIVPROC, glGetProgramiv) X(PFNGLGETRENDERBUFFERPARAMETERIVPROC, glGetRenderbufferParameteriv) \
    X(PFNGLGETSHADERINFOLOGPROC, glGetShaderInfoLog) X(PFNGLGETSHADERIVPROC, glGetShaderiv) \
    X(PFNGLGETTEXIMAGEPROC, glGetTexImage) X(PFNGLGETTEXLEVELPARAMETERIVPROC, glGetTexLevelParameteriv) \
    X(PFNGLGETTEXPARAMETERFVPROC, glGetTexParameterfv) X(PFNGLGETTEXPARAMETERIVPROC, glGetTexParameteriv) \
    X(PFNGLGETUNIFORMLOCATIONPROC, glGetUniformLocation) X(PFNGLLINKPROGRAMPROC, glLinkProgram) \
    X(PFNGLGETACTIVEUNIFORMPROC, glGetActiveUniform) X(PFNGLGETUNIFORMIVPROC, glGetUniformiv) \
    X(PFNGLPIXELSTOREIPROC, glPixelStorei) X(PFNGLREADBUFFERPROC, glReadBuffer) X(PFNGLREADPIXELSPROC, glReadPixels) \
    X(PFNGLRENDERBUFFERSTORAGEPROC, glRenderbufferStorage) X(PFNGLSHADERSOURCEPROC, glShaderSource) \
    X(PFNGLSTENCILFUNCPROC, glStencilFunc) X(PFNGLSTENCILOPPROC, glStencilOp) X(PFNGLTEXIMAGE2DPROC, glTexImage2D) \
    X(PFNGLTEXIMAGE3DPROC, glTexImage3D) X(PFNGLTEXPARAMETERFPROC, glTexParameterf) \
    X(PFNGLTEXPARAMETERFVPROC, glTexParameterfv) X(PFNGLTEXPARAMETERIPROC, glTexParameteri) \
    X(PFNGLTEXSUBIMAGE2DPROC, glTexSubImage2D) X(PFNGLTEXSUBIMAGE3DPROC, glTexSubImage3D) \
    X(PFNGLUNIFORM1IPROC, glUniform1i) X(PFNGLUNIFORM4FPROC, glUniform4f) X(PFNGLUSEPROGRAMPROC, glUseProgram) \
    X(PFNGLVERTEXATTRIBPOINTERPROC, glVertexAttribPointer) X(PFNGLVIEWPORTPROC, glViewport) \
    X(PFNGLSAMPLERPARAMETERIPROC, glSamplerParameteri) X(PFNGLGENSAMPLERSPROC, glGenSamplers) \
    X(PFNGLBINDSAMPLERPROC, glBindSampler)
#define X(type, name) static type name;
GLFUNCS
#undef X
static void load_gl(void) {
#define X(type, name) name = (type)wglGetProcAddress(#name);
    GLFUNCS
#undef X
}

static unsigned failures;
static void note(const char *name, int ok) {
    char message[160];
    snprintf(message, sizeof message, "x64-gl-fbo %s %s", ok ? "ok" : "FAIL", name);
    OutputDebugStringA(message);
    if (!ok) failures++;
}
static void expect_error(GLenum expected, const char *name) {
    GLenum e = glGetError(), again = glGetError();
    char message[120]; snprintf(message, sizeof message, "error %s (got %04x want %04x)", name, e, expected);
    note(message, e == expected && again == GL_NO_ERROR);
}
static void expect_status(GLenum expected, const char *name) {
    GLenum s = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    char message[120]; snprintf(message, sizeof message, "status %s (got %04x want %04x)", name, s, expected);
    note(message, s == expected);
    glGetError();
}
static GLuint shader(GLenum stage, const char *source) {
    GLuint id = glCreateShader(stage); glShaderSource(id, 1, &source, 0); glCompileShader(id);
    GLint ok = 0; glGetShaderiv(id, GL_COMPILE_STATUS, &ok);
    if (!ok) { char log[4096]; glGetShaderInfoLog(id, sizeof log, 0, log); OutputDebugStringA(log); ExitProcess(10); }
    return id;
}
static const char *vs_source = "#version 330 core\n"
    "layout(location=0) in vec2 position; layout(location=1) in vec2 uv; out vec2 tc;"
    "uniform vec4 place; uniform vec4 depth_z; uniform vec4 uvs;"
    "void main(){ tc=uv*uvs.xy; gl_Position=vec4(position*place.zw+place.xy,depth_z.x,1.0); }";
static GLuint program(const char *fs_source) {
    GLuint p = glCreateProgram(), v = shader(GL_VERTEX_SHADER, vs_source), f = shader(GL_FRAGMENT_SHADER, fs_source);
    glAttachShader(p, v); glAttachShader(p, f); glLinkProgram(p);
    GLint ok = 0; glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) { char log[4096]; glGetProgramInfoLog(p, sizeof log, 0, log); OutputDebugStringA(log); ExitProcess(11); }
    return p;
}
static GLuint p_tex, p_vol, p_arr, p_flat, p_mrt;
static GLint loc_place[5], loc_depth[5], loc_uvs[5];
static GLuint programs[5];
static void bind_program(unsigned i) {
    glUseProgram(programs[i]);
    loc_place[i] = glGetUniformLocation(programs[i], "place");
    loc_depth[i] = glGetUniformLocation(programs[i], "depth_z");
    loc_uvs[i] = glGetUniformLocation(programs[i], "uvs");
}
static void quad(unsigned prog, float x, float y, float w, float h, float z, float us, float vs) {
    glUniform4f(loc_place[prog], x, y, w, h); glUniform4f(loc_depth[prog], z, 0, 0, 0);
    glUniform4f(loc_uvs[prog], us, vs, 0, 0); glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}
static GLint tint_loc, zsel_loc;
static void set_tint(float r, float g, float b, float a) { glUniform4f(tint_loc, r, g, b, a); }
static void tile(int index) {
    glViewport((index % 4) * 80, (1 - index / 4) * 100, 80, 100);
}
static int near_byte(int a, int b, int tolerance) { return a >= b - tolerance && a <= b + tolerance; }

int main(void) {
    WNDCLASSA cls = {0}; cls.lpfnWndProc = DefWindowProcA; cls.lpszClassName = "GLFboFixture";
    RegisterClassA(&cls);
    HWND window = CreateWindowExA(0, cls.lpszClassName, "OpenGL", WS_VISIBLE | WS_POPUP, 0, 0, 320, 200, 0, 0, 0, 0);
    HDC dc = GetDC(window); PIXELFORMATDESCRIPTOR desc = {0}; desc.nSize = sizeof desc; desc.nVersion = 1;
    desc.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    desc.cColorBits = 32; desc.cDepthBits = 24; desc.cStencilBits = 8;
    int format = ChoosePixelFormat(dc, &desc); SetPixelFormat(dc, format, &desc);
    HGLRC context = wglCreateContext(dc);
    if (!context) { OutputDebugStringA("x64-gl-fbo GPU unavailable"); for (;;) Sleep(16); }
    wglMakeCurrent(dc, context); load_gl();

    p_tex = program("#version 330 core\nin vec2 tc; layout(location=0) out vec4 color; uniform sampler2D img;"
        "uniform vec4 tint; uniform vec4 zsel; void main(){ color=textureLod(img,tc,zsel.y)*tint; }");
    p_vol = program("#version 330 core\nin vec2 tc; layout(location=0) out vec4 color; uniform sampler3D vol;"
        "uniform vec4 zsel; void main(){ color=texture(vol,vec3(tc,zsel.x),zsel.y); }");
    p_arr = program("#version 330 core\nin vec2 tc; layout(location=0) out vec4 color; uniform sampler2DArray arr;"
        "uniform vec4 zsel; void main(){ color=texture(arr,vec3(tc,zsel.x),zsel.y); }");
    p_flat = program("#version 330 core\nin vec2 tc; layout(location=0) out vec4 color; uniform vec4 tint;"
        "void main(){ color=tint; }");
    p_mrt = program("#version 330 core\nin vec2 tc; layout(location=0) out vec4 c0; layout(location=1) out vec4 c1;"
        "void main(){ c0=vec4(1.0,0.0,0.0,1.0); c1=vec4(0.0,1.0,0.0,1.0); }");
    programs[0] = p_tex; programs[1] = p_vol; programs[2] = p_arr; programs[3] = p_flat; programs[4] = p_mrt;
    GLint tint_tex = 0, zsel_tex = 0;
    GLuint vao, vbo; glGenVertexArrays(1, &vao); glBindVertexArray(vao);
    const GLfloat vertices[] = {-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1};
    glGenBuffers(1, &vbo); glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof vertices, vertices, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 16, 0); glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 16, (void *)8); glEnableVertexAttribArray(1);
    for (unsigned i = 0; i < 5; i++) bind_program(i);
    glUseProgram(p_tex); tint_tex = glGetUniformLocation(p_tex, "tint"); zsel_tex = glGetUniformLocation(p_tex, "zsel");
    (void)tint_tex; (void)zsel_tex;
    GLint zsel_vol = glGetUniformLocation(p_vol, "zsel"), zsel_arr = glGetUniformLocation(p_arr, "zsel");
    GLint tint_flat = glGetUniformLocation(p_flat, "tint");
    /* Integration regression: reflection must retain the GL sampler type while bindings
     * use nonzero texture units (not the canonical shader slot). */
    const GLuint dimensional_programs[] = {p_vol, p_arr};
    const GLenum dimensional_types[] = {GL_SAMPLER_3D, GL_SAMPLER_2D_ARRAY};
    const char *dimensional_names[] = {"vol", "arr"};
    const GLint dimensional_units[] = {3, 5};
    for (unsigned i = 0; i < 2; i++) {
        GLint count = 0, found = 0; glGetProgramiv(dimensional_programs[i], GL_ACTIVE_UNIFORMS, &count);
        for (GLint j = 0; j < count; j++) {
            char name[80]; GLint size = 0; GLenum type = 0;
            glGetActiveUniform(dimensional_programs[i], (GLuint)j, sizeof name, 0, &size, &type, name);
            if (!strcmp(name, dimensional_names[i])) found = size == 1 && type == dimensional_types[i];
        }
        note(i ? "sampler2DArray reflection" : "sampler3D reflection", found);
        glUseProgram(dimensional_programs[i]);
        GLint loc = glGetUniformLocation(dimensional_programs[i], dimensional_names[i]), value = -1;
        glUniform1i(loc, dimensional_units[i]); glGetUniformiv(dimensional_programs[i], loc, &value);
        note(i ? "sampler2DArray unit 5" : "sampler3D unit 3", value == dimensional_units[i]);
    }
    expect_error(GL_NO_ERROR, "setup");

    /* ---- Tile 0: depth-only FBO with a DEPTH_COMPONENT24 texture allocated with NULL data ---- */
    GLuint depth_tex, depth_fbo;
    glGenTextures(1, &depth_tex); glBindTexture(GL_TEXTURE_2D, depth_tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, 64, 64, 0, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, 0);
    expect_error(GL_NO_ERROR, "null depth storage");
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenFramebuffers(1, &depth_fbo); glBindFramebuffer(GL_FRAMEBUFFER, depth_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, depth_tex, 0);
    expect_status(GL_FRAMEBUFFER_INCOMPLETE_DRAW_BUFFER, "depth-only keeps colour draw buffer");
    glDrawBuffer(GL_NONE);
    expect_status(GL_FRAMEBUFFER_INCOMPLETE_READ_BUFFER, "depth-only keeps colour read buffer");
    glReadBuffer(GL_NONE);
    expect_status(GL_FRAMEBUFFER_COMPLETE, "depth-only");
    GLint size = 0;
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE, &size);
    note("attachment type texture", size == GL_TEXTURE);
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE, &size);
    note("attachment depth size >= 24", size >= 24);
    glGetTexLevelParameteriv(GL_TEXTURE_2D, 0, GL_TEXTURE_INTERNAL_FORMAT, &size);
    note("depth internal format query", size == GL_DEPTH_COMPONENT24);
    glGetTexLevelParameteriv(GL_TEXTURE_2D, 0, GL_TEXTURE_DEPTH_SIZE, &size);
    note("depth size query", size >= 24);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    /* ---- Tile 1: colour texture + DEPTH24_STENCIL8 renderbuffer ---- */
    GLuint ds_color, ds_fbo, ds_rbo;
    glGenTextures(1, &ds_color); glBindTexture(GL_TEXTURE_2D, ds_color);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 64, 64, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenRenderbuffers(1, &ds_rbo); glBindRenderbuffer(GL_RENDERBUFFER, ds_rbo);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, 64, 64);
    glGenFramebuffers(1, &ds_fbo); glBindFramebuffer(GL_FRAMEBUFFER, ds_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, ds_color, 0);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, ds_rbo);
    expect_status(GL_FRAMEBUFFER_COMPLETE, "colour + depth-stencil renderbuffer");
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_STENCIL_SIZE, &size); note("rbo stencil size", size == 8);
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_INTERNAL_FORMAT, &size);
    note("rbo internal format", size == GL_DEPTH24_STENCIL8);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    /* ---- Tile 2: float texture parameters, GetTexParameter, repeat wrapping ---- */
    GLuint wrap_tex; const unsigned char two[] = {255, 0, 0, 255, 0, 0, 255, 255};
    glGenTextures(1, &wrap_tex); glBindTexture(GL_TEXTURE_2D, wrap_tex);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 2, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, two);
    glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, (float)GL_NEAREST);
    glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, (float)GL_NEAREST);
    glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, (float)GL_REPEAT);
    glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, (float)GL_CLAMP_TO_EDGE);
    const GLfloat lod_range[] = {0.0f}; glTexParameterfv(GL_TEXTURE_2D, GL_TEXTURE_MIN_LOD, lod_range);
    expect_error(GL_NO_ERROR, "float texture parameters");
    GLfloat fv = 0; GLint iv = 0;
    glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, &iv); note("min filter set through float", iv == GL_NEAREST);
    glGetTexParameterfv(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, &fv); note("wrap_s float query", fv == (float)GL_REPEAT);
    glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_WRAP_R, &iv); note("wrap_r default", iv == GL_REPEAT);
    glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_FUNC, &iv); note("compare func default", iv == GL_LEQUAL);
    /* Legal but approximated parameters must be queryable and must not produce GL errors. */
    glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, (float)GL_CLAMP_TO_BORDER);
    glGetTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, &iv);
    note("border wrap retained for query", iv == GL_CLAMP_TO_BORDER);
    glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_LOD_BIAS, 0.75f);
    glGetTexParameterfv(GL_TEXTURE_2D, GL_TEXTURE_LOD_BIAS, &fv);
    note("LOD bias retained for query", fv == 0.75f);
    expect_error(GL_NO_ERROR, "legal approximated parameters");
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
    glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_LOD_BIAS, 0.0f);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, 0x1234); expect_error(GL_INVALID_ENUM, "bad min filter");
    glTexParameteri(GL_TEXTURE_2D, 0x1234, 1); expect_error(GL_INVALID_ENUM, "bad pname");
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_BASE_LEVEL, -1); expect_error(GL_INVALID_VALUE, "negative base level");

    /* ---- Tile 3: 3D texture 2x2x4 with TexSubImage3D, Tile 4: 2D array ---- */
    GLuint volume, layers; unsigned char voxels[2 * 2 * 4 * 4];
    for (int z = 0; z < 4; z++) for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
        unsigned char *v = voxels + ((z * 2 + y) * 2 + x) * 4; v[0] = (unsigned char)(z * 60); v[1] = (unsigned char)(x * 200);
        v[2] = (unsigned char)(y * 200); v[3] = 255;
    }
    glGenTextures(1, &volume); glBindTexture(GL_TEXTURE_3D, volume);
    glTexImage3D(GL_TEXTURE_3D, 0, GL_RGBA8, 2, 2, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, voxels);
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameterf(GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, (float)GL_MIRRORED_REPEAT);
    const unsigned char white[2 * 2 * 4] = {255,255,255,255, 255,255,255,255, 255,255,255,255, 255,255,255,255};
    glTexSubImage3D(GL_TEXTURE_3D, 0, 0, 0, 2, 2, 2, 1, GL_RGBA, GL_UNSIGNED_BYTE, white);
    expect_error(GL_NO_ERROR, "3D upload");
    glGetTexLevelParameteriv(GL_TEXTURE_3D, 0, GL_TEXTURE_DEPTH, &size); note("3D depth query", size == 4);
    unsigned char back[2 * 2 * 4 * 4]; glGetTexImage(GL_TEXTURE_3D, 0, GL_RGBA, GL_UNSIGNED_BYTE, back);
    note("3D GetTexImage voxel", back[(1 * 4 + 1 * 2 + 1) * 4 + 0] == 60 && back[(1 * 4 + 1 * 2 + 1) * 4 + 1] == 200 &&
        back[(2 * 4 + 0) * 4] == 255 && back[(3 * 4) * 4] == 180);
    glTexImage3D(GL_TEXTURE_3D, 0, GL_RGBA8, 2, 2, 257, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_VALUE, "3D depth over limit");
    glTexSubImage3D(GL_TEXTURE_3D, 0, 0, 0, 3, 2, 2, 2, GL_RGBA, GL_UNSIGNED_BYTE, white); expect_error(GL_INVALID_VALUE, "3D sub region");
    glGenTextures(1, &layers); glBindTexture(GL_TEXTURE_2D_ARRAY, layers);
    const unsigned char array_pixels[] = {255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255,
                                          0,255,0,255, 0,255,0,255, 0,255,0,255, 0,255,0,255};
    glTexImage3D(GL_TEXTURE_2D_ARRAY, 0, GL_RGBA8, 2, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, array_pixels);
    glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    expect_error(GL_NO_ERROR, "array upload");
    {   /* GPU mip generation for volumes and arrays; box-filter rounding may differ by backend (+-3). */
        glBindTexture(GL_TEXTURE_3D, volume); glGenerateMipmap(GL_TEXTURE_3D); expect_error(GL_NO_ERROR, "3D mip generation");
        unsigned char top[4]; glGetTexImage(GL_TEXTURE_3D, 2, GL_RGBA, GL_UNSIGNED_BYTE, top);
        note("3D mip chain average", near_byte(top[0], 124, 3) && near_byte(top[1], 139, 3) && near_byte(top[2], 139, 3));
        glBindTexture(GL_TEXTURE_2D_ARRAY, layers); glGenerateMipmap(GL_TEXTURE_2D_ARRAY);
        unsigned char small[8]; glGetTexImage(GL_TEXTURE_2D_ARRAY, 1, GL_RGBA, GL_UNSIGNED_BYTE, small);
        note("array mip layers stay independent", small[0] == 255 && small[1] == 0 && small[4] == 0 && small[5] == 255);
        /* Distinguishable mip-1 colours make shader texture() bias observable. */
        const unsigned char biased_layers[] = {0,0,255,255, 255,255,0,255};
        glTexSubImage3D(GL_TEXTURE_2D_ARRAY, 1, 0, 0, 0, 1, 1, 2, GL_RGBA, GL_UNSIGNED_BYTE, biased_layers);
        expect_error(GL_NO_ERROR, "array explicit biased mip");
    }
    glBindTexture(GL_TEXTURE_2D, wrap_tex);
    glTexImage3D(GL_TEXTURE_2D, 0, GL_RGBA8, 2, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_ENUM, "TexImage3D 2D target");
    glBindTexture(GL_TEXTURE_3D, wrap_tex); expect_error(GL_INVALID_OPERATION, "texture name reused with another target");

    /* ---- Tile 5: explicit mip levels (each level uploaded separately) ---- */
    GLuint mips; unsigned char l0[4 * 4 * 4], l1[2 * 2 * 4] , l2[4] = {0, 0, 255, 255};
    for (int i = 0; i < 16; i++) { l0[i*4] = 255; l0[i*4+1] = 0; l0[i*4+2] = 0; l0[i*4+3] = 255; }
    for (int i = 0; i < 4; i++) { l1[i*4] = 0; l1[i*4+1] = 255; l1[i*4+2] = 0; l1[i*4+3] = 255; }
    glGenTextures(1, &mips); glBindTexture(GL_TEXTURE_2D, mips);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 4, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, l0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST_MIPMAP_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    {   /* incomplete without levels 1 and 2: GL samples (0,0,0,1) */
        GLint level_width = -1; glGetTexLevelParameteriv(GL_TEXTURE_2D, 1, GL_TEXTURE_WIDTH, &level_width);
        note("undefined level reports zero width", level_width == 0);
    }
    glTexImage2D(GL_TEXTURE_2D, 1, GL_RGBA8, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, l1);
    glTexImage2D(GL_TEXTURE_2D, 2, GL_RGBA8, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, l2);
    expect_error(GL_NO_ERROR, "explicit mip levels");
    unsigned char mip_back[16]; glGetTexImage(GL_TEXTURE_2D, 1, GL_RGBA, GL_UNSIGNED_BYTE, mip_back);
    note("level 1 reads back as uploaded", mip_back[0] == 0 && mip_back[1] == 255 && mip_back[2] == 0);
    glGetTexImage(GL_TEXTURE_2D, 2, GL_RGBA, GL_UNSIGNED_BYTE, mip_back);
    note("level 2 reads back as uploaded", mip_back[0] == 0 && mip_back[1] == 0 && mip_back[2] == 255);

    /* ---- Tile 6: RGBA16F render target and RGB10_A2 upload ---- */
    GLuint half_tex, half_fbo, packed_tex;
    glGenTextures(1, &half_tex); glBindTexture(GL_TEXTURE_2D, half_tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA16F, 8, 8, 0, GL_RGBA, GL_FLOAT, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenFramebuffers(1, &half_fbo); glBindFramebuffer(GL_FRAMEBUFFER, half_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, half_tex, 0);
    expect_status(GL_FRAMEBUFFER_COMPLETE, "RGBA16F colour");
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glGenTextures(1, &packed_tex); glBindTexture(GL_TEXTURE_2D, packed_tex);
    const unsigned int packed_pixel = 1023u | (512u << 10) | (0u << 20) | (3u << 30);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB10_A2, 1, 1, 0, GL_RGBA, GL_UNSIGNED_INT_2_10_10_10_REV, &packed_pixel);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    expect_error(GL_NO_ERROR, "RGB10_A2 upload");
    unsigned int packed_back = 0; glGetTexImage(GL_TEXTURE_2D, 0, GL_RGBA, GL_UNSIGNED_INT_2_10_10_10_REV, &packed_back);
    note("RGB10_A2 round trip", packed_back == packed_pixel);
    glGetTexLevelParameteriv(GL_TEXTURE_2D, 0, GL_TEXTURE_ALPHA_SIZE, &size); note("RGB10_A2 alpha size", size == 2);

    /* ---- Tile 7: two colour attachments with DrawBuffers ---- */
    GLuint mrt0, mrt1, mrt_fbo;
    glGenTextures(1, &mrt0); glBindTexture(GL_TEXTURE_2D, mrt0);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 16, 16, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenTextures(1, &mrt1); glBindTexture(GL_TEXTURE_2D, mrt1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 16, 16, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenFramebuffers(1, &mrt_fbo); glBindFramebuffer(GL_FRAMEBUFFER, mrt_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, mrt0, 0);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT1, GL_TEXTURE_2D, mrt1, 0);
    const GLenum both[] = {GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1};
    glDrawBuffers(2, both); expect_status(GL_FRAMEBUFFER_COMPLETE, "two colour attachments");
    const GLenum dup[] = {GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT0}; glDrawBuffers(2, dup); expect_error(GL_INVALID_OPERATION, "duplicate draw buffer");
    const GLenum five[5] = {0}; glDrawBuffers(5, five); expect_error(GL_INVALID_VALUE, "five draw buffers");
    glDrawBuffer(GL_BACK); expect_error(GL_INVALID_OPERATION, "default-framebuffer buffer on FBO");
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0 + 4, GL_TEXTURE_2D, mrt0, 0); expect_error(GL_INVALID_OPERATION, "attachment beyond maximum");
    glFramebufferTexture2D(GL_FRAMEBUFFER, 0x1234, GL_TEXTURE_2D, mrt0, 0); expect_error(GL_INVALID_ENUM, "bad attachment enum");
    glDrawBuffers(2, both);

    /* ---- Completeness failures ---- */
    GLuint odd_fbo, odd_tex, odd_rbo; glGenFramebuffers(1, &odd_fbo); glBindFramebuffer(GL_FRAMEBUFFER, odd_fbo);
    expect_status(GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT, "empty");
    glGenTextures(1, &odd_tex); glBindTexture(GL_TEXTURE_2D, odd_tex);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, odd_tex, 0);
    expect_status(GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT, "texture without storage");
    glClear(GL_COLOR_BUFFER_BIT); expect_error(GL_INVALID_FRAMEBUFFER_OPERATION, "clear on incomplete framebuffer");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 32, 32, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    expect_status(GL_FRAMEBUFFER_COMPLETE, "storage allocated afterwards");
    glGenRenderbuffers(1, &odd_rbo); glBindRenderbuffer(GL_RENDERBUFFER, odd_rbo);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, 16, 16);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, odd_rbo);
    expect_status(GL_FRAMEBUFFER_UNSUPPORTED, "attachments of different sizes");
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT1, GL_RENDERBUFFER, odd_rbo);
    expect_status(GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT, "depth renderbuffer at a colour point");
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT1, GL_RENDERBUFFER, 0);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, 32, 32);
    expect_status(GL_FRAMEBUFFER_COMPLETE, "matching depth renderbuffer");
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, odd_tex, 0);
    expect_status(GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT, "colour texture at the depth point");
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, odd_tex, 0); expect_error(GL_INVALID_OPERATION, "attach to default framebuffer");

    {   const GLenum back = GL_BACK, back_left = GL_BACK_LEFT;
        glDrawBuffers(1, &back); expect_error(GL_INVALID_ENUM, "DrawBuffers rejects aggregate BACK");
        glReadBuffer(GL_FRONT_AND_BACK); expect_error(GL_INVALID_ENUM, "ReadBuffer rejects FRONT_AND_BACK");
        glDrawBuffers(1, &back_left); expect_error(GL_NO_ERROR, "DrawBuffers accepts BACK_LEFT");
        glDrawBuffer(GL_BACK);
    }

    /* ---- Texture image errors ---- */
    glBindTexture(GL_TEXTURE_2D, odd_tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, 4, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_OPERATION, "colour data for depth format");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 4, 4, 0, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, 0); expect_error(GL_INVALID_OPERATION, "depth data for colour format");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH24_STENCIL8, 4, 4, 0, GL_DEPTH_STENCIL, GL_UNSIGNED_INT_24_8, 0);
    expect_error(GL_NO_ERROR, "null depth-stencil texture storage");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH24_STENCIL8, 4, 4, 0, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, 0);
    expect_error(GL_INVALID_OPERATION, "depth-only data for depth-stencil storage");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, 4, 4, 0, GL_DEPTH_STENCIL, GL_UNSIGNED_INT_24_8, 0);
    expect_error(GL_INVALID_OPERATION, "depth-stencil data for depth-only storage");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 4, 4, 0, GL_RGBA, GL_UNSIGNED_SHORT_5_6_5, 0); expect_error(GL_INVALID_OPERATION, "packed type with RGBA");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 4, 4, 0, 0xffff, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_ENUM, "bad format");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 4, 4, 0, GL_RGBA, 0xffff, 0); expect_error(GL_INVALID_ENUM, "bad type");
    glTexImage2D(GL_TEXTURE_2D, 0, 0x1234, 4, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_VALUE, "bad internal format");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 4, 4, 1, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_VALUE, "border");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, -1, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_VALUE, "negative width");
    glTexImage2D(GL_TEXTURE_2D, 99, GL_RGBA8, 4, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_VALUE, "level too large");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 8192, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_VALUE, "width over limit");
    glTexImage2D(GL_TEXTURE_2D, 0, 0x8235 /* GL_R32I */, 4, 4, 0, 0x8d94, GL_INT, 0);
    expect_error(GL_NO_ERROR, "integer format allocation");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 4, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); glGetError();
    glTexSubImage2D(GL_TEXTURE_2D, 0, 2, 2, 4, 4, GL_RGBA, GL_UNSIGNED_BYTE, l0); expect_error(GL_INVALID_VALUE, "sub-image beyond level");
    glTexSubImage2D(GL_TEXTURE_2D, 3, 0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, l0); expect_error(GL_INVALID_OPERATION, "sub-image of undefined level");
    glTexImage2D(GL_TEXTURE_2D, 1, GL_RGBA8, 4096, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
    expect_error(GL_INVALID_VALUE, "mip size over level limit");
    {   /* Pixel-store strides/skips, row orientation, and RGB's implicit alpha=1. */
        unsigned char source[24] = {0}, result[24];
        source[16] = 51; source[17] = 102; source[18] = 153; source[19] = 7;
        glPixelStorei(GL_UNPACK_ROW_LENGTH, 3); glPixelStorei(GL_UNPACK_SKIP_ROWS, 1);
        glPixelStorei(GL_UNPACK_SKIP_PIXELS, 1);
        glPixelStorei(GL_UNPACK_SKIP_IMAGES, 7); glPixelStorei(GL_UNPACK_IMAGE_HEIGHT, 9); /* ignored for 2D */
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB8, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, source);
        glPixelStorei(GL_UNPACK_ROW_LENGTH, 0); glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
        glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
        glPixelStorei(GL_UNPACK_SKIP_IMAGES, 0); glPixelStorei(GL_UNPACK_IMAGE_HEIGHT, 0);
        memset(result, 0xcc, sizeof result);
        glPixelStorei(GL_PACK_ROW_LENGTH, 3); glPixelStorei(GL_PACK_SKIP_ROWS, 1);
        glPixelStorei(GL_PACK_SKIP_PIXELS, 1);
        glPixelStorei(GL_PACK_SKIP_IMAGES, 7); glPixelStorei(GL_PACK_IMAGE_HEIGHT, 9); /* ignored for 2D */
        glGetTexImage(GL_TEXTURE_2D, 0, GL_RGBA, GL_UNSIGNED_BYTE, result);
        glPixelStorei(GL_PACK_ROW_LENGTH, 0); glPixelStorei(GL_PACK_SKIP_ROWS, 0);
        glPixelStorei(GL_PACK_SKIP_PIXELS, 0);
        glPixelStorei(GL_PACK_SKIP_IMAGES, 0); glPixelStorei(GL_PACK_IMAGE_HEIGHT, 0);
        note("pixel-store skips and RGB alpha", result[16] == 51 && result[17] == 102 && result[18] == 153 &&
            result[19] == 255 && result[15] == 0xcc && result[20] == 0xcc);
        expect_error(GL_NO_ERROR, "pixel-store round trip");
    }
    glBindTexture(GL_TEXTURE_2D, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); expect_error(GL_INVALID_OPERATION, "parameter on texture 0");
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 4, 4, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0); expect_error(GL_INVALID_OPERATION, "image on texture 0");

    /* ---- FBO content checks (rendered then read back) ---- */
    glEnable(GL_DEPTH_TEST); glDepthFunc(GL_LESS);
    unsigned frame = 0;
    for (;;) {
        /* Offscreen: depth texture gets two quads, nearer on the left half. */
        glBindFramebuffer(GL_FRAMEBUFFER, depth_fbo); glViewport(0, 0, 64, 64);
        glClearDepth(1.0); glEnable(GL_DEPTH_TEST); glDepthMask(GL_TRUE); glClear(GL_DEPTH_BUFFER_BIT);
        glUseProgram(p_flat); tint_loc = tint_flat; set_tint(1, 1, 1, 1);
        glBindTexture(GL_TEXTURE_2D, 0);
        quad(3, 0, 0, 1, 1, 0.5f, 1, 1);
        quad(3, -0.5f, 0, 0.5f, 1, -0.5f, 1, 1);
        /* Colour + depth-stencil: stencil marks the left half, green fill only where marked. */
        glBindFramebuffer(GL_FRAMEBUFFER, ds_fbo); glViewport(0, 0, 64, 64);
        glClearColor(0, 0, 0.6f, 1); glClearStencil(0); glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
        glEnable(GL_STENCIL_TEST); glStencilFunc(GL_ALWAYS, 1, 255); glStencilOp(GL_KEEP, GL_KEEP, GL_REPLACE);
        set_tint(1, 0, 0, 1); quad(3, -0.5f, 0, 0.5f, 1, 0.1f, 1, 1);
        glStencilFunc(GL_EQUAL, 1, 255); glStencilOp(GL_KEEP, GL_KEEP, GL_KEEP);
        set_tint(0, 1, 0, 1); quad(3, 0, 0, 1, 1, 0.0f, 1, 1);
        glDisable(GL_STENCIL_TEST);
        /* RGBA16F target accepts values above one. */
        glBindFramebuffer(GL_FRAMEBUFFER, half_fbo); glViewport(0, 0, 8, 8);
        glDisable(GL_DEPTH_TEST); glClearColor(1.5f, 0.25f, -0.5f, 1); glClear(GL_COLOR_BUFFER_BIT);
        /* Two colour attachments. */
        glBindFramebuffer(GL_FRAMEBUFFER, mrt_fbo); glViewport(0, 0, 16, 16); glDrawBuffers(2, both);
        glUseProgram(p_mrt); quad(4, 0, 0, 1, 1, 0, 1, 1);
        if (frame == 0) {
            const GLenum none[] = {GL_NONE, GL_NONE}; glDrawBuffers(2, none);
            quad(4, 0, 0, 1, 1, 0, 1, 1); /* two discarded outputs need distinct §13 scratch attachments */
            expect_error(GL_NO_ERROR, "two disabled draw buffers"); glDrawBuffers(2, both);
        }
        glBindFramebuffer(GL_FRAMEBUFFER, 0);

        if (frame == 0) {
            float f[4]; glBindFramebuffer(GL_READ_FRAMEBUFFER, half_fbo);
            glReadPixels(3, 3, 1, 1, GL_RGBA, GL_FLOAT, f);
            note("RGBA16F values above one survive", f[0] == 1.5f && f[1] == 0.25f && f[2] == -0.5f && f[3] == 1.0f);
            unsigned char px[4];
            glBindFramebuffer(GL_READ_FRAMEBUFFER, ds_fbo); glReadPixels(8, 32, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
            note("stencil-marked half is green", px[0] == 0 && px[1] == 255 && px[2] == 0);
            unsigned char clipped[24]; memset(clipped, 0xcc, sizeof clipped);
            glReadPixels(-1, 31, 3, 2, GL_RGBA, GL_UNSIGNED_BYTE, clipped);
            note("clipped read preserves requested row stride", clipped[0] == 0xcc && clipped[12] == 0xcc &&
                clipped[5] == 255 && clipped[9] == 255 && clipped[17] == 255 && clipped[21] == 255);
            glReadPixels(56, 32, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
            note("unmarked half keeps clear colour", px[0] == 0 && px[1] == 0 && near_byte(px[2], 153, 1));
            glBindFramebuffer(GL_READ_FRAMEBUFFER, mrt_fbo); glReadBuffer(GL_COLOR_ATTACHMENT1); glReadPixels(4, 4, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
            note("attachment 1 receives output 1", px[0] == 0 && px[1] == 255);
            glReadBuffer(GL_COLOR_ATTACHMENT0); glReadPixels(4, 4, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
            note("attachment 0 receives output 0", px[0] == 255 && px[1] == 0);
            glBindFramebuffer(GL_READ_FRAMEBUFFER, depth_fbo); glReadBuffer(GL_NONE);
            glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px); expect_error(GL_INVALID_OPERATION, "read with GL_NONE read buffer");
            glBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
            glReadPixels(0, 0, 1, 1, GL_DEPTH_COMPONENT, GL_FLOAT, f); glGetError();
            glGetIntegerv(GL_MAX_COLOR_ATTACHMENTS, &iv); note("max colour attachments", iv == 4);
            glGetIntegerv(GL_MAX_DRAW_BUFFERS, &iv); note("max draw buffers", iv == 4);
            glGetIntegerv(GL_MAX_3D_TEXTURE_SIZE, &iv); note("max 3D size", iv >= 256);
            note("no GL error remains", glGetError() == GL_NO_ERROR);
            char summary[96]; snprintf(summary, sizeof summary, "x64-gl-fbo %s failures=%u", failures ? "FAIL" : "PASS", failures);
            OutputDebugStringA(summary);
        }

        /* Screen: eight tiles. */
        glClearColor(0.05f, 0.05f, 0.1f, 1); glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        glDisable(GL_DEPTH_TEST);
        glActiveTexture(GL_TEXTURE0);
        glUseProgram(p_tex); tint_loc = tint_tex; zsel_loc = zsel_tex; set_tint(1, 1, 1, 1);
        glUniform4f(zsel_tex, 0, 0, 0, 0);
        tile(0); glBindTexture(GL_TEXTURE_2D, depth_tex); quad(0, 0, 0, 1, 1, 0, 1, 1);
        tile(1); glBindTexture(GL_TEXTURE_2D, ds_color); quad(0, 0, 0, 1, 1, 0, 1, 1);
        tile(2); glBindTexture(GL_TEXTURE_2D, wrap_tex); quad(0, 0, 0, 1, 1, 0, 2, 1);
        tile(5); glBindTexture(GL_TEXTURE_2D, mips); glUniform4f(zsel_tex, 0, 1, 0, 0); quad(0, -0.6666667f, 0, 0.3333333f, 1, 0, 1, 1);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 1); glUniform4f(zsel_tex, 0, 2, 0, 0);
        quad(0, 0, 0, 0.3333333f, 1, 0, 1, 1); /* explicit LOD cannot exceed MAX_LEVEL */
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_BASE_LEVEL, 1);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glUniform4f(zsel_tex, 0, 0, 0, 0);
        quad(0, 0.6666667f, 0, 0.3333333f, 1, 0, 1, 1); /* base-level-only sampling starts at BASE_LEVEL */
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_BASE_LEVEL, 0); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 1000);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST_MIPMAP_NEAREST);
        glUniform4f(zsel_tex, 0, 0, 0, 0);
        tile(6); glBindTexture(GL_TEXTURE_2D, packed_tex); quad(0, -0.5f, 0, 0.5f, 1, 0, 1, 1);
        glBindTexture(GL_TEXTURE_2D, half_tex); set_tint(0.5f, 0.5f, 0.5f, 1); quad(0, 0.5f, 0, 0.5f, 1, 0, 1, 1);
        set_tint(1, 1, 1, 1);
        tile(7); glBindTexture(GL_TEXTURE_2D, mrt0); quad(0, -0.5f, 0, 0.5f, 1, 0, 1, 1);
        glBindTexture(GL_TEXTURE_2D, mrt1); quad(0, 0.5f, 0, 0.5f, 1, 0, 1, 1);
        /* Poison the old default-unit path: units 3/5 are the only complete dimensional bindings. */
        glBindTexture(GL_TEXTURE_3D, 0); glBindTexture(GL_TEXTURE_2D_ARRAY, 0);
        glActiveTexture(GL_TEXTURE3);
        glUseProgram(p_vol); glBindTexture(GL_TEXTURE_3D, volume);
        glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_NEAREST_MIPMAP_NEAREST);
        glUniform4f(zsel_vol, 0.375f, 0, 0, 0);
        tile(3); quad(1, -0.5f, 0, 0.5f, 1, 0, 1, 1);
        glUniform4f(zsel_vol, 0.625f, 0, 0, 0); quad(1, 0.5f, 0, 0.5f, 1, 0, 1, 1);
        glUniform4f(zsel_vol, 0.625f, 14, 0, 0); quad(1, 0.9f, 0, 0.1f, 1, 0, 1, 1);
        glActiveTexture(GL_TEXTURE5);
        glUseProgram(p_arr); glBindTexture(GL_TEXTURE_2D_ARRAY, layers);
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_NEAREST_MIPMAP_NEAREST); tile(4);
        glUniform4f(zsel_arr, 0, 0, 0, 0); quad(2, -0.5f, 0, 0.5f, 1, 0, 1, 1);
        glUniform4f(zsel_arr, 1, 0, 0, 0); quad(2, 0.5f, 0, 0.5f, 1, 0, 1, 1);
        glUniform4f(zsel_arr, 1, 14, 0, 0); quad(2, 0.9f, 0, 0.1f, 1, 0, 1, 1);
        glActiveTexture(GL_TEXTURE0);
        if (glGetError() != GL_NO_ERROR) { OutputDebugStringA("x64-gl-fbo unexpected GL error"); failures++; }
        frame++; SwapBuffers(dc);
    }
}
