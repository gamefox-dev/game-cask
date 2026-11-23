// SPDX-License-Identifier: CC0-1.0
// K64: memory attribution math, budget resolution, decoder reservations by kind and lazy WebGL 2 recovery shadows.
import { describe, expect, it } from 'vitest';
import * as A from '../../bgt/runtime/abi';
import { CommandEncoder, Frame, TextureTable, defaultState, decodeCommands, type DecodeContext } from '../../bgt/runtime/commands';
import { GpuState } from '../../bgt/runtime/commands-gpu';
import {
  MEMORY_BUDGET_DEFAULT, guestMemoryFromMetrics, memoryBreakdown, resolveMemoryBudget, textureLevelBytes, type MemoryInputs,
} from '../../bgt/runtime/memory';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';

const O = A.GPU_OP;
const MiB = 1024 * 1024;
const inputs = (patch: Partial<MemoryInputs> = {}): MemoryInputs => ({
  wasm: { linearBytes: 200 * MiB, initialBytes: 2 * MiB, moduleBytes: 30 * MiB },
  guest: null,
  gpu: { budgetBytes: 256 * MiB, reservedBytes: 12 * MiB, peakReservedBytes: 14 * MiB, reserved: { buffers: 4 * MiB, textures: 8 * MiB, shaders: 0 } },
  native: { backend: 'webgl2', buffers: { count: 2, bytes: 4 * MiB, nativeBytes: 4 * MiB }, textures: { count: 3, bytes: 8 * MiB, depthStencilBytes: MiB },
    renderbuffers: { count: 0, bytes: 0 }, internal: { bytes: MiB, screenBytes: MiB, poolBytes: 0, scratchBytes: 0 },
    shadows: { bufferBytes: 4 * MiB, textureBytes: 2 * MiB } },
  legacyTextureBytes: 0,
  canvas: { width: 1024, height: 512 },
  js: { assetBytes: 10 * MiB, streamCacheBytes: 3 * MiB, gpuDecoderShadowBytes: 4 * MiB, audioQueuedBytes: 1000, loadBuffersBytes: 0, heapUsedBytes: null },
  budget: { bytes: MEMORY_BUDGET_DEFAULT, source: 'default' },
  ...patch,
});

describe('memory breakdown', () => {
  it('counts each held byte once and sums the components to the total', () => {
    const m = memoryBreakdown(inputs(), { linear: 0, total: 0 });
    const canvas = 1024 * 512 * 4 * 2;
    expect(m.gpu!.canvasBytesEstimate).toBe(canvas);
    expect(m.estimate.components).toEqual({ wasmLinear: 200 * MiB, wasmModule: 30 * MiB,
      gpuNative: 4 * MiB + 8 * MiB + MiB + canvas, jsHeld: 10 * MiB + 3 * MiB + 4 * MiB + 1000 + 6 * MiB, gpuOverhead: 0 });
    const c = m.estimate.components;
    expect(m.estimate.totalBytes).toBe(c.wasmLinear + c.wasmModule + c.gpuNative + c.jsHeld + c.gpuOverhead);
    expect(m.js.heldBytes).toBe(c.jsHeld);
    expect(m.js.gpuRecoveryShadowBytes).toBe(6 * MiB);
    expect(m.estimate.status).toBe('ok');
    expect(m.wasm.compiledBytes).toBeNull();
  });
  it('flags the budget and keeps high-water marks across samples', () => {
    const over = memoryBreakdown(inputs({ budget: { bytes: 64 * MiB, source: 'url' } }), { linear: 0, total: 0 });
    expect(over.estimate).toMatchObject({ overBudget: true, status: 'over-budget', budgetBytes: 64 * MiB, budgetSource: 'url' });
    const later = memoryBreakdown(inputs({ wasm: { linearBytes: 100 * MiB, initialBytes: 0, moduleBytes: 0 } }),
      { linear: 300 * MiB, total: over.estimate.totalBytes + 5 });
    expect(later.wasm.peakLinearBytes).toBe(300 * MiB);
    expect(later.estimate.peakTotalBytes).toBe(over.estimate.totalBytes + 5);
    expect(later.estimate.totalBytes).toBeLessThan(later.estimate.peakTotalBytes);
  });
  it('a load-milestone sample with the download buffer sets the peak that later samples keep (vK64)', () => {
    const base = inputs();
    const load = memoryBreakdown({ ...base, js: { ...base.js, loadBuffersBytes: 30 * MiB } }, { linear: 0, total: 0 });
    const steady = memoryBreakdown(base, { linear: load.wasm.peakLinearBytes, total: load.estimate.peakTotalBytes });
    expect(load.estimate.totalBytes - steady.estimate.totalBytes).toBe(30 * MiB);
    expect(load.js.heldBytes - steady.js.heldBytes).toBe(30 * MiB);
    expect(steady.estimate.peakTotalBytes).toBe(load.estimate.totalBytes);
    expect(steady.estimate.peakSampling).toMatch(/load milestones.*every 30 presents/);
  });
  it('a game without GPU or guest metrics has null sections, still a total', () => {
    const m = memoryBreakdown(inputs({ gpu: null, native: null, canvas: { width: 0, height: 0 } }), { linear: 0, total: 0 });
    expect(m.gpu).toBeNull();
    expect(m.estimate.components.gpuNative).toBe(0);
  });
  it('reads guest memory from Win32 profile metrics; native games have none', () => {
    expect(guestMemoryFromMetrics({ bgt: 1 })).toBeNull();
    expect(guestMemoryFromMetrics(null)).toBeNull();
    expect(guestMemoryFromMetrics({ heap_bytes: 4096, virtual_live_bytes: '65536', host_bytes: 10n, gl_frontend_bytes: 7 })).toMatchObject({
      heapBytes: 4096, virtualLiveBytes: 65536, hostBytes: 10, glFrontendBytes: 7, committedBytes: null });
  });
});

