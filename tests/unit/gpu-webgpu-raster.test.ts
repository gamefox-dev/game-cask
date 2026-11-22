// SPDX-License-Identifier: CC0-1.0. K62 WebGPU executor pieces that need no device: the clamped-viewport view
// transform (window coordinates must equal the unclamped viewport's), the packed varying interface and the
// last-vertex-first rotation. Pixels on real devices: tests/e2e/x64-gl-raster.spec.ts.
import { describe, expect, it } from 'vitest';
import { clampViewport } from '../../bgt/renderers/webgpu/view';
import { linkedVaryings, packVaryings, shaderBindings, translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { rotateList } from '../../bgt/renderers/webgpu/provoking';

const f32 = (x: number) => Math.fround(x);
describe('K62 WebGPU viewport clamping', () => {
  it('maps clip space onto the clamped rectangle exactly where the unclamped viewport would (top-left, +y down)', () => {
    // Breakage caught: a plain clamp (no transform) squeezes the image into the visible part of the viewport.
    for (const [x, y, w, h, W, H] of [[0, -128, 256, 160, 32, 32], [-16, 0, 48, 40, 32, 32], [20, -32, 40, 40, 32, 32],
      [-128, -80, 512, 320, 256, 160], [192, 96, 96, 64, 256, 160], [0.75, 1.75, 5.5, 4.5, 8, 8]]) {
      const c = clampViewport(x, y, w, h, W, H), [nx, ny, nw, nh] = c.native, [sx, sy, ox, oy] = c.transform.map(f32);
      expect(c.empty).toBe(false);
      expect(nx).toBeGreaterThanOrEqual(0); expect(ny).toBeGreaterThanOrEqual(0);
      expect(nx + nw).toBeLessThanOrEqual(W); expect(ny + nh).toBeLessThanOrEqual(H);
      for (const [xd, yd] of [[-1, -1], [1, 1], [0.3, -0.7], [-0.25, 0.9]]) {
        const xw = x + (xd + 1) * w / 2, yw = y + (1 - yd) * h / 2;           // the unclamped viewport's window position
        const xc = xd * sx + ox, yc = yd * sy + oy;                            // clip w = 1
        expect(nx + (xc + 1) * nw / 2).toBeCloseTo(xw, 3); expect(ny + (1 - yc) * nh / 2).toBeCloseTo(yw, 3);
      }
    }
    expect(clampViewport(0, 0, 32, 32, 32, 32).transform).toEqual([1, 1, 0, 0]);   // fitting viewports keep the identity
    expect(clampViewport(40, 0, 10, 10, 32, 32).empty).toBe(true);
    expect(clampViewport(-60, -60, 20, 20, 32, 32).empty).toBe(true);
    expect(clampViewport(-32768, -32768, 1, 1, 256, 160).empty).toBe(true);
  });
});
describe('K62 packed varyings', () => {
  const vs = '#version 330 core\nlayout(location=0) in vec2 p;out vec3 a;noperspective out float b;flat out ivec2 c;out float d;flat out vec3 e;' +
    'void main(){a=vec3(1);b=2.0;c=ivec2(3,-4);d=5.0;e=vec3(6);gl_Position=vec4(p,0.0,1.0);}';
  const fs = '#version 330 core\nin vec3 a;noperspective in float b;flat in ivec2 c;in float d;flat in vec3 e;layout(location=0) out vec4 o;' +
    'void main(){o=vec4(a.x+b+d,float(c.y),e.z,1.0);}';
  it('packs per interpolation class into dense vec4 locations, spanning locations where needed', () => {
    const p = packVaryings(linkedVaryings(vs, fs));
    // smooth: a.xyz d -> location 0; linear: b -> 1; flat (u32 bits): c.xy e.xy -> 2, e.z -> 3.
    expect(p.slots).toEqual([{ location: 0, interpolation: 'smooth' }, { location: 1, interpolation: 'linear' },
      { location: 2, interpolation: 'flat' }, { location: 3, interpolation: 'flat' }]);
    expect(p.at.get('e')).toEqual([{ location: 2, component: 2, flat: true }, { location: 2, component: 3, flat: true },
      { location: 3, component: 0, flat: true }]);
    const v = translateGLSL(vs, 1, 1, undefined, undefined, undefined, { packing: p, viewTransform: true });
    const f = translateGLSL(fs, 2, 1, undefined, undefined, undefined, { packing: p });
    expect(v).toContain('@location(2) @interpolate(flat) bgt_internal_v2: vec4u');
    expect(v).toContain('bgt_internal_out.bgt_internal_v2[0] = bitcast<u32>(c.x);');
    expect(f).toContain('@location(1) @interpolate(linear) bgt_internal_v1: vec4f');
    expect(f).toContain('e = vec3f(bitcast<f32>(bgt_internal_in.bgt_internal_v2[2]), bitcast<f32>(bgt_internal_in.bgt_internal_v2[3]), bitcast<f32>(bgt_internal_in.bgt_internal_v3[0]));');
    // The view transform is renderer-internal (group 2): not a §13 binding.
    expect(v).toContain('@group(2) @binding(0) var<uniform> bgt_internal_view');
    expect(shaderBindings(v).some(b => b.group === 2)).toBe(false);
  });
  it('fits 106 float varyings into 27 locations (the 28-location adapter) where unpacked needs 106', () => {
    const decls = Array.from({ length: 106 }, (_, i) => ({ name: `f${i}`, type: 'float', interpolation: 'smooth' as const }));
    expect(packVaryings(decls).slots).toHaveLength(27);
    // Worst case of the reported capacity 4L - 6: two classes of one component each plus the rest.
    const worst = [...decls.slice(0, 4 * 16 - 6 - 2), { name: 'l', type: 'float', interpolation: 'linear' as const },
      { name: 'i', type: 'int', interpolation: 'flat' as const }];
    expect(packVaryings(worst).slots.length).toBeLessThanOrEqual(16);
  });
});
describe('K62 WGSL type names as GLSL identifiers', () => {
  it('renames f32/vec4f/array-like GLSL names (a varying named f32 was a cyclic WGSL declaration)', () => {
    const v = translateGLSL('#version 330 core\nlayout(location=0) in vec2 p;out float f32;out vec2 vec4f;void main(){f32=1.0;vec4f=p;gl_Position=vec4(p,0.0,1.0);}', 1, 1);
    expect(v).toContain('var<private> bgt_internal_glsl_f32: f32;'); expect(v).toContain('bgt_internal_glsl_vec4f: vec2f');
  });
});
describe('K62 provoking vertex rotation', () => {
  it('draws each primitive last-vertex-first, keeping the triangle winding', () => {
    expect([...rotateList([0, 1, 2, 3, 4, 5, 6], 3)]).toEqual([2, 0, 1, 5, 3, 4]);
    expect([...rotateList([7, 8, 9], 2)]).toEqual([8, 7]);
  });
});
