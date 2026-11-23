// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0
// K74 (Q138): one CPU copy per §13 buffer (decoder + executor) and the release of after-init loader assets.
// Breakage caught: the executor allocating its own copy again (two copies, the r30 "decoder shadow 12 + recovery shadow
// 12 MB"), an executor that reads decode-time (future) contents instead of execution-time contents, a decoder that
// validates index draws against the store without the frame's pending writes, a replay executor writing into the live
// store, settle() losing writes no executor applied, a loss restore that re-copies or un-shares the store, the memory
// report counting a shared store twice, and a loader image kept in JS after bgt_init (or released while open).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as A from '../../bgt/runtime/abi';
import { CommandEncoder, Frame, TextureTable, defaultState, decodeCommands, type DecodeContext } from '../../bgt/runtime/commands';
import { GpuState } from '../../bgt/runtime/commands-gpu';
import { BufferJournal, adoptBufferStore, attachSharedWrite, markApplied } from '../../bgt/runtime/shared-buffers';
import { Vfs } from '../../bgt/runtime/vfs';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';
import type { GpuBackend, GpuItem } from '../../bgt/renderers/types';
import { Requests } from '../../bgt/runtime/requests';

const O = A.GPU_OP;

function fakeGL(): WebGL2RenderingContext {
  const constants = new Map<string, number>();
  const constant = (p: string) => { if (!constants.has(p)) constants.set(p, 0x1000 + constants.size); return constants.get(p)!; };
  const overrides: Record<string, unknown> = { NO_ERROR: 0, isContextLost: () => false, getError: () => 0, getExtension: () => ({}),
    // A capable context (languages > 0, so the decoder accepts §13 work): alignment 256, everything else large.
    getParameter: (p: number) => p === constant('UNIFORM_BUFFER_OFFSET_ALIGNMENT') ? 256 : 65536,
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE') };
  return new Proxy({}, { get(_, p: string) {
    if (p in overrides) return overrides[p];
    if (/^[A-Z][A-Z0-9_]*$/.test(p)) return constant(p);
    return () => ({});
  } }) as WebGL2RenderingContext;
}

/** Decode into a frame for `backend` (the executor the decoder shares stores with). */
function decoder(backend: GpuBackend) {
  const frame = new Frame(); frame.reset(64, 64);
  const gpu = new GpuState(backend);
  const requests = new Requests();
  const ctx: DecodeContext = { state: defaultState(64, 64), frame, textures: new TextureTable(), linearFilter: true, triangles: true, gpu,
    gpuRequest: (id) => { const t = requests.reserve(id); return typeof t === 'number' ? t : (data, error) => requests.complete(t, data, error); } };
  const mem = new Uint8Array(65536);
  const run = (e: CommandEncoder) => { const b = e.finish(); mem.set(b); return decodeCommands(mem, 0, b.length, ctx); };
  const items = () => frame.items.filter((i): i is GpuItem => i.kind === 'gpu');
  return { frame, gpu, mem, run, items };
}

const webgl2 = () => { const errors: string[] = []; return { exec: new WebGL2Gpu(fakeGL(), (e) => errors.push(e), {}), errors }; };
const bufferOf = (exec: WebGL2Gpu, h: number) => (exec as unknown as { buffers: Map<number, { data: Uint8Array; shared?: boolean }> }).buffers.get(h)!;

describe('K74 shared buffer store: decoder + WebGL 2 executor', () => {
  it('keeps one copy; the executor sees execution-time contents, the decoder the latest', () => {
    const { exec, errors } = webgl2(), d = decoder(exec);
    d.mem.fill(1, 4096, 4112); d.mem.fill(2, 8192, 8196); d.mem.fill(3, 8200, 8204);
    expect(d.run(new CommandEncoder().gpu(O.BUFFER_CREATE, [1, 7, 16, 4096, 16])
      .gpu(O.BUFFER_UPDATE, [1, 0, 8192, 4]).gpu(O.BUFFER_UPDATE, [1, 2, 8200, 4])).errors).toEqual([]);
    const entry = d.gpu.buffers.get(1)!, latest = [2, 2, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect([...d.gpu.read(entry, 0, 16)]).toEqual(latest);
    expect([...entry.shadow]).toEqual(Array(16).fill(1)); // nothing executed yet
    const [create, u1, u2] = d.items();
    expect(exec.execute(create), errors.join()).toBe(0);
    expect(bufferOf(exec, 1).data).toBe(entry.shadow); // adopted: one array
    expect(exec.execute(u1)).toBe(0);
    // Execution order: the second update (decoded, not yet executed) is not visible to the executor.
    expect([...bufferOf(exec, 1).data]).toEqual([2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...d.gpu.read(entry, 0, 16)]).toEqual(latest);
    expect(exec.execute(u2)).toBe(0);
    expect([...entry.shadow]).toEqual(latest);
    expect(d.gpu.settle()).toBe(0); // the executor applied every write
    // Counted once: the decoder's reservation holds the bytes; the executor reports them as shared, not as a shadow.
    expect(exec.memory().shadows).toEqual({ bufferBytes: 0, textureBytes: 0, sharedBufferBytes: 16 });
    expect(d.gpu.reservedByKind().buffers).toBe(16);
  });

  it('validates indexed draws against the frame\'s pending writes (journal), newest write first', () => {
    const d = decoder({ languages: 7, glRaster: true, constAttrib: true, execute: () => 0 });
    const src = new TextEncoder().encode('out vec4 value;');
    d.mem.set(src, 16384);
    const F = (f: number) => new Uint32Array(new Float32Array([f]).buffer)[0];
    const pipeline = [1, 1, 2, 3, 0, 0, A.GPU.FORMAT_NONE, 0, 0, 7, 0, 255, 255, 7, 0, 0, 0, 7, 0, 0, 0, 0, 0, 1, 1, 1,
      16, 0, 0, 0, 0, 3, 0, 0, 1, 0, 0, 1, 0, 0, 15];
    expect(d.run(new CommandEncoder().gpu(O.SHADER_CREATE, [1, 1, 0, 16384, src.length, 1])
      .gpu(O.SHADER_CREATE, [2, 2, 0, 16384, src.length, 2])).errors).toEqual([]);
    for (const it of d.frame.items) if (it.kind === 'gpu' && it.complete) it.complete(0, 'compiled');
    expect(d.run(new CommandEncoder().gpu(O.BUFFER_CREATE, [1, 3, 4096, 0, 0]).gpu(O.PIPELINE_CREATE, pipeline)).errors).toEqual([]);
    const draw = (index: number) => {
      new DataView(d.mem.buffer).setUint16(20000, index, true);
      return d.run(new CommandEncoder().gpu(O.BUFFER_UPDATE, [1, 0, 20000, 2])
        .gpu(O.PASS_BEGIN, [1, 0, 0, 0, 0, F(1), 0, 0, 0, 1, F(0), F(0), F(0), F(1)]).gpu(O.PIPELINE, [1])
        .gpu(O.VERTEX_BUFFER, [0, 1, 0, 4096]).gpu(O.INDEX_BUFFER, [1, 0, 0, 256])
        .gpu(O.DRAW_INDEXED, [1, 1, 0, 0, 0]).gpu(O.PASS_END, [])).status;
    };
    // 4096 B / 16 B stride: vertices 0..255. The store still holds zeros: only the journal knows index 300.
    expect(draw(300)).toBe(A.E_BOUNDS);
    expect(draw(5)).toBe(0);
    expect(draw(256)).toBe(A.E_BOUNDS);
    expect([...d.gpu.buffers.get(1)!.shadow.subarray(0, 2)]).toEqual([0, 0]);
    expect(d.gpu.settle()).toBe(3); // this backend never executed: settle applies them, in order
    expect(new DataView(d.gpu.buffers.get(1)!.shadow.buffer).getUint16(0, true)).toBe(256);
  });

  it('a replay executor gets a private copy and never writes the live store; settle restores the decoder view', () => {
    const { exec } = webgl2(), replay = webgl2().exec, d = decoder(exec);
    d.mem.fill(9, 8192, 8200);
    expect(d.run(new CommandEncoder().gpu(O.BUFFER_CREATE, [1, 7, 8, 0, 0]).gpu(O.BUFFER_UPDATE, [1, 0, 8192, 8])).errors).toEqual([]);
    const entry = d.gpu.buffers.get(1)!;
    for (const it of d.items()) expect(replay.execute(it)).toBe(0);
    expect(bufferOf(replay, 1).data).not.toBe(entry.shadow);
    expect([...bufferOf(replay, 1).data]).toEqual(Array(8).fill(9));
    expect([...entry.shadow]).toEqual(Array(8).fill(0));
    expect(replay.memory().shadows.bufferBytes).toBe(8);
    expect(d.gpu.settle()).toBe(1);
    expect([...entry.shadow]).toEqual(Array(8).fill(9));
    // The owner adopts at most once per item: executing the same CREATE again (a residual replay) is private.
    const [create] = d.items();
    expect(exec.execute(create)).toBe(0); expect(bufferOf(exec, 1).data).toBe(entry.shadow);
    expect(exec.execute({ kind: 'gpu', op: O.BUFFER_DELETE, words: [1] })).toBe(0);
    expect(exec.execute(create)).toBe(0); expect(bufferOf(exec, 1).data).not.toBe(entry.shadow);
  });

  it('a context-loss restore keeps the same array and its sharing (no transient second copy)', () => {
    const { exec, errors } = webgl2(), d = decoder(exec);
    d.mem.fill(5, 4096, 4160);
    expect(d.run(new CommandEncoder().gpu(O.BUFFER_CREATE, [1, 7, 64, 4096, 64])).errors).toEqual([]);
    for (const it of d.items()) expect(exec.execute(it)).toBe(0);
    const store = d.gpu.buffers.get(1)!.shadow;
    exec.restore();
    expect(errors).toEqual([]);
    expect(bufferOf(exec, 1).data).toBe(store); expect(bufferOf(exec, 1).shared).toBe(true);
    expect([...store]).toEqual(Array(64).fill(5));
    expect(exec.memory().shadows.sharedBufferBytes).toBe(64);
  });
});

describe('K74 shared buffer store: WebGPU executor', () => {
  beforeAll(() => {
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
    vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 });
  });
  afterAll(() => { vi.unstubAllGlobals(); });
  const device = () => ({ limits: {}, features: new Set<string>(), queue: { submit: vi.fn(), writeTexture: vi.fn(), writeBuffer: vi.fn() },
    createTexture: () => ({ createView: () => ({}), destroy() {} }), createCommandEncoder: () => ({ finish: () => ({}) }),
    createBuffer: (d: { size: number; usage: number }) => ({ size: d.size, usage: d.usage, destroy() {} }) }) as unknown as GPUDevice;

  it('adopts the decoder store, applies writes in execution order and restores onto the same array', async () => {
    const errors: string[] = [], exec = new WebGPUCommands(device(), (e) => errors.push(e), null, {});
    const d = decoder(exec);
    d.mem.fill(4, 8192, 8196);
    expect(d.run(new CommandEncoder().gpu(O.BUFFER_CREATE, [1, 7, 32, 0, 0]).gpu(O.BUFFER_UPDATE, [1, 3, 8192, 4])).errors).toEqual([]);
    const entry = d.gpu.buffers.get(1)!;
    for (const it of d.items()) expect(exec.execute(it), errors.join()).toBe(0);
    expect(exec.buffers.get(1)!.shadow).toBe(entry.shadow);
    expect([...entry.shadow.subarray(0, 8)]).toEqual([0, 0, 0, 4, 4, 4, 4, 0]);
    expect(d.gpu.settle()).toBe(0);
    expect(exec.memory().shadows).toMatchObject({ bufferBytes: 0, sharedBufferBytes: 32 });
    await exec.restore(device());
    expect(exec.buffers.get(1)!.shadow).toBe(entry.shadow); expect(exec.buffers.get(1)!.shared).toBe(true);
  });
});