describe('memory budget', () => {
  it('resolves option > URL > manifest > default', () => {
    expect(resolveMemoryBudget()).toEqual({ bytes: MEMORY_BUDGET_DEFAULT, source: 'default' });
    expect(MEMORY_BUDGET_DEFAULT).toBe(1.5 * 1024 * MiB);
    expect(resolveMemoryBudget(undefined, null, 512 * MiB)).toEqual({ bytes: 512 * MiB, source: 'manifest' });
    expect(resolveMemoryBudget(undefined, '1.5g', 512 * MiB)).toEqual({ bytes: 1536 * MiB, source: 'url' });
    expect(resolveMemoryBudget(undefined, '768m')).toEqual({ bytes: 768 * MiB, source: 'url' });
    expect(resolveMemoryBudget(undefined, String(100 * MiB))).toEqual({ bytes: 100 * MiB, source: 'url' });
    expect(resolveMemoryBudget(200 * MiB, '768m', 512 * MiB)).toEqual({ bytes: 200 * MiB, source: 'option' });
  });
  it.each([['abc'], ['1m'], ['-5'], ['1e9']])('rejects URL value %s', (v) => {
    expect(() => resolveMemoryBudget(undefined, v)).toThrow(RangeError);
  });
  it('rejects fractional or out-of-range manifest/option budgets', () => {
    expect(() => resolveMemoryBudget(undefined, null, 1.5)).toThrow(RangeError);
    expect(() => resolveMemoryBudget(1024)).toThrow(RangeError);
  });
});

describe('texture level bytes', () => {
  it('2D chains, constant array layers and halving 3D depth', () => {
    expect(textureLevelBytes({ width: 8, height: 4, depth: 1, dimension: 0 }, 3, 4)).toBe((32 + 8 + 2) * 4);
    expect(textureLevelBytes({ width: 4, height: 4, depth: 6, dimension: 2 }, 2, 1)).toBe((16 + 4) * 6);
    expect(textureLevelBytes({ width: 4, height: 4, depth: 4, dimension: 1 }, 3, 2)).toBe((64 + 8 + 1) * 2);
    expect(textureLevelBytes({ width: 9, height: 1, depth: 1, dimension: 0 }, 0, 4)).toBe(0);
  });
});

