// SPDX-License-Identifier: CC0-1.0
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { rendererHotpathFixture } from '../fixtures/renderer-hotpath';
// Standalone: no game files, wasm build, guest readbacks or diagnostic work inside timed frames.
test('2D engine renderer submission wall time and synchronous-query census', async ({page}, info) => {
  test.setTimeout(180000);
  await page.goto('/');
  const fixture=rendererHotpathFixture();
  const result=await page.evaluate(async ({setup,frame,kind,root})=>{
    const {Frame}=await import(root+'/runtime/commands.ts');
    const {WebGL2Renderer}=await import(root+'/renderers/webgl2/webgl2.ts');
    const {WebGPURenderer}=await import(root+'/renderers/webgpu/webgpu.ts');
    const canvas=document.createElement('canvas'); document.body.append(canvas);
    const renderer=kind==='webgl2'?WebGL2Renderer.create(canvas):await WebGPURenderer.create(canvas);
    if(!renderer)throw new Error(kind+' unavailable'); renderer.resize(32,32);
    const errors:string[]=[];renderer.onError((m:string)=>errors.push(m));
    const lb={x:0,y:0,w:32,h:32,scale:1};
    const restore=(record:any)=>{const f=new Frame();f.reset(32,32);f.items.push(...record.items);return f;};
    const init=restore(setup),steady=restore(frame);
    const shaderResults: number[]=[];
    for(const it of init.items)if(it.kind==='gpu'&&it.op===0x48)it.complete=(code:number)=>shaderResults.push(code);
    await renderer.drawFrame(init,lb,false);await renderer.finish();
    // Compilation callbacks are async on WebGPU.
    for(let i=0;i<100&&shaderResults.length<2;i++)await new Promise(r=>setTimeout(r,10));
    if(shaderResults.length!==2||shaderResults.some(c=>c))throw new Error('shader compilation '+shaderResults);
    const names=['getError','checkFramebufferStatus','getParameter','getUniformLocation','getUniformBlockIndex','getActiveUniformBlockParameter','readPixels','getBufferSubData'];
    const counts:Record<string,number>={},originals=new Map<string,(...args:any[])=>any>();
    const proto=WebGL2RenderingContext.prototype as any;
    for(const name of names){counts[name]=0;const original=proto[name];originals.set(name,original);proto[name]=function(...args:any[]){counts[name]++;return original.apply(this,args);};}
    const samples:number[]=[];
    try{
      for(let i=0;i<8;i++){await renderer.drawFrame(steady,lb,false);await renderer.finish();}
      for(const name of names)counts[name]=0;
      for(let i=0;i<60;i++){
        const t=performance.now();const pending=renderer.drawFrame(steady,lb,false);samples.push(performance.now()-t);await pending;
        // Outside measured submission span; keep GPU work bounded and avoid queue-backpressure drift.
        await renderer.finish();
      }
      const timedCounts={...counts};
      const nativeSyncQueries=renderer.gpu.nativeSyncQueries?{...renderer.gpu.nativeSyncQueries}:null;
      const pixels=await renderer.drawFrame(steady,lb,true);
      return {kind,frames:60,drawsPerFrame:128,passesPerFrame:16,samples,counts:timedCounts,errors,
        pixel:pixels?[...pixels.data.slice(0,4)]:null,nativeSyncQueries};
    }finally{for(const [name,original] of originals)proto[name]=original;renderer.destroy();}
  },{setup:fixture.setup,frame:fixture.frame,kind:info.project.name.includes('webgpu')?'webgpu':'webgl2',root:'/@fs'+resolve('bgt')});
  console.log('HOTPATH '+JSON.stringify(result));
  await info.attach('hotpath.json',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.errors).toEqual([]);expect(result.pixel).toEqual([255,0,0,255]);
  expect(result.counts.getError).toBe(result.kind==='webgl2'?result.frames:0);
  expect(result.nativeSyncQueries).toEqual(result.kind==='webgl2'?{getError:1,checkFramebufferStatus:0,generatedBufferReadbacks:0}:null);
  for(const name of ['checkFramebufferStatus','getParameter','getUniformLocation','getUniformBlockIndex','getActiveUniformBlockParameter','readPixels','getBufferSubData'])expect(result.counts[name],name).toBe(0);
});
