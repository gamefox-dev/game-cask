#version 330 core
// std140 block with an instance name: vec4, scalar array, nested struct, bool and mat2 members.
struct Ramp { vec2 range; float bias; };
layout(std140) uniform Params {
  vec4 tint;
  float coef[3];
  Ramp ramp;
  bool enabled;
  mat2 m2;
} params;
layout(location = 0) out vec4 frag;
void main() {
  vec3 col = params.tint.rgb * params.coef[1] + vec3(params.ramp.range, params.ramp.bias);
  if (params.enabled) { vec2 q = params.m2 * col.rg; col.rg = q; }
  frag = vec4(col, 1.0);
}
