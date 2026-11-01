// Adapter discovery alone is not a usability check (notably on headless Dawn).
// Keep and use the actual device that passed, rather than destroying it and trusting
// another acquisition. This module is shared by runtime startup and browser preflight.
export class WebGPUUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'WebGPUUnavailable'; }
}

async function bounded<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WebGPUUnavailable(`probe timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Check submission AND exact readback, again after a task turn. Race device loss:
 * some drivers resolve requestDevice but immediately return a destroyed device. */
export async function checkWebGPUDevice(device: GPUDevice, timeoutMs = 3000): Promise<void> {
  let src: GPUBuffer | undefined, dst: GPUBuffer | undefined;
  try {
    await bounded(() => Promise.race([
      device.lost.then(info => { throw new WebGPUUnavailable(`device lost (${info.reason}): ${info.message}`); }),
      (async () => {
        src = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        dst = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        for (const value of [0x1234abcd, 0x5a17c0de]) {
          device.queue.writeBuffer(src, 0, new Uint32Array([value]));
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(src, 0, dst, 0, 4);
          device.queue.submit([encoder.finish()]);
          await dst.mapAsync(GPUMapMode.READ);
          try {
            if (new Uint32Array(dst.getMappedRange())[0] !== value)
              throw new WebGPUUnavailable('submission readback mismatch');
          } finally { dst.unmap(); }
          await device.queue.onSubmittedWorkDone();
          // Yield to native device-loss delivery, not just the microtask queue.
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      })(),
    ]), timeoutMs);
  } catch (e) {
    if (e instanceof DOMException) throw new WebGPUUnavailable(`submission/readback: ${e.name}: ${e.message}`);
    throw e;
  } finally { src?.destroy(); dst?.destroy(); }
}

export interface ProbedWebGPU { gpu: GPU; adapter: GPUAdapter; device: GPUDevice }
export async function acquireWebGPU(gpu: GPU | undefined = navigator.gpu, timeoutMs = 3000): Promise<ProbedWebGPU> {
  if (!gpu) throw new WebGPUUnavailable('navigator.gpu is absent');
  let device: GPUDevice | undefined, cancelled = false;
  let stage = 'requestAdapter';
  try {
    return await bounded(async () => {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new WebGPUUnavailable('requestAdapter returned null');
      if (cancelled) throw new WebGPUUnavailable('probe cancelled');
      stage = 'requestDevice';
      // §13.7 float32 color textures need filtering/blending semantics; request them when the adapter has them.
      const optional = (['float32-filterable', 'float32-blendable'] as const)
        .filter(feature => adapter.features?.has(feature));
      device = await adapter.requestDevice(optional.length ? { requiredFeatures: optional } : undefined);
      if (cancelled) { device.destroy(); throw new WebGPUUnavailable('probe cancelled'); }
      stage = 'submission/readback';
      await checkWebGPUDevice(device, timeoutMs);
      return { gpu, adapter, device };
    }, timeoutMs);
  } catch (e) {
    cancelled = true;
    device?.destroy();
    if (e instanceof DOMException) throw new WebGPUUnavailable(`${stage}: ${e.name}: ${e.message}`);
    throw e;
  }
}

/** Test preflight: known unavailability skips; programming errors still fail. */
export async function webGPUProbeReason(): Promise<string | null> {
  try {
    const { device } = await acquireWebGPU();
    device.destroy();
    return null;
  } catch (e) {
    if (e instanceof WebGPUUnavailable) return e.message;
    throw e;
  }
}
