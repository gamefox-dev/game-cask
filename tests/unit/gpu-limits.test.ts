import { beforeAll, expect, it } from 'vitest';
import { compileC } from '../support/compile';
import { GameHost } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { CAP_GPU, E_BOUNDS, E_LIMIT, GPU_LIMITS_SIZE, GPU_OP } from '../../bgt/runtime/abi';
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
  expect(words[16]).toBe(6); expect(words[25]).toBe(CAP_GPU | 1);
  host.setBackend(2);
  host.init();
  words = new Uint32Array(host.peek(0, 112)!.buffer);
  expect(words[16]).toBe(0); expect(words[25]).toBe(1);
});
it('an explicitly enabled GPU host reports its language mask and clears no unrelated capability', async () => {
  const host = await GameHost.create(wasm, { log: () => {}, vfs: new Vfs(), now: () => 0 }, {
    backend: 3, caps: CAP_GPU | 1, seed: 1, displayWidth: 64, displayHeight: 64, arg0: 0, arg1: 80,
    gpuBackend: { languages: 6, execute: () => 0 },
  });
  host.init();
  const bytes = host.peek(0, 112)!, words = new Uint32Array(bytes.buffer, bytes.byteOffset, 28);
  expect(words[4]).toBe(1); expect(words[16]).toBe(6); expect(words[25]).toBe(CAP_GPU | 1);
});
