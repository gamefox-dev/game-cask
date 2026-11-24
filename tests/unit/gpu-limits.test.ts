import { beforeAll, expect, it } from 'vitest';
import { compileC } from '../support/compile';
import { GameHost } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { CAP_ENTROPY, CAP_GPU, E_BOUNDS, E_LIMIT, GPU_LIMITS_SIZE, GPU_OP } from '../../bgt/runtime/abi';
import { CommandEncoder } from '../../bgt/runtime/commands';
let wasm: WebAssembly.Module;
beforeAll(async () => { wasm = await WebAssembly.compile(await compileC('tests/fixtures/c/gpu_limits_probe.c')); });
it.each([0, 15, 16, 79, 80, 112])('limits cap %i preserves prefix and writes only negotiated size', async (cap) => {
  const host = await GameHost.create(wasm, { log: () => {}, vfs: new Vfs(), now: () => 0 }, {
    backend: 3, caps: CAP_GPU, seed: 1, displayWidth: 64, displayHeight: 64, arg0: 0, arg1: cap,
  });
  expect(host.init()).toBe(0);
  const bytes = host.peek(0, 112)!, words = [...new Uint32Array(bytes.buffer, bytes.byteOffset, 28)];
  expect(words[24] | 0).toBe(cap < 16 ? E_LIMIT : 0);
  expect(words[25] & CAP_GPU).toBe(0); // cannot advertise without implementation
  const n = cap < 16 ? 0 : cap < 80 ? 4 : 20;
  if (n) expect(words.slice(0, 4)).toEqual([n * 4, 4096, 1023, 268435456]);
  if (n === 20) expect(words.slice(4, 20)).toEqual([
    0, 1023, 268435456, 67108864, 8, 16, 8, 4, 256, 65536, 2048, 1048576, 0, 13, 65535, 0,
  ]);
  expect(words.slice(n, 24)).toEqual(new Array(24 - n).fill(0xdeadbeef));
  expect(GPU_LIMITS_SIZE).toBe(80);
});
it.each([1, 0xfffffffc])('limits rejects misaligned/out-of-memory destination %i without writes', async (ptr) => {
  const host = await GameHost.create(wasm, { log: () => {}, vfs: new Vfs(), now: () => 0 }, {
    backend: 3, caps: 0, seed: 1, displayWidth: 64, displayHeight: 64, arg0: ptr, arg1: 80,
  });
  host.init();
  const bytes = host.peek(0, 112)!, words = new Uint32Array(bytes.buffer, bytes.byteOffset, 28);
  expect(words[24] | 0).toBe(E_BOUNDS);
  expect([...words.slice(0, 24)]).toEqual(new Array(24).fill(0xdeadbeef));
});
it('GPU renegotiation cannot discard decoded resources or pending work before backend execution', async () => {
  const host = await GameHost.create(wasm, { log: () => {}, vfs: new Vfs(), now: () => 0 }, {
    backend: 3, caps: CAP_GPU | 1, seed: 1, displayWidth: 64, displayHeight: 64, arg0: 0, arg1: 80,
    gpuBackend: { languages: 7, execute: () => 0 },
  });
  host.init();
  expect(host.hasGpuWork).toBe(false);
  const create = new CommandEncoder().gpu(GPU_OP.BUFFER_CREATE, [1, 1, 16, 0, 0]).finish();
  const remove = new CommandEncoder().gpu(GPU_OP.BUFFER_DELETE, [1]).finish();
  expect(host.submitExternal(create).status).toBe(0);
  expect(host.hasGpuWork).toBe(true);
  expect(() => host.setBackend(2)).toThrow('Cannot migrate live GPU resources');
  host.consume(); // Even once queued work is consumed, the logical handle is still live.
  expect(host.hasGpuWork).toBe(true);
  expect(() => host.setBackend(2)).toThrow('Cannot migrate live GPU resources');
  expect(host.submitExternal(remove).status).toBe(0);
  expect(host.hasGpuWork).toBe(true); // Deletion itself remains queued even with empty handle maps.
  expect(() => host.setBackend(2)).toThrow('pending GPU work');
  host.consume();
  expect(host.hasGpuWork).toBe(false);
  host.setBackend(2, { languages: 6, execute: () => 0 });
  host.init(); // Re-query extended limits through the fixture's init export.
  let words = new Uint32Array(host.peek(0, 112)!.buffer);
  expect(words[16]).toBe(6); expect(words[25]).toBe(CAP_GPU | CAP_ENTROPY | 1); // LANE-K1
  host.setBackend(2);
  host.init();
  words = new Uint32Array(host.peek(0, 112)!.buffer);
  expect(words[16]).toBe(0); expect(words[25]).toBe(CAP_ENTROPY | 1); // LANE-K1: preserve entropy.
});
it('an explicitly enabled GPU host reports its language mask and clears no unrelated capability', async () => {
  const host = await GameHost.create(wasm, { log: () => {}, vfs: new Vfs(), now: () => 0 }, {
    backend: 3, caps: CAP_GPU | 1, seed: 1, displayWidth: 64, displayHeight: 64, arg0: 0, arg1: 80,
    gpuBackend: { languages: 6, execute: () => 0 },
  });
  host.init();
  const bytes = host.peek(0, 112)!, words = new Uint32Array(bytes.buffer, bytes.byteOffset, 28);
  expect(words[4]).toBe(1); expect(words[16]).toBe(6); expect(words[25]).toBe(CAP_GPU | CAP_ENTROPY | 1); // LANE-K1
});
// K51: offset 52 must be the backend's real (clamped) limit; a fixed 65536 would lie to a 16384-byte WebGL2 device.
// K73: that is 'device' mode (gpu.limits: "device"); the default 'portable' mode is tested below.
it.each([[undefined, 65536], [16384, 16384], [32776, 32768], [131072, 65536]])(
  'max_uniform_range reports backend limit %s as %i in device mode', async (native, expected) => {
    const host = await GameHost.create(wasm, { log: () => {}, vfs: new Vfs(), now: () => 0 }, {
      backend: 3, caps: CAP_GPU, seed: 1, displayWidth: 64, displayHeight: 64, arg0: 0, arg1: 80,
      gpuBackend: { languages: 6, maxUniformRange: native, execute: () => 0 }, gpuLimits: 'device',
    });
    host.init();
    const bytes = host.peek(0, 112)!, words = new Uint32Array(bytes.buffer, bytes.byteOffset, 28);
    expect(words[4]).toBe(1); expect(words[13]).toBe(expected);
  });

