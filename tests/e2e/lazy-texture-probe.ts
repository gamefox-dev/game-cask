// SPDX-License-Identifier: CC0-1.0
// K71 (Q128/Q129): browser-side §13 executor script for lazy texture storage and the recovery-shadow opt-out.
// Runs the same commands with lazy (default) or eager (`lazyTextures: false`) storage on a real WebGL 2 context or
// WebGPU device, so the spec can require identical pixels/readbacks and exact accounting in both modes.
import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import type { GpuItem } from '../../bgt/renderers/types';
import type { GpuNativeMemory } from '../../bgt/runtime/memory';
import { GPU_OP as O } from '../../bgt/runtime/abi';

type Executor = (WebGPUCommands | WebGL2Gpu) & { memory(): GpuNativeMemory };
const f = (value: number) => new Uint32Array(new Float32Array([value]).buffer)[0];
const textures = (m: GpuNativeMemory) => ({ bytes: m.textures.bytes, depth: m.textures.depthStencilBytes,
  lazy: m.textures.lazy?.bytes ?? 0, lazyCount: m.textures.lazy?.count ?? 0, lazyDepth: m.textures.lazy?.depthStencilBytes ?? 0,
  shadows: m.shadows.textureBytes });

export async function lazyTextureProbe(backend: string, opts: { lazy: boolean; shadows: boolean }) {
  const errors: string[] = [], canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
  let device: GPUDevice | undefined, gl: WebGL2RenderingContext | undefined, screen: GPUTexture | undefined;
  let gpu: Executor;
  const makeScreen = (d: GPUDevice) => d.createTexture({ size: [8, 8], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  if (backend === 'webgpu') {
    device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    const commands = new WebGPUCommands(device, m => errors.push(m), null, { lazyTextures: opts.lazy });
    screen = makeScreen(device); commands.frame(screen); gpu = commands;
  } else {
    gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })!;
    const commands = new WebGL2Gpu(gl, m => errors.push(m), { lazyTextures: opts.lazy });
    commands.beginFrame(8, 8, { x: 0, y: 0, w: 8, h: 8, scale: 1 }); gpu = commands;
  }
  gpu.recoveryShadows = opts.shadows;
  const op = (code: number, words: number[], data?: Uint8Array<ArrayBuffer>) => {
    const r = gpu.execute({ kind: 'gpu', op: code, words, data });
    if (r) throw new Error(`GPU op 0x${code.toString(16)}: ${r}; ${errors.join('; ')}`);
  };
  const compile = (handle: number, source: string, stage: number) => new Promise<void>((resolve, reject) => {
    gpu.execute({ kind: 'gpu', op: O.SHADER_CREATE, words: [handle, stage, 1], source,
      complete: (code, log) => code ? reject(new Error(log || errors.join('; '))) : resolve() } as GpuItem);
  });
  const read = (h: number, mip: number, size: number) => new Promise<number[]>((resolve, reject) => {
    const code = gpu.execute({ kind: 'gpu', op: O.TEXTURE_READBACK, words: [h, mip, 0, 0, 0, size, size, 1, 1],
      readback: (bytes?: Uint8Array, status = 0) => status || !bytes ? reject(new Error(`readback ${status}`)) : resolve([...bytes]) } as GpuItem);
    if (code) reject(new Error(`readback opcode ${code}: ${errors.join('; ')}`));
  });
  const pixel = async (): Promise<number[]> => {
    if (device) {
      const staging = device.createBuffer({ size: 2048, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: screen! }, { buffer: staging, bytesPerRow: 256 }, [8, 8]);
        device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
        return [...new Uint8Array(staging.getMappedRange()).slice(3 * 256 + 3 * 4, 3 * 256 + 3 * 4 + 4)];
      } finally { staging.destroy(); }
    }
    const raw = new Uint8Array(4); gl!.readPixels(3, 3, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, raw); return [...raw];
  };
  const lose = async () => {
    if (device) {
      // A real device loss: the old device is destroyed and the executor restores onto a fresh one.
      device.destroy(); const next = await (await navigator.gpu.requestAdapter())!.requestDevice();
      next.addEventListener('uncapturederror', e => errors.push(e.error.message));
      const commands = gpu as WebGPUCommands; commands.lost(); device = next;
      try { await commands.restore(next); } finally { screen = makeScreen(next); commands.frame(screen); }
    } else {
      const ext = gl!.getExtension('WEBGL_lose_context')!;
      const lost = new Promise<void>(res => canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); res(); }, { once: true }));
      const restored = new Promise<void>(res => canvas.addEventListener('webglcontextrestored', () => res(), { once: true }));
      ext.loseContext(); await lost; await new Promise(res => setTimeout(res, 30));
      ext.restoreContext(); await restored; (gpu as WebGL2Gpu).restore();
    }
  };
  const steps: Record<string, ReturnType<typeof textures>> = {};
  const snap = (label: string) => { steps[label] = textures(gpu.memory()); };
  try {
    // Never used: an 8x8 DEPTH24_STENCIL8 and a 4x4 RGBA8 (the "allocated at startup, never drawn" atlas case).
    op(O.TEXTURE_CREATE_EX, [21, 0, 8, 8, 1, 1, 5, 3]);
    op(O.TEXTURE_CREATE_EX, [23, 0, 4, 4, 1, 1, 0, 3]);
    // Used later: DEPTH32F sampled inside a pass (materialized mid-pass), RGBA8 sampled without any upload,
    // a mip chain generated from a never-materialized base, a LOAD-only depth/color attachment pair.
    op(O.TEXTURE_CREATE_EX, [20, 0, 8, 8, 1, 1, 6, 3]);
    op(O.TEXTURE_CREATE_EX, [24, 0, 4, 4, 1, 1, 0, 3]);
    op(O.TEXTURE_CREATE_EX, [22, 0, 8, 8, 1, 4, 0, 3]); op(O.TEXTURE_ALLOCATE_MIPS, [22, 4]); op(O.TEXTURE_GENERATE_MIPS, [22, 0]);
    op(O.TEXTURE_CREATE_EX, [26, 0, 8, 8, 1, 1, 0, 3]); op(O.TEXTURE_CREATE_EX, [25, 0, 8, 8, 1, 1, 6, 3]);
    // Cleared by clear-only passes (the profile's whole-attachment glClear) before any other use.
    op(O.TEXTURE_CREATE_EX, [28, 0, 4, 4, 1, 1, 0, 3]); op(O.TEXTURE_CREATE_EX, [29, 0, 8, 8, 1, 1, 6, 3]);
    snap('created');
    op(O.PASS_BEGIN, [1, 0, 0, 0, 0, 0, 0, 28, 0, 1, f(64 / 255), f(128 / 255), f(191 / 255), f(1)]); op(O.PASS_END, []);
    op(O.PASS_BEGIN, [0, 29, 0, 1, 0, f(0.5), 0]); op(O.PASS_END, []);
    snap('cleared');
    // Sampling: o = (texel(24).r + 0.25, texel(28).g, depth(20) * 0.75, 1) = (64, 128, 191, 255) when 24 is 0, 28 was
    // cleared to (64, 128, 191, 255) / 255 and 20 is 1. 28 and 20 are materialized inside the screen pass.
    await compile(1, '#version 330 core\nvoid main(){vec2 p[3]=vec2[3](vec2(-1,1),vec2(-1,-3),vec2(3,1));' +
      'gl_Position=vec4(p[bgt_vertex_index],.5,1);}', 1);
    await compile(2, '#version 330 core\nuniform sampler2D bgt_t0;uniform sampler2D bgt_t1;uniform sampler2D bgt_t2;layout(location=0) out vec4 o;' +
      'void main(){vec4 c=texelFetch(bgt_t0,ivec2(1,1),0);float d=texelFetch(bgt_t1,ivec2(2,2),0).r;vec4 k=texelFetch(bgt_t2,ivec2(3,0),0);' +
      'o=vec4(c.r+.25,k.g,d*.75,1);}', 2);
    op(O.SAMPLER_CREATE, [1, 0, 0, 0, 0, 0, 0, 7]);
    op(O.PIPELINE_CREATE, [1, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255, 7, 0, 0, 0, 7, 0, 0, 0, 0, 7, 0, 0, 1,
      0, 0, 1, 0, 0, 1, 0, 0, 15]);
    op(O.PASS_BEGIN, [1, 0, 0, 0, 0, f(1), 0, 0, 0, 1, 0, 0, 0, f(1)]);
    op(O.PIPELINE, [1]); op(O.TEXTURE, [0, 24, 1]); op(O.TEXTURE, [1, 20, 1]); op(O.TEXTURE, [2, 28, 1]);
    op(O.DRAW, [3, 1, 0, 0]); op(O.PASS_END, []);
    const sampled = await pixel();
    snap('sampled');
    // Attachments: a LOAD-only pass over a never-materialized color + depth pair keeps the creation values.
    op(O.PASS_BEGIN, [1, 25, 0, 0, 0, f(1), 0, 26, 0, 0, 0, 0, 0, 0]); op(O.PASS_END, []);
    snap('attached');
    const before = { t26: await read(26, 0, 8), t25: await read(25, 0, 8), t22: await read(22, 0, 8), t22m1: await read(22, 1, 4),
      t20: await read(20, 0, 8), t24: await read(24, 0, 4), t28: await read(28, 0, 4), t29: await read(29, 0, 8) };
    snap('readback');
    let recovery = '';
    try { await lose(); } catch (e) { recovery = String((e as Error).message); }
    snap('restored');
    // After a successful restore the never-uploaded levels still read back their creation values.
    // Cleared contents are rendered contents: lost on recovery like any render target (targetsLost), so 28/29 restore
    // to their creation values.
    const after = recovery ? null : { t26: await read(26, 0, 8), t25: await read(25, 0, 8), t22: await read(22, 0, 8),
      t22m1: await read(22, 1, 4), t20: await read(20, 0, 8), t24: await read(24, 0, 4), t28: await read(28, 0, 4), t29: await read(29, 0, 8) };
    // Opt-out semantics: an upload leaves no shadow, and the next loss is refused instead of restoring zeros.
    let refused = '';
    if (!recovery) {
      op(O.TEXTURE_CREATE_EX, [27, 0, 2, 2, 1, 1, 0, 3]);
      op(O.TEXTURE_UPDATE_EX, [27, 0, 0, 0, 0, 2, 2, 1, 0, 16], new Uint8Array(16).fill(9));
      snap('uploaded');
      try { await lose(); } catch (e) { refused = String((e as Error).message); }
    }
    if (device) await device.queue.onSubmittedWorkDone().catch(() => undefined);
    return { errors, sampled, before, after, recovery, refused, steps, lazyStats: { ...gpu.lazyTextures } };
  } finally { screen?.destroy(); device?.destroy(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); }
}