describe('K74 WebGPU upload bands (Q137)', () => {
  beforeAll(() => {
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
    vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 });
  });
  afterAll(() => { vi.unstubAllGlobals(); });
  type Write = { origin: number[]; offset: number; bytesPerRow: number; rowsPerImage: number; size: number[]; data: Uint8Array };
  const recording = () => {
    const tex: Write[] = [], buf: { offset: number; dataOffset: number; size: number }[] = [];
    const device = { limits: {}, features: new Set<string>(), queue: { submit: vi.fn(),
      writeTexture: (dst: { origin: number[] }, data: Uint8Array, layout: { offset?: number; bytesPerRow: number; rowsPerImage: number }, size: number[]) =>
        tex.push({ origin: dst.origin, offset: layout.offset ?? 0, bytesPerRow: layout.bytesPerRow, rowsPerImage: layout.rowsPerImage, size, data }),
      writeBuffer: (_b: unknown, offset: number, _d: Uint8Array, dataOffset = 0, size?: number) => buf.push({ offset, dataOffset, size: size ?? _d.length }) },
    createTexture: () => ({ createView: () => ({}), destroy() {} }), createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ end() {} }) }),
    createBuffer: (d: { size: number; usage: number }) => ({ size: d.size, usage: d.usage, destroy() {} }) } as unknown as GPUDevice;
    return { device, tex, buf };
  };
  // Reassemble the uploaded region from the recorded calls: every byte exactly once, at its place.
  const replay = (w: Write[], width: number, height: number, depth: number, bpp: number, x0: number, y0: number, z0: number) => {
    const out = new Uint8Array(width * height * depth * bpp).fill(0xee);
    for (const c of w) for (let z = 0; z < c.size[2]; z++) for (let r = 0; r < c.size[1]; r++) {
      const src = c.offset + (z * c.rowsPerImage + r) * c.bytesPerRow, dz = c.origin[2] - z0 + z, dy = c.origin[1] - y0 + r;
      expect(c.origin[0]).toBe(x0);
      out.set(c.data.subarray(src, src + c.size[0] * bpp), ((dz * height) + dy) * width * bpp);
    }
    return out;
  };

  it('splits large texture and buffer writes into bands no larger than the chunk; the bytes land unchanged', () => {
    const { device, tex, buf } = recording(), errors: string[] = [];
    const exec = new WebGPUCommands(device, (e) => errors.push(e), null, {});
    exec.uploadChunkBytes = 4096;
    const ok = (op: number, words: number[], data?: Uint8Array<ArrayBuffer>) => expect(exec.execute({ kind: 'gpu', op, words, data }), errors.join()).toBe(0);
    ok(O.TEXTURE_CREATE_EX, [1, 0, 64, 64, 1, 1, 0, 3]);
    const img = Uint8Array.from({ length: 40 * 30 * 4 }, (_, i) => (i * 7) & 255);
    ok(O.TEXTURE_UPDATE_EX, [1, 0, 3, 5, 0, 40, 30, 1, 0, img.length], img);
    expect(tex.length).toBe(Math.ceil(30 / Math.floor(4096 / 160)));
    for (const c of tex) expect(c.size[1] * c.bytesPerRow).toBeLessThanOrEqual(4096);
    expect(replay(tex, 40, 30, 1, 4, 3, 5, 0)).toEqual(img);
    // A 2D array region: whole slices per call when a slice fits.
    tex.length = 0;
    ok(O.TEXTURE_CREATE_EX, [2, 2, 16, 16, 6, 1, 0, 3]);
    const arr = Uint8Array.from({ length: 16 * 16 * 6 * 4 }, (_, i) => (i * 13) & 255);
    ok(O.TEXTURE_UPDATE_EX, [2, 0, 0, 0, 0, 16, 16, 6, 0, arr.length], arr);
    expect(tex.length).toBe(Math.ceil(6 / Math.floor(4096 / 1024))); expect(replay(tex, 16, 16, 6, 4, 0, 0, 0)).toEqual(arr);
    // Small writes stay one call.
    tex.length = 0; ok(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 4, 4, 1, 0, 64], new Uint8Array(64)); expect(tex.length).toBe(1);
    // Buffers: 10000 B in 4096 B ranges at increasing offsets, 4-byte aligned.
    ok(O.BUFFER_CREATE, [1, 7, 10000, 0, 10000], new Uint8Array(10000));
    expect(buf.map((b) => [b.offset, b.dataOffset, b.size])).toEqual([[0, 0, 4096], [4096, 4096, 4096], [8192, 8192, 1808]]);
    expect(exec.memory().uploads).toEqual({ largestBytes: 4096, chunkBytes: 4096 });
  });
});

