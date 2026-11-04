// Original CC0-1.0. Both real backends: every one of 12,000 full-u32 buffers copied and read natively.
import {resolve} from 'node:path';
import {test,expect,openGame,assertBackend} from './fixtures';
test('12,000 full-u32 native buffer IDs, all-byte copy/readback and three churn generations',async({page,backendParam,collector},info)=>{
 void collector;test.setTimeout(300000);
 expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready');await assertBackend(page,backendParam,info);
 const result=await page.evaluate(async({backend,root})=>{
  const {GPU_OP:O}=await import(root+'/runtime/abi.ts');const {WebGL2Gpu}=await import(root+'/renderers/webgl2/gpu.ts');const {WebGPUCommands}=await import(root+'/renderers/webgpu/gpu.ts');
  const errors:string[]=[],canvas=document.createElement('canvas'),gl=backend==='webgl2'?canvas.getContext('webgl2')!:undefined;
  const adapter=backend==='webgpu'?await navigator.gpu.requestAdapter():undefined,device=adapter?await adapter.requestDevice():undefined;
  device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const gpu=gl?new WebGL2Gpu(gl,(e:string)=>errors.push(e)):new WebGPUCommands(device!,(e:string)=>errors.push(e));
  const send=(op:number,words:number[],extra:Record<string,unknown>={})=>{const rc=gpu.execute({kind:'gpu',op,words,...extra});if(rc)throw new Error(op+': '+rc);};
  const count=12000,dst=0xffffffff;let checked=0;
  for(let cycle=0;cycle<3;cycle++){
   send(O.BUFFER_CREATE,[dst,15,count*4,0,0]);
   for(let i=0;i<count;i++){
    const id=0xffff0000+i,data=new Uint8Array(new Uint32Array([cycle*count+i+1]).buffer);
    send(O.BUFFER_CREATE,[id,15,4,0,4],{data});
   }
   for(let i=0;i<count;i++)send(O.BUFFER_COPY,[0xffff0000+i,0,dst,i*4,4]);
   const bytes=await new Promise<Uint8Array>((resolve,reject)=>send(O.BUFFER_READBACK,[dst,0,count*4,1],{readback:(data:Uint8Array|undefined,error:number)=>error?reject(new Error(String(error))):resolve(data!)}));
   const values=new Uint32Array(bytes.buffer,bytes.byteOffset,count);
   for(let i=0;i<count;i++){if(values[i]!==cycle*count+i+1)throw new Error('native data mismatch '+cycle+':'+i);checked++;}
   for(let i=0;i<count;i++)send(O.BUFFER_DELETE,[0xffff0000+i]);send(O.BUFFER_DELETE,[dst]);
  }
  if(device){await device.queue.onSubmittedWorkDone();device.destroy();}
  return {checked,errors,supported:gpu.bufferHandles};
 },{backend:backendParam,root:'/@fs'+resolve('bgt')});
 expect(result).toEqual({checked:36000,errors:[],supported:true});
});
