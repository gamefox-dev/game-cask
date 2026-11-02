// SPDX-License-Identifier: CC0-1.0
import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import type { GpuBackend, GpuItem } from '../../bgt/renderers/types';
import { GPU_OP as O } from '../../bgt/runtime/abi';
export interface OpaqueCase { name: string; language: number; vs: string; fs: string; slots: number[]; expected: number[]; uniform?: number[]; resources?: number[] }
export async function opaqueProbe(backend: string, cases: OpaqueCase[]) {
  const errors: string[] = [], pixels: { name: string; pixel: number[]; expected: number[] }[] = [];
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
  let device: GPUDevice | undefined, gl: WebGL2RenderingContext | undefined, screen: GPUTexture | undefined;
  let gpu: GpuBackend;
  if (backend === 'webgpu') {
    device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    const commands = new WebGPUCommands(device, m => errors.push(m));
    screen = device.createTexture({ size: [8, 8], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    commands.frame(screen); gpu = commands;
  } else {
    gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })!;
    const commands = new WebGL2Gpu(gl, m => errors.push(m));
    commands.beginFrame(8, 8, { x: 0, y: 0, w: 8, h: 8, scale: 1 }); gpu = commands;
  }
  const op = (op: number, words: number[], data?: Uint8Array<ArrayBuffer>) => {
    const code = gpu.execute({ kind: 'gpu', op, words, data });
    if (code) throw new Error(`GPU op ${op}: ${code}; ${errors.join('; ')}`);
  };
  const compile = (handle: number, source: string, stage: number, language: number) => new Promise<void>((resolve, reject) => {
    gpu.execute({ kind: 'gpu', op: O.SHADER_CREATE, words: [handle, stage, language], source,
      complete: (code, log) => code ? reject(new Error(log || errors.join('; '))) : resolve() } as GpuItem);
  });
  const f = (n: number) => new Uint32Array(new Float32Array([n]).buffer)[0];
  try {
    op(O.TEXTURE_CREATE, [1, 1, 1, 1, 0, 1]);
    op(O.TEXTURE_UPDATE, [1, 0, 0, 0, 1, 1], new Uint8Array([64, 17, 191, 255]));
    op(O.TEXTURE_CREATE, [2, 1, 1, 1, 0, 1]);
    op(O.TEXTURE_UPDATE, [2, 0, 0, 0, 1, 1], new Uint8Array([203, 128, 29, 255]));
    op(O.TEXTURE_CREATE_EX, [3, 1, 1, 1, 1, 1, 0, 1]);
    op(O.TEXTURE_UPDATE_EX, [3, 0, 0, 0, 0, 1, 1, 1], new Uint8Array([64, 17, 191, 255]));
    op(O.TEXTURE_CREATE_EX, [4, 2, 1, 1, 2, 1, 0, 1]);
    op(O.TEXTURE_UPDATE_EX, [4, 0, 0, 0, 0, 1, 1, 2], new Uint8Array([8, 9, 10, 11, 203, 128, 29, 255]));
    op(O.TEXTURE_CREATE, [5, 1, 1, 1, 6, 1]);
    op(O.TEXTURE_UPDATE, [5, 0, 0, 0, 1, 1], new Uint8Array(new Float32Array([0.5]).buffer));
    op(O.TEXTURE_CREATE_EX, [6, 0, 1, 1, 1, 1, 18, 1]);
    op(O.TEXTURE_UPDATE, [6, 0, 0, 0, 1, 1], new Uint8Array(new Int32Array([-16777217]).buffer));
    op(O.TEXTURE_CREATE_EX, [7, 0, 1, 1, 1, 1, 17, 1]);
    op(O.TEXTURE_UPDATE, [7, 0, 0, 0, 1, 1], new Uint8Array(new Uint32Array([0xfedcba98]).buffer));
    op(O.SAMPLER_CREATE, [1, 0, 0, 0, 0, 0, 0, 7]);
    op(O.SAMPLER_CREATE, [2, 0, 0, 0, 0, 0, 1, 3]);
    for (const c of cases) {
      try {
        await compile(1, c.vs, 1, c.language); await compile(2, c.fs, 2, c.language);
        if (c.uniform) {
          const bytes = new Uint8Array(new Float32Array(c.uniform).buffer);
          op(O.BUFFER_CREATE, [1, 4, bytes.length, 0, bytes.length], bytes);
        }
        const mask = c.slots.reduce((m, s) => m | (1 << s), 0);
        op(O.PIPELINE_CREATE, [1, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255, 7, 0, 0, 0, 7, 0, 0, 0,
          c.uniform ? 1 : 0, mask, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 15]);
        op(O.PASS_BEGIN, [1, 0, 0, 0, 0, f(1), 0, 0, 0, 1, 0, 0, 0, f(1)]); op(O.PIPELINE, [1]);
        if (c.uniform) op(O.UNIFORM_BUFFER, [0, 1, 0, c.uniform.length * 4]);
        for (const [i, slot] of c.slots.entries()) {
          const resource = c.resources?.[i] ?? slot;
          op(O.TEXTURE, [slot, resource + 1, resource === 4 ? 2 : 1]);
        }
        op(O.DRAW, [3, 1, 0, 0]); op(O.PASS_END, []);
        let pixel: number[];
        if (device) {
          const staging = device.createBuffer({ size: 2048, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          try {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer({ texture: screen! }, { buffer: staging, bytesPerRow: 256 }, [8, 8]);
            device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
            pixel = [...new Uint8Array(staging.getMappedRange()).slice(3 * 256 + 12, 3 * 256 + 16)]; staging.unmap();
          } finally { staging.destroy(); }
        } else {
          const raw = new Uint8Array(4); gl!.readPixels(3, 3, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, raw);
          if (gl!.getError()) throw new Error('readPixels failed'); pixel = [...raw];
        }
        pixels.push({ name: c.name, pixel, expected: c.expected });
        op(O.PIPELINE_DELETE, [1]); op(O.SHADER_DELETE, [1]); op(O.SHADER_DELETE, [2]);
        if (c.uniform) op(O.BUFFER_DELETE, [1]);
      } catch (e) { errors.push(`${c.name}: ${String(e)}`); }
    }
    if (device) await device.queue.onSubmittedWorkDone();
    return { errors, pixels };
  } finally { screen?.destroy(); device?.destroy(); gl?.getExtension('WEBGL_lose_context')!.loseContext(); }
}
