import { resolve } from 'node:path';
import { test, expect } from './fixtures';

// Catches forbidden native depth transfers, stale CPU-shadow readback, row-padding mistakes and packed stencil corruption.
test('GPU depth: ordered uploads, partial updates, sampling and post-render readback', async ({ page, backendParam, collector }) => {
  void collector;
  await page.goto('/');
  const results = await page.evaluate(async ({ path, backend }) => {
    const module = await import(/* @vite-ignore */ path); return module.depthProbe(backend);
  }, { path: '/@fs' + resolve('tests/e2e/gpu-depth-probe.ts'), backend: backendParam });
  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.sample.code).toBe(0); expect(result.sample.data).toEqual([64, 0, 0, 255]);
    if (result.format === 5 && backendParam === 'webgpu') {
      // WebGPU exposes no sampleable/copyable packed depth24 aspect. Never synthesize stencil from a shadow.
      expect(result.uploaded).toEqual({ code: -4, data: [] }); expect(result.rendered).toEqual({ code: -4, data: [] });
    } else {
      expect(result.uploaded.code).toBe(0); expect(result.rendered.code).toBe(0);
      if (result.format === 6) {
        expect(result.uploadedFloats).toEqual(Array.from({ length: 64 }, (_, i) => i === 37 ? .5 : .25));
        expect(result.renderedFloats).toEqual(new Array(64).fill(.75));
      } else {
        const uploaded = new Uint32Array(new Uint8Array(result.uploaded.data).buffer);
        const rendered = new Uint32Array(new Uint8Array(result.rendered.data).buffer);
        expect([...uploaded]).toEqual(Array.from({ length: 64 }, (_, i) => i === 37 ? 0x800000f3 : 0x40000007));
        expect(rendered).toHaveLength(64);
        for (const v of rendered) { expect(v & 255).toBe(19); expect(Math.abs((v >>> 8) - 0xbfffff)).toBeLessThanOrEqual(1); }
      }
    }
  }
});
