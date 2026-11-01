#version 330 core
// out/inout parameters, multiple declarators, constant array sizes and length().
precision highp float;
const int N = 3;
const int TOTAL = N * 2;
float scratch[TOTAL];
void accumulate(in float v, inout float sum, out float last) { sum += v; last = v; }
layout(location = 0) out vec4 frag;
void main() {
  float a = 0.25, b = 0.5;
  float sum = 0.0, last;
  accumulate(a, sum, last);
  accumulate(b, sum, last);
  float table[N];
  table[0] = sum; table[1] = last; table[2] = float(table.length() + TOTAL);
  frag = vec4(table[0], table[1], table[2] / 18.0, 1.0);
}
