// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';

test('failed native pipelines reject feedback, binds and draws without stale executable reuse', async ({ page, backendParam, collector }, info) => {
  void collector; expect(await openGame(page, backendParam, { game:'gpu-scenes' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  const result = await page.evaluate(async ({ root, backend }) => {
    const { GPU_OP: O, E_IO } = await import(root + '/runtime/abi.ts');
    const { WebGL2Gpu } = await import(root + '/renderers/webgl2/gpu.ts');
    const { WebGPUCommands } = await import(root + '/renderers/webgpu/gpu.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const gl = backend === 'webgl2' ? canvas.getContext('webgl2')! : undefined;
    const device = backend === 'webgpu' ? await (await navigator.gpu.requestAdapter())!.requestDevice() : undefined;
    const errors: string[] = [], uncaptured: string[] = [];
    device?.addEventListener('uncapturederror', e => uncaptured.push(e.error.message));
    const gpu = gl ? new WebGL2Gpu(gl, (e:string) => errors.push(e)) : new WebGPUCommands(device!, (e:string) => errors.push(e));
    const send = (op: number, words: number[], extra = {}) => gpu.execute({ kind:'gpu', op, words, ...extra });
    const ok = (op: number, words: number[], extra = {}) => { if(send(op,words,extra)) throw Error(errors.join('\n')); };
    const compile = (h: number, source: string) => new Promise<void>((resolve, reject) =>
      ok(O.SHADER_CREATE,[h,h===2?2:1,1,0,source.length,h],{source,complete:(code:number,log:string)=>code?reject(Error(log)):resolve()}));
    const pipeline = (h: number, vs = 1, format = 3, mask = 0) => [h,vs,2,3,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,mask,0,1,1,1,
      16,1,0,0,0,format,0,0,1,0,0,1,0,0,15];
    // Native validation is asynchronous on WebGPU. Observe its owned scope, not a timer or unrelated queue idle.
    const settle = async (h: number) => {
      if (device) await (gpu as any).pipelines.get(h)?.validation;
    };
    const begin = () => ok(O.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,1,0,1,0,0,0,0]);
    const names = 'result 3\n';
    const uses: number[][] = [], reads: number[][] = [], creation: number[] = [];
    const probeFailed = async (h: number) => {
      const codes = [send(O.FEEDBACK_VARYINGS,[h,0,1,0,names.length],{source:names})];
      begin(); ok(O.PIPELINE,[1]); ok(O.VERTEX_BUFFER,[0,1,0,16]); ok(O.INDEX_BUFFER,[3,0,0,6]);
      codes.push(send(O.PIPELINE,[h]), send(O.DRAW,[3,1,0,0]), send(O.DRAW_INDEXED,[3,1,0,0,0]),
        send(O.FEEDBACK_CAPTURE,[1,2,0,48,0,0,0,0,0,0,0,0,0]));
      ok(O.PASS_END,[]); uses.push(codes);
      reads.push(await new Promise<number[]>((resolve,reject) => ok(O.TEXTURE_READBACK,[1,0,1,1,0,1,1,1,20],
        {readback:(data:Uint8Array,code:number)=>code?reject(Error(String(code))):resolve([...data])})));
    };
    try {
      await compile(1,'#version 330 core\nlayout(location=0) in vec4 value;out vec4 result;void main(){result=value;uint id=bgt_vertex_index;gl_Position=vec4(id==1u?3.0:-1.0,id==2u?3.0:-1.0,0.0,1.0);}');
      await compile(2,'#version 330 core\nin vec4 result;layout(location=0) out vec4 color;void main(){color=result;}');
      // Undeclared active UBO: a real synchronous pipeline failure on both renderers.
      await compile(3,'#version 330 core\nlayout(std140) uniform bgt_u0{vec4 offset;};layout(location=0) in vec4 value;out vec4 result;void main(){result=value+offset;gl_Position=vec4(0.0,0.0,0.0,1.0);}');
      for (const [h,type] of [[4,'ivec4'],[5,'uvec4']] as const) await compile(h,'#version 330 core\nlayout(location=0) in '+type+' value;out vec4 result;void main(){result=vec4(value);gl_Position=vec4(0.0,0.0,0.0,1.0);}');
      ok(O.TEXTURE_CREATE,[1,4,4,1,0,3]);
      ok(O.BUFFER_CREATE,[1,1,16,0,16],{data:new Uint8Array(new Float32Array([1,0,0,1]).buffer)});
      ok(O.BUFFER_CREATE,[2,8,48,0,0]); ok(O.BUFFER_CREATE,[3,2,6,0,6],{data:new Uint8Array(new Uint16Array([0,1,2]).buffer)});
      ok(O.PIPELINE_CREATE,pipeline(1)); await settle(1);
      creation.push(send(O.PIPELINE_CREATE,pipeline(2,3))); await probeFailed(2);
      // Cross-class and signedness failures must never become successful component fills.
      for (const [vs,format] of [[1,6],[1,10],[4,1],[4,4],[4,10],[5,6]]) {
        creation.push(send(O.PIPELINE_CREATE,pipeline(3,vs,format))); await settle(3); await probeFailed(3); ok(O.PIPELINE_DELETE,[3]);
      }
      // Delete/reuse cannot inherit failed feedback state or a late validation tombstone.
      ok(O.PIPELINE_DELETE,[2]); ok(O.PIPELINE_CREATE,pipeline(2)); await settle(2);
      begin(); ok(O.PIPELINE,[2]); ok(O.VERTEX_BUFFER,[0,1,0,16]); ok(O.DRAW,[3,1,0,0]); ok(O.PASS_END,[]);
      const recovered = await new Promise<number[]>((resolve,reject) => ok(O.TEXTURE_READBACK,[1,0,1,1,0,1,1,1,21],
        {readback:(data:Uint8Array,code:number)=>code?reject(Error(String(code))):resolve([...data])}));
      if(device) await device.queue.onSubmittedWorkDone();
      return { creation, uses, reads, recovered, errors, uncaptured, E_IO };
    } finally { device?.destroy(); }
  }, { root:'/@fs' + resolve('bgt'), backend:backendParam });
  expect(result.creation[0]).toBe(result.E_IO);
  expect(result.creation.slice(1)).toEqual(Array(6).fill(backendParam === 'webgl2' ? result.E_IO : 0));
  expect(result.uses).toEqual(Array.from({length:7},()=>Array(5).fill(result.E_IO)));
  expect(result.reads).toEqual(Array.from({length:7},()=>[0,0,0,0]));
  expect(result.recovered).toEqual([255,0,0,255]);
  expect(result.uncaptured).toEqual([]);
  expect(result.errors).toHaveLength(42);
  expect(result.errors.join('\n')).not.toMatch(/undefined|Cannot read|TypeError/);
  expect(result.errors.join('\n')).toMatch(/creation failed/);
});
