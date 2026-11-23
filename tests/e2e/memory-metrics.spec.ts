// SPDX-License-Identifier: CC0-1.0
// K64: memory attribution and load metrics on a real §13 GL fixture.
// Catches: a breakdown component missing or double counted (sum != total), a decoder reservation that no longer
// matches what the backend allocated, guest/linear figures that exceed linear memory, a regressed streaming compile,
// and load marks out of order or missing.
import { resolve } from 'node:path';
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
  expect(js.assetBytes + js.streamCacheBytes + js.gpuDecoderShadowBytes + js.audioQueuedBytes + js.loadBuffersBytes
    + js.gpuRecoveryShadowBytes + js.legacyTextureShadowBytes).toBe(js.heldBytes);
  expect(js.loadBuffersBytes).toBe(0);
  expect(m.estimate.peakTotalBytes).toBeGreaterThanOrEqual(m.estimate.totalBytes);
  expect(m.estimate.peakSampling).toMatch(/load milestones/);
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
  // native buffer bytes and materialized + lazy texture bytes equal the reservation exactly (2D textures only here).
  const gpu = m.gpu!, n = gpu.native!;
  expect(n.backend).toBe(d.backend);
  expect(gpu.reserved.buffers + gpu.reserved.textures + gpu.reserved.shaders).toBe(gpu.reservedBytes);
  expect(gpu.reservedBytes).toBe(d.gpu!.reservedBytes);
  expect(gpu.reserved.buffers).toBeGreaterThan(0);
  expect(gpu.reserved.textures).toBeGreaterThan(0);
  expect(n.buffers.bytes).toBe(gpu.reserved.buffers);
  expect(n.buffers.nativeBytes).toBeGreaterThanOrEqual(n.buffers.bytes);
  // K71: textures not yet used hold no native storage; materialized + lazy bytes equal the reservation exactly.
  expect(n.textures.bytes + (n.textures.lazy?.bytes ?? 0)).toBe(gpu.reserved.textures);
  expect(n.textures.depthStencilBytes).toBeLessThanOrEqual(n.textures.bytes);
  expect(n.renderbuffers).toEqual({ count: 0, bytes: 0 });
  expect(js.gpuDecoderShadowBytes).toBe(gpu.reserved.buffers);
  // Recovery shadows hold only uploaded bytes. x64-gl never uploads its depth/stencil or FBO color targets, and
  // uploads only tiny textures: eager shadows (one per allocated level; 288,804 B here) fail both bounds.
  expect(n.shadows.bufferBytes).toBe(n.buffers.bytes);
  expect(n.textures.depthStencilBytes).toBeGreaterThan(0);
  expect(n.shadows.textureBytes).toBeLessThanOrEqual(n.textures.bytes - n.textures.depthStencilBytes);
  expect(n.shadows.textureBytes).toBeLessThan(n.textures.bytes / 100);
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

