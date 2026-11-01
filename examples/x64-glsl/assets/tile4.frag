#version 330 core
in vec2 tc;
out vec4 shade;
void main() { shade = vec4(tc.x, 0.25, tc.y * 0.5, 1.0); }
