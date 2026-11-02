// SPDX-License-Identifier: CC0-1.0. Original synthetic interfaces and exact pixels.
import {resolve} from 'node:path';
import {test,expect,openGame,assertBackend} from './fixtures';
test('GPU sparse fragment outputs preserve unwritten MRT attachments and masks in both GLSL languages',async({page,backendParam,collector},info)=>{
 void collector;expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready');await assertBackend(page,backendParam,info);
 const result=await page.evaluate(async({backend,root})=>{
  const {GPU_OP:O}=await import(root+'/runtime/abi.ts');const {WebGL2Gpu}=await import(root+'/renderers/webgl2/gpu.ts');const {WebGPUCommands}=await import(root+'/renderers/webgpu/gpu.ts');
  const errors:string[]=[],canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
  const gl=backend==='webgl2'?canvas.getContext('webgl2')!:undefined;
  const adapter=backend==='webgpu'?await navigator.gpu.requestAdapter():undefined,device=adapter?await adapter.requestDevice():undefined;
  device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const gpu=gl?new WebGL2Gpu(gl,(e:string)=>errors.push(e)):new WebGPUCommands(device!,(e:string)=>errors.push(e));
  const send=(op:number,words:number[],extra:Record<string,unknown>={})=>{const code=gpu.execute({kind:'gpu',op,words,...extra});if(code)throw new Error(`${op}: ${code}`);};
  const compile=(h:number,stage:number,language:number,source:string)=>new Promise<void>((resolve,reject)=>send(O.SHADER_CREATE,[h,stage,language,0,source.length,h],{source,complete:(code:number,log:string)=>code?reject(new Error(log)):resolve()}));
  const pixels:number[][]=[],depths:number[][]=[];
  for(let h=1;h<=4;h++)send(O.TEXTURE_CREATE,[h,16,16,1,0,3]);
  send(O.TEXTURE_CREATE,[5,16,16,1,6,3]);
  const read=(h:number)=>new Promise<number[]>((resolve,reject)=>send(O.TEXTURE_READBACK,[h,0,8,8,0,1,1,1,10],{readback:(data:Uint8Array|undefined,error:number)=>error?reject(new Error(String(error))):resolve([...data!])}));
  // Native WGSL combined adds vertex-output/fragment-input locations which must NOT count as fragment outputs.
  for(const language of backend==='webgpu'?[1,2,0]:[1,2]){
   const h=language*2+1,version=language===1?'#version 330 core':'#version 300 es\nprecision highp float;';
   if(language){
    await compile(h,1,language,version+'\nvoid main(){vec2 p=vec2(-1,-1);if(bgt_vertex_index==1u)p=vec2(3,-1);if(bgt_vertex_index==2u)p=vec2(-1,3);gl_Position=vec4(p,0.5,1);}');
    await compile(h+1,2,language,version+'\nlayout(location=1) out vec4 a;layout(location=3) out vec4 b;void main(){a=vec4(0,1,0,1);b=vec4(0,0,1,1);}');
   }else{
    const source=`/* outer /* inner */ fn fs_main()->@location(0) vec4f{} */
const loc:u32=0u;fn helper(){const LOC:u32=2u;}const LOC:u32=1u;
struct V{@builtin(position) p:vec4f,@location(0) v:vec4f};struct F{@location(LOC) a:vec4f,@location(3) b:vec4f};
@vertex fn vs_main(@builtin(vertex_index) i:u32)->V{var p=vec2f(-1,-1);if(i==1u){p=vec2f(3,-1);}if(i==2u){p=vec2f(-1,3);}return V(vec4f(p,0.5,1),vec4f(1));}
@fragment fn fs_main(@location(0) v:vec4f)->F{return F(vec4f(0,1,0,1),vec4f(0,0,1,1));}`;
    await compile(h,3,0,source);
   }
   for(const mask of [15,5]){
    const pipe=h*2+(mask===5?1:0);send(O.PIPELINE_CREATE,[pipe,h,language?h+1:h,3,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,0,0,0,0,4,...Array.from({length:4},()=>[0,0,1,0,0,1,0,0,mask]).flat()]);
    send(O.PASS_BEGIN,[4,0,0,0,0,0x3f800000,0,...[1,2,3,4].flatMap(t=>[t,0,1,0x3f800000,0,0,0x3f800000])]);send(O.PIPELINE,[pipe]);send(O.DRAW,[3,1,0,0]);send(O.PASS_END,[]);
    for(let t=1;t<=4;t++)pixels.push(await read(t));
   }
   if(language){
    const empty=20+language;await compile(empty,2,language,version+'\nvoid main(){}');
    send(O.PIPELINE_CREATE,[empty,h,empty,3,0,0,6,0,1,7,0,255,255,7,0,0,0,7,0,0,0,0,0,0,0,0]);
    send(O.PASS_BEGIN,[0,5,0,1,0,0x3f800000,0]);send(O.PIPELINE,[empty]);send(O.DRAW,[3,1,0,0]);send(O.PASS_END,[]);depths.push(await read(5));
   }
  }
  if(device){await device.queue.onSubmittedWorkDone();device.destroy();}return {pixels,depths,errors};
 },{backend:backendParam,root:'/@fs'+resolve('bgt')});
 const expected=[[255,0,0,255],[0,255,0,255],[255,0,0,255],[0,0,255,255],[255,0,0,255],[0,0,0,255],[255,0,0,255],[0,0,255,255]];
 expect(result.depths).toEqual([[0,0,0,63],[0,0,0,63]]);expect(result.errors).toEqual([]);expect(result.pixels).toEqual(Array.from({length:backendParam==='webgpu'?3:2},()=>expected).flat());
});
