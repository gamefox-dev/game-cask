// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';
import { rendererFrameFixture } from '../fixtures/renderer-frame';
import { rendererScreenFixture } from '../fixtures/renderer-screen';
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

// Catches readback-only masking: screen copies and DST_ALPHA blending must see native opaque alpha.
test('opaque screen boundaries preserve offscreen alpha and destination-alpha blending @webgpu', async ({page, backendParam, collector}, info) => {
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
  },{root:'/@fs'+resolve('bgt'),frames:rendererScreenFixture()});
  expect(result[1]).toEqual(result[0]);
  const pixel = (frame: number, label: string, x = 0) => {
    const shot = result[0][frame].find((s: any) => s.label === label)!;
    return [...Buffer.from(shot.data,'base64').subarray(x*4,x*4+4)];
  };
  const pass1 = result[0][1].find((s: any) => s.label.includes(':pass:1:0'))!;
  expect([...Buffer.from(pass1.data,'base64').subarray(0,4)]).toEqual([64,0,0,128]);
  expect(pixel(1,'screen')).toEqual([64,0,0,255]);
  expect(pixel(2,'screen')).toEqual([0,128,0,255]);
  const offscreen = result[0][2].find((s: any) => s.label.includes(':pass:1:0'))!;
  expect([...Buffer.from(offscreen.data,'base64').subarray(0,4)]).toEqual([0,64,0,64]);
  expect(pixel(3,'screen')).toEqual([64,0,0,255]);
  expect(pixel(3,'screen',8)).toEqual([255,0,0,255]);
});
