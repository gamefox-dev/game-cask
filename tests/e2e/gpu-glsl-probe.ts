// SPDX-License-Identifier: CC0-1.0
// Browser-side real renderer execution of the original GLSL regression corpus.
import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import type { GpuBackend, GpuItem } from '../../bgt/renderers/types';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { glslRegressions, regressionVertex, regressionFragment, type GlslRegression } from '../support/glsl-regressions';
import { webglBoundaryRegression } from '../support/glsl-storage-regressions';

export async function glslProbe(backend: string, selected?: GlslRegression[]) {
  const rejections: string[] = [];
  const cases = selected ?? (backend === 'webgl2' ? glslRegressions : [...glslRegressions, webglBoundaryRegression]);
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
        complete: (code, log) => code ? reject(new Error(log || errors.join('; '))) : resolve() } as GpuItem);
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
    const kinds = ['float2d','float3d','floatArray','int2d','uint2d','int3d','uint3d','intArray','uintArray','shadow','depthColor'];
    for (const [index, kind] of kinds.entries()) {
      const volume = kind.endsWith('3d'), array = kind.endsWith('Array'), integer = /^(int|uint)/.test(kind);
      const format = integer ? kind.startsWith('uint') ? 29 : 30 : kind === 'shadow' || kind === 'depthColor' ? 6 : 0;
      op(O.TEXTURE_CREATE_EX, [10+index,volume ? 1 : array ? 2 : 0,4,4,volume || array ? 2 : 1,3,format,1]);
      op(O.TEXTURE_ALLOCATE_MIPS,[10+index,3]);
      for (let level=0;level<3;level++) {
        const width=Math.max(1,4>>level), depth=array ? 2 : volume ? Math.max(1,2>>level) : 1;
        const values: number[] = [];
        for(let z=0;z<depth;z++) for(let y=0;y<width;y++) for(let x=0;x<width;x++) {
          if(kind==='shadow' || kind==='depthColor') values.push((x+y)%2===0 ? 0.25 : 0.75);
          else values.push(16+level*64+x*8,32+y*16,48+z*32,255);
        }
        const data = kind === 'shadow' || kind==='depthColor' ? new Uint8Array(new Float32Array(values).buffer) : integer ?
          new Uint8Array(new Uint32Array(values).buffer) : new Uint8Array(values);
        op(O.TEXTURE_UPDATE_EX,[10+index,level,0,0,0,width,width,depth],data);
      }
    }
    for (const language of [1, 2]) {
      const version = language === 1 ? '#version 330 core\n' : '#version 300 es\nprecision highp float;\nprecision highp int;\n';
      await compile(1, version + regressionVertex, 1, language);
      if (backend === 'webgl2' && !selected) {
        let rejected = false;
        try { await compile(2, version + regressionFragment(webglBoundaryRegression), 2, language); }
        catch (e) {
          rejected = true; const message = String(e);
          if (!message.includes(webglBoundaryRegression.webglRejection!)) errors.push(message);
          else rejections.push(message);
        }
        if (!rejected) errors.push('indexed swizzle out boundary was silently accepted');
        // The next normal program must compile AND render; a poisoned native context cannot pass.
      }
      for (const c of cases) {
        if (c.rejection) {
          try {
            await compile(2, version + regressionFragment(c), 2, language);
            errors.push(c.name + ': expected compile rejection, but succeeded');
          } catch (e) {
            const message = String(e);
            if (message.includes(c.rejection)) rejections.push(message);
            else errors.push(c.name + ': wrong rejection: ' + message);
          }
          continue;
        }
        try {
          await compile(2, version + regressionFragment(c), 2, language);
          if (c.sampler) op(O.SAMPLER_CREATE_EX, c.sampler);
          if (c.uniform) {
            const bytes = new Uint8Array(new Float32Array(c.uniform).buffer);
            op(O.BUFFER_CREATE, [3, 4, bytes.length, 0, bytes.length], bytes);
          }
          op(O.PIPELINE_CREATE, [1, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255,
            7, 0, 0, 0, 7, 0, 0, 0, c.uniform ? 1 : 0, c.texture ? 1 : 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 15]);
          op(O.PASS_BEGIN, [1, 0, 0, 0, 0, f(1), 0, 0, 0, 1, 0, 0, 0, f(1)]);
          op(O.PIPELINE, [1]);
          if (c.uniform) op(O.UNIFORM_BUFFER, [0, 3, 0, c.uniform.length * 4]);
          if (c.texture) op(O.TEXTURE, [0, c.textureKind ? 10+kinds.indexOf(c.textureKind) : c.invalid ? 2 : 1, 1]);
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
          if (c.uniform) op(O.BUFFER_DELETE, [3]);
          if (c.sampler) { op(O.SAMPLER_DELETE,[1]); op(O.SAMPLER_CREATE,[1,0,0,0,0,0,0,7]); }
        } catch (e) { errors.push(`${c.name} language ${language}: ${String(e)}`); }
      }
      op(O.SHADER_DELETE, [1]);
    }
    if (device) await device.queue.onSubmittedWorkDone();
    return { errors, pixels, rejections, count: cases.length,
      depth32fLinearApproximations: gpu instanceof WebGL2Gpu ? gpu.depth32fLinearApproximations : 0 };
  } finally { screen?.destroy(); device?.destroy(); gl?.getExtension('WEBGL_lose_context')!.loseContext(); }
}
