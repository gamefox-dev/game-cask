import { test, expect, openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';
import { otherBackend } from './backend-page';
import { compareGpuImages } from '../support/gpu-image';
import type { Page, TestInfo } from '@playwright/test';

async function capture(page: Page, backend: string, info: TestInfo) {
  expect(await openGame(page, backend, { game: 'x64-gl-integer' })).toBe('ready');
  await assertBackend(page, backend, info);
  const messages = new Set<string>();
  for (let i = 0; i < 250; i++) {
    await step(page, 1); await page.waitForTimeout(10);
    const d = await diagnostics(page); d.logs.forEach(l => messages.add(l.message));
    if (d.logs.some(l => l.message.includes('x64-gl-integer display ready'))) break;
  }
  await step(page, 24);
  const d = await diagnostics(page), logs = [...messages];
  console.log('x64-gl-integer native-boundary', backend, d.gpuDevice?.renderer ?? null, logs.filter(l => l.includes('native-boundary')));
  expect(logs.some(l => l.includes('x64-gl-integer display ready')), JSON.stringify(logs)).toBe(true);
  expect(logs.filter(l => /x64-gl-integer FAIL/.test(l)), JSON.stringify(logs)).toEqual([]);
  expect(logs.some(l => /x64-gl-integer PASS failures=0 checks=228/.test(l)), JSON.stringify(logs)).toBe(true);
  // Named native boundary (ABI §13.8), excluded from portable equality: never normalize or float-round these values.
  // GL 3.3 defines no result for an out-of-range integer output into a narrower attachment. Pinned exactly where the
  // implementation is fixed: WebGPU saturates (255 / -128) and SwiftShader WebGL2 narrows (0 / 1). On a native-GPU
  // WebGL2 driver (BGT_WEBGL2_GPU=1) the value is the driver's; it must still be what an 8-bit attachment can hold.
  const boundary = (unsigned: 0 | 1) => {
    const line = logs.find(l => l.includes(`native-boundary unsigned=${unsigned} value=`));
    expect(line, JSON.stringify(logs)).toBeDefined();
    return Number(/value=(\d+)/.exec(line!)![1]);
  };
  const u8 = boundary(1), i8 = boundary(0), nativeDriver = backend === 'webgl2' && d.gpuDevice?.software === false;
  if (!nativeDriver) {
    expect(u8, 'R8UI overflow').toBe(backend === 'webgl2' ? 0 : 255);
    expect(i8, 'R8I overflow').toBe(backend === 'webgl2' ? 1 : 4294967168);
  } else {
    expect(u8, 'R8UI overflow must fit 0..255').toBeLessThanOrEqual(255);
    expect(i8 <= 127 || i8 >= 4294967168, `R8I overflow ${i8} must fit -128..127`).toBe(true);
  }
  expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
  const m = d.metrics as Record<string, any>;
  expect(m.gl_unimplemented).toBe(0); expect(m.gl_approximations).toBe(0); expect(m.gl_stubs).toEqual([]); expect(m.interp_insns).toBe(0);
  const pixels = await readPixels(page);
  for (const [x, y, rgb] of [
    [40, 100, [64, 0, 0]], [120, 100, [0, 128, 191]], [120, 25, [64, 128, 191]],
    [200, 100, [17, 1, 19]], [200, 25, [152, 1, 1]], [280, 100, [1, 238, 235]], [280, 25, [1, 255, 235]],
  ] as [number, number, number[]][]) {
    const px = Math.floor(d.letterbox.x + (x + .5) * d.letterbox.w / 320), py = Math.floor(d.letterbox.y + (y + .5) * d.letterbox.h / 200);
    for (let c = 0; c < 3; c++) expect(Math.abs(pixels.data[(py * pixels.width + px) * 4 + c] - rgb[c]), `panel (${x},${y}) channel ${c}`).toBeLessThanOrEqual(1);
  }
  await page.locator('canvas').screenshot({ path: `/tmp/k8a-finish-${backend}.png` });
  return pixels;
}

// Each guest check is asserted on both actual backends; the final image exposes clears, integer values and orientation.
test('x64-gl-integer: Q21 finish-line pixels and exact GL contracts', async ({ page, backendParam, collector }, info) => {
  void collector; await capture(page, backendParam, info);
});
test('x64-gl-integer: Q21 cross-backend image equality @webgpu', async ({ page, backendParam, collector }, info) => {
  void collector;
  const a = await capture(page, backendParam, info);
  const other = backendParam === 'webgpu' ? 'webgl2' : 'webgpu';
  const b = await otherBackend(other, info, p => capture(p, other, info));
  const comparison = compareGpuImages(a, b); console.log('Q21 FINISH COMPARISON', comparison);
  expect(comparison.different).toBe(0); expect(comparison.unmatched).toBe(0);
});
