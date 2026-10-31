import { test, expect, openGame, readPixels, diagnostics, debugState, step } from './fixtures';
import { hardwarePixels } from './fixtures';
import type { Page } from '@playwright/test';
import { resolve } from 'node:path';

test.beforeEach(async ({ collector }) => { void collector; });

function near(actual: number[], expected: number[], tolerance = 2): void {
  expect(actual.length).toBe(expected.length);
  if (!hardwarePixels()) return;
  for (let i = 0; i < expected.length; i++) expect(Math.abs(actual[i]-expected[i])).toBeLessThanOrEqual(tolerance);
}
async function probe<T>(page: Page, name: string, file = 'gpu-webgl2-probe.ts'): Promise<T> {
  await page.goto('/');
  return page.evaluate(async ({ name, url }) => {
    const module = await import(/* @vite-ignore */ url);
    return module[name]();
  }, { name, url: '/@fs'+resolve('tests/e2e', file) });
}

// Catches format allocation/upload/clear/sRGB conversion and independently blended/masked MRT errors.
test('GPU WebGL2: every color format, top-left uploads and independent MRT state', async ({ page, backendParam }) => {
  test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
  const result = await probe<Record<string, number[]>>(page, 'formatsProbe');
  for (let f = 0; f < 5; f++) {
    near(result[`zero${f}`], f === 2 || f === 3 ? [0, 0, 0, 255] : [0, 0, 0, 0]);
    const upload = [[128, 64, 255, 255], [55, 13, 255, 255], [128, 0, 0, 255],
      [128, 64, 0, 255], [128, 64, 255, 255]][f];
    const render = [[64, 128, 191, 255], [64, 128, 191, 255], [64, 0, 0, 255],
      [64, 128, 0, 255], [64, 128, 191, 255]][f];
    near(result[`upload${f}`], upload); near(result[`render${f}`], render);
  }
  near(result.topLeft, [255, 0, 0, 255]); near(result.bottomLeft, [0, 0, 255, 255]);
  near(result.blended, [128, 0, 128, 255]); near(result.masked, [64, 0, 255, 255]);
  near(result.constant, [13, 51, 115, 128]);
});

// Catches depth allocation initialization, depth-only pass completeness and comparison sampling failures.
test('GPU WebGL2: both depth formats initialize to one and support depth-only clears and sampling',
  async ({ page, backendParam }) => {
    test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
    const result = await probe<Record<string, number[]>>(page, 'depthProbe');
    for (const f of [5, 6]) {
      near(result[`initial${f}`], [255, 0, 0, 255]); near(result[`depth${f}`], [64, 0, 0, 255]);
      near(result[`compare${f}`], [255, 0, 0, 255]);
    }
  });

// Catches reflection silently accepting forbidden uniforms, undeclared slots, and mismatched integer inputs.
test('GPU WebGL2: compilation logs complete once and pipeline reflection rejects incompatible layouts',
  async ({ page, backendParam }) => {
    test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
    const r = await probe<{ invalid: { code: number; log: string; calls: number }[]; errors: string[] }>(
      page, 'reflectionProbe');
    expect(r.invalid).toHaveLength(10);
    for (const result of r.invalid) {
      expect(result.code).toBe(-6); expect(result.calls).toBe(1); expect(result.log.length).toBeGreaterThan(0);
    }
    expect(r.errors).toHaveLength(4);
    expect(r.errors[0]).toContain('Illegal uniform'); expect(r.errors[1]).toContain('Vertex input mismatch');
    for (const error of r.errors.slice(2)) expect(error).toContain('Color output mismatch');
  });

// Catches WebGL integer viewport argument truncation and incorrect top-left fractional bounds.
test('GPU WebGL2: fractional asymmetric viewport preserves pixel-center coverage', async ({ page, backendParam }) => {
  test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
  const result = await probe<number[][]>(page, 'viewportProbe');
  for (const i of [0, 1, 4, 5, 6]) near(result[i], [0, 0, 0, 0]);
  for (const i of [2, 3]) near(result[i], [64, 128, 191, 255]);
});

// Catches signed-ID truncation and WebGL's implicit all-ones primitive restart changing BGT points.
test('GPU WebGL2: full-width vertex IDs and all-ones indices remain ordinary vertices',
  async ({ page, backendParam }) => {
    test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
    const result = await probe<number[][]>(page, 'idsProbe');
    for (const pixel of result) near(pixel, [255, 0, 255, 255]);
  });

// Catches missing loss completion, dropped resource updates and stale restored uniform-buffer contents.
test('GPU WebGL2: shaders fail once during context loss and queued uploads restore in order',
  async ({ page, backendParam }) => {
    test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
    const r = await probe<{ calls: number; failedCalls: number; status: number; log: string; update: number;
      errors: string[]; pixel: number[] }>(page, 'lossProbe', 'gpu-webgl2-loss-probe.ts');
    expect(r.calls).toBe(1); expect(r.failedCalls).toBe(1);
    expect(r.status).toBe(-6); expect(r.log).toContain('lost');
    expect(r.update).toBe(-6); expect(r.errors).toEqual([]); near(r.pixel, [255, 0, 0, 255]);
  });

// Catches native stride limits leaking into the portable ABI and missing first_instance fetch offsets.
for (const [scene, description] of [[8, '2048-byte vertex strides'], [9, 'nonzero first instance']] as const) {
  test(`GPU WebGL2: ${description} render through the native C fixture`, async ({ page, backendParam }) => {
    test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
    expect(await openGame(page, 'webgl2', { game: 'gpu-scenes', arg0: String(scene), debug: '1' })).toBe('ready');
    await step(page, 4);
    const s = await debugState<{ pixel: number; read: number; error: number }>(page);
    expect(s.read).toBe(1); expect(s.error).toBe(0);
    const p = await readPixels(page), d = await diagnostics(page), b = d.letterbox;
    const x = scene === 8 ? 80 : 154, y = scene === 8 ? 64 : 125;
    const dx = Math.floor(b.x+(x+.5)*b.w/160), dy = Math.floor(b.y+(y+.5)*b.h/128);
    near([...p.data.subarray((dy*p.width+dx)*4, (dy*p.width+dx)*4+4)],
      scene === 8 ? [63, 65, 127, 255] : [255, 0, 255, 255], 4);
    if (scene === 8) near([s.pixel&255, (s.pixel>>>8)&255, (s.pixel>>>16)&255, s.pixel>>>24],
      [63, 65, 127, 255], 4);
    expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
  });
}
