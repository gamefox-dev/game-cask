import { test, expect, openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';
import { otherBackend } from './backend-page';
import { compareGpuImages } from '../support/gpu-image';
import type { Page } from '@playwright/test';

const expected = [
  [0,0,0,255], [64,0,0,255], [191,0,0,255], [64,128,0,255],
  [191,64,0,255], [64,128,191,255], [191,128,64,255], [64,128,191,128],
  [191,64,128,191], [255,128,0,255], [255,255,255,255], [128,255,64,255],
  [64,128,192,255], [192,128,64,255], [0,64,255,128], [0,64,255,128],
];
for (const cross of [false, true]) test(`x64-gl-current: ${cross ? 'cross-backend comparison @webgpu' : 'current attribute and swizzle pixels'}`,
  async ({ page, backendParam, collector }, info) => {
    void collector;
    const capture = async (p: Page, backend: string) => {
      expect(await openGame(p, backend, { game: 'x64-gl-current' })).toBe('ready');
      await assertBackend(p, backend, info);
      for (let i = 0; i < 120; i++) {
        await step(p, 1); await p.waitForTimeout(10);
        if ((await diagnostics(p)).logs.some(l => /x64-gl-current (PASS|FAIL) failures=/.test(l.message))) break;
      }
      await step(p, 4);
      const d = await diagnostics(p), m = d.metrics as Record<string, any>;
      expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
      expect(d.logs.filter(l => l.message.includes('x64-gl-current FAIL')), JSON.stringify(d.logs)).toEqual([]);
      expect(d.logs.some(l => l.message.includes('x64-gl-current PASS failures=0')), JSON.stringify(d.logs)).toBe(true);
      expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
      expect(m.gl_approximations).toBe(0);
      const px = await readPixels(p);
      for (let tile = 0; tile < 16; tile++) {
        const x = Math.floor(d.letterbox.x + ((tile % 4) * 80 + 40.5) * d.letterbox.w / 320);
        const y = Math.floor(d.letterbox.y + (Math.floor(tile / 4) * 50 + 25.5) * d.letterbox.h / 200);
        const at = (y * px.width + x) * 4;
        // Canvas composition may force alpha to one; the guest readback above asserts stored alpha as well.
        for (let c = 0; c < 3; c++) expect(Math.abs(px.data[at+c] - expected[tile][c]), `tile ${tile} channel ${c}`)
          .toBeLessThanOrEqual(2);
      }
      for (const [x0, red] of [[3*80+13, 96], [3*80+66, 159]]) {
        const x = Math.floor(d.letterbox.x + (x0 + .5) * d.letterbox.w / 320);
        const y = Math.floor(d.letterbox.y + (125.5) * d.letterbox.h / 200);
        expect(Math.abs(px.data[(y * px.width + x) * 4] - red), `distinct instance x=${x0}`).toBeLessThanOrEqual(2);
      }
      await info.attach(`current-${backend}.png`, { body: await p.locator('canvas').screenshot(), contentType: 'image/png' });
      return px;
    };
    const a = await capture(page, backendParam);
    if (!cross) return;
    const backend = backendParam === 'webgpu' ? 'webgl2' : 'webgpu';
    const b = await otherBackend(backend, info, p => capture(p, backend));
    const comparison = compareGpuImages(a, b); console.log('GL CURRENT COMPARISON', comparison);
    expect(comparison.different).toBeLessThanOrEqual(0.015);
    expect(comparison.unmatched).toBeLessThanOrEqual(0.001);
  });
