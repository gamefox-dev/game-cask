import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';
import { GPU_OP as OP } from '../../bgt/runtime/abi';
import type { GpuItem } from '../../bgt/renderers/types';

const bits = (n: number) => new Uint32Array(new Float32Array([n]).buffer)[0];
const vertex = `struct V { @builtin(position) p: vec4f }; @vertex fn vs_main(@builtin(vertex_index) i:u32)->V { var a=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); var o:V; o.p=vec4f(a[i],0,1); return o; }`;
const fragment = `@group(1) @binding(0) var bgt_t0: texture_depth_2d; @group(1) @binding(1) var bgt_t0_sampler: sampler; @fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f { let d=textureLoad(bgt_t0,vec2i(1,1),0); return vec4f(d,0,0,1); }`;

export async function depthProbe(): Promise<Record<string, number[] | number>> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', e => errors.push(e.error.message));
  const gpu = new WebGPUCommands(device, message => errors.push(message));
  const screen = device.createTexture({ size: [2, 2], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  gpu.frame(screen);
  const exec = (op: number, words: number[], extra: Partial<GpuItem> = {}) => {
    const rc = gpu.execute({ kind: 'gpu', op, words, ...extra });
    if (rc) throw new Error(errors.join('\n') || `GPU op ${op} failed: ${rc}`);
  };
  const compile = (h: number, stage: number, source: string) => new Promise<void>((resolve, reject) => {
    exec(OP.SHADER_CREATE, [h, stage, 0, 0, source.length, h], { source,
      complete: (code, log = '') => code ? reject(new Error(log)) : resolve() });
  });
  await compile(1, 1, vertex); await compile(2, 2, fragment);
  exec(OP.SAMPLER_CREATE_EX, [1, 0, 0, 0, 0, 0, 0, 0, 7, bits(0), bits(1000)]);
  const pipeline = [3, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255,
    7, 0, 0, 0, 7, 0, 0, 0, 0, 1, 0, 0, 1];
  pipeline.push(0, 0, 1, 0, 0, 1, 0, 0, 15);
  exec(OP.PIPELINE_CREATE, pipeline);
  const read = (handle: number, mip = 0) => new Promise<{ data?: Uint8Array; code?: number }>(resolve => {
    exec(OP.TEXTURE_READBACK, [handle, mip, 0, 0, 0, 1, 1, 1, handle + 100], {
      readback: (data, code) => resolve({ data, code }),
    });
  });
  const out: Record<string, number[] | number> = {};
  for (const format of [5, 6]) {
    const depth = format === 5 ? new Uint8Array(new Uint32Array([0x40000007, 0x40000007, 0x40000007, 0x40000007]).buffer) :
      new Uint8Array(new Float32Array([.25, .25, .25, .25]).buffer);
    exec(OP.TEXTURE_CREATE_EX, [10, 0, 2, 2, 1, 1, format, 3]);
    exec(OP.TEXTURE_UPDATE_EX, [10, 0, 0, 0, 0, 2, 2, 1, 0, depth.length], { data: depth });
    exec(OP.TEXTURE_CREATE_EX, [20, 0, 2, 2, 1, 1, 0, 3]);
    exec(OP.PASS_BEGIN, [1, 0, 0, 0, 0, bits(1), 0, 20, 0, 1, bits(0), bits(0), bits(0), bits(0)]);
    exec(OP.TEXTURE, [0, 10, 1]); exec(OP.PIPELINE, [3]); exec(OP.DRAW, [3, 1, 0, 0]); exec(OP.PASS_END, []);
    const color = await read(20); out[`sample${format}`] = color.data ? [...color.data] : [color.code ?? -999];
    const depthRead = await read(10); out[`read${format}`] = depthRead.code ?? (depthRead.data ? [...depthRead.data] : -999);
    exec(OP.TEXTURE_DELETE, [20]); exec(OP.TEXTURE_DELETE, [10]);
  }
  await device.queue.onSubmittedWorkDone();
  if (errors.length) throw new Error(errors.join('\n'));
  out.errors = errors.length;
  screen.destroy(); device.destroy(); return out;
}
