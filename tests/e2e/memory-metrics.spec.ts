// SPDX-License-Identifier: CC0-1.0
// K64: memory attribution and load metrics on a real §13 GL fixture.
// Catches: a breakdown component missing or double counted (sum != total), a decoder reservation that no longer
// matches what the backend allocated, guest/linear figures that exceed linear memory, a regressed streaming compile,
// and load marks out of order or missing.
import { test, expect, openGame, assertBackend, step, diagnostics } from './fixtures';
import type { BGTDiagnostics } from '../../bgt/runtime/runtime';

test('memory breakdown is consistent and the GPU reservation matches the backend allocation', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam, { game: 'x64-gl' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  const before = await diagnostics(page);
  for (let i = 0; i < 100; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).logs.some((l) => l.message.includes('x64-gl PASS'))) break;
  }
  await step(page, 3);
  const d = await diagnostics(page), m = d.memory, api = await page.evaluate(() => (window as unknown as { __BGT_TEST__: { memory(): BGTDiagnostics['memory'] } }).__BGT_TEST__.memory());
  await info.attach('memory.json', { body: JSON.stringify({ memory: m, load: d.load }, null, 2), contentType: 'application/json' });
  expect(d.errors).toEqual([]);
  expect(api.schema).toBe('bgt-memory/1');
  expect(api.estimate.totalBytes).toBe(m.estimate.totalBytes);

  // Totals: disjoint components sum to the estimate; JS-held parts sum to their total.
  const c = m.estimate.components;
  expect(c.wasmLinear + c.wasmModule + c.gpuNative + c.jsHeld).toBe(m.estimate.totalBytes);
  const js = m.js;
  expect(js.assetBytes + js.streamCacheBytes + js.gpuDecoderShadowBytes + js.audioQueuedBytes + js.gpuRecoveryShadowBytes
    + js.legacyTextureShadowBytes).toBe(js.heldBytes);
  expect(m.estimate.peakTotalBytes).toBeGreaterThanOrEqual(m.estimate.totalBytes);
  expect(m.estimate).toMatchObject({ budgetBytes: 1536 * 1024 * 1024, budgetSource: 'default', status: 'ok', overBudget: false });

  // Wasm: linear memory equals the reported size, grew from the declared initial size, module bytes = manifest artifact.
  expect(m.wasm.linearBytes).toBe(d.wasmMemoryBytes);
  expect(m.wasm.peakLinearBytes).toBeGreaterThanOrEqual(m.wasm.linearBytes);
  expect(m.wasm.initialBytes).toBeGreaterThan(0);
  expect(m.wasm.initialBytes).toBeLessThanOrEqual(m.wasm.linearBytes);
  expect(m.wasm.moduleBytes).toBe(d.load.wasm.bytes);
  expect(m.wasm.moduleBytes).toBeGreaterThan(100_000);

  // Guest (Win32 profile): reported, and all inside linear memory.
  const g = m.guest!;
  expect(g).not.toBeNull();
  for (const k of ['heapBytes', 'virtualLiveBytes', 'virtualPeakBytes', 'hostBytes', 'hostReservedBytes', 'glFrontendBytes'] as const) {
    expect(g[k], k).not.toBeNull();
    expect(g[k]!, k).toBeLessThanOrEqual(m.wasm.linearBytes);
  }
  expect(g.virtualPeakBytes!).toBeGreaterThanOrEqual(g.virtualLiveBytes!);
  expect(g.hostBytes!).toBeLessThanOrEqual(g.hostReservedBytes!);

  // GPU: reservation by kind sums to the reserved bytes; after step() every item is executed, so the backend's
  // native buffer/texture bytes equal the reservation exactly (2D textures only in this fixture).
  const gpu = m.gpu!, n = gpu.native!;
  expect(n.backend).toBe(d.backend);
  expect(gpu.reserved.buffers + gpu.reserved.textures + gpu.reserved.shaders).toBe(gpu.reservedBytes);
  expect(gpu.reservedBytes).toBe(d.gpu!.reservedBytes);
  expect(gpu.reserved.buffers).toBeGreaterThan(0);
  expect(gpu.reserved.textures).toBeGreaterThan(0);
  expect(n.buffers.bytes).toBe(gpu.reserved.buffers);
  expect(n.buffers.nativeBytes).toBeGreaterThanOrEqual(n.buffers.bytes);
  expect(n.textures.bytes).toBe(gpu.reserved.textures);
  expect(n.textures.depthStencilBytes).toBeLessThanOrEqual(n.textures.bytes);
  expect(n.renderbuffers).toEqual({ count: 0, bytes: 0 });
  expect(js.gpuDecoderShadowBytes).toBe(gpu.reserved.buffers);
  // Recovery shadows hold only uploaded bytes: never more than the native objects they restore.
  expect(n.shadows.bufferBytes).toBe(n.buffers.bytes);
  expect(n.shadows.textureBytes).toBeLessThanOrEqual(2 * n.textures.bytes);
  expect(gpu.canvasBytesEstimate).toBe(d.canvas.width * d.canvas.height * 4 * 2);
  expect(c.gpuNative).toBe(n.buffers.nativeBytes + n.textures.bytes + n.internal.bytes + gpu.legacyTextureBytes + gpu.canvasBytesEstimate);

  // Load: streaming compile from the dev server's application/wasm, marks in order, first update after ready.
  const l = d.load;
  expect(l.wasm).toMatchObject({ streaming: true, streamingReason: 'streaming' });
  expect(l.wasm.contentType).toMatch(/^application\/wasm/);
  expect(l.wasm.initialMemoryBytes).toBe(m.wasm.initialBytes);
  for (const k of ['manifestMs', 'wasmMs', 'assetsMs', 'readyMs', 'firstFrameMs', 'firstUpdateMs'] as const)
    expect(l.marks[k], k).not.toBeNull();
  expect(l.marks.manifestMs!).toBeLessThanOrEqual(l.marks.wasmMs!);
  expect(l.marks.wasmMs!).toBeLessThanOrEqual(l.marks.readyMs!);
  expect(l.marks.assetsMs!).toBeLessThanOrEqual(l.marks.readyMs!);
  expect(l.marks.readyMs!).toBeLessThanOrEqual(l.marks.firstUpdateMs!);
  expect(l.timeToFirstFrameMs).toBe(l.marks.firstFrameMs);
  expect(l.wasm.instantiateMs).toBeGreaterThan(0);
  // A paused boot has drawn nothing and updated nothing before the test's first step.
  expect(before.load.marks.firstUpdateMs).toBeNull();
});

test('the memory budget is configurable and an over-budget estimate is a warning, not a failure', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam, { game: 'sample2d', memorybudget: '16m' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  await step(page, 2);
  const d = await diagnostics(page);
  expect(d.memory.estimate).toMatchObject({ budgetBytes: 16 * 1024 * 1024, budgetSource: 'url' });
  expect(d.memory.estimate.status).toBe(d.memory.estimate.totalBytes > 16 * 1024 * 1024 ? 'over-budget' : 'ok');
  expect(d.memory.guest).toBeNull(); // native BGT game: no platform profile
  expect(d.memory.js.assetBytes).toBe(d.assets.bytes);
  expect(d.memory.js.legacyTextureShadowBytes).toBe(d.textures.bytes);
  expect(d.failed).toBe(false);
  // A malformed override is reported and ignored, never fatal.
  expect(await openGame(page, backendParam, { game: 'sample2d', memorybudget: 'lots' })).toBe('ready');
  const bad = await diagnostics(page);
  expect(bad.memory.estimate.budgetSource).toBe('default');
  expect(bad.backendNotes.some((s) => /memorybudget=lots/.test(s))).toBe(true);
});
