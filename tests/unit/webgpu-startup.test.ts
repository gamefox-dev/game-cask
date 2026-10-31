import { afterEach, expect, it, vi } from 'vitest';
import { WebGPURenderer } from '../../bgt/renderers/webgpu/webgpu';
import { WebGL2Renderer } from '../../bgt/renderers/webgl2/webgl2';
import { BGTRuntime } from '../../bgt/runtime/runtime';
import { fakeWebGPU, stubWebGPUConstants } from './webgpu-device';

const message = 'injected asynchronous pipeline validation error';
function startup(fail: boolean) {
  stubWebGPUConstants();
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, COPY_SRC: 2, COPY_DST: 4, TEXTURE_BINDING: 8 });
  const h = fakeWebGPU(), listeners: Array<(e: unknown) => void> = [];
  let scheduled = false;
  Object.assign(h.device, {
    limits: { maxTextureDimension2D: 8192 },
    addEventListener: (_name: string, cb: (e: unknown) => void) => listeners.push(cb),
    createShaderModule: () => ({}), createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
    createRenderPipeline: () => {
      if (fail && !scheduled) {
        scheduled = true;
        setTimeout(() => listeners.forEach(cb => cb({ error: { message } })), 0);
      }
      return {};
    },
    createBindGroup: () => ({}), createSampler: () => ({}), createTexture: () => ({}),
  });
  Object.assign(h.device.queue, { writeTexture: () => {} });
  Object.assign(h.gpu, { getPreferredCanvasFormat: () => 'bgra8unorm' });
  vi.stubGlobal('navigator', { gpu: h.gpu });
  const canvas = { getContext: () => ({ configure: () => {} }) } as unknown as HTMLCanvasElement;
  return { ...h, canvas, listeners };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('rejects and cleans up asynchronous init errors even when all four probe copies succeed', async () => {
  const h = startup(true);
  await expect(WebGPURenderer.create(h.canvas)).rejects.toThrow(`WebGPU initialization: ${message}`);
  expect(h.device.queue.submit).toHaveBeenCalledTimes(4);
  expect(h.device.destroy).toHaveBeenCalled();
});
it('auto reports the original init error and falls back; required WebGPU fails closed', async () => {
  for (const backend of ['auto', 'webgpu']) {
    const h = startup(true), gl = { kind: 'webgl2' };
    const createGL = vi.spyOn(WebGL2Renderer, 'create').mockReturnValue(gl as WebGL2Renderer);
    const runtime = { opts: {}, canvas: h.canvas, backendNotes: [] as string[], newCanvas: vi.fn(() => h.canvas) };
    const pick = () => (BGTRuntime.prototype as any).pickRenderer.call(runtime, backend);
    if (backend === 'auto') {
      await expect(pick()).resolves.toBe(gl);
      expect(runtime.newCanvas).toHaveBeenCalledOnce(); expect(createGL).toHaveBeenCalledOnce();
    } else {
      await expect(pick()).rejects.toThrow('WebGPU was required');
      expect(createGL).not.toHaveBeenCalled();
    }
    expect(runtime.backendNotes).toEqual([`webgpu: init failed: WebGPU initialization: ${message}`]);
    expect(h.device.destroy).toHaveBeenCalled();
    createGL.mockRestore();
  }
});
it('publishes a healthy renderer and forwards later errors to runtime consumers', async () => {
  const h = startup(false), r = await WebGPURenderer.create(h.canvas), errors: string[] = [];
  expect(r).not.toBeNull(); expect(h.device.destroy).not.toHaveBeenCalled();
  r!.onError(e => errors.push(e));
  h.listeners.forEach(cb => cb({ error: { message: 'later validation error' } }));
  expect(errors).toEqual(['WebGPU: later validation error']);
  r!.destroy();
});
