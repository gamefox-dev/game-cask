// Original synthetic §13 depth contract probe. No guest/game data.
import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import type { GpuBackend, GpuItem } from '../../bgt/renderers/types';
const bits = (n: number) => new Uint32Array(new Float32Array([n]).buffer)[0];
export async function depthProbe(backend: string) {
  const errors: string[] = [], canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 2;
  let device: GPUDevice | undefined, screen: GPUTexture | undefined;
  let gl: WebGL2RenderingContext | undefined;
  let gpu: GpuBackend;
  if (backend === 'webgpu') {
    const adapter = await navigator.gpu.requestAdapter(); if (!adapter) throw new Error('WebGPU adapter unavailable');
    device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    const commands = new WebGPUCommands(device, m => errors.push(m)); gpu = commands;
    screen = device.createTexture({ size: [32, 2], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    commands.frame(screen);
  } else {
    gl = canvas.getContext('webgl2', { antialias: false })!;
    const commands = new WebGL2Gpu(gl, m => errors.push(m)); gpu = commands;
    commands.beginFrame(32, 2, { x: 0, y: 0, w: 32, h: 2, scale: 1 });
    if (gpu.languages !== 6) throw new Error('WebGL2 capabilities unavailable');
  }
  const exec = (op: number, words: number[], extra: Partial<GpuItem> = {}) => {
    const rc = gpu.execute({ kind: 'gpu', op, words, ...extra });
    if (rc) throw new Error(errors.join('\n') || `GPU op ${op} failed: ${rc}`);
  };
  const shader = (h: number, stage: number, source: string) => new Promise<void>((resolve, reject) => {
    exec(O.SHADER_CREATE, [h, stage, 1, 0, source.length, h], { source,
      complete: (code, log = '') => code ? reject(new Error(log)) : resolve() });
  });
  const read = (h: number, width = 32, height = 2, mip = 0) => new Promise<{ data: number[]; code: number }>(resolve => {
    exec(O.TEXTURE_READBACK, [h, mip, 0, 0, 0, width, height, 1, h + 100], {
      readback: (data, code = 0) => resolve({ data: data ? [...data] : [], code }),
    });
  });
  const floats = (data: number[]) => [...new Float32Array(new Uint8Array(data).buffer)];
  const results = [];
  try {
    await shader(1, 1, '#version 330 core\nvoid main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[bgt_vertex_index],.5,1);}');
    await shader(2, 2, '#version 330 core\nuniform sampler2D bgt_t0;layout(location=0) out vec4 o;void main(){o=vec4(texelFetch(bgt_t0,ivec2(0),0).r,0,0,1);}');
    exec(O.SAMPLER_CREATE, [1, 0, 0, 0, 0, 0, 0, 7]);
    const pipeline = [3, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255, 7, 0, 0, 0, 7, 0, 0, 0, 0, 1, 0, 0, 1];
    pipeline.push(0, 0, 1, 0, 0, 1, 0, 0, 15); exec(O.PIPELINE_CREATE, pipeline);
    for (const format of [5, 6]) {
      const initial = format === 5 ? new Uint8Array(new Uint32Array(64).fill(0x40000007).buffer) :
        new Uint8Array(new Float32Array(64).fill(.25).buffer);
      exec(O.TEXTURE_CREATE_EX, [10, 0, 32, 2, 1, 6, format, 3]);
      exec(O.TEXTURE_UPDATE_EX, [10, 0, 0, 0, 0, 32, 2, 1, 0, initial.length], { data: initial });
      const partial = format === 5 ? new Uint8Array(new Uint32Array([0x800000f3]).buffer) : new Uint8Array(new Float32Array([.5]).buffer);
      exec(O.TEXTURE_UPDATE_EX, [10, 0, 5, 1, 0, 1, 1, 1, 0, 4], { data: partial });
      const uploaded = await read(10);
      exec(O.TEXTURE_CREATE_EX, [20, 0, 32, 2, 1, 1, 0, 3]);
      exec(O.PASS_BEGIN, [1, 0, 0, 0, 0, bits(1), 0, 20, 0, 1, 0, 0, 0, 0]);
      exec(O.TEXTURE, [0, 10, 1]); exec(O.PIPELINE, [3]); exec(O.DRAW, [3, 1, 0, 0]); exec(O.PASS_END, []);
      const sample = await read(20, 1, 1);
      exec(O.PASS_BEGIN, [0, 10, 0, 1, format === 5 ? 1 : 0, bits(.75), 19]); exec(O.PASS_END, []);
      const rendered = await read(10);
      results.push({ format, uploaded, sample, rendered, uploadedFloats: format === 6 ? floats(uploaded.data) : [],
        renderedFloats: format === 6 ? floats(rendered.data) : [] });
      exec(O.TEXTURE_DELETE, [20]); exec(O.TEXTURE_DELETE, [10]);
    }
    await device?.queue.onSubmittedWorkDone();
    if (errors.length) throw new Error(errors.join('\n'));
    return results;
  } finally { screen?.destroy(); device?.destroy(); gl?.getExtension('WEBGL_lose_context')!.loseContext(); }
}
