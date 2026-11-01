// SPDX-License-Identifier: CC0-1.0
import { describe, expect, it } from 'vitest';
import { translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { translateShader } from '../../bgt/renderers/webgl2/shaders';
import { glslRegressions, regressionFragment, regressionVertex } from '../support/glsl-regressions';

describe('original GLSL known-answer corpus through both frontends', () => {
  for (const language of [1, 2]) {
    const version = language === 1 ? '#version 330 core\n' : '#version 300 es\nprecision highp float;\nprecision highp int;\n';
    it(`vertex selector and array constructor, language ${language}`, () => {
      expect(translateGLSL(version + regressionVertex, 1, language)).toContain('select(p[bgt_vertex_index]');
      expect(translateShader(version + regressionVertex, 1, language)).toContain('mix(p[bgt_vertex_index]');
    });
    it.each(glslRegressions)('$name, language ' + language, c => {
      const source = version + regressionFragment(c);
      const wgsl = translateGLSL(source, 2, language), es = translateShader(source, 2, language);
      expect(wgsl).toContain('@fragment fn fs_main');
      expect(es).toContain('#version 300 es');
      if (c.name.startsWith('mix-') && !['mix-numeric', 'mix-user-overload'].includes(c.name)) expect(wgsl).toContain('select(');
      if (c.name === 'mix-numeric') expect(wgsl).toContain('mix(vec2f(0.0), vec2f(1.0), vec2f(0.5, 0.75))');
      if (c.name === 'mix-user-overload') {
        expect(wgsl).toContain('mix(1i, 2i, true)');
        expect(es.match(/int mix\((?:const in highp )?int x, int y, bool a\)/g)).toHaveLength(1);
      }
    });
  }
});