// vK64: lazily shadowed levels recover after a real context/device loss. Catches a lazy shadow that is not
// replayed (partial upload lost), a never-uploaded level restored with stale bytes, and eager shadows (memory).
test('lazily shadowed texture levels recover exactly after context loss; never-uploaded levels hold no shadow',
  async ({ page, backendParam, collector }, info) => {
    void collector;
    await openGame(page, backendParam);
    await assertBackend(page, backendParam, info);
    const r = await page.evaluate(async ({ backend, root }) => {
      const { GPU_OP: O } = await import(/* @vite-ignore */ `${root}/runtime/abi.ts`);
      const errors: string[] = [];
      const canvas = document.createElement('canvas');
      const gl = backend === 'webgpu' ? undefined : canvas.getContext('webgl2')!;
      const adapter = backend === 'webgpu' ? await navigator.gpu.requestAdapter() : undefined;
      let device = adapter ? await adapter.requestDevice() : undefined;
      const constructors = await import(/* @vite-ignore */ `${root}/renderers/${backend === 'webgpu' ? 'webgpu' : 'webgl2'}/gpu.ts`);
      const gpu = device ? new constructors.WebGPUCommands(device, (s: string) => errors.push(s)) :
        new constructors.WebGL2Gpu(gl, (s: string) => errors.push(s));
      const run = (op: number, words: number[], data?: Uint8Array) => {
        const code = gpu.execute({ kind: 'gpu', op, words, data });
        if (code) throw new Error(errors.join('\n') || `opcode ${op}: ${code}`);
      };
      const read = (h: number, mip: number, size: number) => new Promise<number[]>((resolve, reject) => {
        const code = gpu.execute({ kind: 'gpu', op: O.TEXTURE_READBACK, words: [h, mip, 0, 0, 0, size, size, 1, 1],
          readback: (bytes: Uint8Array | undefined, status = 0) => status || !bytes ? reject(new Error(`readback ${status}`)) : resolve([...bytes]) });
        if (code) reject(new Error(`readback opcode ${code}`));
      });
      // 1: 8x8, only a 4x4 green region at (2,2) uploaded (its level shadow is allocated by that partial upload).
      run(O.TEXTURE_CREATE_EX, [1, 0, 8, 8, 1, 1, 0, 1]);
      const green = new Uint8Array(Array.from({ length: 16 }, () => [0, 255, 0, 255]).flat());
      run(O.TEXTURE_UPDATE_EX, [1, 0, 2, 2, 0, 4, 4, 1, 0, green.length], green);
      // 2: 8x8 render-target-capable texture with a generated chain from a never-uploaded base. 3: depth/stencil.
      run(O.TEXTURE_CREATE_EX, [2, 0, 8, 8, 1, 4, 0, 3]); run(O.TEXTURE_ALLOCATE_MIPS, [2, 4]); run(O.TEXTURE_GENERATE_MIPS, [2, 0]);
      run(O.TEXTURE_CREATE_EX, [3, 0, 16, 16, 1, 1, 5, 2]);
      const capture = async () => ({ t1: await read(1, 0, 8), t2: await read(2, 0, 8), t2m1: await read(2, 1, 4) });
      const before = await capture(), shadowsBefore = gpu.memory().shadows.textureBytes;
      if (device) {
        // A real device loss: the old device is destroyed and the executor restores onto a fresh one.
        device.destroy(); const next = await (await navigator.gpu.requestAdapter())!.requestDevice(); gpu.lost(); await gpu.restore(next); device = next;
      } else {
        const ext = gl!.getExtension('WEBGL_lose_context')!;
        const lost = new Promise<void>(res => canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); res(); }, { once: true }));
        const within = <T,>(p: Promise<T>, what: string) => Promise.race([p,
          new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), 10000))]);
        const restored = new Promise<void>(res => canvas.addEventListener('webglcontextrestored', () => res(), { once: true }));
        ext.loseContext(); await within(lost, 'webglcontextlost');
        // As the renderer does (simulateLoss): restore after the loss event has been handled.
        await new Promise(res => setTimeout(res, 30));
        ext.restoreContext(); await within(restored, 'webglcontextrestored'); gpu.restore();
      }
      const after = await capture(), shadowsAfter = gpu.memory().shadows.textureBytes;
      device?.destroy();
      return { before, after, shadowsBefore, shadowsAfter, errors };
    }, { backend: backendParam, root: `/@fs${resolve('bgt')}` });
    const t1: number[] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
      t1.push(...(x >= 2 && x < 6 && y >= 2 && y < 6 ? [0, 255, 0, 255] : [0, 0, 0, 0]));
    const expected = { t1, t2: new Array(8 * 8 * 4).fill(0), t2m1: new Array(4 * 4 * 4).fill(0) };
    expect(r.errors).toEqual([]);
    expect(r.before).toEqual(expected);
    expect(r.after).toEqual(expected);
    // Exactly one 8x8 RGBA8 level shadow: none for the render target, its generated chain or the depth texture.
    expect(r.shadowsBefore).toBe(8 * 8 * 4);
    expect(r.shadowsAfter).toBe(8 * 8 * 4);
  });
