// Concatenated after "#version 330 core" and a "#define VARIANT n" string.
#if VARIANT == 1
#define PICK vec3(0.0, 0.0, 1.0)
#elif VARIANT == 2
#define PICK vec3(1.0, 1.0, 0.0)
#else
#error unknown variant
#endif
#define CAT(a, b) a##b
#line 100
out vec4 CAT(frag, Color);
void main() { fragColor = vec4(PICK, 1.0); }
