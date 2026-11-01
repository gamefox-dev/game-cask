import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';

// Catches wrong selector order/types, boolean access/comparisons, integer precision and numeric regressions.
// Both GLSL330 and ES300 go through the actual renderer's shader + pipeline compile/link and raster readback.
test('GLSL contracts: typed selector and construct known-answer pixels', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, info);
  const result = await page.evaluate(async ({ path, backend }) => {
    const { glslProbe } = await import(/* @vite-ignore */ path);
    return glslProbe(backend);
  }, { path: `/@fs${resolve('tests/e2e/gpu-glsl-probe.ts')}`, backend: backendParam });
  expect(result.errors).toEqual([]);
  expect(result.pixels).toHaveLength(result.count * 2);
  for (const { name, language, pixel, expected } of result.pixels) {
    for (let i = 0; i < 4; i++) expect(Math.abs(pixel[i] - expected[i]), `${name}, language ${language}, channel ${i}`)
      .toBeLessThanOrEqual(1); // RGBA8 quantization only.
  }
});
