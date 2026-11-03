// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { test, expect } from './fixtures';
import { webgpuArgs } from './browser-options';
import { rendererScaleFixture } from '../fixtures/renderer-scale';

test('nearest scale preserves exact small controls and pins native adjacent-texel boundary @webgpu', async ({baseURL}, info) => {
  const cases=[];
  for(const source of [7,8,11,16])for(const dest of [3,5,9])for(const present of [false,true])cases.push({source,dest,present});
  for(const [source,dest] of [[56,45],[199,160],[672,540],[1194,960]])for(const present of [false,true])cases.push({source,dest,present});
  const results=[];
  for(const kind of ['webgl2','webgpu']) {
    const browser=await chromium.launch(kind==='webgpu'?{channel:'chromium',args:webgpuArgs}:{channel:undefined,args:[]});
    try {
      const page=await browser.newPage(); await page.route('**/__scale__',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
      await page.goto(baseURL+'__scale__');
      results.push(await page.evaluate(async ({root,kind,records})=>{
        const {WebGPURenderer}=await import(root+'/renderers/webgpu/webgpu.ts');
        const {WebGL2Renderer}=await import(root+'/renderers/webgl2/webgl2.ts');
        const {FrameReplay}=await import(root+'/renderers/frame-replay.ts');
        const shots=[];
        for(const record of records) {
          const canvas=document.createElement('canvas');document.body.append(canvas);
          const renderer=kind==='webgpu'?await WebGPURenderer.create(canvas,{debug:true}):WebGL2Renderer.create(canvas,{debug:true});
          if(!renderer?.gpu?.languages)throw new Error(kind+' unavailable');
          try { shots.push((await new FrameReplay(renderer).draw(record,true)).find((s: {label:string})=>s.label==='screen')!); } finally {renderer.destroy();canvas.remove();}
        }
        return shots;
      },{root:'/@fs'+resolve('bgt'),kind,records:cases.flatMap(c=>[rendererScaleFixture(c.source,c.dest,c.present),rendererScaleFixture(c.source,c.dest,c.present,true)])}));
    } finally {await browser.close();}
  }
  const evidence=[];
  for(let i=0;i<cases.length;i++) {
    const c=cases[i], shots=results.map(r=>Buffer.from(r[i*2].data,'base64'));
    const coordinates=results.map(r=>Buffer.from(r[i*2+1].data,'base64'));
    let differingPixels=0,maxDisplacement=0,maxIdealDisplacement=0;
    for(let k=0;k<shots[0].length;k+=4) {
      const positions=coordinates.map(bytes=>[bytes[k]+((bytes[k+2]&7)<<8),bytes[k+1]+((bytes[k+2]>>3)<<8)]);
      for(let backend=0;backend<2;backend++) {
        const [x,y]=positions[backend], pixel=k/4;
        if(x>=c.source || y>=c.source || coordinates[backend][k+3]!==255)throw new Error('Not an exact source texel');
        const expected=[x%2*255,y%2*255,(x+y)%2*255,255];
        if(!expected.every((v,ch)=>shots[backend][k+ch]===v))throw new Error('Filtered/non-source checkerboard pixel');
        maxIdealDisplacement=Math.max(maxIdealDisplacement,Math.abs(x-Math.floor((pixel%c.dest+.5)*c.source/c.dest)),Math.abs(y-Math.floor((Math.floor(pixel/c.dest)+.5)*c.source/c.dest)));
      }
      maxDisplacement=Math.max(maxDisplacement,...positions[0].map((v,axis)=>Math.abs(v-positions[1][axis])));
      if(!shots[0].subarray(k,k+4).equals(shots[1].subarray(k,k+4)))differingPixels++;
    }
    // Existing small-scale exact controls are retained, not covered by the native boundary.
    if(i<24)expect(shots[1],JSON.stringify(c)).toEqual(shots[0]);
    expect(maxDisplacement).toBeLessThanOrEqual(1);
    expect(maxIdealDisplacement).toBeLessThanOrEqual(1);
    evidence.push({...c,differingPixels,maxDisplacement,maxIdealDisplacement});
  }
  await info.attach('nearest-scale',{body:JSON.stringify(evidence),contentType:'application/json'});
});
