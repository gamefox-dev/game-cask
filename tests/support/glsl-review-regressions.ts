// SPDX-License-Identifier: CC0-1.0
// Original known answers for the independent vK17a review regressions.
import type { GlslRegression } from './glsl-regressions';
const success = [64, 128, 191, 255];
export const textureBuiltinNames = ['texture', 'textureProj', 'textureLod', 'textureOffset', 'texelFetch',
  'texelFetchOffset', 'textureProjOffset', 'textureLodOffset', 'textureProjLod', 'textureProjLodOffset',
  'textureGrad', 'textureGradOffset', 'textureProjGrad', 'textureProjGradOffset', 'textureSize'];
export const reviewRegressions: GlslRegression[] = textureBuiltinNames.map(name => ({
  name: 'user-overload-' + name, texture: true, expected: success,
  header: 'uniform sampler2D bgt_t0; float ' + name + '(sampler2D s) { return 0.25; }',
  body: 'o = vec4(' + name + '(bgt_t0), 0.5, 0.75, 1.0);',
}));
reviewRegressions.push({
  name: 'user-textureOffset-same-builtin-arity', texture: true, expected: success,
  header: 'uniform sampler2D bgt_t0; float textureOffset(sampler2D s, float x, float y) { return x+y; }',
  body: 'o = vec4(textureOffset(bgt_t0, 0.125, 0.125), 0.5, 0.75, 1.0);',
}, {
  name: 'user-textureOffset-prototype-forwarding', texture: true, expected: success,
  header: 'uniform sampler2D bgt_t0; float textureOffset(sampler2D s); ' +
    'float forward(sampler2D s) { return textureOffset(s); } ' +
    'float unused(sampler2D s) { return textureOffset(s); } ' +
    'float textureOffset(sampler2D s) { return 0.25; }',
  body: 'o = vec4(forward(bgt_t0), 0.5, 0.75, 1.0);',
}, {
  name: 'local-const-negative-matrix', expected: success,
  body: 'const mat2 a = mat2(-2.0); o = a == mat2(-2.0) ? vec4(0.25,0.5,0.75,1.0) : vec4(0.0);',
}, {
  name: 'local-const-matrix-equality', expected: success,
  body: 'const bool b = mat2(1.0) == mat2(1.0); const bool c = b; o = c ? vec4(0.25,0.5,0.75,1.0) : vec4(0.0);',
}, {
  name: 'local-const-matrix-numeric-helpers', expected: success,
  body: 'const mat2 a = inverse(mat2(2.0)); const float b = dot(2.0, 0.25); ' +
    'o = a == mat2(b) ? vec4(0.25,0.5,0.75,1.0) : vec4(0.0);',
});
