// SPDX-License-Identifier: CC0-1.0
// Original independent known answers, never captured game shaders.
import type { GlslRegression } from './glsl-regressions';
const success = [64, 128, 191, 255];
export const builtinRegressions: GlslRegression[] = [];
const matrices = [
  { n: 2, m: [2,1,1,1], inv: [1,-1,-1,2] },
  { n: 3, m: [1,0,5,2,1,6,3,4,0], inv: [-24,20,-5,18,-15,4,5,-4,1] },
  { n: 4, m: [1,0,0,0,1,1,0,0,2,3,1,0,4,5,6,1], inv: [1,0,0,0,-1,1,0,0,1,-3,1,0,-5,13,-6,1] },
];
for (const { n, m, inv } of matrices) {
  const uniform = m.flatMap((_, c) => c < n ? [...m.slice(c*n, (c+1)*n), ...Array(4-n).fill(0)] : []);
  builtinRegressions.push({ name: 'inverse-mat' + n, expected: success, uniform,
    header: 'layout(std140) uniform bgt_u0 { mat' + n + ' m; };',
    body: 'mat' + n + ' a = inverse(m); bool valid = a == mat' + n + '(' + inv.map(x => x + '.0').join(',') +
      ') && m * a == mat' + n + '(1.0) && a * m == mat' + n + '(1.0);' +
      ' o = valid ? vec4(0.25,0.5,0.75,1.0) : vec4(0.0);' });
}
builtinRegressions.push({ name: 'inverse-evaluates-once', expected: success,
  header: 'int calls = 0; mat4 value() { calls++; return mat4(2.0); }',
  body: 'mat4 a = inverse(value()); o = a == mat4(0.5) && calls == 1 ? vec4(0.25,0.5,0.75,1.0) : vec4(0.0);' });
