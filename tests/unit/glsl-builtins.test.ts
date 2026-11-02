// SPDX-License-Identifier: CC0-1.0
import { describe, it, expect } from 'vitest';
import { translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { inverseHelper } from '../../bgt/renderers/webgpu/glsl-builtins';
import { builtinRegressions } from '../support/glsl-builtin-regressions';
import { regressionFragment } from '../support/glsl-regressions';

describe('GLSL matrix and builtin coverage', () => {
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
  for (const c of builtinRegressions) for (const language of [1,2]) it(c.name + ' language ' + language, () => {
    const version = language === 1 ? '#version 330 core\n' : '#version 300 es\nprecision highp float;\n';
    expect(translateGLSL(version + regressionFragment(c), 2, language)).toContain('@fragment');
  });
});