describe('decoder reservation by kind', () => {
  it('splits the GPU reservation into buffers/textures/shaders that sum to the reserved bytes', () => {
    const frame = new Frame(); frame.reset(64, 64);
    const gpu = new GpuState({ languages: 7, glRaster: true, execute: () => 0 });
    const ctx: DecodeContext = { state: defaultState(64, 64), frame, textures: new TextureTable(), linearFilter: true, triangles: true, gpu };
    const run = (e: CommandEncoder) => { const b = e.finish(), mem = new Uint8Array(65536); mem.set(b); return decodeCommands(mem, 0, b.length, ctx); };
    expect(run(new CommandEncoder()
      .gpu(O.BUFFER_CREATE, [1, 7, 4096, 0, 0]).gpu(O.BUFFER_CREATE, [2, 7, 1000, 0, 0])
      .gpu(O.TEXTURE_CREATE, [1, 8, 8, 4, 0, 3])
      .gpu(O.TEXTURE_CREATE_EX, [2, 2, 16, 16, 3, 1, 2, 1])).errors).toEqual([]);
    const k = gpu.reservedByKind();
    expect(k).toEqual({ buffers: 5096, textures: (64 + 16 + 4 + 1) * 4 + 16 * 16 * 3, shaders: 0 });
    expect(k.buffers + k.textures + k.shaders).toBe(gpu.bytes);
    expect(run(new CommandEncoder().gpu(O.BUFFER_DELETE, [2]).gpu(O.TEXTURE_DELETE, [1])).errors).toEqual([]);
    const after = gpu.reservedByKind();
    expect(after).toEqual({ buffers: 4096, textures: 16 * 16 * 3, shaders: 0 });
    expect(after.buffers + after.textures + after.shaders).toBe(gpu.bytes);
  });
});

/** A do-nothing WebGL 2 context: constants are stable numbers, every call returns a fresh object. */
function fakeGL(): WebGL2RenderingContext {
  const constants = new Map<string, number>();
  const constant = (p: string) => { if (!constants.has(p)) constants.set(p, 0x1000 + constants.size); return constants.get(p)!; };
  const overrides: Record<string, unknown> = { NO_ERROR: 0, isContextLost: () => false, getError: () => 0, getExtension: () => ({}),
    getParameter: () => 65536, checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE') };
  return new Proxy({}, { get(_, p: string) {
    if (p in overrides) return overrides[p];
    if (/^[A-Z][A-Z0-9_]*$/.test(p)) return constant(p);
    return () => ({});
  } }) as WebGL2RenderingContext;
}

describe('WebGL 2 executor memory', () => {
  it('reports native sizes equal to the reservation and allocates texture shadows only on upload (K64)', () => {
    const errors: string[] = [], gpu = new WebGL2Gpu(fakeGL(), (e) => errors.push(e), {});
    const ok = (op: number, words: number[], data?: Uint8Array<ArrayBuffer>) => expect(gpu.execute({ kind: 'gpu', op, words, data }), errors.join()).toBe(0);
    ok(O.BUFFER_CREATE, [1, 7, 4096, 0, 0], new Uint8Array(4096));
    // A 256x256 RGBA8 render target with a full mip chain, never uploaded.
    ok(O.TEXTURE_CREATE_EX, [1, 0, 256, 256, 1, 9, 0, 3]);
    ok(O.TEXTURE_ALLOCATE_MIPS, [1, 9]);
    let m = gpu.memory();
    const chain = textureLevelBytes({ width: 256, height: 256, depth: 1, dimension: 0 }, 9, 4);
    expect(m.buffers).toEqual({ count: 1, bytes: 4096, nativeBytes: 4096 });
    // K71: never used, so no native storage yet; the reserved chain is reported as lazy.
    expect(m.textures).toEqual({ count: 1, bytes: 0, depthStencilBytes: 0, lazy: { count: 1, bytes: chain, depthStencilBytes: 0 } });
    expect(m.shadows).toEqual({ bufferBytes: 4096, textureBytes: 0, sharedBufferBytes: 0 }); // no decoder: private (K74); eager: 256*256*4 + every grown level
    ok(O.TEXTURE_GENERATE_MIPS, [1, 0]);
    expect(gpu.memory().shadows.textureBytes).toBe(0); // generated from a zero base: no zero chain
    ok(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 16, 16, 1, 0, 16 * 16 * 4], new Uint8Array(16 * 16 * 4).fill(7));
    m = gpu.memory();
    expect(m.shadows.textureBytes).toBe(256 * 256 * 4);
    ok(O.TEXTURE_GENERATE_MIPS, [1, 0]);
    expect(gpu.memory().shadows.textureBytes).toBe(256 * 256 * 4 * 2 + (chain - 256 * 256 * 4)); // base + generated copy + chain
    ok(O.TEXTURE_CREATE_EX, [2, 0, 64, 64, 1, 1, 5, 2]); // depth24-stencil8 attachment
    m = gpu.memory();
    expect(m.textures.lazy!.depthStencilBytes).toBe(64 * 64 * 4); // K71: an attachment that was never drawn
    expect(m.renderbuffers).toEqual({ count: 0, bytes: 0 });
  });
});
