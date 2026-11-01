import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, diffFraction, hardwarePixels } from './fixtures';
import { otherBackend } from './backend-page';
import { compareGpuImages } from '../support/gpu-image';
import type { Page } from '@playwright/test';

// Eight 80x100 tiles of examples/x64-glsl. Expected colours follow from the shader sources' own arithmetic:
// tile 0 lights*gain*swap*2 -> (0.75,0.5,0.25); tile 1 std140 block with scalar array, struct, bool and mat2;
// tile 2 interpolation qualifiers around the tile midline; tile 3 two sampler-array elements bound to units 3 and 5;
// tile 4 attributes bound with glBindAttribLocation; tiles 5/6 multi-string #define variants; tile 7 out/inout.
const tiles = [
  { name: 'structure array, scalar array, bool, mat3, macros', x: 40, y: 50, rgb: [191, 128, 64] },
  { name: 'std140 block: vec4, float[3], struct, bool, mat2', x: 40, y: 50, ox: 80, rgb: [83, 89, 77] },
  { name: 'interpolation qualifiers (left of midline)', x: 20, y: 50, ox: 160, rgb: [0, 255, 65] },
  { name: 'interpolation qualifiers (right of midline)', x: 60, y: 50, ox: 160, rgb: [255, 0, 193] },
  { name: 'sampler array elements on units 3 and 5', x: 40, y: 50, ox: 240, rgb: [200, 50, 0] },
  { name: 'glBindAttribLocation / glBindFragDataLocation', x: 20, y: 75, oy: 100, rgb: [65, 64, 31] },
  { name: 'variant 2 via prepended #define', x: 40, y: 50, ox: 80, oy: 100, rgb: [255, 255, 0] },
  { name: 'variant 1 via prepended #define', x: 40, y: 50, ox: 160, oy: 100, rgb: [0, 0, 255] },
  { name: 'out/inout parameters, const array sizes, length()', x: 40, y: 50, ox: 240, oy: 100, rgb: [191, 128, 128] },
];
for (const cross of [false, true])
  test(`x64-glsl: ${cross ? 'cross-backend images agree @webgpu' : 'all eight shader tiles have exact pixels'}`,
  async ({ page, backendParam, collector }, info) => {
    void collector;
    const capture = async (p: Page, backend: string) => {
      const status = await openGame(p, backend, { game: 'x64-glsl' });
      await assertBackend(p, backend, info);
      expect(status, JSON.stringify(await diagnostics(p))).toBe('ready');
      for (let i = 0; i < 100; i++) {
        await step(p, 1); await p.waitForTimeout(10);
        if ((await diagnostics(p)).logs.some(l => l.message.includes('x64-glsl PASS'))) break;
      }
      await step(p, 3);
      const d = await diagnostics(p), m = d.metrics as Record<string, any>;
      expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
      for (const text of ['x64-glsl diagnostics ok', 'x64-glsl reflection ok', 'x64-glsl PASS tiles=8'])
        expect(d.logs.some(l => l.message.includes(text)), JSON.stringify(d.logs)).toBe(true);
      expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]); expect(m.exited).toBe(0);
      expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]); expect(m.gl_pipelines).toBe(8);
      const px = await readPixels(p);
      if (hardwarePixels()) for (const probe of tiles) {
        const x = Math.floor(d.letterbox.x + (probe.x + (probe.ox ?? 0) + .5) * d.letterbox.w / 320);
        const y = Math.floor(d.letterbox.y + (probe.y + (probe.oy ?? 0) + .5) * d.letterbox.h / 200), i = (y * px.width + x) * 4;
        for (let c = 0; c < 3; c++) expect(Math.abs(px.data[i + c] - probe.rgb[c]), `${probe.name} channel ${c}`).toBeLessThanOrEqual(3);
      }
      if (hardwarePixels()) expect(diffFraction(px, await readPixels(p), 0), 'repeat capture').toBe(0);
      await info.attach(`x64-glsl-${backend}.png`, { body: await p.locator('canvas').screenshot(), contentType: 'image/png' });
      return px;
    };
    const a = await capture(page, backendParam);
    if (!cross) return;
    const backend = backendParam === 'webgpu' ? 'webgl2' : 'webgpu';
    const b = await otherBackend(backend, info, p => capture(p, backend));
    const comparison = compareGpuImages(a, b); console.log('GLSL COMPARISON', comparison);
    expect(comparison.different).toBeLessThanOrEqual(0.015);
    expect(comparison.unmatched).toBeLessThanOrEqual(0.001);
  });