describe('K74 BufferJournal', () => {
  it('reads store + pending writes in decode order; settle applies only unapplied writes', () => {
    const j = new BufferJournal(), store = new Uint8Array(8);
    expect(j.read(store, 2, 4).buffer).toBe(store.buffer); // nothing pending: a view
    const a = j.write(store, 0, new Uint8Array([1, 1, 1, 1])), b = j.write(store, 2, new Uint8Array([2, 2]));
    expect([...j.read(store, 0, 8)]).toEqual([1, 1, 2, 2, 0, 0, 0, 0]);
    expect([...j.read(store, 2, 2)]).toEqual([2, 2]); // the newest write covers it
    expect([...j.read(store, 1, 2)]).toEqual([1, 2]);
    store.set([1, 1, 1, 1], 0); a.applied = true; // the executor applied the first one
    expect(j.settle()).toBe(1); expect(b.applied).toBe(true);
    expect([...store]).toEqual([1, 1, 2, 2, 0, 0, 0, 0]);
    expect(j.size).toBe(0);
  });

  it('only the owner adopts or marks, and only its own target', () => {
    const owner = {}, other = {}, store = new Uint8Array(4), item = { data: new Uint8Array([7, 7, 7, 7]) };
    attachSharedWrite(item, { store, offset: 0, data: item.data, applied: false }, owner);
    expect(adoptBufferStore(item, 4, other).shared).toBe(false);
    const own = adoptBufferStore(item, 4, owner);
    expect(own).toEqual({ data: store, shared: true }); expect(own.data).toBe(store);
    const w = { store, offset: 0, data: new Uint8Array(1), applied: false }, upd = {};
    attachSharedWrite(upd, w, owner);
    markApplied(upd, owner, new Uint8Array(4)); expect(w.applied).toBe(false);
    markApplied(upd, other, store); expect(w.applied).toBe(false);
    markApplied(upd, owner, store); expect(w.applied).toBe(true);
  });
});

