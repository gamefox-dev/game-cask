// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';
import { runGlsl } from '../support/glsl-native';
import { opaqueRegressions, opaqueFragment, opaqueVertex } from '../support/glsl-opaque-regressions';
import type { OpaqueCase } from './gpu-opaque-probe';

// Catches lost actual bindings, accidental sampler copies, forwarding/overload collisions,
// integer precision loss and comparison-vs-color sampling on both actual native compilers.
test('opaque sampler helpers: direct and GL canonical known-answer pixels', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready'); await assertBackend(page, backendParam, info);
  const cases: OpaqueCase[] = [];
  for (const language of [1, 2]) {
    const version = language === 1 ? '#version 330 core\n' : '#version 300 es\nprecision highp float;\nprecision highp int;\n';
    for (const c of opaqueRegressions) for (const stage of c.fragmentOnly ? ['fragment'] : ['fragment', 'vertex']) {
      if (c.webglOnly && backendParam === 'webgpu') continue;
      let fragment = opaqueFragment(c);
      // Only WGSL makes a deterministic zero choice for GLSL's undefined return value.
      // WebGL checks the defined branches and side effects, not native undefined-value parity.
      if (c.zeroFallthrough && backendParam === 'webgpu') fragment = fragment.replace('vec3 unused=choose(3);',
        'vec3 unused=choose(3);if(any(notEqual(unused,vec3(0.0)))){o=vec4(0.0);return;}');
      const vs = stage === 'fragment' ? opaqueVertex : fragment.replace('layout(location=0) out vec4 o;', 'flat out vec4 o;')
        .replace('void main(){', 'void color_main(){') + '\n' + opaqueVertex.replace('void main(){', 'void main(){color_main();');
      const fs = stage === 'fragment' ? fragment : 'flat in vec4 o;layout(location=0) out vec4 color;void main(){color=o;}';
      cases.push({ name: `${c.name}/direct/${language}/${stage}`, language, vs: version + vs, fs: version + fs, slots: c.slots, expected: c.expected });
      // Give ordinary GL uniforms noncanonical names: reflection, not source-name convention,
      // must decide bindings. Remap the fixture's texture resource identities to those slots below.
      const rename = (text: string) => text.replace(/\bbgt_t([0-7])\b/g, 'image$1');
      for (const arrayBase of c.name === 'sampler-only-argument-removal' ? [false, true] : [false]) {
        const profile = (source: string) => arrayBase ? rename(source)
          .replace('uniform sampler2D image0; uniform sampler2D image1;', 'uniform sampler2D images[2];')
          .replace(/\bimage([01])\b/g, '((images))[$1]') : c.webglOnly ? source : rename(source);
        const result = runGlsl({ vs: [version + profile(vs)], fs: [version + profile(fs)] });
        expect(result.linked, result.linkLog).toBe(true); expect(result.fsOut, result.fsEmitLog).toBeTruthy();
        expect(result.vsOut, result.vsEmitLog).toBeTruthy(); expect(result.slots).toBe(c.slots.length);
        const data = new Int32Array(result.usize! / 4); new Float32Array(data.buffer)[0] = 8;
        for (let s = 0; s < c.slots.length; s++) data.set([0, 1, 2, 3], data.length - 4 * (c.slots.length - s));
        const swizzled = c.name === 'forward-two-distinct-bindings';
        if (swizzled) { data.set([2, 1, 0, 3], data.length - 8); data.set([0, 2, 1, 3], data.length - 4); }
        cases.push({ name: `${c.name}/profile${arrayBase ? '-array-base' : ''}/${language}/${stage}`, language: 1, vs: result.vsOut!, fs: result.fsOut!,
          slots: c.slots.map((_, i) => i), resources: c.slots, expected: swizzled ? [191, 29, 64, 255] : c.expected, uniform: [...new Float32Array(data.buffer)] });
      }
    }
  }
  const result = await page.evaluate(async ({ path, backend, cases }) => {
    const { opaqueProbe } = await import(/* @vite-ignore */ path); return opaqueProbe(backend, cases);
  }, { path: `/@fs${resolve('tests/e2e/gpu-opaque-probe.ts')}`, backend: backendParam, cases });
  expect(result.errors).toEqual([]); expect(cases).toHaveLength(backendParam === 'webgpu' ? 128 : 140); expect(result.pixels).toHaveLength(cases.length);
  for (const { name, pixel, expected } of result.pixels) for (let i = 0; i < 4; i++)
    expect(Math.abs(pixel[i] - expected[i]), `${name} channel ${i}`).toBeLessThanOrEqual(1);
});
