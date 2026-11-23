// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0
// K71 (Q128, Q129): lazy §13 texture storage and the texture recovery-shadow opt-out, executor level (no browser).
// Breakage caught: storage committed at TEXTURE_CREATE / ALLOCATE_MIPS / zero-base GENERATE_MIPS, a first use that
// does not commit storage (or commits a level count other than the reservation), a depth materialization inside a
// pass that leaves another framebuffer, scissor or write mask in place, a delete that creates storage just to destroy
// it, shadows kept while the opt-out is set, a restore that silently proceeds without shadows, and the policy's
// precedence/validation.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { resolveRecoveryShadows } from '../../bgt/runtime/memory';
import { RECOVERY_SHADOWS_OFF } from '../../bgt/renderers/gpu-texture';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';

/** A recording WebGL 2 double: constants are stable numbers; binding and mask state is tracked for getParameter. */
function recordingGL() {
  const constants = new Map<string, number>(), calls: Array<[string, unknown[]]> = [];
  const c = (p: string) => { if (!constants.has(p)) constants.set(p, 0x1000 + constants.size); return constants.get(p)!; };
  const state = new Map<number, unknown>([[c('SCISSOR_TEST'), true], [c('DEPTH_WRITEMASK'), false],
    [c('STENCIL_WRITEMASK'), 0x0f], [c('STENCIL_BACK_WRITEMASK'), 0xf0], [c('DRAW_FRAMEBUFFER_BINDING'), null], [c('READ_FRAMEBUFFER_BINDING'), null]]);
  const bind = (target: number, fb: unknown) => {
    if (target === c('FRAMEBUFFER') || target === c('DRAW_FRAMEBUFFER')) state.set(c('DRAW_FRAMEBUFFER_BINDING'), fb);
    if (target === c('FRAMEBUFFER') || target === c('READ_FRAMEBUFFER')) state.set(c('READ_FRAMEBUFFER_BINDING'), fb);
  };
  const overrides: Record<string, unknown> = {
    NO_ERROR: 0, isContextLost: () => false, getError: () => 0,
    getExtension: () => new Proxy({}, { get: (_, p: string) => (...args: unknown[]) => { calls.push([p, args]); return {}; } }),
    getParameter: (p: number) => state.has(p) ? state.get(p) : 65536,
    checkFramebufferStatus: () => c('FRAMEBUFFER_COMPLETE'),
    bindFramebuffer: (t: number, fb: unknown) => { calls.push(['bindFramebuffer', [t, fb]]); bind(t, fb); },
    enable: (cap: number) => { calls.push(['enable', [cap]]); state.set(cap, true); },
    disable: (cap: number) => { calls.push(['disable', [cap]]); state.set(cap, false); },
    depthMask: (v: boolean) => { calls.push(['depthMask', [v]]); state.set(c('DEPTH_WRITEMASK'), v); },
    stencilMask: (v: number) => { calls.push(['stencilMask', [v]]); state.set(c('STENCIL_WRITEMASK'), v); state.set(c('STENCIL_BACK_WRITEMASK'), v); },
    stencilMaskSeparate: (face: number, v: number) => { calls.push(['stencilMaskSeparate', [face, v]]);
      state.set(face === c('FRONT') ? c('STENCIL_WRITEMASK') : c('STENCIL_BACK_WRITEMASK'), v); },
  };
  const gl = new Proxy({}, { get(_, p: string) {
    if (p in overrides) return overrides[p];
    if (/^[A-Z][A-Z0-9_]*$/.test(p)) return c(p);
    return (...args: unknown[]) => { calls.push([p, args]); return {}; };
  } }) as WebGL2RenderingContext;
  return { gl, calls, c, state, count: (name: string) => calls.filter(([n]) => n === name).length };
}

