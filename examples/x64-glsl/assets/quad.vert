#version 330 core
// Original CC0-1.0 shader. Shared vertex stage for the tile scenes.
precision highp float;
#define HALF(v) ((v) * 0.5)
layout(location = 0) in vec2 position;
in highp vec2 uv;
smooth out vec2 tc;
flat out int pick;
noperspective out float ramp;
uniform int selector;
uniform vec2 shift, extent;       // two uniforms in one declaration
uniform vec4 never_used;          // inactive: must not be reported
void main() {
  tc = uv;
  pick = selector;
  ramp = HALF(position.x) + 0.5 + float(gl_VertexID) * 0.0;
  gl_Position = vec4(position * extent + shift, 0.0, 1.0);
}