// K73 (Q135): the default reports one portable table on every device: ANGLE Metal (16384 uniform range, 84 varyings,
// 16384 textures), SwiftShader (65536, 87, 8192) and WebGPU (65536, 102, 8192) all read 8192 / 16384 / 84 at offsets
// 4 / 52 / 76. Would catch a host that still reports the device value (the MMX8 r30 cross-backend divergence).
const devices: [string, number, number, number][] = [
  ['ANGLE Metal', 16384, 84, 16384], ['SwiftShader', 65536, 87, 8192], ['WebGPU Chromium', 65536, 102, 8192], ['WebGPU WebKit', 65536, 114, 8192]];
const limitWords = async (uniform: number, varyings: number, texture: number, gpuLimits?: 'portable' | 'device') => {
  const host = await GameHost.create(wasm, { log: () => {}, vfs: new Vfs(), now: () => 0 }, {
    backend: 3, caps: CAP_GPU, seed: 1, displayWidth: 64, displayHeight: 64, arg0: 0, arg1: 80, maxTextureDimension: texture,
    gpuBackend: { languages: 6, maxUniformRange: uniform, maxVaryingComponents: varyings, execute: () => 0 }, gpuLimits,
  });
  host.init();
  const bytes = host.peek(0, 112)!, words = new Uint32Array(bytes.buffer, bytes.byteOffset, 28);
  return { words: [words[1], words[13], words[19]], host };
};
it.each(devices)('portable limits (default) on %s: offsets 4/52/76 = 8192/16384/84', async (_name, uniform, varyings, texture) => {
  const { words, host } = await limitWords(uniform, varyings, texture);
  expect(words).toEqual([8192, 16384, 84]);
  expect(host.gpuLimits).toEqual({ mode: 'portable', maxUniformRange: 16384, deviceMaxUniformRange: uniform,
    maxVaryingComponents: 84, deviceMaxVaryingComponents: varyings, maxTextureDimension: 8192, deviceMaxTextureDimension: texture });
});
it.each(devices)('device limits (gpu.limits: "device") on %s report the device values', async (_name, uniform, varyings, texture) => {
  const { words, host } = await limitWords(uniform, varyings, texture, 'device');
  expect(words).toEqual([texture, uniform, varyings]);
  expect(host.gpuLimits?.mode).toBe('device');
});
it('portable limits never exceed a smaller device (16-location WebGPU adapter: 54 varyings; 4096 textures)', async () => {
  const { words } = await limitWords(65536, 54, 4096);
  expect(words).toEqual([4096, 16384, 54]);
});
it('rejects an unknown gpuLimits mode', async () => {
  await expect(GameHost.create(wasm, { log: () => {}, vfs: new Vfs(), now: () => 0 }, {
    backend: 3, caps: CAP_GPU, seed: 1, displayWidth: 64, displayHeight: 64, arg0: 0, arg1: 80,
    gpuBackend: { languages: 6, execute: () => 0 }, gpuLimits: 'max' as 'device',
  })).rejects.toThrow(/invalid gpuLimits/);
});
it('a WebGPU -> WebGL 2 fallback keeps the portable values (no stale, larger limit for the guest)', async () => {
  const { host } = await limitWords(65536, 102, 8192);
  host.setBackend(2, { languages: 6, maxUniformRange: 16384, maxVaryingComponents: 84, execute: () => 0 });
  host.init();
  const bytes = host.peek(0, 112)!, words = new Uint32Array(bytes.buffer, bytes.byteOffset, 28);
  expect([words[13], words[19]]).toEqual([16384, 84]);
});
// vK73: a backend switch recomputes offset 4 from the new renderer (it kept the old renderer's value before).
it.each([['portable', 4096, 4096], ['portable', 16384, 8192], ['device', 4096, 4096], ['device', 16384, 16384]] as const)(
  'setBackend recomputes max_texture_dimension (%s mode, new renderer %i -> %i)', async (mode, texture, expected) => {
    const { host } = await limitWords(65536, 102, 8192, mode);
    host.setBackend(2, { languages: 6, maxUniformRange: 16384, maxVaryingComponents: 84, execute: () => 0 }, texture);
    host.init();
    const bytes = host.peek(0, 112)!, words = new Uint32Array(bytes.buffer, bytes.byteOffset, 28);
    expect(words[1]).toBe(expected);
    expect(host.gpuLimits).toMatchObject({ maxTextureDimension: expected, deviceMaxTextureDimension: texture });
  });
