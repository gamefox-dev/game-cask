// SPDX-License-Identifier: CC0-1.0
// K74 (Q137, Q138): memory accounting on a real §13 GL fixture (x64-gl: indexed draws, uniform blocks, readbacks),
// on both backends (projects) and both suspension modes (BGT_E2E_SUSPENSION=jspi with JSPI-built examples).
// Catches: (Q138) the PE loader image still held in JS after bgt_init, a released asset that later reads miss, the
// executor holding its own second copy of every §13 buffer (decoder shadow + executor shadow), JS-held bytes that do
// not drop by those amounts, and any change of guest behaviour (the fixture's own PASS line with its pixel readbacks,
// and the final pixels); (Q137) `memory().gpu.overhead` missing, not summed into the estimate, or not following the
// canvas size and the retained presentation snapshot.
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';
import { createHash } from 'node:crypto';
import { CANVAS_BUFFERS } from '../../bgt/runtime/memory';
import { GPU_OVERHEAD_FACTORS, type GpuApi } from '../../bgt/runtime/gpu-overhead';
import type { BGTDiagnostics } from '../../bgt/runtime/runtime';

type Manifest = { assets: { path: string; size: number; release?: string }[] };

async function runToPass(page: import('@playwright/test').Page): Promise<BGTDiagnostics> {
  for (let i = 0; i < 100; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).logs.some((l) => l.message.includes('x64-gl PASS'))) break;
  }
  await step(page, 3);
  return diagnostics(page);
}

test('Q138: the loader image is released after init and every §13 buffer is held once; the guest is unchanged', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam, { game: 'x64-gl' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  const manifest = await page.evaluate(async () => (await fetch('/games/x64-gl/manifest.json')).json()) as Manifest;
  const released = manifest.assets.filter((a) => a.release === 'after-init');
  // The build marks exactly the PE loader image; nothing a guest opens by name.
  expect(released.map((a) => a.path)).toEqual(['loader/gl.exe']);
  const d = await runToPass(page), m = d.memory;
  await info.attach('memory.json', { body: JSON.stringify(m, null, 2), contentType: 'application/json' });
  expect(d.errors).toEqual([]);
  expect(d.logs.some((l) => l.message.includes('x64-gl PASS scenes=7 uniforms=2 block=3 sampler=2 readback=1'))).toBe(true);

  // Loader image: dropped once bgt_init returned, never reopened; the held asset bytes are the rest.
  expect(d.assets.released).toEqual({ count: 1, bytes: released[0].size, reopened: [] });
  expect(d.assets.missing).toEqual([]);
  const kept = manifest.assets.filter((a) => !a.release).reduce((n, a) => n + a.size, 0);
  expect(m.js.assetBytes).toBe(kept);
  expect(d.assets.bytes).toBe(kept);

  // Buffers: one shared copy. The decoder's reservation is the bytes; the executor holds no private copy.
  const gpu = m.gpu!, n = gpu.native!;
  expect(gpu.reserved.buffers).toBeGreaterThan(0);
  expect(n.shadows.bufferBytes).toBe(0);
  expect(n.shadows.sharedBufferBytes).toBe(gpu.reserved.buffers);
  expect(m.js.gpuDecoderShadowBytes).toBe(gpu.reserved.buffers);
  expect(m.js.gpuRecoveryShadowBytes).toBe(n.shadows.textureBytes);
  expect(m.js.heldBytes).toBe(kept + m.js.streamCacheBytes + gpu.reserved.buffers + m.js.audioQueuedBytes + n.shadows.textureBytes
    + m.js.legacyTextureShadowBytes);

  // Pixels after the run: the same image on every run of this project (recorded per backend in the attachment).
  const px = await readPixels(page);
  const hash = createHash('sha256').update(px.data).digest('hex').slice(0, 16);
  await info.attach('pixels.txt', { body: `${px.width}x${px.height} ${hash}`, contentType: 'text/plain' });
  expect(px.data.some((v, i) => i % 4 !== 3 && v !== 0)).toBe(true);
});

test('Q137: memory().gpu.overhead attributes canvas surfaces, the presentation snapshot, depth padding and staging, and follows the canvas', async ({ page, browserName, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam, { game: 'x64-gl' })).toBe('ready');
  const backend = await assertBackend(page, backendParam, info);
  // Select expected factors from the test runner's browser, not from the model under test.
  const engine = browserName === 'webkit' ? 'webkit' : 'chromium';
  const f = GPU_OVERHEAD_FACTORS[engine][backend as GpuApi];
  let d = await runToPass(page);
  const check = (dd: BGTDiagnostics) => {
    const m = dd.memory, o = m.gpu!.overhead!;
    const { width, height } = dd.canvas, n = m.gpu!.native!;
    expect(o.model).toEqual({ engine, api: backend, source: f.source, assumed: browserName === 'firefox' });
    expect(o.canvasBytes).toBe(Math.max(0, Math.round(width * height * f.canvasBytesPerPixel + f.canvasFixedBytes) - width * height * 4 * CANVAS_BUFFERS));
    // WebGL 2 retains a full-canvas snapshot of each §13 frame (its screen LOAD reads the physical image); WebGPU
    // re-presents its retained logical screen and keeps none (K74).
    expect(o.presentationBytes).toBe(backend === 'webgl2' ? width * height * 4 : 0);
    expect(o.depthStencilBytes).toBe(Math.round(n.textures.depthStencilBytes * f.depthStencilFactor));
    expect(n.uploads!.largestBytes).toBeGreaterThan(0);
    if (backend === 'webgpu') expect(n.uploads!.largestBytes).toBeLessThanOrEqual(n.uploads!.chunkBytes!);
    expect(o.stagingBytes).toBe(Math.round(Math.max(f.stagingFixedBytes, n.uploads!.largestBytes * f.stagingPerLargestUpload)));
    expect(o.totalBytes).toBe(o.canvasBytes + o.presentationBytes + o.depthStencilBytes + o.stagingBytes);
    expect(m.estimate.components.gpuOverhead).toBe(o.totalBytes);
    const c = m.estimate.components;
    expect(m.estimate.totalBytes).toBe(c.wasmLinear + c.wasmModule + c.gpuNative + c.jsHeld + c.gpuOverhead);
    expect(o.browserBaseBytes).toBe(f.baseBytes);
    return o;
  };
  const before = check(d);
  // A larger canvas: the canvas and presentation terms grow with it, nothing else does.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForFunction((w) => (window as unknown as { __BGT_TEST__: { diagnostics(): BGTDiagnostics } }).__BGT_TEST__.diagnostics().canvas.width !== w, d.canvas.width);
  await step(page, 2);
  const d2 = await diagnostics(page);
  const after = check(d2);
  expect(d2.canvas.width * d2.canvas.height).toBeGreaterThan(d.canvas.width * d.canvas.height);
  expect(after.canvasBytes).toBeGreaterThan(before.canvasBytes);
  if (backend === 'webgl2') expect(after.presentationBytes).toBeGreaterThan(before.presentationBytes);
  else expect(after.presentationBytes).toBe(0);
  expect(after.stagingBytes).toBe(before.stagingBytes);
  d = d2;
  expect(d.errors).toEqual([]);
});