describe('K74 after-init asset release (Q138)', () => {
  it('drops release:"after-init" assets once no handle reads them; a later open is E_NOT_FOUND, not missing', () => {
    const v = new Vfs(), image = new Uint8Array(1000), data = new Uint8Array(10);
    v.add('loader/game.exe', image, 'after-init'); v.add('data.bin', data);
    expect(v.totalBytes).toBe(1010);
    const h = v.openFile('loader/game.exe'); expect(h).toBeGreaterThan(0);
    const h2 = v.openFile('loader/game.exe');
    expect(v.releaseInitAssets()).toBe(0); // still open: kept until its last handle closes
    const dst = new Uint8Array(4); expect(v.read(h, dst)).toBe(4);
    expect(v.close(h)).toBe(0); expect(v.totalBytes).toBe(1010); // another handle still reads it
    expect(v.close(h2)).toBe(0); // last close after init: released now (review vK74)
    expect(v.totalBytes).toBe(10); expect(v.releasedBytes).toBe(1000); expect(v.released.get('loader/game.exe')).toBe(1000);
    expect(v.openFile('loader/game.exe')).toBe(A.E_NOT_FOUND);
    expect([...v.reopened]).toEqual(['loader/game.exe']); expect([...v.missing]).toEqual([]);
    expect(v.fileCount).toBe(2); expect(v.list()).toEqual(['data.bin', 'loader/game.exe']);
    const d = v.openFile('data.bin'); expect(d).toBeGreaterThan(0); // ordinary assets stay, also after close
    expect(v.close(d)).toBe(0); expect(v.totalBytes).toBe(10);
    expect(v.releaseInitAssets()).toBe(0);
    // Before bgt_init returned, closing never releases (the PE loader may reopen during init).
    const early = new Vfs(); early.add('loader/x.exe', new Uint8Array(8), 'after-init');
    expect(early.close(early.openFile('loader/x.exe'))).toBe(0); expect(early.totalBytes).toBe(8);
  });
});

