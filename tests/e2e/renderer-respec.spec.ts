// SPDX-License-Identifier: CC0-1.0. Catches late queue writes overwriting earlier draws on a reused store.
import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {rendererHotpathFixture,rendererOrphanFixture} from '../fixtures/renderer-hotpath';
test('full buffer replacement preserves earlier draws in command order',async({page},info)=>{
  await page.goto('/?paused=1&backend=none');
  const result=await page.evaluate(async({root,setup,kind})=>{
    const {Frame}=await import(root+'/runtime/commands.ts');
    const {WebGL2Renderer}=await import(root+'/renderers/webgl2/webgl2.ts');
    const {WebGPURenderer}=await import(root+'/renderers/webgpu/webgpu.ts');
    const c=document.createElement('canvas');document.body.append(c);
    const r=kind==='webgl2'?WebGL2Renderer.create(c):await WebGPURenderer.create(c);
    if(!r)throw Error('renderer unavailable');r.resize(32,32);const errors:string[]=[];r.onError((e:string)=>errors.push(e));
    const restore=(record:any)=>{const f=new Frame();f.reset(32,32);f.items.push(...record.items);return f;};
    const lb={x:0,y:0,w:32,h:32,scale:1},init=restore(setup),results:number[]=[];
    for(const it of init.items)if(it.kind==='gpu'&&it.op===0x48)it.complete=(code:number)=>results.push(code);
    await r.drawFrame(init,lb,false);await r.finish();
    for(let i=0;i<100&&results.length<2;i++)await new Promise(s=>setTimeout(s,10));
    if(results.length!==2||results.some(n=>n))throw Error('shader results '+results);
    const frame=new Frame();frame.reset(32,32);
    const push=(op:number,words:number[],extra={})=>frame.items.push({kind:'gpu',op,words,...extra});
    push(0x44,[3,0,0,0,1,1,0,4],{data:new Uint8Array([255,255,255,255])});
    for(let i=0;i<2;i++){
      push(0x41,[1,0,0,16],{data:new Uint8Array(new Float32Array(i?[0,1,0,1]:[1,0,0,1]).buffer)});
      push(0x4c,[1,0,0,0,0,0x3f800000,0,0,0,i?0:1,0,0,0,0]);
      push(0x4e,[1]);push(0x55,[0,1,0,16]);push(0x56,[0,3,1]);push(0x50,[i*16,0,16,32]);push(0x57,[3,1,0,0]);push(0x4d,[]);
    }
    const pixels=await r.drawFrame(frame,lb,true);await r.finish();
    const at=(x:number)=>pixels?[...pixels.data.slice((16*32+x)*4,(16*32+x)*4+4)]:null;
    const result={errors,left:at(8),right:at(24)};r.destroy();return result;
  },{root:'/@fs'+resolve('bgt'),setup:rendererHotpathFixture().setup,kind:info.project.name.includes('webgpu')?'webgpu':'webgl2'});
  expect(result.errors).toEqual([]);expect(result.left).toEqual([255,0,0,255]);expect(result.right).toEqual([0,255,0,255]);
});
// Catches reintroduced per-allocation polling or completeness invalidation from unrelated buffer churn.
test('engine-shaped equal-size reuse has one poll and cached FBO completeness',async({page},info)=>{
  await page.goto('/?paused=1&backend=none');
  const result=await page.evaluate(async({root,setup,frame,kind})=>{
    const {Frame}=await import(root+'/runtime/commands.ts');
    const {WebGL2Renderer}=await import(root+'/renderers/webgl2/webgl2.ts');
    const {WebGPURenderer}=await import(root+'/renderers/webgpu/webgpu.ts');
    const c=document.createElement('canvas');document.body.append(c);
    const r=kind==='webgl2'?WebGL2Renderer.create(c):await WebGPURenderer.create(c);if(!r)throw Error('renderer unavailable');
    r.resize(32,32);const errors:string[]=[];r.onError((e:string)=>errors.push(e));
    const restore=(record:any)=>{const f=new Frame();f.reset(32,32);f.items.push(...record.items);return f;};
    const lb={x:0,y:0,w:32,h:32,scale:1},init=restore(setup),steady=restore(frame),results:number[]=[];
    for(const it of init.items)if(it.kind==='gpu'&&it.op===0x48)it.complete=(code:number)=>results.push(code);
    await r.drawFrame(init,lb,false);await r.finish();
    for(let i=0;i<100&&results.length<2;i++)await new Promise(s=>setTimeout(s,10));
    if(results.length!==2||results.some(n=>n))throw Error('shader results '+results);
    for(let i=0;i<3;i++){await r.drawFrame(steady,lb,false);await r.finish();}
    const queries=r.gpu.nativeSyncQueries?{...r.gpu.nativeSyncQueries}:null;
    const pixels=await r.drawFrame(steady,lb,true);const result={errors,queries,pixel:pixels?[...pixels.data.slice(0,4)]:null};r.destroy();return result;
  },{root:'/@fs'+resolve('bgt'),...rendererOrphanFixture(true),kind:info.project.name.includes('webgpu')?'webgpu':'webgl2'});
  expect(result.errors).toEqual([]);expect(result.pixel).toEqual([255,0,0,255]);
  expect(result.queries).toEqual(info.project.name.includes('webgpu')?null:{getError:1,checkFramebufferStatus:0,generatedBufferReadbacks:0});
});
