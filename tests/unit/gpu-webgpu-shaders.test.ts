import { describe, expect, it } from 'vitest';
import { glslVaryings, shaderBindings, translateGLSL, validateWGSL } from '../../bgt/renderers/webgpu/shaders';

const vs = `#version 330 core
layout(location=0) in vec3 position;
layout(std140) uniform bgt_u2 { mat4 projection; vec4 tint; } camera;
out vec4 color;
void main() { gl_Position = camera.projection * vec4(position, 1.0); color = camera.tint; }`;
const fs = `#version 330 core
uniform sampler2D bgt_t3;
in vec4 color;
layout(location=0) out vec4 outputColor;
void main() {
  if (gl_FragCoord.x < 4.0) discard;
  outputColor = texture(bgt_t3, color.xy) * color;
}`;

describe('WebGPU engine-independent GLSL frontend and ABI reflection', () => {
  it('retains integer sampler signedness and renames GLSL identifiers reserved by WGSL', () => {
    for (const [sampler, scalar] of [['isampler2D', 'i32'], ['usampler2D', 'u32']]) {
      const code = translateGLSL(`#version 330 core\nuniform ${sampler} bgt_t0;layout(location=0) out vec4 o;void main(){${scalar === 'i32' ? 'ivec4' : 'uvec4'} ref=texelFetch(bgt_t0,ivec2(0),0);o=vec4(ref);}`, 2, 1);
      expect(code).toContain(`texture_2d<${scalar}>`); expect(code).toContain('textureLoad(');
      expect(code).toContain('bgt_internal_glsl_ref');
    }
  });
  it('lowers fixed-size vector array constructors with typed elements and rejects wrong lengths', () => {
    const code=translateGLSL(`#version 330 core
void main(){ vec2 p[3]=vec2[3](vec2(-1,1),vec2(-1,-1),vec2(1,-1));
gl_Position=vec4(p[bgt_vertex_index],0.5,1); }`,1,1);
    expect(code).toContain('var p: array<vec2f, 3> = array<vec2f, 3>');
    expect(code).toContain('p[bgt_vertex_index]');
    expect(() => translateGLSL('#version 330 core\nvoid main(){vec2 p[2]=vec2[2](vec2(1));}',1,1))
      .toThrow('array constructor requires 2 elements');
  });
  it('translates std140 matrices, instance block names and in/out varyings', () => {
    const code = translateGLSL(vs, 1, 1);
    expect(code).toContain('@vertex fn vs_main');
    expect(code).toContain('camera.projection');
    expect(code).toContain('@location(0) color: vec4f');
    expect(shaderBindings(code)).toEqual([{ group: 0, binding: 2, type: 'uniform' }]);
  });
  it('translates samplers, top-left fragment coordinates and discard', () => {
    const code = translateGLSL(fs, 2, 1);
    expect(code).toContain('textureSample(bgt_t3, bgt_t3_sampler');
    expect(code).toContain('bgt_frag_coord.x');
    expect(code).toContain('discard;');
    expect(shaderBindings(code)).toEqual([
      { group: 1, binding: 6, type: 'texture' }, { group: 1, binding: 7, type: 'sampler' },
    ]);
  });
  it('accepts ES300 precision declarations and portable IDs', () => {
    const source = `#version 300 es
precision highp float;
layout(location=0) in vec4 p;
void main() { gl_Position = p + vec4(float(bgt_vertex_index + bgt_instance_index)); }`;
    expect(translateGLSL(source, 1, 2)).toContain('@builtin(instance_index)');
  });
  it('links varying names using a shared location map rather than independent stage ordering', () => {
    const source = '#version 330 core\nout vec4 z; out vec2 a; void main(){ gl_Position=vec4(0.0); }';
    expect(glslVaryings(source, 1)).toEqual(['a', 'z']);
    expect(translateGLSL(source, 1, 1, ['a', 'unused', 'z'])).toContain('@location(2) z: vec4f');
  });
  it('lowers boolean mix selectors to typed WGSL select without changing numeric mix', () => {
    const source = `#version 330 core
layout(location=0) out vec4 c;
void main() {
  float sf = mix(-1.0, 2.0, true);
  vec2 vf = mix(vec2(1.0, 2.0), vec2(3.0, 4.0), bvec2(false, true));
  ivec3 vi = mix(ivec3(1, 2, 3), ivec3(4, 5, 6), bvec3(true, false, true));
  uvec2 vu = mix(uvec2(1u, 2u), uvec2(3u, 4u), bvec2(false, true));
  bvec4 vb = mix(bvec4(false, true, false, true), bvec4(true, false, true, false),
    bvec4(true, true, false, false));
  c = vec4(sf + vf.x, float(vi.y + int(vu.x)), vb.z ? 1.0 : 0.0, mix(0.0, 1.0, 0.25));
}`;
    const code = translateGLSL(source, 2, 1);
    expect(code).toContain('select((-1.0), 2.0, true)');
    expect(code).toContain('select(vec2f(1.0, 2.0), vec2f(3.0, 4.0), vec2<bool>(false, true))');
    expect(code).toContain('select(vec3i(1i, 2i, 3i), vec3i(4i, 5i, 6i), vec3<bool>(true, false, true))');
    expect(code).toContain('mix(0.0, 1.0, 0.25)');
    expect(code).not.toContain("mix(vec2f(1.0, 2.0), vec2f(3.0, 4.0), vec2<bool>");
  });
  it('retains bool type after indexing/swizzling comparison results used as mix selectors', () => {
    const code = translateGLSL(`#version 330 core
layout(location=0) out vec4 c;
void main() { bvec3 b=lessThan(vec3(1.0), vec3(2.0));
c=vec4(mix(1.0, 2.0, b[0]), mix(vec2(1.0), vec2(2.0), b.yx), mix(0.0, 1.0, 0.25)); }`, 2, 1);
    expect(code).toContain('select(1.0, 2.0, b[0i])');
    expect(code).toContain('select(vec2f(1.0), vec2f(2.0), b.yx)');
    expect(code).toContain('mix(0.0, 1.0, 0.25)');
  });
  it.each([
    'mix(vec2(1.0), vec2(2.0), true)',
    'mix(1, 2u, true)',
    'mix(vec3(1.0), vec3(2.0), bvec2(true))',
  ])('rejects mismatched boolean selector types: %s', expression => {
    expect(() => translateGLSL(`#version 330 core\nvoid main(){${expression};}`, 2, 1))
      .toThrow('mix boolean selector requires matching');
  });
  it('translates loops, helper calls and explicit LOD', () => {
    const source = `#version 330 core
uniform sampler2D bgt_t0; layout(location=0) out vec4 c;
float helper(float x) { return sin(x); }
void main() {
  float x = 0.0;
  for (int i=0; i<3; i++) { x += helper(float(i)); }
  c = textureLod(bgt_t0, vec2(x), 1.0);
}`;
    const code = translateGLSL(source, 2, 1);
    expect(code).toContain('for (var i: i32 = 0i;');
    expect(code).toContain('textureSampleLevel');
  });
  it('lowers std140 mat2 padding and scalar diagonal matrix constructors', () => {
    const source = `#version 330 core
layout(std140) uniform bgt_u0 { mat2 m; } block;
void main() { vec2 p = block.m * vec2(1.0); gl_Position = mat4(1.0) * vec4(p,0.0,1.0); }`;
    const code = translateGLSL(source, 1, 1);
    expect(code).toContain('m: mat2x4f');
    expect(code).toContain('mat2x2f(block.m[0].xy, block.m[1].xy)');
    expect(code).toContain('vec4f(f32(1.0), 0.0, 0.0, 0.0)');
  });
  it('validates unused bindings but allows omitting them from active pipeline reflection', () => {
    const source = '@group (0) @binding (7u) var<uniform> unused: vec4f;';
    expect(shaderBindings(source)).toEqual([{ group: 0, binding: 7, type: 'uniform' }]);
    expect(shaderBindings(source, true)).toEqual([]);
    expect(() => shaderBindings('@group(0) @binding(slot) var<uniform> u: vec4f;')).toThrow(/literal/);
  });
  it('preserves integer arithmetic before float conversion (independent review regression)', () => {
    const code = translateGLSL(`#version 330 core
layout(location=0) out vec4 c; void main() { c=vec4(float(1/2)); }`, 2, 1);
    expect(code).toContain('(1i / 2i)');
    expect(code).not.toContain('(1.0 / 2.0)');
  });
  it('keeps ternary branches lazy, including helper calls that mutate globals', () => {
    const code = translateGLSL(`#version 330 core
layout(location=0) out vec4 c; float counter=0.0;
float bump() { counter += 1.0; return counter; }
void main() { float a=2.0; float x=bgt_frag_coord.x>0.0 ? a : bump(); c=vec4(counter); }`, 2, 1);
    expect(code).not.toContain('select(bump()');
    expect(code).toContain('if (bgt_internal_condition) { return a; } return bump();');
    expect(code).not.toContain('x: f32) -> f32');
  });
  it('WGSL is used unchanged', () => {
    const source = '@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0,0,0,1); }';
    expect(validateWGSL(source, 1)).toBe(source);
  });
  it.each([
    ['bad version', '#version 450\nvoid main() {}', /expected #version 330 core/],
    ['syntax with line', '#version 330 core\nvoid main() { @ }', /GLSL line 2: unexpected character/],
    ['unknown identifier', '#version 330 core\nvoid main() { missing=1.0; }', /line 2: unknown identifier/],
    ['native binding', '#version 330 core\nlayout(binding=0) uniform sampler2D bgt_t0;', /native bindings/],
    ['ordinary uniform', '#version 330 core\nuniform float time;', /uniforms must be/],
    ['reserved', '#version 330 core\nvoid bgt_internal_main() {}', /prefix is reserved/],
    ['native ID', '#version 330 core\nvoid main() { int i=gl_VertexID; }', /unknown identifier/],
  ])('reports readable %s errors', (_name, source, error) => {
    expect(() => translateGLSL(source, 1, 1)).toThrow(error);
  });
  it.each([
    '@group(2) @binding(0) var tex: texture_2d<f32>;',
    '@group(0) @binding(8) var<uniform> u: vec4f;',
    '@group(1) @binding(0) var s: sampler;',
    '@group(1) @binding(1) var tex: texture_2d<f32>;',
  ])('rejects nonportable reflection: %s', source => {
    expect(() => shaderBindings(source)).toThrow(/violates §13.5/);
  });
  it('reflects comparison-depth bindings and forbids compute/storage', () => {
    expect(shaderBindings('@binding(0) @group(1) var t: texture_depth_2d;')).toEqual([
      { group: 1, binding: 0, type: 'depth' },
    ]);
    expect(() => validateWGSL('@compute @workgroup_size(1) fn c() {}', 0)).toThrow(/outside §13/);
  });
});
