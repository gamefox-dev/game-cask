import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acquireWebGPU, checkWebGPUDevice, webGPUProbeReason } from '../../bgt/renderers/webgpu/probe';
import { fakeWebGPU, stubWebGPUConstants } from './webgpu-device';

beforeEach(stubWebGPUConstants);
afterEach(() => { vi.unstubAllGlobals(); });
it('retains the same adapter and device after two exact submissions/readbacks', async () => {
  const h = fakeWebGPU();
  const result = await acquireWebGPU(h.gpu as unknown as GPU);
  expect(result.gpu).toBe(h.gpu); expect(result.adapter).toBe(h.adapter); expect(result.device).toBe(h.device);
  expect(h.device.destroy).not.toHaveBeenCalled();
  expect(h.device.queue.submit).toHaveBeenCalledTimes(2);
  expect(h.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2);
  expect(h.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
});
for (const stage of ['requestDevice', 'submit', 'map', 'completion', 'mismatch', 'loss'] as const)
  it(`rejects present-but-broken WebGPU at ${stage} and cleans up`, async () => {
    const h = fakeWebGPU(), error = new DOMException('external Instance no longer exists', 'OperationError');
    if (stage === 'requestDevice') h.adapter.requestDevice.mockRejectedValue(error);
    if (stage === 'submit') h.device.queue.submit.mockImplementation(() => { throw error; });
    if (stage === 'map') h.device.createBuffer.mockImplementationOnce(() => {
      const b = { data: new Uint32Array(1), mapAsync: vi.fn(async () => {}), getMappedRange: () => new ArrayBuffer(4), unmap: vi.fn(), destroy: vi.fn() };
      return b;
    }).mockImplementationOnce(() => {
      const b = { data: new Uint32Array(1), mapAsync: vi.fn(async () => { throw error; }), getMappedRange: () => new ArrayBuffer(4), unmap: vi.fn(), destroy: vi.fn() };
      return b;
    });
    if (stage === 'completion') h.device.queue.onSubmittedWorkDone.mockRejectedValue(error);
    if (stage === 'mismatch') h.device.queue.submit.mockImplementation(() => {});
    if (stage === 'loss') h.device.queue.onSubmittedWorkDone.mockImplementation(async () => {
      setTimeout(() => h.device.destroy(), 0);
    });
    vi.stubGlobal('navigator', { gpu: h.gpu });
    const reason = await webGPUProbeReason();
    expect(reason).toMatch(stage === 'mismatch' ? /readback mismatch/ : stage === 'loss' ? /device lost.*destroyed/ : /OperationError.*external Instance/);
    if (stage !== 'requestDevice') expect(h.device.destroy).toHaveBeenCalled();
  });
it('times out a pending device acquisition and destroys a late device', async () => {
  const h = fakeWebGPU();
  let resolve!: (device: typeof h.device) => void;
  h.adapter.requestDevice.mockImplementation(() => new Promise(r => { resolve = r; }));
  await expect(acquireWebGPU(h.gpu as unknown as GPU, 15)).rejects.toThrow('probe timed out');
  resolve(h.device); await new Promise(r => setTimeout(r, 0));
  expect(h.device.destroy).toHaveBeenCalledOnce();
  expect(h.device.queue.submit).not.toHaveBeenCalled();
});
it('times out a hung submission/readback and frees both buffers', async () => {
  const h = fakeWebGPU();
  h.device.queue.onSubmittedWorkDone.mockImplementation(() => new Promise(() => {}));
  await expect(checkWebGPUDevice(h.device as unknown as GPUDevice, 15)).rejects.toThrow('probe timed out');
  expect(h.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
});
