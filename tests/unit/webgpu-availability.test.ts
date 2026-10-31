import { afterEach, expect, it, vi } from 'vitest';
import type { Page, TestInfo } from '@playwright/test';
import { assertWebGPUAvailable, webGPUWasAvailable } from '../e2e/webgpu-availability';
import { webGPUProbeReason } from '../../bgt/renderers/webgpu/probe';
import { fakeWebGPU, stubWebGPUConstants } from './webgpu-device';

const skipped = new Error('test skipped');
function harness(gpu: unknown, browser = {}) {
  stubWebGPUConstants();
  vi.stubGlobal('navigator', { gpu });
  const page = {
    context: () => ({ browser: () => browser }),
    route: vi.fn(), unroute: vi.fn(), goto: vi.fn(),
    // The real page imports this same runtime module via Vite's /@fs URL.
    evaluate: vi.fn(() => webGPUProbeReason()),
  } as unknown as Page;
  const skip = vi.fn(() => { throw skipped; });
  const info = { project: { use: { baseURL: 'http://127.0.0.1:5195/' } }, skip } as unknown as TestInfo;
  return { page, info, skip };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

for (const [name, gpu, reason] of [
  ['absent API', undefined, 'navigator.gpu is absent'],
  ['null adapter', { requestAdapter: async () => null }, 'requestAdapter returned null'],
  ['Dawn unavailable Instance', { requestAdapter: async () => { throw new DOMException('A valid external Instance reference no longer exists.', 'OperationError'); } }, 'requestAdapter: OperationError: A valid external Instance reference no longer exists.'],
  ['present but broken device', { requestAdapter: async () => ({ requestDevice: async () => { throw new DOMException('A valid external Instance reference no longer exists.', 'OperationError'); } }) }, 'requestDevice: OperationError: A valid external Instance reference no longer exists.'],
  ['present but destroyed device', { requestAdapter: async () => {
    const h = fakeWebGPU(); h.device.destroy(); return h.adapter;
  } }, 'device lost (destroyed): Device was destroyed.'],
] as const) {
  it(`WebGPU ${name}: reported skip without required hardware`, async () => {
    vi.stubEnv('BGT_REQUIRE_WEBGPU', '0');
    const { page, info, skip } = harness(gpu);
    await expect(assertWebGPUAvailable(page, info)).rejects.toBe(skipped);
    expect(skip).toHaveBeenCalledWith(true, `WebGPU unavailable: ${reason}`);
    expect(webGPUWasAvailable(page)).toBe(false);
    expect(page.unroute).toHaveBeenCalledOnce();
  });
  it(`WebGPU ${name}: BGT_REQUIRE_WEBGPU=1 fails, never skips`, async () => {
    vi.stubEnv('BGT_REQUIRE_WEBGPU', '1');
    const { page, info, skip } = harness(gpu);
    await expect(assertWebGPUAvailable(page, info)).rejects.toThrow(`WebGPU required but WebGPU unavailable: ${reason}`);
    expect(skip).not.toHaveBeenCalled();
  });
  it(`WebGPU ${name} after a successful probe fails instead of skipping the earlier work`, async () => {
    vi.stubEnv('BGT_REQUIRE_WEBGPU', '0');
    const { page, info, skip } = harness(fakeWebGPU().gpu);
    await assertWebGPUAvailable(page, info);
    vi.stubGlobal('navigator', { gpu });
    await expect(assertWebGPUAvailable(page, info)).rejects.toThrow(`WebGPU adapter lost after a successful probe: ${reason}`);
    expect(webGPUWasAvailable(page)).toBe(true);
    expect(skip).not.toHaveBeenCalled();
    expect(page.unroute).toHaveBeenCalledTimes(2);
  });
  it(`WebGPU ${name} on a fresh page in the same test/browser fails after success`, async () => {
    vi.stubEnv('BGT_REQUIRE_WEBGPU', '0');
    const browser = {};
    const first = harness(fakeWebGPU().gpu, browser);
    await assertWebGPUAvailable(first.page, first.info);
    const second = harness(gpu, browser);
    await expect(assertWebGPUAvailable(second.page, first.info)).rejects.toThrow(`WebGPU adapter lost after a successful probe: ${reason}`);
    expect(first.skip).not.toHaveBeenCalled();
    expect(second.page.unroute).toHaveBeenCalledOnce();
  });
}
it('success in one test/browser does not prevent initial-absence skips in independent tests or launches', async () => {
  vi.stubEnv('BGT_REQUIRE_WEBGPU', '0');
  const browser = {};
  const first = harness(fakeWebGPU().gpu, browser);
  await assertWebGPUAvailable(first.page, first.info);
  const independentTest = harness({ requestAdapter: async () => null }, browser);
  await expect(assertWebGPUAvailable(independentTest.page, independentTest.info)).rejects.toBe(skipped);
  expect(independentTest.skip).toHaveBeenCalledOnce();
  const independentLaunch = harness({ requestAdapter: async () => null });
  await expect(assertWebGPUAvailable(independentLaunch.page, first.info)).rejects.toBe(skipped);
  expect(first.skip).toHaveBeenCalledOnce();
});
it('usable device: keep all subsequent device/guest/render assertions enabled', async () => {
  const { gpu, device } = fakeWebGPU();
  const { page, info, skip } = harness(gpu);
  await assertWebGPUAvailable(page, info);
  expect(webGPUWasAvailable(page)).toBe(true);
  expect(skip).not.toHaveBeenCalled();
  expect(gpu.requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
  expect(device.queue.submit).toHaveBeenCalledTimes(2);
  expect(device.destroy).toHaveBeenCalledOnce();
});
it('unexpected probe errors fail instead of becoming hardware skips', async () => {
  const { page, info, skip } = harness({ requestAdapter: async () => { throw new Error('probe regression'); } });
  await expect(assertWebGPUAvailable(page, info)).rejects.toThrow('probe regression');
  expect(skip).not.toHaveBeenCalled();
  expect(page.unroute).toHaveBeenCalledOnce();
});
