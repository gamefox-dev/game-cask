// SPDX-License-Identifier: CC0-1.0. Original §13 stream, no game assets (K53 review vK53 finding 1).
// Breakage caught: WebGPU frame batching resumes the native pass after a transform-feedback draw in a fresh
// command encoder; if the rebound index buffer is not marked as used by that encoder, a later same-frame
// BUFFER_UPDATE of the indices skips the copy-on-write rename and the already-recorded drawIndexed reads
// the new indices (the wrong triangle is rasterized). Merged and per-pass WebGPU execution must match, and
// both backends must rasterize the triangle the draw's own indices name.
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';

test('TF drawIndexed keeps its indices when they are updated later in the same batched frame', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam, { game: 'gpu-scenes' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  const runs = await page.evaluate(async ({ backend, root }) => {
    const { GPU_OP: O } = await import(root + '/runtime/abi.ts');
    const { WebGL2Gpu } = await import(root + '/renderers/webgl2/gpu.ts');
    const { WebGPUCommands } = await import(root + '/renderers/webgpu/gpu.ts');
    const out: { merge: boolean; left: number[]; right: number[]; feedback: number[]; renames: number }[] = [];
    for (const merge of backend === 'webgpu' ? [true, false] : [false]) {
      const errors: string[] = [], canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const gl = backend === 'webgl2' ? canvas.getContext('webgl2')! : undefined;
      const adapter = backend === 'webgpu' ? await navigator.gpu.requestAdapter() : undefined;
      const device = adapter ? await adapter.requestDevice() : undefined;
      device?.addEventListener('uncapturederror', e => errors.push(e.error.message));
      const gpu = gl ? new WebGL2Gpu(gl, (e: string) => errors.push(e), { batch: true }) :
        new WebGPUCommands(device!, (e: string) => errors.push(e));
      if (device) {
        const commands = gpu as InstanceType<typeof WebGPUCommands>;
        commands.merge = merge;
        commands.frame(device.createTexture({ size: [16, 16], format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING }));
      } else (gpu as InstanceType<typeof WebGL2Gpu>).beginFrame(16, 16, { x: 0, y: 0, w: 16, h: 16, scale: 1 });
      const send = (op: number, words: number[], extra: Record<string, unknown> = {}) => {
        const code = gpu.execute({ kind: 'gpu', op, words, ...extra });
        if (code) throw new Error(`GPU opcode ${op}: ${code}; ${errors.join(';')}`);
      };
      const compile = (h: number, stage: number, source: string) => new Promise<void>((ok, fail) =>
        send(O.SHADER_CREATE, [h, stage, 1, 0, source.length, h], { source, complete: (c: number, log: string) => c ? fail(new Error(log)) : ok() }));
      const readTexture = () => new Promise<number[]>((ok, fail) => send(O.TEXTURE_READBACK, [1, 0, 0, 0, 0, 16, 16, 1, 50],
        { readback: (data: Uint8Array | undefined, code = 0) => code ? fail(new Error(String(code))) : ok([...data!]) }));
      const readBuffer = () => new Promise<number[]>((ok, fail) => send(O.BUFFER_READBACK, [3, 0, 12, 51],
        { readback: (data: Uint8Array | undefined, code = 0) => code ? fail(new Error(String(code))) : ok([...data!]) }));
      try {
        // Vertices 0..2: a triangle over the left edge; 3..5: its mirror over the right edge.
        await compile(1, 1, '#version 330 core\nout float id;void main(){vec2 p[6]=vec2[6](vec2(-1,-3),vec2(-1,3),vec2(-0.1,0),' +
          'vec2(1,-3),vec2(1,3),vec2(0.1,0));id=float(bgt_vertex_index);gl_Position=vec4(p[bgt_vertex_index],0,1);}');
        await compile(2, 2, '#version 330 core\nlayout(location=0) out vec4 c;void main(){c=vec4(1,0,0,1);}');
        send(O.TEXTURE_CREATE, [1, 16, 16, 1, 0, 3]);
        send(O.PIPELINE_CREATE, [1, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255, 7, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 15]);
        const names = 'id 0\n';
        send(O.FEEDBACK_VARYINGS, [1, 0, 1, 0, names.length], { source: names });
        send(O.BUFFER_CREATE, [2, 15, 12, 0, 12], { data: new Uint8Array(new Uint32Array([0, 1, 2]).buffer) });
        send(O.BUFFER_CREATE, [3, 8, 12, 0, 0]);
        // Rasterizer discard off: the TF draw also rasterizes with indices 0,1,2.
        send(O.PASS_BEGIN, [1, 0, 0, 0, 0, 0x3f800000, 0, 1, 0, 1, 0, 0, 0, 0]);
        send(O.PIPELINE, [1]); send(O.INDEX_BUFFER, [2, 1, 0, 12]);
        send(O.FEEDBACK_CAPTURE, [0, 3, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        send(O.DRAW_INDEXED, [3, 1, 0, 0, 0]); send(O.PASS_END, []);
        // Same frame, after the draw: the guest rewrites its index buffer (glBufferSubData).
        send(O.BUFFER_UPDATE, [2, 0, 0, 12], { data: new Uint8Array(new Uint32Array([3, 4, 5]).buffer) });
        const pixels = await readTexture(), feedback = await readBuffer();
        if (device) await device.queue.onSubmittedWorkDone();
        if (errors.length) throw new Error(errors.join('\n'));
        const at = (x: number, y: number) => pixels.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4);
        out.push({ merge, left: at(1, 8), right: at(14, 8), feedback: [...new Float32Array(new Uint8Array(feedback).buffer)],
          renames: device ? (gpu as InstanceType<typeof WebGPUCommands>).batch.bufferRenames : 0 });
      } finally { device?.destroy(); }
    }
    return out;
  }, { backend: backendParam, root: '/@fs' + resolve('bgt') });
  for (const r of runs) {
    // The draw's own indices (0,1,2) were rasterized and captured, never the later update (3,4,5).
    expect(r.left).toEqual([255, 0, 0, 255]);
    expect(r.right).toEqual([0, 0, 0, 0]);
    expect(r.feedback).toEqual([0, 1, 2]);
  }
  if (backendParam === 'webgpu') {
    expect(runs.map(r => r.merge)).toEqual([true, false]);
    // Merged: the update is a copy-on-write rename of the index buffer the pending encoder references.
    expect(runs[0].renames).toBe(1); expect(runs[1].renames).toBe(0);
  }
});
