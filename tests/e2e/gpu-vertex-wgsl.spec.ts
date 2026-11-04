// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';
import { vertexComponentCases } from '../fixtures/vertex-components';

test('native WGSL vertex fetch uses the same class-preserving component fill @webgpu', async ({page,backendParam,collector},info) => {
  void collector; expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready'); await assertBackend(page,backendParam,info);
  const cases=vertexComponentCases.flatMap(c=>[1,2,3,4].map(width=>({ ...c, shaderWidth:width })));
  const result=await page.evaluate(async ({root,cases})=>{
    const {WebGPUCommands}=await import(root+'/renderers/webgpu/gpu.ts');
    const {GPU_OP:O}=await import(root+'/runtime/abi.ts');
    const device=await (await navigator.gpu.requestAdapter())!.requestDevice(), errors:string[]=[];
    device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const gpu=new WebGPUCommands(device,e=>errors.push(e));
    const send=(op:number,words:number[],extra={})=>{if(gpu.execute({kind:'gpu',op,words,...extra}))throw Error(errors.join(';'));};
    const pixels:number[][]=[];
    try {
      send(O.TEXTURE_CREATE,[1,4,4,1,0,3]);
      for(const c of cases){
        const s=c.scalar==='float'?'f':c.scalar==='int'?'i':'u',type=c.shaderWidth===1?s+'32':'vec'+c.shaderWidth+s;
        const value=c.shaderWidth===4?'value':c.shaderWidth===3?'value,1'+(s==='f'?'.0':s):c.shaderWidth===2?
          'value,0'+(s==='f'?'.0':s)+',1'+(s==='f'?'.0':s):'value,0'+(s==='f'?'.0':s)+',0'+(s==='f'?'.0':s)+',1'+(s==='f'?'.0':s);
        const source='struct Out{@builtin(position) pos:vec4f,@location(0) paint:vec4f};'+
          '@vertex fn vs_main(@location(0) value:'+type+',@builtin(vertex_index) id:u32)->Out{var o:Out;'+
          'o.pos=vec4f(select(-1.0,3.0,id==1u),select(-1.0,3.0,id==2u),0.0,1.0);'+
          'o.paint=vec4f(vec4'+s+'('+value+'))'+(s==='f'?'':'/vec4f(8.0,8.0,8.0,1.0)')+';return o;}'+
          '@fragment fn fs_main(i:Out)->@location(0) vec4f{return i.paint;}';
        await new Promise<void>((resolve,reject)=>send(O.SHADER_CREATE,[1,3,0,0,source.length,1],{source,complete:(code:number,log:string)=>code?reject(Error(log)):resolve()}));
        send(O.BUFFER_CREATE,[1,1,c.data.length,0,c.data.length],{data:new Uint8Array(c.data)});
        send(O.PIPELINE_CREATE,[1,1,1,3,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,0,0,1,1,1,c.data.length,1,0,0,0,c.format,0,0,1,0,0,1,0,0,15]);
        send(O.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,1,0,1,0,0,0,0]); send(O.PIPELINE,[1]);send(O.VERTEX_BUFFER,[0,1,0,c.data.length]);send(O.DRAW,[3,1,0,0]);send(O.PASS_END,[]);
        pixels.push(await new Promise<number[]>((resolve,reject)=>send(O.TEXTURE_READBACK,[1,0,1,1,0,1,1,1,2],{readback:(data:Uint8Array,code:number)=>code?reject(Error(String(code))):resolve([...data])})));
        send(O.PIPELINE_DELETE,[1]);send(O.SHADER_DELETE,[1]);send(O.BUFFER_DELETE,[1]);
      }
      await device.queue.onSubmittedWorkDone(); return {pixels,errors};
    }finally{device.destroy();}
  },{root:'/@fs'+resolve('bgt'),cases});
  expect(result.errors).toEqual([]); expect(result.pixels).toHaveLength(cases.length);
  cases.forEach((c,i)=>{
    const values=Array.from({length:4},(_,j)=>j<c.shaderWidth?(c.values[j]??(j===3?1:0)):(j===3?1:0));
    const expected=values.map((v,j)=>Math.round(Math.min(1,Math.max(0,c.scalar!=='float'&&j<3?v/8:v))*255));
    expect(result.pixels[i],JSON.stringify(c)).toEqual(expected);
  });
});
