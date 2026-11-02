// SPDX-License-Identifier: CC0-1.0
import { describe, expect, it } from 'vitest';
import { translateShader } from '../../bgt/renderers/webgl2/shaders';
import { translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { validateNativeLvalues, indexedSwizzleDiagnostic } from '../../bgt/renderers/webgl2/glsl-boundaries';
import { webglBoundaryRegression } from '../support/glsl-storage-regressions';
import { regressionFragment } from '../support/glsl-regressions';
describe('WebGL native indexed-swizzle out/inout boundary is contained before compilation', () => {
  it.each(['out', 'inout'])('rejects %s dynamic indexed swizzle with a named diagnostic', mode => {
    expect(() => validateNativeLvalues(`void put(${mode} float a){} void main(){vec4 v; int i=0; put(v.wy[i++]);}`)).toThrow(indexedSwizzleDiagnostic);
  });
  it.each(['v.wy', 'v.y', 'v[i++]', 'box.rgba', 'v.wy[1]', 'v.wy[1u]'])('does not reject supported direct storage %s', place => {
    expect(() => validateNativeLvalues(`void put(out float a){} void main(){vec4 v; int i=0; put(${place});}`)).not.toThrow();
  });
  it('handles nested calls/argument commas and parenthesized indices', () => {
    expect(() => validateNativeLvalues('struct B { vec4 v; }; void put(inout float b){} void main(){B box; put((box.v).yx[(next())]);}')).toThrow(indexedSwizzleDiagnostic);
  });
  it('records comma-separated struct members and chooses the matching overload', () => {
    expect(() => validateNativeLvalues('struct B { vec4 unused, v; }; void put(out float a){} void main(){B box; put(box.v.wy[i++]);}')).toThrow(indexedSwizzleDiagnostic);
    expect(() => validateNativeLvalues('void put(out float a){} float put(float a,float b){return a+b;} void main(){vec4 v; o=vec4(put(v.wy[i++],0.5));}')).not.toThrow();
  });
  it('does not confuse indexed struct-array members with vector swizzles', () => {
    const source = '#version 330 core\nstruct S { float rgba[2]; }; void put(out float a) { a=1.0; } void main(){S s; int i=0; put(s.rgba[i]);}';
    expect(() => translateShader(source, 1, 1)).not.toThrow();
  });
  it('does not confuse a shadowed vector name with an indexed struct-array member', () => {
    const source = '#version 330 core\nstruct S { float rgba[2]; }; vec4 s; void put(out float a) { a=1.0; } void main(){S s; int i=0; put(s.rgba[i]);}';
    expect(() => translateShader(source, 1, 1)).not.toThrow();
  });
  it('does not reject an indexed swizzle passed by value or hidden in comments', () => {
    expect(() => translateShader('#version 330 core\nvoid put(float a){}void main(){vec4 v=vec4(0.0);int i=0;put(v.wy[i]);/* void other(out float a){}other(v.wy[i]); */}', 1, 1)).not.toThrow();
  });
  it('rejects the diagnostic fixture on WebGL but retains mutable WGSL copy-out', () => {
    const source = '#version 330 core\n' + regressionFragment(webglBoundaryRegression);
    expect(() => translateShader(source, 2, 1)).toThrow(indexedSwizzleDiagnostic);
    const code = translateGLSL(source, 2, 1);
    expect(code).toContain('array<u32, 2>(3u, 1u)');
    expect(code).toMatch(/v\[bgt_internal_value_\d+\] = bgt_internal_argument_/);
  });
});
