#version 330 core
// Interpolation qualifiers and built-ins.
smooth in vec2 tc;
flat in int pick;
noperspective in float ramp;
uniform vec2 origin;
layout(location = 0) out vec4 frag;
void main() {
  float local = gl_FragCoord.x - origin.x;
  vec3 c = vec3(1.0, 0.0, 0.0);
  if (local < 40.0) { c = vec3(0.0, 1.0, 0.0); }
  if (pick == 3) { c.b = ramp; }
  frag = vec4(c, 1.0);
}
