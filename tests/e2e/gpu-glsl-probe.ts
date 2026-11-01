// SPDX-License-Identifier: CC0-1.0
// Browser-side real renderer execution of the original GLSL regression corpus.
import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import type { GpuBackend, GpuItem } from '../../bgt/renderers/types';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { glslRegressions, regressionVertex, regressionFragment } from '../support/glsl-regressions';

export async function glslProbe(backend: string) {
  const errors: string[] = [], pixels: { name: string; language: number; pixel: number[]; expected: number[] }[] = [];
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
  let device: GPUDevice | undefined, gl: WebGL2RenderingContext | undefined, screen: GPUTexture | undefined;
  let gpu: GpuBackend;
  if (backend === 'webgpu') {
    device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    const commands = new WebGPUCommands(device, m => errors.push(m));
    screen = device.createTexture({ size: [8, 8], format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
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
  const compile = (handle: number, source: string, stage: number, language: number) =>
    new Promise<void>((resolve, reject) => {
      gpu.execute({ kind: 'gpu', op: O.SHADER_CREATE, words: [handle, stage, language], source,
        complete: (code, log) => code ? reject(new Error(log)) : resolve() } as GpuItem);
    });
  const f = (value: number) => new Uint32Array(new Float32Array([value]).buffer)[0];
  try {
    op(O.TEXTURE_CREATE, [1, 2, 2, 1, 0, 1]);
    op(O.TEXTURE_UPDATE, [1, 0, 0, 0, 2, 2], new Uint8Array([
      255, 0, 0, 255, 64, 128, 191, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    ]));
    // Non-selected values include quiet NaNs and infinities supplied at runtime, not constant-folded division.
    op(O.TEXTURE_CREATE, [2, 1, 1, 1, 4, 1]);
    op(O.TEXTURE_UPDATE, [2, 0, 0, 0, 1, 1], new Uint8Array(new Uint16Array([0x7e00, 0x7c00, 0xfe00, 0xfc00]).buffer));
    op(O.SAMPLER_CREATE, [1, 0, 0, 0, 0, 0, 0, 7]);
    for (const language of [1, 2]) {
      const version = language === 1 ? '#version 330 core\n' : '#version 300 es\nprecision highp float;\nprecision highp int;\n';
      await compile(1, version + regressionVertex, 1, language);
      for (const c of glslRegressions) {
        try {
          await compile(2, version + regressionFragment(c), 2, language);
          op(O.PIPELINE_CREATE, [1, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255,
            7, 0, 0, 0, 7, 0, 0, 0, 0, c.texture ? 1 : 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 15]);
          op(O.PASS_BEGIN, [1, 0, 0, 0, 0, f(1), 0, 0, 0, 1, 0, 0, 0, f(1)]);
          op(O.PIPELINE, [1]);
          if (c.texture) op(O.TEXTURE, [0, c.invalid ? 2 : 1, 1]);
          op(O.DRAW, [3, 1, 0, 0]); op(O.PASS_END, []);
          let pixel: number[];
          if (device) {
            const staging = device.createBuffer({ size: 2048, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            try {
              const encoder = device.createCommandEncoder();
              encoder.copyTextureToBuffer({ texture: screen! }, { buffer: staging, bytesPerRow: 256 }, [8, 8]);
              device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
              pixel = [...new Uint8Array(staging.getMappedRange()).slice(3 * 256 + 3 * 4, 3 * 256 + 3 * 4 + 4)];
              staging.unmap();
            } finally { staging.destroy(); }
          } else {
            const raw = new Uint8Array(4);
            gl!.readPixels(3, 3, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, raw);
            if (gl!.getError()) throw new Error('readPixels failed'); pixel = [...raw];
          }
          pixels.push({ name: c.name, language, pixel, expected: c.expected });
          op(O.PIPELINE_DELETE, [1]); op(O.SHADER_DELETE, [2]);
        } catch (e) { errors.push(`${c.name} language ${language}: ${String(e)}`); }
      }
      op(O.SHADER_DELETE, [1]);
    }
    if (device) await device.queue.onSubmittedWorkDone();
    return { errors, pixels, count: glslRegressions.length };
  } finally { screen?.destroy(); device?.destroy(); gl?.getExtension('WEBGL_lose_context')!.loseContext(); }
}
