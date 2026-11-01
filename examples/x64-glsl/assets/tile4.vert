#version 330 core
// No layout qualifiers: locations come from glBindAttribLocation.
in vec2 pos;
in vec2 coord;
in vec4 unused_attr;
out vec2 tc;
void main() { tc = coord; gl_Position = vec4(pos, 0.0, 1.0); }
