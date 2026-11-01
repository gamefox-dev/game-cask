#version 330 core
// Sampler array addressed with constant indices; an unused sampler stays inactive.
uniform sampler2D pair[2];
uniform sampler2D ghost;
in vec2 tc;
layout(location = 0) out vec4 frag;
void main() { frag = texture(pair[0], tc) + texture(pair[1], tc) * 0.5; }