describe('K71 WebGL 2 lazy texture storage', () => {
  const make = (opts: { lazyTextures?: boolean } = {}) => {
    const r = recordingGL(), errors: string[] = [], gpu = new WebGL2Gpu(r.gl, (e) => errors.push(e), opts);
    const ok = (op: number, words: number[], data?: Uint8Array<ArrayBuffer>) => expect(gpu.execute({ kind: 'gpu', op, words, data }), errors.join()).toBe(0);
    return { ...r, gpu, ok, errors };
  };

  it('commits storage once, on first use, with every reserved level; never at create, mip allocation or zero-base generation', () => {
    const { gpu, ok, calls, count } = make();
    ok(O.TEXTURE_CREATE_EX, [1, 0, 64, 64, 1, 7, 0, 3]); ok(O.TEXTURE_ALLOCATE_MIPS, [1, 7]); ok(O.TEXTURE_GENERATE_MIPS, [1, 0]);
    ok(O.TEXTURE_CREATE_EX, [2, 0, 32, 32, 1, 1, 5, 2]); // DEPTH24_STENCIL8, attached at startup and never drawn
    ok(O.TEXTURE_CREATE_EX, [3, 2, 8, 8, 4, 2, 0, 1]); // 2D array, all levels reserved at create
    expect(count('texStorage2D') + count('texStorage3D')).toBe(0);
    expect(count('clearBufferfi') + count('clearBufferfv')).toBe(0);
    expect(count('generateMipmap')).toBe(0);
    let m = gpu.memory().textures;
    const chain = [64, 32, 16, 8, 4, 2, 1].reduce((n, s) => n + s * s * 4, 0);
    expect(m).toEqual({ count: 3, bytes: 0, depthStencilBytes: 0,
      lazy: { count: 3, bytes: chain + 32 * 32 * 4 + (8 * 8 + 4 * 4) * 4 * 4, depthStencilBytes: 32 * 32 * 4 } });
    // First upload commits all 7 reserved levels at once, exactly once.
    ok(O.TEXTURE_UPDATE_EX, [1, 3, 0, 0, 0, 8, 8, 1, 0, 256], new Uint8Array(256));
    ok(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 1, 1, 1, 0, 4], new Uint8Array(4));
    const storage = calls.filter(([n]) => n === 'texStorage2D');
    expect(storage).toHaveLength(1); expect(storage[0][1][1]).toBe(7); expect(storage[0][1].slice(3)).toEqual([64, 64]);
    m = gpu.memory().textures;
    expect(m.bytes).toBe(chain); expect(m.lazy!.bytes).toBe(32 * 32 * 4 + (8 * 8 + 4 * 4) * 4 * 4);
    expect(gpu.lazyTextures.materialized).toBe(1);
    // Deleting a never-materialized texture needs no storage.
    ok(O.TEXTURE_DELETE, [3]);
    expect(count('texStorage3D')).toBe(0);
    expect(gpu.memory().textures.lazy).toEqual({ count: 1, bytes: 32 * 32 * 4, depthStencilBytes: 32 * 32 * 4 });
  });

  it('eager mode (lazyTextures: false) allocates at creation as before K71', () => {
    const { gpu, ok, count } = make({ lazyTextures: false });
    ok(O.TEXTURE_CREATE_EX, [1, 0, 16, 16, 1, 1, 6, 2]);
    expect(count('texStorage2D')).toBe(1); expect(count('clearBufferfv')).toBe(1);
    expect(gpu.memory().textures).toMatchObject({ bytes: 16 * 16 * 4, depthStencilBytes: 16 * 16 * 4, lazy: { count: 0, bytes: 0, depthStencilBytes: 0 } });
  });

  it('materializes a depth texture bound for sampling inside a pass and restores framebuffer, scissor and masks', () => {
    const { ok, calls, c, state, count } = make();
    ok(O.TEXTURE_CREATE_EX, [1, 0, 16, 16, 1, 1, 0, 3]); // color attachment
    ok(O.TEXTURE_CREATE_EX, [2, 0, 16, 16, 1, 1, 6, 3]); // DEPTH32F, sampled only
    ok(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 1, 1, 1, 0, 4], new Uint8Array(4)); // has storage: the pass is real
    ok(O.PASS_BEGIN, [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(count('texStorage2D')).toBe(1);
    const passFb = state.get(c('DRAW_FRAMEBUFFER_BINDING'));
    expect(passFb).toBeTruthy();
    // Pipeline-like state inside the pass that the initialization clear must not leak.
    state.set(c('SCISSOR_TEST'), true); state.set(c('DEPTH_WRITEMASK'), false);
    state.set(c('STENCIL_WRITEMASK'), 3); state.set(c('STENCIL_BACK_WRITEMASK'), 5);
    const mark = calls.length;
    ok(O.TEXTURE, [0, 2, 1]);
    const during = calls.slice(mark);
    expect(during.filter(([n]) => n === 'texStorage2D')).toHaveLength(1);
    expect(during.filter(([n]) => n === 'clearBufferfv')).toHaveLength(1); // depth initialized to 1
    expect(state.get(c('DRAW_FRAMEBUFFER_BINDING'))).toBe(passFb);
    expect(state.get(c('READ_FRAMEBUFFER_BINDING'))).toBe(passFb);
    expect(state.get(c('SCISSOR_TEST'))).toBe(true);
    expect(state.get(c('DEPTH_WRITEMASK'))).toBe(false);
    expect(state.get(c('STENCIL_WRITEMASK'))).toBe(3);
    expect(state.get(c('STENCIL_BACK_WRITEMASK'))).toBe(5);
    // A second bind of the same texture commits nothing more.
    ok(O.TEXTURE, [1, 2, 1]);
    expect(count('texStorage2D')).toBe(2);
  });

  it('a clear-only pass over storage-less attachments records constants; first use clears to them; an in-pass op realizes the pass', () => {
    const { gpu, ok, calls, c, state, count } = make();
    const f = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];
    ok(O.TEXTURE_CREATE_EX, [1, 0, 16, 16, 1, 1, 0, 3]); ok(O.TEXTURE_CREATE_EX, [2, 0, 16, 16, 1, 1, 5, 3]);
    // The profile's whole-attachment glClear: PASS_BEGIN with clears + PASS_END.
    ok(O.PASS_BEGIN, [1, 2, 0, 1, 1, f(0.5), 7, 1, 0, 1, f(0.25), f(0.5), f(0.75), f(1)]); ok(O.PASS_END, []);
    expect(count('texStorage2D')).toBe(0); expect(count('clearBufferfv') + count('clearBufferfi') + count('clearBufferiv')).toBe(0);
    expect(gpu.lazyTextures.deferredPasses).toBe(1);
    expect(gpu.memory().textures.lazy!.count).toBe(2);
    // Sampling the color texture inside a later pass: storage, then exactly the recorded clear, color mask restored.
    ok(O.TEXTURE_CREATE_EX, [3, 0, 16, 16, 1, 1, 0, 3]);
    ok(O.TEXTURE_UPDATE_EX, [3, 0, 0, 0, 0, 1, 1, 1, 0, 4], new Uint8Array(4));
    ok(O.PASS_BEGIN, [1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0]); // LOAD over a materialized target: a real pass
    const mark = calls.length;
    ok(O.TEXTURE, [0, 1, 1]);
    const clears = calls.slice(mark).filter(([n]) => n === 'clearBufferfv');
    expect(clears).toEqual([['clearBufferfv', [c('COLOR'), 0, [0.25, 0.5, 0.75, 1]]]]);
    expect(calls.slice(mark).some(([n, a]) => n === 'colorMaskiOES' && a[0] === 0)).toBe(true);
    ok(O.PASS_END, []);
    // The depth/stencil texture: depth 0.5 and stencil 7 from the deferred clear, via one clearBufferfi.
    ok(O.TEXTURE_READBACK, [2, 0, 0, 0, 0, 1, 1, 1, 1]);
    expect(calls.filter(([n]) => n === 'clearBufferfi').map(([, a]) => a.slice(1))).toEqual([[0, 0.5, 7]]);
    // A pass that is followed by an in-pass op is realized natively (attachments get storage, clears issued).
    ok(O.TEXTURE_CREATE_EX, [4, 0, 8, 8, 1, 1, 0, 3]);
    const before = count('texStorage2D');
    ok(O.PASS_BEGIN, [1, 0, 0, 0, 0, 0, 0, 4, 0, 1, f(1), 0, 0, f(1)]);
    expect(count('texStorage2D')).toBe(before);
    ok(O.SCISSOR, [0, 0, 4, 4]);
    expect(count('texStorage2D')).toBe(before + 1);
    expect(state.get(c('DRAW_FRAMEBUFFER_BINDING'))).toBeTruthy();
    ok(O.PASS_END, []);
    expect(gpu.lazyTextures.deferredPasses).toBe(1);
  });

  it('recovery shadows off: no texture shadows, restore refuses after an upload; on: shadows and restore', () => {
    for (const shadows of [true, false]) {
      const { gpu, ok } = make();
      gpu.recoveryShadows = shadows;
      ok(O.TEXTURE_CREATE_EX, [1, 0, 4, 4, 1, 1, 0, 3]);
      ok(O.TEXTURE_CREATE_EX, [2, 0, 4, 4, 1, 1, 0, 3]);
      expect(() => gpu.restore()).not.toThrow(); // nothing uploaded yet: nothing to lose
      ok(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 4, 4, 1, 0, 64], new Uint8Array(64).fill(3));
      ok(O.TEXTURE_GENERATE_MIPS, [1, 0]);
      expect(gpu.memory().shadows.textureBytes).toBe(shadows ? 64 + 64 : 0);
      if (shadows) expect(() => gpu.restore()).not.toThrow();
      else expect(() => gpu.restore()).toThrow(`${RECOVERY_SHADOWS_OFF}: 1 uploaded texture(s) cannot be restored`);
    }
  });
});

