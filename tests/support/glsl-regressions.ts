// SPDX-License-Identifier: CC0-1.0
// Original, engine-independent known-answer shader corpus. No captured or third-party shader sources.
export interface GlslRegression { name: string; body: string; header?: string; expected: number[]; texture?: boolean; invalid?: boolean }
export const regressionVertex = `out vec4 ref;\nvoid main() {
  ref = vec4(1.0);
  vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  vec2 chosen = mix(p[bgt_vertex_index], -p[bgt_vertex_index], lessThan(vec2(1.0, -1.0), vec2(0.0)));
  gl_Position = vec4(chosen, 0.5, 1.0);
}`;
const success = [64, 128, 191, 255];
export const glslRegressions: GlslRegression[] = [];
for (const component of ['float', 'int', 'uint', 'bool']) for (const n of [1, 2, 3, 4]) for (const invert of [false, true]) {
  const type = n === 1 ? component : `${{ float: '', int: 'i', uint: 'u', bool: 'b' }[component]}vec${n}`;
  const condition = Array.from({ length: n }, (_, i) => (i % 2 === 0) !== invert ? 'true' : 'false');
  const x = Array.from({ length: n }, (_, i) => component === 'float' ? `${i + 1}.0` : component === 'int' ? `${-100 - i}` :
    component === 'uint' ? `${0xf0000001 + i}u` : i % 2 === 0 ? 'false' : 'true');
  const y = Array.from({ length: n }, (_, i) => component === 'float' ? `${i + 5}.0` : component === 'int' ? `${-200 - i}` :
    component === 'uint' ? `${0xe0000001 + i}u` : i % 2 === 0 ? 'true' : 'false');
  const expected = x.map((v, i) => condition[i] === 'true' ? y[i] : v);
  const ctor = (values: string[]) => n === 1 ? values[0] : `${type}(${values.join(', ')})`;
  const selector = n === 1 ? condition[0] : `bvec${n}(${condition.join(', ')})`;
  glslRegressions.push({ name: `mix-${component}${n}-${invert ? 'false' : 'true'}-first`, expected: success,
    body: `${type} result = mix(${ctor(x)}, ${ctor(y)}, ${selector});
      bool correct = ${n === 1 ? `result == ${ctor(expected)}` : `all(equal(result, ${ctor(expected)}))`};
      o = vec4(correct ? 0.25 : 0.0, correct ? 0.5 : 0.0, correct ? 0.75 : 0.0, 1.0);` });
}
glslRegressions.push(
  { name: 'mix-user-overload', expected: success,
    header: 'int mix(const in highp int x, int y, bool a) { return x + y + (a ? 1 : 0); }',
    body: 'float value = float(mix(1, 2, true)) / 16.0; o = vec4(value, 0.5, 0.75, 1.0);' },
  { name: 'mix-unselected-invalid', expected: success, texture: true, invalid: true,
    header: 'uniform sampler2D bgt_t0;', body: `
      vec4 invalid = texelFetch(bgt_t0, ivec2(0), 0);
      o = mix(vec4(0.25, 0.5, 0.75, 1.0), invalid, bvec4(false));` },
  { name: 'mix-argument-evaluation', expected: success,
    header: `float calls = 0.0;
      float left() { calls += 1.0; return 0.25; }
      float right() { calls += 1.0; return 0.75; }`, body: `
      float value = mix(left(), right(), bgt_frag_coord.x < 0.0);
      o = vec4(value, calls * 0.25, 0.75, 1.0);` },
  { name: 'mix-false-scalar-and-vector', expected: success, body: `
    float a = mix(0.25, -123.0, false);
    vec3 b = mix(vec3(0.5, 0.75, 1.0), vec3(-13.0), bvec3(false));
    o = vec4(a, b);` },
  { name: 'mix-numeric', expected: success, body: `
    float a = mix(0.0, 1.0, 0.25);
    vec2 b = mix(vec2(0.0), vec2(1.0), vec2(0.5, 0.75));
    vec4 c = mix(vec4(0.0), vec4(1.0), 1.0);
    o = vec4(a, b, c.w);` },
  { name: 'boolean-relations-and-access', expected: success, body: `
    bvec4 b = lessThan(vec4(1.0, 9.0, 3.0, 8.0), vec4(2.0, 7.0, 5.0, 6.0));
    vec2 v = mix(vec2(0.0, 0.5), vec2(0.25, 0.0), b.xy);
    bool valid = all(equal(not(b), bvec4(false, true, false, true))) &&
      any(greaterThan(ivec3(-4, 3, 0), ivec3(0))) &&
      all(lessThanEqual(uvec2(1u, 2u), uvec2(1u, 3u))) &&
      all(greaterThanEqual(ivec2(-3, 7), ivec2(-4, 7))) &&
      all(notEqual(bvec2(false, true), bvec2(true, false)));
    o = vec4(v, mix(0.0, 0.75, b[2]), valid ? 1.0 : 0.0);` },
  { name: 'integer-bit-contracts', expected: success, body: `
    uint u = (uint(-1) & 65535u) ^ 255u;
    int i = (-33 >> 2) + 10;
    uvec2 v = (uvec2(1u, 3u) << uvec2(4u, 3u)) | uvec2(2u);
    bool valid = u == 65280u && i == 1 && all(equal(v, uvec2(18u, 26u))) &&
      (16777217u + uint(2)) == 16777219u;
    o = valid ? vec4(0.25, 0.5, 0.75, 1.0) : vec4(0.0);` },
  { name: 'negative-mod-and-rounding', expected: success, body: `
    vec3 m = mod(vec3(-3.5, 3.5, -3.5), vec3(2.0, -2.0, -2.0));
    vec3 r = round(vec3(-1.7, 1.2, 2.8));
    vec4 e = roundEven(vec4(-2.5, -1.5, 1.5, 2.5));
    bool valid = all(equal(m, vec3(0.5, -0.5, -1.5))) &&
      all(equal(r, vec3(-2.0, 1.0, 3.0))) && all(equal(e, vec4(-2.0, -2.0, 2.0, 2.0)));
    o = valid ? vec4(0.25, 0.5, 0.75, 1.0) : vec4(0.0);` },
  { name: 'matrix-array-swizzle-and-out', expected: success,
    header: `void compute(in vec2 a, out vec2 b, inout float c) { b = a.yx; c += 0.25; }`, body: `
    float values[3] = float[3](0.25, 0.5, 0.75);
    mat2 small = mat2(2.0); mat4 large = mat4(small);
    vec2 pair; float x = 0.5; compute(vec2(values[1], values[0]), pair, x);
    vec4 v = vec4(pair, x, large[3].w);
    v.yx = v.xy; v.yx = v.xy;
    o = v;` },
  { name: 'derivatives', expected: success, body: `
    float x = bgt_frag_coord.x;
    o = vec4(abs(dFdx(x)) * 0.25, fwidth(x) * 0.5, abs(dFdy(bgt_frag_coord.y)) * 0.75, 1.0);` },
  { name: 'texture-fetch-size-lod', expected: success, texture: true,
    header: 'uniform sampler2D bgt_t0;', body: `
    ivec2 size = textureSize(bgt_t0, 0);
    vec4 a = texelFetch(bgt_t0, ivec2(1, 0), 0);
    vec4 b = textureLod(bgt_t0, vec2(0.75, 0.25), 0.0);
    o = all(equal(size, ivec2(2))) && all(equal(a, b)) ? a : vec4(0.0);` },
);
export function regressionFragment(c: GlslRegression): string {
  return `${c.header ?? ''}\nin vec4 ref;\nlayout(location=0) out vec4 o;\nvoid main() { ${c.body} o *= ref; }`;
}
