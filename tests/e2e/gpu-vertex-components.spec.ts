// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';
import { vertexComponentCases, componentShaders } from '../fixtures/vertex-components';

test('vertex fetch fills and truncates components like native GL, including feedback', async ({ page, backendParam, collector }, info) => {
  test.setTimeout(180_000); void collector;
  expect(await openGame(page, backendParam, { game: 'gpu-scenes' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  const cases = vertexComponentCases.flatMap(c => [1,2].flatMap(language => [1,2,3,4].map(width =>
    ({ ...c, language, shaderWidth: width, ...componentShaders(c.scalar, width, language) })))).sort((a,b) =>
    Number(b.format === 1 && b.shaderWidth === 4) - Number(a.format === 1 && a.shaderWidth === 4));
  const results = await page.evaluate(async ({ root, backend, cases }) => {
    const { GPU_OP: O } = await import(root + '/runtime/abi.ts');
    const { WebGL2Gpu } = await import(root + '/renderers/webgl2/gpu.ts');
    const { WebGPUCommands } = await import(root + '/renderers/webgpu/gpu.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const gl = backend === 'webgl2' ? canvas.getContext('webgl2')! : undefined;
    const device = backend === 'webgpu' ? await (await navigator.gpu.requestAdapter())!.requestDevice() : undefined;
    const errors: string[] = [];
    device?.addEventListener('uncapturederror', e => errors.push(e.error.message));
    const gpu = gl ? new WebGL2Gpu(gl, (e:string) => errors.push(e)) : new WebGPUCommands(device!, (e:string) => errors.push(e));
    const send = (op: number, words: number[], extra = {}) => {
      const code = gpu.execute({ kind: 'gpu', op, words, ...extra });
      if (code) throw Error('opcode ' + op + ': ' + code + ' ' + errors.join('\n'));
    };
    const compile = (h: number, stage: number, language: number, source: string) => new Promise<void>((resolve, reject) =>
      send(O.SHADER_CREATE, [h,stage,language,0,source.length,h], { source, complete: (code: number, log: string) => code ? reject(Error(log)) : resolve() }));
    const read = (op: number, words: number[]) => new Promise<number[]>((resolve, reject) =>
      send(op, words, { readback: (data: Uint8Array, code: number) => code ? reject(Error(String(code))) : resolve([...data]) }));
    const referenceCanvas = document.createElement('canvas'); referenceCanvas.width = referenceCanvas.height = 4;
    const native = referenceCanvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
    const reference = (c: typeof cases[number]) => {
      const g = native, p = g.createProgram()!;
      for (const [stage, source] of [[g.VERTEX_SHADER, c.vertex.replace('bgt_vertex_index', 'uint(gl_VertexID)')], [g.FRAGMENT_SHADER, c.fragment]] as const) {
        const s = g.createShader(stage)!;
        g.shaderSource(s, source.replace('#version 330 core', '#version 300 es\nprecision highp float;\nprecision highp int;'));
        g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s)!);
        g.attachShader(p, s); g.deleteShader(s);
      }
      g.linkProgram(p); if (!g.getProgramParameter(p, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(p)!);
      const b = g.createBuffer()!, vao = g.createVertexArray()!;
      g.bindVertexArray(vao); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, new Uint8Array(c.data), g.STATIC_DRAW);
      g.enableVertexAttribArray(0);
      if (c.format < 5) g.vertexAttribPointer(0, c.width, c.format === 4 ? g.UNSIGNED_BYTE : g.FLOAT, c.format === 4, c.data.length, 0);
      else g.vertexAttribIPointer(0, c.width, c.scalar === 'int' ? g.INT : g.UNSIGNED_INT, c.data.length, 0);
      g.vertexAttribDivisor(0, 1); g.useProgram(p); g.viewport(0,0,4,4); g.drawArraysInstanced(g.TRIANGLES,0,3,1);
      const pixel = new Uint8Array(4); g.readPixels(1,1,1,1,g.RGBA,g.UNSIGNED_BYTE,pixel);
      const error = g.getError(); g.deleteProgram(p); g.deleteBuffer(b); g.deleteVertexArray(vao);
      if (error) throw Error('native reference ' + error); return [...pixel];
    };
    const results = [];
    try {
      send(O.TEXTURE_CREATE, [1,4,4,1,0,3]); send(O.BUFFER_CREATE,[2,8,48,0,0]);
      for (const c of cases) {
        await compile(1,1,c.language,c.vertex); await compile(2,2,c.language,c.fragment);
        send(O.BUFFER_CREATE,[1,1,c.data.length,0,c.data.length], { data: new Uint8Array(c.data) });
        send(O.PIPELINE_CREATE,[1,1,2,3,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,0,0,1,1,1,
          c.data.length,1,0,0,0,c.format,0,0,1,0,0,1,0,0,15]);
        const names = 'result ' + c.feedbackFormat + '\n';
        send(O.FEEDBACK_VARYINGS,[1,0,1,0,names.length],{source:names});
        send(O.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,1,0,1,0,0,0,0]); send(O.PIPELINE,[1]);
        send(O.VERTEX_BUFFER,[0,1,0,c.data.length]); send(O.FEEDBACK_CAPTURE,[0,2,0,48,0,0,0,0,0,0,0,0,0]);
        send(O.DRAW,[3,1,0,0]); send(O.PASS_END,[]);
        const pixel = await read(O.TEXTURE_READBACK,[1,0,1,1,0,1,1,1,5]);
        const captured = await read(O.BUFFER_READBACK,[2,0,c.shaderWidth*4*3,6]);
        results.push({ format:c.format, width:c.shaderWidth, pixel, native:reference(c), captured });
        send(O.PIPELINE_DELETE,[1]); send(O.BUFFER_DELETE,[1]); send(O.SHADER_DELETE,[1]); send(O.SHADER_DELETE,[2]);
      }
      if (device) await device.queue.onSubmittedWorkDone();
      if (errors.length) throw Error(errors.join('\n')); return results;
    } finally { device?.destroy(); }
  }, { root: '/@fs' + resolve('bgt'), backend: backendParam, cases });
  expect(results).toHaveLength(cases.length);
  results.forEach((r, i) => {
    const c = cases[i], values = Array.from({ length:c.shaderWidth }, (_, j) => c.values[j] ?? (j === 3 ? 1 : 0));
    const typed = c.scalar === 'float' ? new Float32Array(values) : c.scalar === 'int' ? new Int32Array(values) : new Uint32Array(values);
    const bytes = [...new Uint8Array(typed.buffer)];
    expect(r.captured, JSON.stringify(c)).toEqual([...bytes,...bytes,...bytes]);
    expect(r.pixel, JSON.stringify(c)).toEqual(r.native);
    if (c.format === 1 && c.shaderWidth === 4) expect(r.pixel).toEqual([64,128,0,255]);
  });
});
