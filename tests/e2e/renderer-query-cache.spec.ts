// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { rendererHotpathFixture } from '../fixtures/renderer-hotpath';
test('native completeness and uniform reflection follow storage/program generations',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async({root,init})=>{
    const {WebGL2Gpu}=await import(root+'/renderers/webgl2/gpu.ts');
    const {GPU_OP:O}=await import(root+'/runtime/abi.ts');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
    const g=canvas.getContext('webgl2',{antialias:false})!;if(!g)throw Error('WebGL2 unavailable');
    const errors:string[]=[],gpu=new WebGL2Gpu(g,(m:string)=>errors.push(m));
    gpu.beginFrame(32,32,{x:0,y:0,w:32,h:32,scale:1});
    const send=(op:number,words:number[],extra={})=>gpu.execute({kind:'gpu',op,words,...extra});
    for(const item of init.items)if(gpu.execute(item))throw Error(errors.join(' '));
    const original=g.checkFramebufferStatus.bind(g);let queries=0;
    g.checkFramebufferStatus=(t:number)=>{queries++;return original(t);};
    const pass=(h=1,mip=0)=>send(O.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,h,mip,1,0,0,0,0]);
    pass();send(O.PASS_END,[]);pass();send(O.PASS_END,[]);const repeat=queries;
    send(O.TEXTURE_DELETE,[1]);send(O.TEXTURE_CREATE_EX,[1,0,16,16,1,2,0,3]);
    pass();send(O.PASS_END,[]);const reused=queries;
    send(O.TEXTURE_ALLOCATE_MIPS,[1,2]);pass();send(O.PASS_END,[]);const growth=queries;
    pass(1,1);send(O.PASS_END,[]);const mip=queries;
    const pipeline=init.items.find((i:any)=>i.op===O.PIPELINE_CREATE)!.words;
    // A recycled shader/program must refresh reflected block size as well as uniform locations.
    send(O.PIPELINE_DELETE,[1]);send(O.SHADER_DELETE,[2]);
    const source='#version 330 core\nlayout(std140) uniform bgt_u0 {vec4 color;vec4 extra;};layout(location=0) out vec4 result;void main(){result=color+extra;}';
    send(O.SHADER_CREATE,[2,2,1,0,source.length,2],{source});
    send(O.PIPELINE_CREATE,pipeline);
    pass();send(O.PIPELINE,[1]);send(O.UNIFORM_BUFFER,[0,1,0,16]);const short=send(O.DRAW,[3,1,0,0]);send(O.PASS_END,[]);
    const nativeError=g.getError();g.getExtension('WEBGL_lose_context')?.loseContext();
    return {repeat,reused,mip,growth,short,nativeError,errors};
  },{root:'/@fs'+resolve('bgt'),init:rendererHotpathFixture().setup});
  expect(result.repeat).toBe(1);expect(result.reused).toBe(2);expect(result.growth).toBeGreaterThan(result.reused);expect(result.mip).toBe(result.growth+1);
  expect(result.short).toBe(-6);expect(result.nativeError).toBe(0);expect(result.errors).toHaveLength(1);expect(result.errors[0]).toContain('Uniform range smaller than reflected block');
});
