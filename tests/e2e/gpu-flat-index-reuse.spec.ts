// SPDX-License-Identifier: CC0-1.0. Original §13 stream, no game assets (K62 review vK62 finding 1).
// Breakage caught: WebGPU draws GLSL flat-varying indexed draws from a rotated (last-vertex-first) copy of the
// indices; a cache keyed by the buffer *handle* reused the old copy after the handle was deleted and re-created
// with new indices (ABI §13.1 allows immediate reuse; K57 re-creates stores under the same handle), so the second
// draw rasterized the first draw's triangle. Also: a flat indexed draw from indices rewritten every frame must not
// create a GPU buffer per draw. Both backends rasterize the triangle the draw's own indices name with the flat id of
// GL's provoking (last) vertex.
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';

test('flat indexed draws after a delete/re-create of the index handle use the new indices; no per-draw buffers', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam, { game: 'gpu-scenes' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  const runs = await page.evaluate(async ({ backend, root }) => {
    const { GPU_OP: O } = await import(root + '/runtime/abi.ts');
    const { WebGL2Gpu } = await import(root + '/renderers/webgl2/gpu.ts');
    const { WebGPUCommands } = await import(root + '/renderers/webgpu/gpu.ts');
    const out: { merge: boolean; first: number[][]; second: number[][]; steady: number[][]; created: number; rings: number }[] = [];
    for (const merge of backend === 'webgpu' ? [true, false] : [false]) {
      const errors: string[] = [], canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const gl = backend === 'webgl2' ? canvas.getContext('webgl2')! : undefined;
      const adapter = backend === 'webgpu' ? await navigator.gpu.requestAdapter() : undefined;
      const device = adapter ? await adapter.requestDevice() : undefined;
      device?.addEventListener('uncapturederror', e => errors.push(e.error.message));
      let created = 0;
      if (device) { const create = device.createBuffer.bind(device); device.createBuffer = (d: GPUBufferDescriptor) => { created++; return create(d); }; }
      const gpu = gl ? new WebGL2Gpu(gl, (e: string) => errors.push(e), { batch: true }) : new WebGPUCommands(device!, (e: string) => errors.push(e));
      const commands = device ? gpu as InstanceType<typeof WebGPUCommands> : undefined;
      if (commands) {
        commands.merge = merge;
        commands.frame(device!.createTexture({ size: [16, 16], format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING }));
      } else (gpu as InstanceType<typeof WebGL2Gpu>).beginFrame(16, 16, { x: 0, y: 0, w: 16, h: 16, scale: 1 });
      const send = (op: number, words: number[], extra: Record<string, unknown> = {}) => {
        const code = gpu.execute({ kind: 'gpu', op, words, ...extra });
        if (code) throw new Error(`GPU opcode ${op}: ${code}; ${errors.join(';')}`);
      };
      const compile = (h: number, stage: number, source: string) => new Promise<void>((ok, fail) =>
        send(O.SHADER_CREATE, [h, stage, 1, 0, source.length, h], { source, complete: (c: number, log: string) => c ? fail(new Error(log)) : ok() }));
      const read = () => new Promise<number[]>((ok, fail) => send(O.TEXTURE_READBACK, [1, 0, 0, 0, 0, 16, 16, 1, 50],
        { readback: (data: Uint8Array | undefined, code = 0) => code ? fail(new Error(String(code))) : ok([...data!]) }));
      const at = (p: number[], x: number, y: number) => p.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4);
      const indices = (v: number[]) => new Uint8Array(new Uint32Array(v).buffer);
      const draw = (clear: boolean) => {
        send(O.PASS_BEGIN, [1, 0, 0, 0, 0, 0x3f800000, 0, 1, 0, clear ? 1 : 0, 0, 0, 0, 0]);
        send(O.PIPELINE, [1]); send(O.INDEX_BUFFER, [2, 1, 0, 12]); send(O.DRAW_INDEXED, [3, 1, 0, 0, 0]); send(O.PASS_END, []);
      };
      try {
        // Vertices 0..2: a triangle over the left edge; 3..5: its mirror over the right edge. Flat id -> red = 40 * id.
        await compile(1, 1, '#version 330 core\nflat out uint id;void main(){vec2 p[6]=vec2[6](vec2(-1,-3),vec2(-1,3),vec2(-0.1,0),' +
          'vec2(1,-3),vec2(1,3),vec2(0.1,0));id=bgt_vertex_index;gl_Position=vec4(p[bgt_vertex_index],0,1);}');
        await compile(2, 2, '#version 330 core\nflat in uint id;layout(location=0) out vec4 c;void main(){c=vec4(float(id)*40.0/255.0,0,0,1);}');
        send(O.TEXTURE_CREATE, [1, 16, 16, 1, 0, 3]);
        send(O.PIPELINE_CREATE, [1, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255, 7, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 15]);
        send(O.BUFFER_CREATE, [2, 15, 12, 0, 12], { data: indices([0, 1, 2]) });
        draw(true); const first = await read();
        // Same handle, new store: ABI §13.1 allows immediate reuse.
        send(O.BUFFER_DELETE, [2]); send(O.BUFFER_CREATE, [2, 15, 12, 0, 12], { data: indices([3, 4, 5]) });
        draw(true); const second = await read();
        // Steady: indices rewritten every frame (same values, new contents version), one flat indexed draw per frame.
        commands?.flush(); const before = created;
        for (let i = 0; i < 10; i++) { send(O.BUFFER_UPDATE, [2, 0, 0, 12], { data: indices([3, 4, 5]) }); draw(true); commands?.flush(); }
        const during = created - before, steady = await read(); // (the readback itself creates a staging buffer)
        if (device) await device.queue.onSubmittedWorkDone();
        if (errors.length) throw new Error(errors.join('\n'));
        out.push({ merge, first: [at(first, 1, 8), at(first, 14, 8)], second: [at(second, 1, 8), at(second, 14, 8)],
          steady: [at(steady, 1, 8), at(steady, 14, 8)], created: during, rings: commands?.rotatedIndices?.created ?? 0 });
      } finally { device?.destroy(); }
    }
    return out;
  }, { backend: backendParam, root: '/@fs' + resolve('bgt') });
  for (const r of runs) {
    // First draw: indices 0,1,2 -> the left triangle, flat id of the last vertex (2).
    expect(r.first).toEqual([[80, 0, 0, 255], [0, 0, 0, 0]]);
    // After delete/re-create: indices 3,4,5 -> the right triangle, id 5 (the stale copy drew the left one again).
    expect(r.second).toEqual([[0, 0, 0, 0], [200, 0, 0, 255]]);
    expect(r.steady).toEqual([[0, 0, 0, 0], [200, 0, 0, 255]]);
  }
  if (backendParam === 'webgpu') {
    expect(runs.map(r => r.merge)).toEqual([true, false]);
    // Ten frames of rewritten indices: rotated copies are queue writes into one index ring, no GPU buffer creation.
    for (const r of runs) { expect(r.created).toBe(0); expect(r.rings).toBe(1); }
  }
});
