// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { test, expect, openGame, assertBackend } from './fixtures';
import { webgpuArgs } from './browser-options';
import { rendererFloatFixture } from '../fixtures/renderer-float';
import type { ReplaySnapshot } from '../../bgt/renderers/frame-replay';

test('native float16 conversion boundary retains exact RGBA8 integer and depth controls @webgpu', async ({page, backendParam, collector}, info) => {
  void collector; expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready'); await assertBackend(page,backendParam,info);
  const results: ReplaySnapshot[][] = [];
  // Same launch settings as probe:replay, not a reduced-capability Metal WebGL context.
  for (const kind of ['webgl2','webgpu']) {
    const browser = await chromium.launch(kind === 'webgpu' ? {channel:'chromium',args:webgpuArgs} : {channel:undefined,args:[]});
    try {
      const probe = await browser.newPage();
      await probe.route('**/__renderer_float__', route => route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
      await probe.goto(new URL('/__renderer_float__', page.url()).href);
      results.push(await probe.evaluate(async ({root,kind,frame}) => {
        const {WebGPURenderer} = await import(root+'/renderers/webgpu/webgpu.ts');
        const {WebGL2Renderer} = await import(root+'/renderers/webgl2/webgl2.ts');
        const {FrameReplay} = await import(root+'/renderers/frame-replay.ts');
        const canvas=document.createElement('canvas'); document.body.append(canvas);
        const renderer=kind==='webgpu'?await WebGPURenderer.create(canvas,{debug:true}):WebGL2Renderer.create(canvas,{debug:true});
        if (!renderer?.gpu?.languages) throw new Error(kind+' unavailable');
        try { return await new FrameReplay(renderer).draw(frame,true); } finally { renderer.destroy(); }
      },{root:'/@fs'+resolve('bgt'),kind,frame:rendererFloatFixture()}));
    } finally { await browser.close(); }
  }
  const evidence = [];
  expect(results[1].length).toBe(results[0].length);
  for (let i=0;i<results[0].length;i++) {
    const a=results[0][i], b=results[1][i];
    expect({...a,data:''}).toEqual({...b,data:''});
    const x=Buffer.from(a.data,'base64'), y=Buffer.from(b.data,'base64');
    if (a.format===0 && a.label.includes(':pass:5:0')) {
      // Native UNORM tie conversion is a separate one-code numerical boundary.
      // Keep this original nonrepresentable control as well as exact representable controls.
      let maxUnormDelta=0;
      for(let j=0;j<x.length;j+=4) {
        for(const bytes of [x,y]) {
          expect([...bytes.subarray(j,j+2)]).toEqual([26,51]);
          expect([76,77]).toContain(bytes[j+2]); expect(bytes[j+3]).toBe(153);
        }
        maxUnormDelta=Math.max(maxUnormDelta,Math.abs(x[j+2]-y[j+2]));
      }
      evidence.push({label:a.label,maxUnormDelta}); continue;
    }
    if (a.format!==4) {
      expect(y).toEqual(x);
      if (a.format===0) expect([...x.subarray(0,4)]).toEqual([64,128,191,255]);
      if (a.format===17) expect(x.readUInt32LE()).toBe(0x12345678);
      if (a.format===6) expect(x.readFloatLE()).toBe(.5);
      continue;
    }
    let maxHalfUlp=0;
    const expected = [0x2e66,0x3266,0x34cd,0x38cd]; // RNE of original 0.1,0.2,0.3,0.6.
    for (let j=0;j<x.length;j+=2) {
      const u=x.readUInt16LE(j), v=y.readUInt16LE(j), want=expected[(j/2)%4];
      // Native conversion may round toward zero or nearest; no missing/zero/wrong-channel draw can pass.
      expect([want-1,want]).toContain(u); expect([want-1,want]).toContain(v);
      maxHalfUlp=Math.max(maxHalfUlp,Math.abs(u-v));
    }
    expect(maxHalfUlp).toBeLessThanOrEqual(1);
    evidence.push({label:a.label,maxHalfUlp,webgl2:[...x.subarray(0,8)],webgpu:[...y.subarray(0,8)]});
  }
  await info.attach('native-float16-boundary',{body:JSON.stringify(evidence),contentType:'application/json'});
});
