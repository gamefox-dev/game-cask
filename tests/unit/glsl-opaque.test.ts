// SPDX-License-Identifier: CC0-1.0
// @bgt-examples: x64-glsl
import { describe, expect, it } from 'vitest';
import { runGlsl } from '../support/glsl-native';
import { specializeOpaqueSamplers } from '../../bgt/renderers/glsl-opaque';
import { translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { translateShader } from '../../bgt/renderers/webgl2/shaders';
const version = '#version 330 core\n';
const helpers = `vec4 leaf(in sampler2D s, vec2 uv){ return texture(s, uv); }
vec4 forward(vec2 uv, const in highp sampler2D s){ return leaf(s, uv); }
vec4 leaf(in sampler3D s, vec3 uv){ return texture(s, uv); }
void main(){ o=forward(vec2(0.25),first)+forward(vec2(0.75),second)+leaf(volume,vec3(0.5)); }`;
const globals = 'uniform sampler2D first, second; uniform sampler3D volume; out vec4 o;\n';
describe('opaque sampler helper identity specialization', () => {
  it('C frontend preserves reflection and applies coordinate/swizzle transforms at the actual slot', () => {
    const r = runGlsl({ fs: [version + globals + helpers] });
    expect(r.fs?.ok, r.fs?.log).toBe(true); expect(r.linked, r.linkLog).toBe(true);
    expect(r.fsOut, r.fsEmitLog).toBeTruthy(); expect(r.slots).toBe(3);
    expect(r.uniforms?.map(u => [u.name, u.type])).toEqual([['first', 0x8b5e], ['second', 0x8b5e], ['volume', 0x8b5f]]);
    for (const slot of [0, 1, 2]) expect(r.fsOut).toContain(`bgt_gl_sw${slot}(texture(bgt_t${slot},bgt_gl_uv${slot === 2 ? '3' : ''}(`);
    expect(r.fsOut).not.toMatch(/\b(?:leaf|forward)\s*\(/);
    expect(translateGLSL(r.fsOut!, 2, 1)).toContain('@fragment fn fs_main');
    expect(translateShader(r.fsOut!, 2, 1)).toContain('#version 300 es');
  });
  it('direct canonical helper calls are specialized in both backend frontends', () => {
    const source = version + 'uniform sampler2D bgt_t0; uniform sampler2D bgt_t1; uniform sampler3D bgt_t2; layout(location=0) out vec4 o;\n' +
      helpers.replace(/\bfirst\b/g, 'bgt_t0').replace(/\bsecond\b/g, 'bgt_t1').replace(/\bvolume\b/g, 'bgt_t2');
    expect(translateGLSL(source, 2, 1)).toContain('textureSample(bgt_t0, bgt_t0_sampler');
    expect(translateGLSL(source, 2, 1)).toContain('textureSample(bgt_t1, bgt_t1_sampler');
    expect(translateShader(source, 2, 1)).not.toMatch(/\b(?:leaf|forward)\s*\(/);
  });
  for (const type of ['sampler2D', 'sampler3D', 'samplerCube', 'sampler2DArray', 'sampler2DShadow', 'samplerCubeShadow',
    'sampler2DArrayShadow', 'isampler2D', 'usampler2D', 'isampler3D', 'usampler3D', 'isamplerCube', 'usamplerCube', 'isampler2DArray', 'usampler2DArray']) {
    it(`generic opaque identity lowering: ${type}`, () => {
      const source = `uniform ${type} source; void sink(${type} value){} void pass(in ${type} forwarded){sink(forwarded);} void main(){pass(source);}`;
      const out = specializeOpaqueSamplers(source);
      expect(out).not.toMatch(/\b(?:sink|pass)\s*\(/); expect(out).toContain('uniform ' + type + ' source;');
      const r = runGlsl({ fs: [version + source], reflectOnly: true });
      expect(r.fs?.ok, r.fs?.log).toBe(true); expect(r.fsOut, r.fsEmitLog).toBeTruthy();
      expect(r.fsOut).not.toMatch(/\b(?:sink|pass)\s*\(/);
    });
  }
  it('constant-indexed uniform array elements retain their distinct reflected slots through forwarding', () => {
    const r = runGlsl({ fs: [version + `uniform sampler2D images[2];out vec4 o;
      vec4 read(sampler2D s){return texture(s,vec2(0.5));}
      vec4 pass(sampler2D s){return read(s);}
      void main(){o=pass(images[1])+pass(images[0]);}`] });
    expect(r.fsOut, r.fsEmitLog).toBeTruthy(); expect(r.slots).toBe(2);
    expect(r.uniforms?.map(u => [u.name, u.size, u.location])).toEqual([['images[0]', 2, 0]]);
    for (const slot of [0, 1]) expect(r.fsOut).toContain(`bgt_gl_sw${slot}(texture(bgt_t${slot},bgt_gl_uv(`);
    expect(translateGLSL(r.fsOut!, 2, 1)).toContain('@fragment fn fs_main');
  });
  it('parenthesized uniform array bases select the same constant-indexed sampler identity', () => {
    const r = runGlsl({ fs: [version + `uniform sampler2D images[2];out vec4 o;
      vec4 read(sampler2D s){return texture(s,vec2(0.5));}
      void main(){o=read(((images))[1])+read((images[0]));}`] });
    expect(r.fs?.ok, r.fs?.log).toBe(true); expect(r.fsOut, r.fsEmitLog).toBeTruthy(); expect(r.slots).toBe(2);
    for (const slot of [0, 1]) expect(r.fsOut).toContain(`bgt_gl_sw${slot}(texture(bgt_t${slot},bgt_gl_uv(`);
    expect(translateGLSL(r.fsOut!, 2, 1)).toContain('@fragment fn fs_main');
  });
  for (const call of ['use(s)', 'use()', 'use(s,0.0,1.0)']) it(`validates unused opaque helper call signatures: ${call}`, () => {
    const source = `void use(sampler3D v,float n){} void unused(sampler2D s){${call};}void main(){}`;
    expect(() => specializeOpaqueSamplers(source)).toThrow('no matching opaque helper overload');
    const r = runGlsl({ fs: [version + source] }); expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('no matching opaque helper overload');
  });
  it('validates sampler type separately from call arity in unused opaque helpers', () => {
    const source = 'void use(sampler3D v){}void unused(sampler2D s){use(s);}void main(){}';
    expect(() => specializeOpaqueSamplers(source)).toThrow('no matching opaque helper overload');
    const r = runGlsl({ fs: [version + source] }); expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('no matching opaque helper overload');
  });
  it('WGSL discard does not satisfy a nonvoid helper return requirement', () => {
    const source = version + 'uniform sampler2D bgt_t0;layout(location=0) out vec4 o;float read(sampler2D s,bool k){if(k){discard;}else{return texture(s,vec2(0.5)).r;}}void main(){o=vec4(read(bgt_t0,false));}';
    expect(translateGLSL(source, 2, 1)).toContain('return f32();');
    const r = runGlsl({ fs: [source] }); expect(r.fsOut, r.fsEmitLog).toBeTruthy();
    expect(translateGLSL(r.fsOut!, 2, 1)).toContain('return f32();');
  });
  for (const source of [
    'void bad(sampler2D s){vec4 a=texture(s[0],vec2(0.5));}void main(){}',
    'uniform sampler2D image;void bad(sampler2D s){vec4 a=texture(image[0],vec2(0.5));}void main(){}',
  ]) it('rejects invalid scalar indexing even in an unused texture builtin call', () => {
    expect(() => specializeOpaqueSamplers(source)).toThrow('opaque sampler scalar/array identity mismatch');
    const r = runGlsl({ fs: [version + source] }); expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('opaque sampler');
  });
  it('hygiene leaves local struct members out of the lexical variable namespace', () => {
    const source = 'uniform sampler2D bgt_t0;out vec4 o;vec4 read(sampler2D s){struct S{float bgt_t0;};S q=S(1.0);return texture(s,vec2(0.5))*q.bgt_t0;}void main(){o=read(bgt_t0);}';
    const out = specializeOpaqueSamplers(source); expect(out).toContain('float bgt_t0;'); expect(out).toContain('q.bgt_t0');
    const r = runGlsl({ fs: [version + source] }); expect(r.fsOut, r.fsEmitLog).toBeTruthy();
    expect(r.fsOut).toMatch(/float bgt_t0\s*;/); expect(r.fsOut).toContain('q.bgt_t0');
  });
  for (const language of [1, 2]) for (const ordinary of [false, true])
    it(`anonymous struct fields retain uniform and sampler-parameter spellings (language ${language}, ordinary ${ordinary})`, () => {
      const source = (language === 1 ? version : '#version 300 es\nprecision highp float;\n') +
        'uniform sampler2D bgt_t0;layout(location=0) out vec4 o;' + (ordinary ? 'float value();' : '') +
        'vec4 read(sampler2D s){' + (ordinary ? 'return texture(s,vec2(0.5))*value();}float value(){' : '') +
        'struct {float bgt_t0;float s;}q;q.bgt_t0=1.0;q.s=1.0;' +
        (ordinary ? 'return q.bgt_t0*q.s;}' : 'return texture(s,vec2(0.5))*q.bgt_t0*q.s;}') +
        'void main(){o=read(bgt_t0);}';
      const out = specializeOpaqueSamplers(source);
      expect(out).toContain('float bgt_t0;float s;'); expect(out).toContain('q.bgt_t0'); expect(out).toContain('q.s');
      expect(translateShader(source, 2, language)).toMatch(/float bgt_t0\s*;/);
      const r = runGlsl({ fs: [source] }); expect(r.fsOut, r.fsEmitLog).toBeTruthy();
      expect(r.fsOut).toMatch(/float bgt_t0\s*;/); expect(r.fsOut).toContain('q.bgt_t0');
    });
  it('ordinary value functions do not acquire uniform-only inline-struct restrictions', () => {
    const source = 'out vec4 o;struct S{float x;}v;S f(S a){return a;}void main(){v.x=0.5;o=vec4(f(v).x);}';
    const r = runGlsl({ fs: [version + source] }); expect(r.fsOut, r.fsEmitLog).toBeTruthy(); expect(r.fsOut).toMatch(/struct S/);
  });
  it('a helper parameter does not activate a shadowed global sampler or change reflection', () => {
    const r = runGlsl({ fs: [version + `uniform samplerCube unused;uniform sampler2D image;out vec4 o;
      vec4 read(sampler2D unused){return texture(unused,vec2(0.5));}
      void main(){o=read(image);}`] });
    expect(r.fs?.ok, r.fs?.log).toBe(true); expect(r.fsOut, r.fsEmitLog).toBeTruthy();
    expect(r.slots).toBe(1); expect(r.uniforms?.map(u => u.name)).toEqual(['image']);
    expect(r.fsOut).not.toContain('samplerCube');
  });
  it('numeric overloads with the same sampler signature retain typed overload resolution', () => {
    const source = `uniform sampler2D bgt_t0; layout(location=0) out vec4 o;
      vec4 read(sampler2D s, float x){return texture(s,vec2(x));}
      vec4 read(sampler2D s, int x){return texture(s,vec2(float(x)*0.5));}
      void main(){o=read(bgt_t0,0.25)+read(bgt_t0,1);}`;
    expect(translateGLSL(version + source, 2, 1)).toContain('bgt_internal_overload');
    const r = runGlsl({ fs: [version + source.replace('bgt_t0', 'tex').replaceAll('bgt_t0', 'tex')] });
    expect(r.fsOut, r.fsEmitLog).toBeTruthy(); expect(translateGLSL(r.fsOut!, 2, 1)).toContain('bgt_internal_overload');
  });
  for (const mode of ['out', 'inout']) it(`rejects forbidden ${mode} samplers, including unused helpers`, () => {
    const source = `void bad(${mode} sampler2D s){} void main(){}`;
    expect(() => specializeOpaqueSamplers(source)).toThrow('opaque sampler parameters must be in');
    const r = runGlsl({ fs: [version + source] });
    expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('opaque sampler parameters must be in');
  });
  it('sampler arithmetic is not accepted as a helper identity', () => {
    const source = 'uniform sampler2D tex; void use(sampler2D s){} void main(){use(tex+tex);}';
    expect(() => specializeOpaqueSamplers(source)).toThrow('unmodified sampler identities');
    const r = runGlsl({ fs: [version + source] });
    expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('opaque sampler arithmetic/assignment is forbidden');
  });
  for (const [name, helpers, body] of [
    ['numeric-parameter-cannot-capture-binding', 'vec4 read(sampler2D s,float bgt_t0){return texture(s,vec2(0.5))*bgt_t0;}', 'o=read(bgt_t0,1.0);'],
    ['numeric-local-cannot-capture-binding', 'vec4 read(sampler2D s){float bgt_t0=1.0;return texture(s,vec2(0.5))*bgt_t0;}', 'o=read(bgt_t0);'],
    ['nested-local-shadows-opaque-param', 'float read(float x){return x;} vec4 read(sampler2D s){float x;{float s=0.25;x=read(s);}return texture(s,vec2(0.5))+vec4(x);}', 'o=read(bgt_t0);'],
    ['loop-scope-restores-opaque-param', 'float read(float x){return x;} vec4 read(sampler2D s){float x=0.0;for(int s=0;s<2;s++){x+=read(float(s));}return texture(s,vec2(0.5))+vec4(x);}', 'o=read(bgt_t0);'],
    ['implicit-if-scope-restores-opaque-param', 'vec4 read(sampler2D s){if(false)float s=0.25;return texture(s,vec2(0.5));}', 'o=read(bgt_t0);'],
    ['implicit-while-scope-restores-opaque-param', 'vec4 read(sampler2D s){while(false)float s=0.25;return texture(s,vec2(0.5));}', 'o=read(bgt_t0);'],
    ['else-does-not-see-other-branch-local', 'vec4 read(sampler2D s){vec4 v=vec4(0.0);if(false)float s=0.25;else v=texture(s,vec2(0.5));return v;}', 'o=read(bgt_t0);'],
    ['zero-argument-numeric-overload', 'float read(){return 0.25;} float read(sampler2D s){return texture(s,vec2(0.5)).r;}', 'o=vec4(read()+read(bgt_t0));'],
    ['array-constant-before-specialized-prototype', 'const int N=2; float read(sampler2D s,float a[N]){return texture(s,vec2(a[0])).r;}', 'float a[2]=float[2](0.5,0.5);o=vec4(read(bgt_t0,a));'],
    ['return-precision', 'highp vec4 read(sampler2D s){return texture(s,vec2(0.5));}', 'o=read(bgt_t0);'],
  ]) it(`hygiene, declarations and overloads: ${name}`, () => {
    const src = version + 'uniform sampler2D bgt_t0;layout(location=0) out vec4 o;' + helpers + 'void main(){' + body + '}';
    expect(translateGLSL(src, 2, 1)).toContain('@fragment fn fs_main');
    expect(translateShader(src, 2, 1)).toContain('#version 300 es');
    const r = runGlsl({ fs: [src] }); expect(r.fsOut, r.fsEmitLog).toBeTruthy();
    expect(translateGLSL(r.fsOut!, 2, 1)).toContain('@fragment fn fs_main');
  });
  it('bounded specialization can grow a small source up to the full 1 MiB limit', () => {
    const source = version + Array.from({ length: 8 }, (_, i) => `uniform sampler2D image${i};`).join('') +
      'out vec4 o;vec4 read(sampler2D s){vec4 v=texture(s,vec2(0.5));' + 'v+=vec4(0.00001);'.repeat(1400) + 'return v;}void main(){o=' +
      Array.from({ length: 8 }, (_, i) => `read(image${i})`).join('+') + ';}';
    const r = runGlsl({ fs: [source] }); expect(r.fsOut, r.fsEmitLog).toBeTruthy();
    expect(r.fsOut!.length).toBeGreaterThan(150000); expect(r.fsOut!.length).toBeLessThan(1048576);
  });
  it('fails truthfully at the bounded specialization count rather than dropping helper calls', () => {
    const source = Array.from({ length: 8 }, (_, i) => `uniform sampler2D image${i};`).join('') +
      'vec4 f0(sampler2D s){return texture(s,vec2(0.5));}' +
      Array.from({ length: 33 }, (_, i) => `vec4 f${i + 1}(sampler2D s){return f${i}(s);}`).join('') +
      'out vec4 o;void main(){o=' + Array.from({ length: 8 }, (_, i) => `f33(image${i})`).join('+') + ';}';
    expect(() => specializeOpaqueSamplers(source)).toThrow('specialization limit (256)');
    const r = runGlsl({ fs: [version + source] });
    expect(r.fsOut).toBeNull(); expect(r.fsEmitLog).toContain('specialization limit (256)');
  });
  it('reports the actual expanded-source ceiling rather than returning a truncated shader', () => {
    const source = 'uniform sampler2D image;vec4 read(sampler2D s){vec4 v=texture(s,vec2(0.5));' +
      'v+=vec4(0.00001);'.repeat(66000) + 'return v;}out vec4 o;void main(){o=read(image);}';
    expect(() => specializeOpaqueSamplers(source)).toThrow('expansion exceeds 1 MiB');
    const r = runGlsl({ fs: [version + source] });
    expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('source');
  });
  it('rejects sampler arithmetic in uncalled opaque helpers instead of removing the invalid code silently', () => {
    const source = 'uniform sampler2D tex;vec4 bad(sampler2D s){return s+s;}void main(){}';
    expect(() => specializeOpaqueSamplers(source)).toThrow('opaque sampler arithmetic/assignment is forbidden');
    const r = runGlsl({ fs: [version + source] }); expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('opaque sampler arithmetic/assignment is forbidden');
  });
  for (const expression of ['if(s){}', 'float value=float(s);', 'vec4 value=vec4(s);', 'sampler2D value=s;'])
    it(`rejects non-sampler use in an unused opaque definition: ${expression}`, () => {
      const source = `uniform sampler2D image;void bad(sampler2D s){${expression}}void main(){}`;
      expect(() => specializeOpaqueSamplers(source)).toThrow(/opaque sampler/);
      const r = runGlsl({ fs: [version + source] }); expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('opaque sampler');
    });
  it('WGSL selects a typed zero only for GLSL undefined nonvoid fallthrough paths', () => {
    const source = version + `layout(location=0) out vec4 o;
      vec3 partial(int n){if(n==1)return vec3(0.25);else if(n==2)return vec3(0.75);}
      vec3 complete(bool a){if(a)return vec3(0.5);else return vec3(1.0);}
      void main(){o=vec4(partial(1)+complete(false),1.0);}`;
    const out = translateGLSL(source, 2, 1);
    expect(out.match(/GLSL undefined non-void fallthrough/g)).toHaveLength(1);
    expect(out).toContain('return vec3f();');
    expect(translateShader(source, 2, 1)).not.toContain('deterministic zero');
  });
  it('rejects the fragment-only texture bias overload in vertex helpers', () => {
    const source = version + 'uniform sampler2D bgt_t0;vec4 read(sampler2D s){return texture(s,vec2(0.5),1.0);}void main(){gl_Position=read(bgt_t0);}';
    expect(() => translateGLSL(source, 1, 1)).toThrow('texture bias is only available in fragment shaders');
  });
  for (const type of ['samplerCube', 'samplerCubeShadow', 'sampler2DArrayShadow', 'isampler3D', 'usampler3D', 'isampler2DArray', 'usampler2DArray'])
    it(`keeps unsupported active texture storage truthful: ${type}`, () => {
      const r = runGlsl({ fs: [version + `uniform ${type} image;void use(${type} s){}void main(){use(image);}`] });
      expect(r.fs?.ok).toBe(false); expect(r.fs?.log).toContain('sampler type is not supported');
    });
});
