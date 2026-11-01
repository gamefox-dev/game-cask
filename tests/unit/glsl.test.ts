// Known-answer tests for the GL profile's GLSL front end: the C preprocessor / reflection / emission code is
// compiled for the host (tests/native/glsl_driver.c) and driven with our own CC0 shader corpus. The canonical
// output is then run through both browser frontends (WebGL 2 validation and the WGSL translator).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/headless';
import { preprocess, runGlsl, type GlslResult } from '../support/glsl-native';
import { shaderBindings, translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { translateShader } from '../../bgt/renderers/webgl2/shaders';

const compact = (s: string) => s.replace(/\s+/g, '');
const lines = (s: string) => s.split('\n').map(l => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
const VS = '#version 330 core\nvoid main(){gl_Position=vec4(0.0);}\n';
const FS = '#version 330 core\nout vec4 c;\nvoid main(){c=vec4(0.0);}\n';
const assets = (name: string) => readFileSync(join(ROOT, 'examples/x64-glsl/assets', name), 'utf8');
const link = (vs: string[], fs: string[], extra: Partial<Parameters<typeof runGlsl>[0]> = {}) => runGlsl({ vs, fs, ...extra });
const names = (r: GlslResult) => r.uniforms!.map(u => u.name);
const find = (r: GlslResult, name: string) => r.uniforms!.find(u => u.name === name)!;

describe('GLSL preprocessor', () => {
  it('expands object-like and function-like macros, arguments, nesting and ## pasting', () => {
    const r = preprocess(`#version 330 core
#define ADD(a, b) ((a) + (b))
#define TWICE(x) ADD(x, x)
#define PAIR 1, 2
#define STR(x) x
#define CAT3(a,b,c) a##b##c
#define EMPTY
float v = TWICE(ADD(1, 2));
int w = STR(PAIR);
CAT3(i, n, t) joined; x EMPTY y
`);
    expect(r.ok, r.log).toBe(true);
    expect(compact(r.pp)).toContain('floatv=((((1)+(2)))+(((1)+(2))));');
    expect(compact(r.pp)).toContain('intw=1,2;');
    expect(r.pp).toMatch(/int joined;/);
    expect(r.pp).toMatch(/x\s+y/);
  });
  it('rescans function-macro aliases against following tokens and accepts whitespace in empty parameter lists', () => {
    const r = preprocess('#version 330 core\n#define F(x) ((x)+1)\n#define ALIAS F\n#define ID(x) x\n#define ZERO( ) 0\nALIAS(2) ID(F)(3) ALIAS(4) ZERO()\n');
    expect(r.ok, r.log).toBe(true); expect(compact(r.pp)).toBe('((2)+1)((3)+1)((4)+1)0');
  });
  it('never re-expands a macro inside its own expansion', () => {
    const r = preprocess('#version 330 core\n#define A B\n#define B A\n#define F(x) F(x) + x\nA B\nF(1)\n');
    expect(r.ok, r.log).toBe(true);
    expect(lines(r.pp)).toEqual(['A B', 'F(1) + 1']);
  });
  it('evaluates #if / #elif / #else with defined(), operators and nested inactive groups', () => {
    const r = preprocess(`#version 330 core
#if 1 + 2 * 3 == 7 && (4 << 1) == 8 && 0x10 == 16 && 010 == 8
A
#endif
#if !defined FOO && !defined(BAR) && ~0 == -1 && (5 % 3) == 2 && 7 / 2 == 3 && (6 ^ 3) == 5 && (6 | 1) == 7
B
#endif
#if 0
C
#elif 1
D
#elif 1
E
#else
F
#endif
#if 0
#if 1
G
#else
H
#endif
#else
I
#endif
#define LEVEL 3
#if LEVEL > 2 && LEVEL < 4 || 0
J
#endif
`);
    expect(r.ok, r.log).toBe(true);
    expect(lines(r.pp)).toEqual(['A', 'B', 'D', 'I', 'J']);
  });
  it('defines __VERSION__, GL_core_profile and GL_ES as a driver would', () => {
    expect(lines(preprocess('#version 330 core\n__VERSION__\n#ifdef GL_core_profile\ncore\n#endif\n#ifndef GL_ES\nnoes\n#endif\n').pp))
      .toEqual(['330', 'core', 'noes']);
    expect(lines(preprocess('#version 330 compatibility\n#ifdef GL_core_profile\nbad\n#endif\n#ifdef GL_compatibility_profile\ncompat\n#endif\n').pp))
      .toEqual(['compat']);
    expect(lines(preprocess('#version 150\n#ifdef GL_core_profile\ncore\n#endif\n').pp)).toEqual(['core']); // default profile of 1.50+
    const es = preprocess('#version 300 es\nGL_ES __VERSION__\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nhigh\n#endif\n#ifdef GL_core_profile\nbad\n#endif\n');
    expect(lines(es.pp)).toEqual(['1 300', 'high']); expect(es.es).toBe(1);
  });
  it('tracks __LINE__ / __FILE__ across source strings, #line, comments and continuations', () => {
    const r = preprocess('#version 330 core\nfoo __LINE__ __FILE__\n', 'bar __LINE__ __FILE__\n#line 50 7\n__LINE__ __FILE__\n#line 10\n__LINE__\n');
    expect(lines(r.pp)).toEqual(['foo 2 0', 'bar 1 1', '50 7', '10']);
    const c = preprocess('#version 330 core\na \\\nb\nc /* multi\nline */ d __LINE__\n#define LONG 1 + \\\n 2\nLONG __LINE__\n');
    expect(lines(c.pp)).toEqual(['a b', 'c', 'd 5', '1 + 2 8']);
    expect(c.pp.split('\n').length).toBe(9); // every source newline is preserved so diagnostics keep their line numbers
  });
  it('supports prepended #define strings for shader variants and rejects misplaced #version', () => {
    const body = '#if VARIANT == 1\nbluish\n#elif VARIANT == 2\nyellowish\n#else\n#error unknown variant\n#endif\n';
    expect(lines(preprocess('#version 330 core\n', '#define VARIANT 2\n', body).pp)).toEqual(['yellowish']);
    expect(lines(preprocess('#version 330 core\n', '#define VARIANT 1\n', body).pp)).toEqual(['bluish']);
    const bad = preprocess('#version 330 core\n', body);
    expect(bad.ok).toBe(false); expect(bad.log).toContain('#error');
    const late = preprocess('#define X 1\n', '#version 330 core\n');
    expect(late.ok).toBe(false); expect(late.log).toContain('#version must occur first');
  });
  it('reports #error, redefinition, reserved names, unknown directives and balance errors with line numbers', () => {
    const e = preprocess('#version 330 core\n\n#error stop here\n');
    expect(e.ok).toBe(false); expect(e.log).toMatch(/^0:3\(\d+\): error: #error `stop here'/);
    expect(preprocess('#version 330 core\n#define A 1\n#define A 2\n').log).toContain('redefinition of macro');
    expect(preprocess('#version 330 core\n#define A 1\n#define A 1\nA\n#undef A\nA\n').ok).toBe(true);
    expect(preprocess('#version 330 core\n#define GL_X 1\n').log).toContain('reserved');
    expect(preprocess('#version 330 core\n#bogus\n').log).toContain('unknown preprocessor directive `bogus\'');
    expect(preprocess('#version 330 core\n#endif\n').log).toContain('#endif without #if');
    expect(preprocess('#version 330 core\n#else\n').log).toContain('#else without #if');
    expect(preprocess('#version 330 core\n#if 1\n').log).toContain('unterminated');
    expect(preprocess('#version 330 core\n#define F(a,b) a\nF(1)\n').log).toContain('wrong number of arguments');
    expect(preprocess('#version 330 core\n#if 1/0\n#endif\n').log).toContain('division by zero');
    expect(preprocess('#version 330 core\n#if 1 +\n#endif\n').log).toContain('syntax error');
    expect(preprocess('#version 120\n').log).toContain('not supported');
    expect(preprocess('x\n').pp).toBe('x\n');
    expect(preprocess('/* open').ok).toBe(false);
  });
  it('concatenates source strings before tokenization, including directives, comments and macro invocations', () => {
    const r = preprocess('#ver', 'sion 330 core\n#define VALUE 7\nVAL', 'UE __FILE__ __LINE__\n/* split', ' comment */ VALUE\n#define F(x) ((x)+1)\nF(', '2)\n');
    expect(r.ok, r.log).toBe(true);
    expect(lines(r.pp)).toEqual(['7 2 1', '7', '((2)+1)']);
    expect(lines(preprocess('#version 330 core\n// hidden', ' still hidden\nvisible\n').pp)).toEqual(['visible']);
  });
  it('expands #line arguments and short-circuits conditional expressions', () => {
    const r = preprocess('#version 330 core\n#define L 40\n#define S 3\n#line L S\n#if (1 || 1/0) && !(0 && 1/0) && (1 ? 7 : 1/0) == 7\n__LINE__ __FILE__\n#endif\n');
    expect(r.ok, r.log).toBe(true); expect(lines(r.pp)).toEqual(['41 3']);
  });
  it('bounds expression and macro-argument recursion instead of overflowing the stack', () => {
    expect(preprocess(`#version 330 core\n#if ${'('.repeat(2000)}1${')'.repeat(2000)}\n#endif\n`).log).toContain('nesting too deep');
    expect(preprocess(`#version 330 core\n#define F(x) x\n${'F('.repeat(2000)}1${')'.repeat(2000)}\n`).log).toContain('nesting too deep');
  });
  it('evaluates negative integer arithmetic without host signed-shift traps', () => {
    const r = preprocess('#version 330 core\n#if (-1 << 3) == -8 && -7 / 2 == -3 && -7 % 2 == -1\narithmetic\n#endif\n');
    expect(r.ok, r.log).toBe(true); expect(lines(r.pp)).toEqual(['arithmetic']);
  });
  it('handles #extension, #pragma and warnings for undefined identifiers', () => {
    const r = preprocess('#version 330 core\n#extension GL_ARB_explicit_attrib_location : require\n#extension GL_FOO_bar : enable\n#pragma optimize(on)\n#if UNDEF == 0\nzero\n#endif\n');
    expect(r.ok, r.log).toBe(true);
    expect(r.log).toContain('warning: extension is not supported `GL_FOO_bar\'');
    expect(r.log).toContain('undefined identifier in preprocessor expression');
    expect(lines(r.pp)).toEqual(['zero']);
    expect(preprocess('#version 330 core\n#extension GL_FOO_baz : require\n').ok).toBe(false);
    expect(preprocess('#version 330 core\n#extension all : require\n').log).toContain('supports only warn and disable');
  });
});

describe('GL 3.3 reflection', () => {
  it('reports every numeric uniform type, size and sequential locations', () => {
    const types: [string, number][] = [['float', 0x1406], ['vec2', 0x8b50], ['vec3', 0x8b51], ['vec4', 0x8b52], ['int', 0x1404],
      ['ivec2', 0x8b53], ['ivec3', 0x8b54], ['ivec4', 0x8b55], ['uint', 0x1405], ['uvec2', 0x8dc6], ['uvec3', 0x8dc7],
      ['uvec4', 0x8dc8], ['bool', 0x8b56], ['bvec2', 0x8b57], ['bvec3', 0x8b58], ['bvec4', 0x8b59], ['mat2', 0x8b5a],
      ['mat3', 0x8b5b], ['mat4', 0x8b5c], ['mat2x3', 0x8b65], ['mat2x4', 0x8b66], ['mat3x2', 0x8b67], ['mat3x4', 0x8b68],
      ['mat4x2', 0x8b69], ['mat4x3', 0x8b6a]];
    const decl = types.map(([t], i) => `uniform ${t} u${i};`).join('\n');
    // Initialising a local from each uniform makes every declaration statically used.
    const fs = `#version 330 core\n${decl}\nout vec4 c;\nvoid main(){ c = vec4(0.0);\n${types.map(([t], i) => `{ ${t} q${i} = u${i}; }`).join('\n')}\n}`;
    const r = link([VS], [fs], { reflectOnly: true });
    expect(r.linked, r.linkLog).toBe(true);
    types.forEach(([, gl], i) => {
      const u = find(r, `u${i}`); expect([u.type, u.size, u.location, u.block]).toEqual([gl, 1, i, -1]);
    });
  });
  it('reports every GL 3.3 sampler type', () => {
    const samplers: [string, number][] = [['sampler1D', 0x8b5d], ['sampler2D', 0x8b5e], ['sampler3D', 0x8b5f], ['samplerCube', 0x8b60],
      ['sampler1DShadow', 0x8b61], ['sampler2DShadow', 0x8b62], ['sampler2DRect', 0x8b63], ['sampler2DRectShadow', 0x8b64],
      ['sampler1DArray', 0x8dc0], ['sampler2DArray', 0x8dc1], ['samplerBuffer', 0x8dc2], ['sampler1DArrayShadow', 0x8dc3],
      ['sampler2DArrayShadow', 0x8dc4], ['samplerCubeShadow', 0x8dc5], ['isampler2D', 0x8dca], ['usampler2D', 0x8dd2],
      ['isampler3D', 0x8dcb], ['usamplerCube', 0x8dd4], ['isampler2DArray', 0x8dcf], ['usamplerBuffer', 0x8dd8],
      ['sampler2DMS', 0x9108], ['sampler2DMSArray', 0x910b], ['isampler2DMS', 0x9109], ['usampler2DMSArray', 0x910d]];
    const fs = `#version 330 core\n${samplers.map(([t]) => `uniform ${t} s_${t};`).join('\n')}\nout vec4 c;\nvoid main(){ c = vec4(0.0);\n${
      samplers.map(([t]) => `c.x += float(textureSize(s_${t}, 0).x);`).join('\n')}\n}`;
    const r = link([VS], [fs], { reflectOnly: true });
    expect(r.linked, r.linkLog).toBe(true);
    for (const [t, gl] of samplers) expect(find(r, `s_${t}`).type, t).toBe(gl);
    // Without reflection-only mode the BGT texture layer refuses everything except sampler2D / sampler2DShadow.
    for (const type of ['sampler3D', 'sampler2DArray', 'samplerCube', 'samplerCubeShadow', 'isampler2D']) {
      const strict = link([VS], [`#version 330 core\nuniform ${type} a;\nout vec4 c;\nvoid main(){c=vec4(textureSize(a,0).x);}`]);
      expect(strict.fs!.ok, type).toBe(false); expect(strict.fs!.log).toContain('not supported by the BGT texture layer');
    }
  });
  it('lays out std140 blocks, arrays, nested structures, bools and matrices by the GL rules', () => {
    const fs = `#version 330 core
struct Inner { vec3 a; float b; };
struct Outer { float x; Inner in0; vec2 arr[2]; };
layout(std140) uniform Blk {
  float f; vec3 v3; float g; vec2 v2; float fa[2]; mat3 m3; vec3 v3a[2]; Inner inner; Outer outer[2]; bool flag; mat2 m2[2]; ivec2 iv;
} blk;
out vec4 c;
void main(){ c = vec4(blk.f + blk.v3.x + blk.g + blk.v2.x + blk.fa[1] + blk.m3[0].x + blk.v3a[1].x + blk.inner.b + blk.outer[1].x + blk.m2[1][0].x + float(blk.iv.x) + float(blk.flag));
  c += vec4(blk.outer[0].in0.a, blk.outer[1].arr[1].x); }`;
    const r = link([VS], [fs]);
    expect(r.linked, r.linkLog).toBe(true);
    const want: [string, number, number, number, number][] = [   // name, offset, array stride, matrix stride, size
      ['Blk.f', 0, 0, 0, 1], ['Blk.v3', 16, 0, 0, 1], ['Blk.g', 28, 0, 0, 1], ['Blk.v2', 32, 0, 0, 1], ['Blk.fa[0]', 48, 16, 0, 2],
      ['Blk.m3', 80, 0, 16, 1], ['Blk.v3a[0]', 128, 16, 0, 2], ['Blk.inner.a', 160, 0, 0, 1], ['Blk.inner.b', 172, 0, 0, 1],
      ['Blk.outer[0].x', 176, 0, 0, 1], ['Blk.outer[0].in0.a', 192, 0, 0, 1], ['Blk.outer[0].in0.b', 204, 0, 0, 1],
      ['Blk.outer[0].arr[0]', 208, 16, 0, 2], ['Blk.outer[1].x', 240, 0, 0, 1], ['Blk.outer[1].in0.a', 256, 0, 0, 1],
      ['Blk.outer[1].arr[0]', 272, 16, 0, 2], ['Blk.flag', 304, 0, 0, 1], ['Blk.m2[0]', 320, 32, 16, 2], ['Blk.iv', 384, 0, 0, 1]];
    for (const [name, offset, stride, mstride, size] of want) {
      const u = find(r, name); expect([name, u.offset, u.arrayStride, u.matrixStride, u.size, u.block, u.location])
        .toEqual([name, offset, stride, mstride, size, 0, -1]);
    }
    expect(r.blocks).toEqual([{ name: 'Blk', size: 400, members: 20, stages: 2 }]);
  });
  it('flattens structure arrays into GL names with sequential locations, base names for arrays', () => {
    const fs = `#version 330 core
struct Light { vec3 pos; float w[2]; };
uniform Light lights[2];
uniform float tail[3];
out vec4 c;
void main(){ c = vec4(lights[1].pos, tail[2] + lights[0].w[1]); }`;
    const r = link([VS], [fs]);
    expect(names(r)).toEqual(['lights[0].pos', 'lights[0].w[0]', 'lights[1].pos', 'lights[1].w[0]', 'tail[0]']);
    expect(r.uniforms!.map(u => [u.location, u.size])).toEqual([[0, 1], [1, 2], [3, 1], [4, 2], [6, 3]]);
  });
  it('treats unused, dead-code, #if-removed and unreachable-function uniforms and blocks as inactive', () => {
    const fs = `#version 330 core
uniform float used_in_main, unused, only_in_dead, via_macro, in_called, inside_ifdef;
uniform vec4 only_here;
#define ACCESS via_macro
float helper() { return in_called; }
float dead() { return only_in_dead; }
layout(std140) uniform Live { float live; };
layout(std140) uniform Dead { float dead_member; };
layout(std140) uniform Named { float member; } named;
layout(std140) uniform NamedDead { float other; } named_dead;
out vec4 c;
void main(){
  c = vec4(used_in_main + ACCESS + helper() + live + named.member);
#ifdef NOT_DEFINED
  c += vec4(inside_ifdef);
#endif
  float local = 1.0; c.x += local;
}`;
    const r = link([VS], [fs]);
    expect(names(r)).toEqual(['used_in_main', 'via_macro', 'in_called', 'live', 'Named.member']);
    expect(r.fsOut).not.toContain('float dead()');
    expect(r.fsOut).not.toContain('only_in_dead');
    expect(r.blocks!.map(b => b.name)).toEqual(['Live', 'Named']);
    expect(r.usize).toBe(16 + 3 * 4 + 4); // meta + three floats, rounded up to 16 bytes
  });
  it('assigns attribute locations: layout first, glBindAttribLocation next, then lowest free; mat4 takes four', () => {
    const vs = `#version 330 core
layout(location = 5) in vec4 explicit5;
in vec2 bound_a; in vec3 bound_b; in mat4 transform; in vec2 auto_c; in int ints; in vec4 inactive_attr;
layout(location = 2) in uvec2 two;
void main(){ gl_Position = explicit5 + vec4(bound_a, 0.0, 0.0) + vec4(bound_b, 0.0) + transform[0] + vec4(auto_c, 0.0, 0.0) + vec4(float(ints)) + vec4(vec2(two), 0.0, 0.0); }`;
    const r = link([vs], [FS], { attr: { bound_a: 9, bound_b: 10, explicit5: 7 }, reflectOnly: true });
    expect(r.linked, r.linkLog).toBe(true);
    expect(r.attribs!.map(a => [a.name, a.location, a.type, a.size])).toEqual([
      ['explicit5', 5, 0x8b52, 1], ['bound_a', 9, 0x8b50, 1], ['bound_b', 10, 0x8b51, 1], ['transform', 11, 0x8b5c, 1],
      ['auto_c', 0, 0x8b50, 1], ['ints', 1, 0x1404, 1], ['two', 2, 0x8dc6, 1]]);
    const clash = link(['#version 330 core\nin vec4 a; in vec4 b;\nvoid main(){gl_Position=a+b;}\n'], [FS], { attr: { a: 3, b: 3 } });
    expect(clash.linked).toBe(false); expect(clash.linkLog).toContain('already in use');
  });
  it('assigns fragment output locations from layout, glBindFragDataLocation, then lowest free', () => {
    const fs = `#version 330 core
layout(location = 2) out vec4 c2; out vec4 b1; out vec4 auto0; out float f3;
void main(){ c2 = vec4(0.0); b1 = vec4(1.0); auto0 = vec4(2.0); f3 = 1.0; }`;
    const r = link([VS], [fs], { frag: { b1: 1, f3: 3 } });
    expect(r.outputs!.map(o => [o.name, o.location, o.type])).toEqual([['c2', 2, 0x8b52], ['b1', 1, 0x8b52], ['auto0', 0, 0x8b52], ['f3', 3, 0x1406]]);
  });
  it('gives link errors for interface and declaration mismatches', () => {
    const expectLink = (vs: string, fs: string, text: string) => {
      const r = link([vs], [fs]); expect(r.linked, text).toBe(false); expect(`${r.linkLog}${r.vs!.log}${r.fs!.log}`).toContain(text);
    };
    expectLink(VS, '#version 330 core\nin vec3 missing;\nout vec4 c;\nvoid main(){c=vec4(missing,1.0);}\n', 'no matching output');
    expectLink('#version 330 core\nout vec3 v;\nvoid main(){v=vec3(1.0);gl_Position=vec4(0.0);}\n',
      '#version 330 core\nin vec2 v;\nout vec4 c;\nvoid main(){c=vec4(v,0.0,1.0);}\n', 'types differ');
    expectLink('#version 330 core\nsmooth out float v;\nvoid main(){v=1.0;gl_Position=vec4(0.0);}\n',
      '#version 330 core\nflat in float v;\nout vec4 c;\nvoid main(){c=vec4(v);}\n', 'interpolation');
    expectLink('#version 330 core\nuniform vec4 u;\nvoid main(){gl_Position=u;}\n',
      '#version 330 core\nuniform vec3 u;\nout vec4 c;\nvoid main(){c=vec4(u,1.0);}\n', 'different types');
    expectLink('#version 330 core\nlayout(std140) uniform B { vec4 a; };\nvoid main(){gl_Position=a;}\n',
      '#version 330 core\nlayout(std140) uniform B { vec3 a; };\nout vec4 c;\nvoid main(){c=vec4(a,1.0);}\n', 'declared differently');
    expectLink(VS, '#version 330 core\nout vec4 c;\nvoid notmain(){}\n', 'does not define main');
    expectLink('#version 330 core\nint out_of_main;\nvoid main(){ }\n', FS.replace('void main', 'void main2'), 'does not define main');
    expectLink(VS, '#version 330 core\nlayout(location=0) out vec4 a; layout(location=0) out vec4 b;\nvoid main(){a=b=vec4(1.0);}\n', 'already in use');
  });
  it('bounds declaration constant-expression nesting', () => {
    const r = link([VS], [`#version 330 core\nuniform float a[${'('.repeat(2000)}1${')'.repeat(2000)}];\nvoid main(){}\n`]);
    expect(r.fs!.ok).toBe(false); expect(r.fs!.log).toContain('constant expression nesting too deep');
  });
  it('rejects constructs outside the BGT subset with explanatory compile logs, not silent translation', () => {
    const bad = (src: string, text: string) => { const r = link([VS], [src]); expect(r.fs!.ok, text).toBe(false); expect(r.fs!.log).toContain(text); };
    bad('#version 330 core\nuniform float a[100000];\nout vec4 c;\nvoid main(){c=vec4(a[0]);}\n', 'array size');
    bad('#version 330 core\nuniform nosuchtype x;\nvoid main(){}\n', 'unknown type');
    bad('#version 330 core\nuniform float x = 1.0;\nvoid main(){}\n', 'initializers');
    bad('#version 330 core\nlayout(std140, row_major) uniform B { mat4 m; } b;\nout vec4 c;\nvoid main(){c=b.m[0];}\n', 'row_major');
    bad('#version 330 core\nlayout(binding = 2) uniform sampler2D t;\nvoid main(){}\n', 'not supported');
    bad('#version 330 core\nuniform B { float a; } b[2];\nvoid main(){}\n', 'arrays of uniform blocks');
    bad('#version 330 core\nout V { vec4 a; } v;\nvoid main(){}\n', 'interface blocks');
    bad('#version 330 core\nvarying vec4 old;\nvoid main(){}\n', 'core profile');
    bad('#version 330 core\nuniform sampler2D s; vec4 f(sampler2D t){return texture(t, vec2(0.0));}\nout vec4 c;\nvoid main(){c=f(s);}\n', 'sampler function parameters');
    bad('#version 330 core\nout mat4 m;\nvoid main(){}\n', 'fragment output');
  });
});

describe('canonical BGT output', () => {
  const program = (vs: string[], fs: string[], extra = {}) => {
    const r = link(vs, fs, extra); expect(r.linked, `${r.vs?.log}${r.fs?.log}${r.linkLog}`).toBe(true); return r;
  };
  it('rewrites interface declarations, samplers, built-ins and texture coordinates for the ABI', () => {
    const r = program([assets('quad.vert')], [assets('tile3.frag')]);
    expect(r.vsOut!.startsWith('#version 330 core\n')).toBe(true);
    expect(r.fsOut).toContain('uniform sampler2D bgt_t0; uniform sampler2D bgt_t1;');
    expect(r.fsOut).toContain('texture(bgt_t0,bgt_gl_uv( tc))');
    expect(r.fsOut).toContain('layout(location=0) out vec4 frag;');
    expect(r.vsOut).toContain('layout(location=0) in vec2 position; layout(location=1) in vec2 uv;');
    expect(r.vsOut).toContain('smooth out vec2 tc;'.replace('smooth ', '')); // interpolation default is smooth
    expect(r.vsOut).toContain('flat out int pick; noperspective out float ramp;');
    expect(r.vsOut).toContain('int(bgt_vertex_index)');
    expect(r.vsOut).toContain('void bgt_gl_main()');
    expect(r.vsOut).not.toMatch(/never_used|precision|#define/);
    // Line numbers stay aligned with the source (the prelude shares the line after #version).
    const line = (text: string, needle: string) => text.split('\n').findIndex(l => l.includes(needle));
    expect(line(r.vsOut!, 'void bgt_gl_main()')).toBe(line(assets('quad.vert'), 'void main()'));
  });
  it('flips shadow coordinates, gradients and texel fetches and refuses unsupported texture functions', () => {
    const fs = (body: string) => `#version 330 core\nuniform sampler2D a; uniform sampler2DShadow s;\nout vec4 c;\nvoid main(){ ${body} }`;
    const r = program([VS], [fs('c = textureLod(a, vec2(0.5), 1.0) + vec4(texture(s, vec3(0.5, 0.25, 0.5))) + textureGrad(a, vec2(0.5), vec2(1.0), vec2(1.0, 2.0)) + texelFetch(a, ivec2(1, 2), 0);')]);
    expect(r.fsOut).toContain('textureLod(bgt_t0,bgt_gl_uv( vec2(0.5)), 1.0)');
    expect(r.fsOut).toContain('texture(bgt_t1,bgt_gl_uv3( vec3(0.5, 0.25, 0.5)))');
    expect(r.fsOut).toContain('bgt_gl_grad( vec2(1.0))');
    expect(r.fsOut).toContain('texelFetch(bgt_t0,bgt_gl_fy( ivec2(1, 2),textureSize(bgt_t0, 0)), 0)');
    const bad = link([VS], [fs('c = textureOffset(a, vec2(0.5), ivec2(1));')]);
    expect(bad.fsEmitLog).toContain('texture function is not supported');
    expect(link([VS], [fs('c = vec4(gl_FragDepth);')]).fsEmitLog).toContain('built-in variable is not supported');
  });
  it('indexes sampler arrays with constant expressions only', () => {
    const src = (index: string) => `#version 330 core\nconst int K = 1;\nuniform sampler2D s[3];\nout vec4 c;\nvoid main(){ c = texture(s[${index}], vec2(0.5)); }`;
    const ok = program([VS], [src('K + 1')]);
    expect(ok.fsOut).toContain('texture(bgt_t2,');
    expect(ok.uniforms!.find(u => u.name === 's[0]')).toMatchObject({ size: 3, slot: 1 });
    expect(link([VS], [src('int(gl_FragCoord.x)')]).fsEmitLog).toContain('dynamic sampler-array indexing');
  });
  it('shares one ordinary-uniform layout between stages and assigns blocks to slots 1..7', () => {
    const r = program([assets('quad.vert')], [assets('tile1.frag')]);
    expect(r.blocks).toEqual([{ name: 'Params', size: 128, members: 6, stages: 2 }]);
    expect(r.vsOut).toContain('layout(std140) uniform bgt_u0 { vec4 bgt_gl_meta; int selector; vec2 shift; vec2 extent; };');
    expect(r.fsOut).toContain('layout(std140) uniform bgt_u0 { vec4 bgt_gl_meta; int selector; vec2 shift; vec2 extent; };');
    expect(r.fsOut).toContain('layout(std140) uniform bgt_u1 {');
    expect(r.fsOut).toContain('} params;');
    expect(r.vsOut).not.toContain('bgt_u1');
    expect(find(r, 'selector').location).toBe(0);
  });
  it('bounds the merged stage-uniform table without corrupting memory', () => {
    const stage = (prefix: string, vertex: boolean) => `#version 330 core\n${Array.from({ length: 192 }, (_, i) => `uniform float ${prefix}${i};`).join('\n')}\n${vertex ? '' : 'out vec4 c;'}\nvoid main(){${vertex ? 'gl_Position' : 'c'}=vec4(${Array.from({ length: 192 }, (_, i) => `${prefix}${i}`).join('+')});}`;
    const r = link([stage('v', true)], [stage('f', false)]);
    // The declaration cap includes the fragment output; 191+192 distinct uniforms still exceed one stage's cap.
    const fs = stage('f', false).replace('uniform float f191;', '').replace('+f191', '');
    const merged = link([stage('v', true)], [fs]);
    expect(r.fs!.ok).toBe(false);
    expect(merged.linked, merged.linkLog).toBe(true);
    expect(merged.uniforms).toHaveLength(383);
  });
  it('stays inside the ordinary uniform storage bound', () => {
    const fs = `#version 330 core\nuniform vec4 big[2000];\nout vec4 c;\nvoid main(){c=big[1999];}\n`;
    const r = link([VS], [fs]); expect(r.linked).toBe(false); expect(r.linkLog).toContain('storage limit');
  });
});

// Every shipped fixture pair must translate for WebGPU (WGSL) and satisfy the WebGL 2 ES 3.00 validator.
describe('canonical output through both backend frontends', () => {
  const pairs: [string, string[], string[], Record<string, number>?][] = [
    ['tile0', ['quad.vert'], ['tile0.frag']], ['tile1', ['quad.vert'], ['tile1.frag']], ['tile2', ['quad.vert'], ['tile2.frag']],
    ['tile3', ['quad.vert'], ['tile3.frag']], ['tile4', ['tile4.vert'], ['tile4.frag'], { pos: 3, coord: 1 }],
    ['tile7', ['quad.vert'], ['tile7.frag']],
  ];
  it.each(pairs)('%s', (label, vs, fs, attr) => {
    const r = link(vs.map(assets), fs.map(assets), { attr });
    expect(r.linked, `${label}: ${r.linkLog}`).toBe(true);
    const varyings = [...new Set([...(r.vsOut!.matchAll(/\bout\s+\w+\s+(\w+);/g)), ...(r.fsOut!.matchAll(/\bin\s+\w+\s+(\w+);/g))]
      .map(m => m[1]))].sort();
    for (const [stage, source] of [[1, r.vsOut!], [2, r.fsOut!]] as const) {
      const wgsl = translateGLSL(source, stage, 1, varyings);
      expect(shaderBindings(wgsl).filter(b => b.group === 0).every(b => b.type === 'uniform')).toBe(true);
      expect(() => translateShader(source, stage, 1)).not.toThrow();
    }
  });
  it('translates all variants of the multi-string fragment shader', () => {
    for (const [define, color] of [[2, 'vec3(1.0, 1.0, 0.0)'], [1, 'vec3(0.0, 0.0, 1.0)']] as const) {
      const r = link([assets('quad.vert')], ['#version 330 core\n', `#define VARIANT ${define}\n`, assets('variant.frag')]);
      expect(r.linked, `${r.fs!.log}${r.linkLog}`).toBe(true);
      expect(compact(r.fsOut!)).toContain(compact(`fragColor = vec4(${color}, 1.0);`));
      expect(r.outputs).toEqual([{ name: 'fragColor', type: 0x8b52, size: 1, location: 0 }]);
      translateGLSL(r.fsOut!, 2, 1, ['pick', 'ramp', 'tc']);
      expect(r.fs!.pp.split('\n')[1]).toBe(''); // the prepended #define line becomes an empty line
    }
  });
});

describe('WebGPU frontend: structures, std140 storage forms and calling conventions', () => {
  const wgsl = (body: string, stage = 2, header = '') => translateGLSL(`#version 330 core\n${header}\n${body}`, stage, 1);
  it('hoists structures, arrays of structures and padded scalar arrays out of std140 blocks', () => {
    const code = wgsl(`struct Light { vec3 color; float w; };
layout(std140) uniform bgt_u0 { vec4 bgt_gl_meta; Light lights[2]; float gains[3]; bool on; mat2 m; };
layout(location=0) out vec4 c;
void main(){ Light l = lights[1]; c = vec4(l.color * gains[2], on ? 1.0 : l.w); c.xy = m * c.xy; }`);
    expect(code).toContain('struct Light_u { @align(16) color: vec3f, @align(4) w: f32 };');
    expect(code).toContain('lights: array<Light_u, 2>');
    expect(code).toContain('gains: array<vec4<f32>, 3>');
    expect(code).toContain('on: u32');
    expect(code).toContain('bgt_internal_load_Light(bgt_internal_bgt_u0.lights[1i])');
    expect(code).toContain('bgt_internal_bgt_u0.gains[2i].x');
    expect(code).toContain('(bgt_internal_bgt_u0.on != 0u)');
    expect(code).toContain('m: mat2x4f');
  });
  it('supports out / inout parameters, const array sizes, length() and multiple declarators', () => {
    const code = wgsl(`const int N = 2; const int M = N * 3;
void bump(in float a, inout float b, out float c) { a += 1.0; b += a; c = b; }
layout(location=0) out vec4 o;
void main(){ float x = 1.0, y = 2.0, z; bump(x, y, z); float t[M]; t[M - 1] = z; o = vec4(t[5], float(t.length()), x, y); }`);
    expect(code).toContain('fn bump(bgt_internal_p_a: f32, b: ptr<function, f32>, c: ptr<function, f32>)');
    expect(code).toContain('bump(x, &y, &z)');
    expect(code).toContain('var t: array<f32, 6>');
    expect(code).toContain('var x: f32 = 1.0; var y: f32 = 2.0; var z: f32');
    expect(() => wgsl('layout(location=0) out vec4 o;\nvoid f(out float r){ r = 1.0; }\nvoid main(){ o = vec4(0.0); f(o.x); }')).toThrow('local variables');
  });
  it('supports prototypes, relational built-ins, user structures and gl_PointSize', () => {
    const code = wgsl(`struct P { vec2 a; float b[2]; };
float f(P p);
layout(location=0) out vec4 o;
float f(P p) { return p.a.x + p.b[1]; }
void main(){ P p = P(vec2(1.0), float[2](2.0, 3.0)); bvec2 lt = lessThan(p.a, vec2(2.0)); o = vec4(f(p)); if (any(lt)) o.w = 0.0; }`);
    expect(code).toContain('(p.a < vec2f(2.0))'.replace('p.a', 'p.a'));
    expect(code).toContain('struct P { a: vec2f, b: array<f32, 2> };');
    const vs = translateGLSL('#version 330 core\nlayout(location=0) in vec4 p;\nvoid main(){ gl_PointSize = 4.0; gl_Position = p; }', 1, 1);
    expect(vs).toContain('bgt_internal_point_size = 4.0');
  });
});

describe('WebGL 2 (GLSL ES 3.00) translation of the canonical source', () => {
  it('emulates noperspective with value*w and w through the perspective-correct path', () => {
    const r = link([assets('quad.vert')], [assets('tile2.frag')]);
    expect(r.linked, r.linkLog).toBe(true);
    const vs = translateShader(r.vsOut!, 1, 1), fs = translateShader(r.fsOut!, 2, 1);
    expect(vs).not.toContain('noperspective');
    expect(vs).toContain('out float bgt_internal_q;');
    expect(vs).toContain('out float bgt_internal_np_ramp; float ramp;');
    expect(vs).toMatch(/bgt_internal_np_ramp = ramp \* gl_Position\.w;\s+bgt_internal_q = gl_Position\.w;/);
    expect(fs).toContain('in float bgt_internal_np_ramp; float ramp;');
    expect(fs).toContain('ramp = bgt_internal_np_ramp / bgt_internal_q;');
  });
});