/** vK71: 3D TEXTURE_GENERATE_MIPS with recovery shadows on or off. WebGPU box-filters 3D levels on the CPU from the
 * upload shadow, so that shadow must survive the opt-out; WebGL 2 generates natively. Returns level 1 and 2 texels. */
export async function mip3dProbe(backend: string, shadows: boolean) {
  const errors: string[] = [], canvas = document.createElement('canvas');
  let device: GPUDevice | undefined, gl: WebGL2RenderingContext | undefined, gpu: Executor;
  if (backend === 'webgpu') {
    device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    gpu = new WebGPUCommands(device, m => errors.push(m));
  } else {
    gl = canvas.getContext('webgl2')!;
    gpu = new WebGL2Gpu(gl, m => errors.push(m));
  }
  gpu.recoveryShadows = shadows;
  const op = (code: number, words: number[], data?: Uint8Array<ArrayBuffer>) => {
    const r = gpu.execute({ kind: 'gpu', op: code, words, data });
    if (r) throw new Error(`GPU op 0x${code.toString(16)}: ${r}; ${errors.join('; ')}`);
  };
  const read = (mip: number, size: number) => new Promise<number[]>((resolve, reject) => {
    const code = gpu.execute({ kind: 'gpu', op: O.TEXTURE_READBACK, words: [1, mip, 0, 0, 0, size, size, size, 1],
      readback: (bytes?: Uint8Array, status = 0) => status || !bytes ? reject(new Error(`readback ${status}`)) : resolve([...bytes]) } as GpuItem);
    if (code) reject(new Error(`readback opcode ${code}: ${errors.join('; ')}`));
  });
  try {
    // 4x4x4 RGBA8 volume, 3 levels, uniform (200, 100, 50, 255): every box-filtered level is exactly that texel.
    op(O.TEXTURE_CREATE_EX, [1, 1, 4, 4, 4, 3, 0, 1]);
    op(O.TEXTURE_ALLOCATE_MIPS, [1, 3]);
    const base = new Uint8Array(Array.from({ length: 64 }, () => [200, 100, 50, 255]).flat());
    op(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 4, 4, 4, 0, base.length], base);
    op(O.TEXTURE_GENERATE_MIPS, [1, 0]);
    const result = { level1: await read(1, 2), level2: await read(2, 1), errors };
    if (device) await device.queue.onSubmittedWorkDone();
    return result;
  } finally { device?.destroy(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); }
}
