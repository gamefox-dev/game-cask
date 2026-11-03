// SPDX-License-Identifier: CC0-1.0
import { describe, expect, it } from 'vitest';
import { translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { translateShader } from '../../bgt/renderers/webgl2/shaders';
import { regressionFragment } from '../support/glsl-regressions';
import { reviewRegressions } from '../support/glsl-review-regressions';

describe('vK17a independent review regressions', () => {
  const overloaded = 'uniform sampler2D bgt_t0; layout(location=0) out vec4 o; ' +
    'float textureOffset(sampler2D s) { return 0.25; } ' +
    'void main() { o = textureOffset(bgt_t0, vec2(0.5), ivec2(0)); }';
  it('desktop includes the builtin when no user overload matches', () => {
    const source = '#version 330 core\n' + overloaded;
    expect(translateGLSL(source, 2, 1)).toContain('textureSample(');
    expect(translateShader(source, 2, 1)).toContain('textureOffset(bgt_t0,');
  });
  it('ES user declarations hide the builtin when no user overload matches', () => {
    const source = '#version 300 es\nprecision highp float;\n' + overloaded;
    for (const translate of [translateGLSL, translateShader])
      expect(() => translate(source, 2, 2)).toThrow('no matching opaque helper overload');
  });
  it('desktop builtin fallback still validates invalid arity in an unused helper', () => {
    const source = '#version 330 core\n' + overloaded.replace(
      'void main()', 'vec4 unused(sampler2D s) { return textureOffset(s, vec2(0.5)); } void main()');
    for (const translate of [translateGLSL, translateShader])
      expect(() => translate(source, 2, 1)).toThrow('invalid opaque texture builtin argument count');
  });
  for (const language of [1, 2]) for (const c of reviewRegressions) it(c.name + ' language ' + language, () => {
    const version = language === 1 ? '#version 330 core\n' : '#version 300 es\nprecision highp float;\n';
    const source = version + regressionFragment(c);
    const wgsl = translateGLSL(source, 2, language);
    expect(wgsl).toContain('@fragment fn fs_main');
    expect(translateShader(source, 2, language)).toContain('#version 300 es');
    // GLSL constant provenance does not imply WGSL const-evaluability: these
    // initializers call generated matrix, equality or scalar-numeric helpers.
    if (c.name.startsWith('local-const-')) {
      expect(wgsl).not.toMatch(/\bconst [abc]:/);
      expect(wgsl).toMatch(/\blet [ab]:/);
    }
  });
});