describe('K74 GPU-process overhead model (Q137)', () => {
  it('models canvas surfaces beyond the counted copies, depth/stencil padding and staging; sums to the total', async () => {
    const { gpuOverhead, gpuEngine, GPU_OVERHEAD_FACTORS } = await import('../../bgt/runtime/gpu-overhead');
    const { memoryBreakdown, MEMORY_BUDGET_DEFAULT, CANVAS_BUFFERS } = await import('../../bgt/runtime/memory');
    expect(gpuEngine('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36')).toBe('chromium');
    expect(gpuEngine('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('webkit');
    expect(gpuEngine('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBeNull();
    const MiB = 2 ** 20;
    for (const api of ['webgl2', 'webgpu'] as const) {
      const f = GPU_OVERHEAD_FACTORS.chromium[api], canvas = { width: 960, height: 540 }, counted = 960 * 540 * 4 * CANVAS_BUFFERS;
      const o = gpuOverhead({ engine: 'chromium', api, canvas, canvasCountedBytes: counted, depthStencilBytes: 8 * MiB,
        presentationBytes: 960 * 540 * 4, largestUploadBytes: 16 * MiB });
      expect(o.canvasBytes).toBe(Math.round(960 * 540 * f.canvasBytesPerPixel + f.canvasFixedBytes) - counted);
      expect(o.depthStencilBytes).toBe(Math.round(8 * MiB * f.depthStencilFactor));
      expect(o.stagingBytes).toBe(Math.round(Math.max(f.stagingFixedBytes, 16 * MiB * f.stagingPerLargestUpload)));
      expect(o.totalBytes).toBe(o.canvasBytes + o.presentationBytes + o.depthStencilBytes + o.stagingBytes);
      expect(o.model).toMatchObject({ engine: 'chromium', api, assumed: false });
      // Smaller upload calls (the WebGPU bands) never model more staging; no upload yet: none.
      const banded = gpuOverhead({ engine: 'chromium', api, canvas, canvasCountedBytes: counted, depthStencilBytes: 0, presentationBytes: 0, largestUploadBytes: MiB });
      expect(banded.stagingBytes).toBeLessThanOrEqual(o.stagingBytes); expect(banded.stagingBytes).toBe(Math.round(Math.max(f.stagingFixedBytes, MiB * f.stagingPerLargestUpload)));
      const empty = gpuOverhead({ engine: null, api, canvas: { width: 1920, height: 1080 }, canvasCountedBytes: 4 * counted,
        depthStencilBytes: 0, presentationBytes: 0, largestUploadBytes: 0 });
      expect(empty.stagingBytes).toBe(0); expect(empty.model.assumed).toBe(true);
      expect(empty.canvasBytes).toBe(Math.max(0, Math.round(1920 * 1080 * f.canvasBytesPerPixel + f.canvasFixedBytes) - 4 * counted));
      // The estimate counts it as its own component.
      const m = memoryBreakdown({ wasm: { linearBytes: 0, initialBytes: 0, moduleBytes: 0 }, guest: null, gpu: null, native: null,
        legacyTextureBytes: 0, canvas, js: { assetBytes: 0, streamCacheBytes: 0, gpuDecoderShadowBytes: 0, audioQueuedBytes: 0,
          loadBuffersBytes: 0, heapUsedBytes: null }, budget: { bytes: MEMORY_BUDGET_DEFAULT, source: 'default' }, gpuOverhead: o },
      { linear: 0, total: 0 });
      expect(m.estimate.components.gpuOverhead).toBe(o.totalBytes);
      expect(m.gpu!.overhead).toBe(o);
      expect(m.estimate.totalBytes).toBe(m.estimate.components.gpuNative + o.totalBytes);
    }
    // Chromium's WebGPU keeps far more staging per call than ANGLE (measured), which the upload bands exploit.
    expect(GPU_OVERHEAD_FACTORS.chromium.webgpu.stagingPerLargestUpload).toBeGreaterThan(GPU_OVERHEAD_FACTORS.chromium.webgl2.stagingPerLargestUpload);
  });
});
