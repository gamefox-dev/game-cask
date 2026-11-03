// SPDX-License-Identifier: CC0-1.0
import { describe, it, expect } from 'vitest';
import { translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { lowerDepthSampling } from '../../bgt/renderers/webgpu/depth';
import { inverseHelper } from '../../bgt/renderers/webgpu/glsl-builtins';
import { builtinRegressions, invalidOffsetRegressions, depthApproximationRegressions } from '../support/glsl-builtin-regressions';
import { regressionFragment } from '../support/glsl-regressions';

describe('GLSL matrix and builtin coverage', () => {
  it('retains the explicit builtin fixture census', () => {
    expect(builtinRegressions).toHaveLength(313);
    expect(new Set(builtinRegressions.map(c=>c.name)).size).toBe(313);
  });
  for (const c of invalidOffsetRegressions) for (const language of [1,2]) it(c.name + ' rejects language ' + language, () => {
    const version = language === 1 ? '#version 330 core\n' : '#version 300 es\nprecision highp float;\n';
    expect(() => translateGLSL(version + regressionFragment(c),2,language)).toThrow('offset must be a constant expression');
  });
  for (const declaration of ['ivec2 delta=ivec2(0);','const ivec2 delta=ivec2(int(bgt_frag_coord.x),0);','ivec2 delta=value();'])
    it('does not infer constant offsets from runtime values: '+declaration,()=>{
      const source='#version 330 core\nuniform isampler2D bgt_t0; layout(location=0) out vec4 o; ivec2 value(){return ivec2(0);} void main(){'+declaration+' textureOffset(bgt_t0,vec2(0.375),delta); o=vec4(1.0);}';
      expect(()=>translateGLSL(source,2,1)).toThrow('offset must be a constant expression');
    });
  for (const kind of ['int2d','shadow','depthColor']) it('guards the '+kind+' zero footprint before logarithm',()=>{
    const c=builtinRegressions.find(c=>c.name==='zero-footprint-'+kind)!;
    let source=translateGLSL('#version 330 core\n'+regressionFragment(c),2,1,undefined,kind==='depthColor'?new Set([0]):undefined,new Map([[0,c.sampler!]]));
    if(kind==='depthColor') source=lowerDepthSampling(source,[{binding:0,sampler:c.sampler!}]);
    expect(source).toContain('log2(max(1.17549435e-38,');
  });
  for (const body of ['inverse(mat2x3(1.0))','inverse(1.0)','modf(1.0, 2.0)','frexp(1.0, 2)'])
    it('rejects invalid builtin shape/storage: ' + body, () => {
      expect(() => translateGLSL('#version 330 core\nlayout(location=0) out vec4 o; void main(){ ' + body + '; o=vec4(1.0); }',2,1)).toThrow();
    });
  for (const n of [2,3,4]) it('generates adjugate inverse mat' + n, () => {
    const helper = inverseHelper('mat' + n + 'x' + n + 'f')!;
    expect(helper.source).toContain('let d =');
    expect(helper.source.match(/ \/ d/g)).toHaveLength(n*n);
    expect(helper.source).not.toMatch(/epsilon|select|if \(/);
  });
  it('does not invent doubles or non-square inverses', () => {
    expect(inverseHelper('mat2x3f')).toBeUndefined();
    expect(inverseHelper('dmat4')).toBeUndefined();
  });
  for (const c of [...builtinRegressions,...depthApproximationRegressions]) for (const language of [1,2]) it(c.name + ' language ' + language, () => {
    const version = language === 1 ? '#version 330 core\n' : '#version 300 es\nprecision highp float;\n';
    expect(translateGLSL(version + regressionFragment(c), 2, language)).toContain('@fragment');
  });
});