/** A recording GPUDevice double: textures count creation, views and destruction. */
function fakeDevice() {
  const textures: Array<{ desc: GPUTextureDescriptor; destroyed: boolean }> = [], passes: unknown[] = [];
  const encoder = () => ({ beginRenderPass: (d: unknown) => { passes.push(d); return { end: () => {} }; },
    copyTextureToTexture: vi.fn(), finish: () => ({}) });
  const device = {
    limits: {}, features: new Set<string>(), queue: { submit: vi.fn(), writeTexture: vi.fn(), writeBuffer: vi.fn() },
    createTexture: (desc: GPUTextureDescriptor) => {
      const t = { desc, destroyed: false, width: (desc.size as number[])[0], height: (desc.size as number[])[1],
        createView: () => ({}), destroy() { this.destroyed = true; } };
      textures.push(t); return t;
    },
    createCommandEncoder: encoder, createBuffer: () => ({ destroy() {} }),
  };
  return { device, textures, passes };
}

describe('K71 WebGPU lazy texture storage', () => {
  beforeAll(() => {
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
    vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 });
  });
  afterAll(() => { vi.unstubAllGlobals(); });
  const make = (opts: { lazyTextures?: boolean } = {}) => {
    const f = fakeDevice(), errors: string[] = [];
    const gpu = new WebGPUCommands(f.device as unknown as GPUDevice, (e) => errors.push(e), null, opts);
    const ok = (op: number, words: number[], data?: Uint8Array<ArrayBuffer>) => expect(gpu.execute({ kind: 'gpu', op, words, data }), errors.join()).toBe(0);
    return { ...f, gpu, ok, errors };
  };

  it('creates the GPUTexture on first use with every reserved level; delete of an unused texture creates none', () => {
    const { gpu, ok, textures, passes, device } = make();
    ok(O.TEXTURE_CREATE_EX, [1, 0, 64, 64, 1, 7, 0, 3]); ok(O.TEXTURE_ALLOCATE_MIPS, [1, 7]); ok(O.TEXTURE_GENERATE_MIPS, [1, 0]);
    ok(O.TEXTURE_CREATE_EX, [2, 0, 32, 32, 1, 1, 5, 2]); ok(O.TEXTURE_CREATE_EX, [3, 0, 8, 8, 1, 1, 0, 3]);
    expect(textures).toHaveLength(0); expect(passes).toHaveLength(0);
    expect(gpu.memory().textures.lazy!.count).toBe(3);
    ok(O.TEXTURE_DELETE, [3]);
    expect(textures).toHaveLength(0);
    ok(O.TEXTURE_UPDATE_EX, [1, 2, 0, 0, 0, 16, 16, 1, 0, 1024], new Uint8Array(1024));
    expect(textures).toHaveLength(1); expect(textures[0].desc.mipLevelCount).toBe(7);
    expect(device.queue.writeTexture).toHaveBeenCalledTimes(1);
    const m = gpu.memory().textures;
    expect(m.bytes).toBe([64, 32, 16, 8, 4, 2, 1].reduce((n, s) => n + s * s * 4, 0));
    expect(m.lazy).toEqual({ count: 1, bytes: 32 * 32 * 4, depthStencilBytes: 32 * 32 * 4 });
    expect(gpu.lazyTextures.materialized).toBe(1);
  });

  it('a depth texture is cleared to 1 (and stencil 0) when it is materialized, for every reserved level', () => {
    const { gpu, ok, textures, passes } = make();
    ok(O.TEXTURE_CREATE_EX, [2, 0, 32, 32, 1, 2, 5, 3]); ok(O.TEXTURE_ALLOCATE_MIPS, [2, 2]);
    expect(passes).toHaveLength(0);
    void (gpu as unknown as { textures: Map<number, { native: unknown }> }).textures.get(2)!.native;
    expect(textures).toHaveLength(1); expect(textures[0].desc.mipLevelCount).toBe(2);
    expect(passes).toHaveLength(2);
    for (const p of passes as Array<{ depthStencilAttachment: GPURenderPassDepthStencilAttachment }>)
      expect(p.depthStencilAttachment).toMatchObject({ depthLoadOp: 'clear', depthClearValue: 1, stencilLoadOp: 'clear', stencilClearValue: 0 });
  });

  it('a clear-only pass creates nothing; materialization clears every level to its recorded constant', () => {
    const { gpu, ok, textures, passes } = make();
    const f = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];
    ok(O.TEXTURE_CREATE_EX, [1, 0, 16, 16, 1, 1, 0, 3]); ok(O.TEXTURE_CREATE_EX, [2, 0, 16, 16, 1, 1, 5, 3]);
    ok(O.PASS_BEGIN, [1, 2, 0, 1, 0, f(0.25), 0, 1, 0, 1, f(0.5), 0, 0, f(1)]); ok(O.PASS_END, []);
    expect(textures).toHaveLength(0); expect(passes).toHaveLength(0); expect(gpu.lazyTextures.deferredPasses).toBe(1);
    const t = (gpu as unknown as { textures: Map<number, { native: unknown }> }).textures;
    void t.get(1)!.native; void t.get(2)!.native;
    expect(passes).toEqual([
      expect.objectContaining({ colorAttachments: [expect.objectContaining({ loadOp: 'clear', clearValue: [0.5, 0, 0, 1] })] }),
      expect.objectContaining({ depthStencilAttachment: expect.objectContaining({ depthClearValue: 0.25, stencilClearValue: 0 }) }),
    ]);
  });

  it('eager mode creates at TEXTURE_CREATE; the shadow opt-out keeps no upload copy and restore refuses', async () => {
    const eager = make({ lazyTextures: false });
    eager.ok(O.TEXTURE_CREATE_EX, [1, 0, 4, 4, 1, 1, 0, 3]);
    expect(eager.textures).toHaveLength(1);
    const off = make(); off.gpu.recoveryShadows = false;
    off.ok(O.TEXTURE_CREATE_EX, [1, 0, 4, 4, 1, 1, 0, 3]);
    off.ok(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 4, 4, 1, 0, 64], new Uint8Array(64).fill(5));
    expect(off.gpu.memory().shadows.textureBytes).toBe(0);
    await expect(off.gpu.restore(fakeDevice().device as unknown as GPUDevice)).rejects.toThrow(RECOVERY_SHADOWS_OFF);
    const on = make();
    on.ok(O.TEXTURE_CREATE_EX, [1, 0, 4, 4, 1, 1, 0, 3]);
    on.ok(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 4, 4, 1, 0, 64], new Uint8Array(64).fill(5));
    expect(on.gpu.memory().shadows.textureBytes).toBe(64);
  });
});

describe('K71 recovery shadow policy', () => {
  it('option > URL > manifest > default (on); invalid values are rejected', () => {
    expect(resolveRecoveryShadows()).toEqual({ enabled: true, source: 'default' });
    expect(resolveRecoveryShadows(undefined, null, false)).toEqual({ enabled: false, source: 'manifest' });
    expect(resolveRecoveryShadows(undefined, '1', false)).toEqual({ enabled: true, source: 'url' });
    expect(resolveRecoveryShadows(undefined, '0', true)).toEqual({ enabled: false, source: 'url' });
    expect(resolveRecoveryShadows(true, '0', false)).toEqual({ enabled: true, source: 'option' });
    expect(resolveRecoveryShadows(undefined, '', undefined)).toEqual({ enabled: true, source: 'default' });
    expect(() => resolveRecoveryShadows(undefined, 'no')).toThrow(/recoveryshadows=no/);
    expect(() => resolveRecoveryShadows(undefined, null, 'false')).toThrow(/must be a boolean/);
  });
});
