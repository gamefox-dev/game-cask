// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';
import { rendererFrameFixture } from '../fixtures/renderer-frame';
test('standalone multipass recording preserves float blending, native blits and handle generations @webgpu', async ({page, backendParam, collector}, info) => {
  void collector; expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready'); await assertBackend(page,backendParam,info);
  const result = await page.evaluate(async ({root, frames}) => {
    const {WebGPURenderer} = await import(root+'/renderers/webgpu/webgpu.ts');
    const {WebGL2Renderer} = await import(root+'/renderers/webgl2/webgl2.ts');
    const {FrameReplay} = await import(root+'/renderers/frame-replay.ts');
    const results = [];
    for (const kind of ['webgl2','webgpu']) {
      const canvas=document.createElement('canvas'); document.body.append(canvas);
      const renderer=kind==='webgpu'?await WebGPURenderer.create(canvas,{debug:true}):WebGL2Renderer.create(canvas,{debug:true});
      if(!renderer) throw new Error(kind+' unavailable'); const replay=new FrameReplay(renderer);
      const shots=[]; for(const frame of frames) shots.push(await replay.draw(frame,true));
      results.push(shots); renderer.destroy();
    }
    return results;
  },{root:'/@fs'+resolve('bgt'),frames:rendererFrameFixture()});
  expect(result[1]).toEqual(result[0]);
  const screen=result[0][1].find((s: any)=>s.label==='screen')!;
  const bytes=Buffer.from(screen.data,'base64');
  expect([...bytes.subarray(0,4)]).toEqual([64,0,0,255]);
  expect([...bytes.subarray(8*4,8*4+4)]).toEqual([64,128,0,255]);
  const last=result[0][2].find((s: any)=>s.label==='screen')!;
  expect([...Buffer.from(last.data,'base64').subarray(0,4)]).toEqual([0,0,255,255]);
});
