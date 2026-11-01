#version 330 core
// Structure array, scalar array, bool and mat3 uniforms; macros with conditionals.
#ifndef TINT_MODE
#define TINT_MODE 2
#endif
#define WEIGHTED(l) ((l).color * (l).weight)
#if TINT_MODE == 1
#define SCALE_FACTOR 1.0
#elif TINT_MODE == 2 && defined(GL_core_profile) && __VERSION__ >= 330
#define SCALE_FACTOR gains[2]
#else
#define SCALE_FACTOR 0.0
#endif
struct Light { vec3 color; float weight; };
uniform Light lights[3];
uniform highp float gains[4];
uniform bool boost;
uniform mat3 swap_rb;
uniform float unused_gain, unused_other;
in vec2 tc;
layout(location = 0) out vec4 frag;
void main() {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 3; i++) { c += WEIGHTED(lights[i]); }
  c = swap_rb * (c * SCALE_FACTOR);
  if (boost) { c = c * 2.0; }
  frag = vec4(c, 1.0);
}
