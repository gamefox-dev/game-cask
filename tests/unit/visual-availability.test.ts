// Regression: conformance must not turn canvas/device initialization failures into hardware
// skips after requestAdapter succeeded. Exercise the actual registered browser-test callbacks.
import { afterEach, expect, it, vi } from 'vitest';
import { webGPUProbeReason } from '../../bgt/renderers/webgpu/probe';
import { fakeWebGPU, stubWebGPUConstants } from './webgpu-device';

const h = vi.hoisted(() => ({ cases: new Map<string, (...args: any[]) => Promise<void>>(), info: undefined as any,
  skipped: new Error('test skipped'), skip: vi.fn() }));
vi.mock('../e2e/fixtures', async () => {
  const actual = await vi.importActual<typeof import('../e2e/fixtures')>('../e2e/fixtures');
  // Exercise real openGame on the fresh title page, while supplying this callback's TestInfo.
  vi.spyOn(actual.test, 'info').mockImplementation(() => h.info);
  const register = Object.assign((name: string, run: (...args: any[]) => Promise<void>) => h.cases.set(name, run), {
    skip: (condition: boolean, message: string) => { if (condition) { h.skip(message); throw h.skipped; } },
    info: () => h.info,
  });
  return { ...actual, test: register, expect };
});
import '../e2e/visual.spec';
import { webGPUWasAvailable } from '../e2e/webgpu-availability';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
for (const name of [
  'conformance scene: every v0.1 2D operation renders correctly on this backend',
  'WebGPU and WebGL 2 produce matching images (conformance scene and sample title)',
]) it(`adapter-present conformance failure is not a skip: ${name}`, async () => {
  vi.stubEnv('BGT_REQUIRE_WEBGPU', '0');
  stubWebGPUConstants();
  vi.stubGlobal('navigator', { gpu: fakeWebGPU().gpu });
  const page = { context: () => ({ browser: () => null }),
    route: vi.fn(), unroute: vi.fn(), goto: vi.fn(), waitForFunction: vi.fn(),
    evaluate: vi.fn().mockImplementationOnce(() => webGPUProbeReason())
      .mockResolvedValueOnce({ done: true, backend: 'webgpu', unavailable: true }) };
  h.info = { project: { use: { baseURL: 'http://127.0.0.1:5195/' } },
    skip: () => { throw new Error('preflight must not skip with adapter'); } };
  await expect(h.cases.get(name)!({ page, backendParam: 'webgpu', collector: {} }, h.info))
    .rejects.toThrow(/renderer unavailable after preflight/);
  expect(webGPUWasAvailable(page as any)).toBe(true);
  expect(h.skip).not.toHaveBeenCalled();
});

for (const [name, requestAdapter] of [
  ['null adapter', async () => null],
  ['absent API', undefined],
  ['Dawn unavailable Instance', async () => { throw new DOMException('external Instance lost', 'OperationError'); }],
] as const) it(`visual comparison fails, not skips, on fresh title-page ${name} after GPU conformance`, async () => {
  vi.stubEnv('BGT_REQUIRE_WEBGPU', '0');
  const context = { newPage: vi.fn(), close: vi.fn() };
  const browser = { newContext: vi.fn(async () => context) };
  const conf = { width: 1, height: 1, base64: Buffer.from([0, 0, 0, 255]).toString('base64') };
  stubWebGPUConstants();
  vi.stubGlobal('navigator', { gpu: fakeWebGPU().gpu });
  const page = { context: () => ({ browser: () => browser }), route: vi.fn(), unroute: vi.fn(),
    goto: vi.fn(), waitForFunction: vi.fn(), evaluate: vi.fn()
      .mockImplementationOnce(() => webGPUProbeReason())
      .mockResolvedValueOnce(conf).mockResolvedValueOnce(conf) };
  const titlePage = { context: () => ({ browser: () => browser }), route: vi.fn(), unroute: vi.fn(),
    goto: vi.fn(), evaluate: vi.fn(() => {
      vi.stubGlobal('navigator', { gpu: requestAdapter ? { requestAdapter } : undefined });
      return webGPUProbeReason();
    }) };
  context.newPage.mockResolvedValue(titlePage);
  h.info = { project: { use: { baseURL: 'http://127.0.0.1:5195/' } },
    skip: (condition: boolean, message: string) => { if (condition) { h.skip(message); throw h.skipped; } } };
  const callback = h.cases.get('WebGPU and WebGL 2 produce matching images (conformance scene and sample title)')!;
  await expect(callback({ browser, page, backendParam: 'webgpu', collector: {} }, h.info))
    .rejects.toThrow('WebGPU adapter lost after a successful probe');
  expect(webGPUWasAvailable(page as any)).toBe(true);
  expect(titlePage.evaluate).toHaveBeenCalledOnce();
  expect(titlePage.unroute).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  expect(h.skip).not.toHaveBeenCalled();
});
