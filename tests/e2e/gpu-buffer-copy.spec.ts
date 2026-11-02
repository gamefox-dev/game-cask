// SPDX-License-Identifier: CC0-1.0. Original byte-copy known answers, actual native readback.
import {resolve} from 'node:path';
import {test,expect,openGame,assertBackend} from './fixtures';
test('GPU byte copies preserve all surrounding bytes for every alignment and same-buffer nonoverlap',async({page,backendParam,collector},info)=>{
 void collector;expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready');await assertBackend(page,backendParam,info);
 const result=await page.evaluate(async({backend,root})=>{
  const {GPU_OP:O}=await import(root+'/runtime/abi.ts');const {WebGL2Gpu}=await import(root+'/renderers/webgl2/gpu.ts');const {WebGPUCommands}=await import(root+'/renderers/webgpu/gpu.ts');
  const errors:string[]=[],canvas=document.createElement('canvas');const gl=backend==='webgl2'?canvas.getContext('webgl2')!:undefined;
  const adapter=backend==='webgpu'?await navigator.gpu.requestAdapter():undefined,device=adapter?await adapter.requestDevice():undefined;
  device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));const gpu=gl?new WebGL2Gpu(gl,(e:string)=>errors.push(e)):new WebGPUCommands(device!,(e:string)=>errors.push(e));
  const send=(op:number,words:number[],extra:Record<string,unknown>={})=>{const code=gpu.execute({kind:'gpu',op,words,...extra});if(code)throw new Error(`${op}: ${code}`);};
  const initial=Uint8Array.from({length:63},(_,i)=>i*3+1),base=new Uint8Array(63).fill(0xab);let checks=0;
  send(O.BUFFER_CREATE,[1,15,63,0,63],{data:initial});send(O.BUFFER_CREATE,[2,15,63,0,63],{data:base});
  const read=()=>new Promise<Uint8Array>((resolve,reject)=>send(O.BUFFER_READBACK,[2,0,63,10],{readback:(data:Uint8Array|undefined,error:number)=>error?reject(new Error(String(error))):resolve(data!)}));
  for(const same of [false,true])for(let s=0;s<4;s++)for(let d=0;d<4;d++)for(let n=1;n<=9;n++){
    send(O.BUFFER_UPDATE,[2,0,0,63],{data:same?initial:base});const expected=new Uint8Array(same?initial:base);
    expected.set(initial.slice(s,s+n),d+32);send(O.BUFFER_COPY,[same?2:1,s,2,d+32,n]);
    const actual=await read();if(actual.some((v,i)=>v!==expected[i]))throw new Error(`copy ${same},${s},${d},${n}`);checks++;
  }
  // Full tail through a non-four-byte native allocation boundary.
  send(O.BUFFER_COPY,[1,0,2,0,63]);const actual=await read();if(actual.some((v,i)=>v!==initial[i]))throw new Error('full odd length');checks++;
  if(device){await device.queue.onSubmittedWorkDone();device.destroy();}return {checks,errors};
 },{backend:backendParam,root:'/@fs'+resolve('bgt')});
 expect(result.checks).toBe(289);expect(result.errors).toEqual([]);
});
