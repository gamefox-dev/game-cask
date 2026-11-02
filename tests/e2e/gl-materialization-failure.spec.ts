// @bgt-examples: x64-gl-ranges
// SPDX-License-Identifier: CC0-1.0. Actual profile fault injection; no private runtime test-API writes.
import {resolve} from 'node:path';
import {test,expect,openGame,assertBackend} from './fixtures';
test('partial two-block materialization retires generated private UBOs after upload/wire limits and recovery succeeds',async({page,backendParam,collector},info)=>{
 void collector;expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready');await assertBackend(page,backendParam,info);
 const result=await page.evaluate(async({backend,root})=>{
  const A=await import(root+'/runtime/abi.ts');const {GameHost,emptyInput}=await import(root+'/runtime/host.ts');const {Vfs}=await import(root+'/runtime/vfs.ts');
  const {WebGL2Gpu}=await import(root+'/renderers/webgl2/gpu.ts');const {WebGPUCommands}=await import(root+'/renderers/webgpu/gpu.ts');
  const manifest=await (await fetch('/games/x64-gl-ranges/manifest.json')).json();const wasm=await (await fetch('/games/x64-gl-ranges/game.wasm')).arrayBuffer();
  const results=[];
  for(const mode of ['upload','wire','uniform']){
    const vfs=new Vfs();for(const a of manifest.assets)vfs.add(a.path,new Uint8Array(await (await fetch('/games/x64-gl-ranges/assets/'+a.path)).arrayBuffer()));
    const errors:string[]=[],logs:string[]=[],canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
    const gl=backend==='webgl2'?canvas.getContext('webgl2',{antialias:false})!:undefined;
    const adapter=backend==='webgpu'?await navigator.gpu.requestAdapter():undefined,device=adapter?await adapter.requestDevice():undefined;
    device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const gpu=gl?new WebGL2Gpu(gl,(e:string)=>errors.push(e)):new WebGPUCommands(device!,(e:string)=>errors.push(e));
    const screen=device?.createTexture({size:[320,200],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
    if(screen)(gpu as InstanceType<typeof WebGPUCommands>).frame(screen);else(gpu as InstanceType<typeof WebGL2Gpu>).beginFrame(320,200,{x:0,y:0,w:320,h:200,scale:1});
    let injected=false;const ops:{op:number;words:readonly number[]}[]=[];
    const host:InstanceType<typeof GameHost>=await GameHost.create(wasm,{vfs,now:()=>performance.now(),log:(_level:number,message:string)=>{
      logs.push(message);
      if(message.includes('inject partial materialization limit')){
        injected=true;
        if(mode==='upload')host.frame.gpuUploadBytes=A.GPU_LIMITS.budget-64;
        else if(mode==='uniform')host.frame.gpuUploadBytes=A.GPU_LIMITS.budget-392;
        else host.frame.commandBytes=A.GPU_CONTINUATION_LIMITS.bytes-128;
      }
      if(message.includes('inject rejected full upload'))host.frame.gpuUploadBytes=A.GPU_LIMITS.budget;
      if(message.includes('restore materialization budget')){host.frame.gpuUploadBytes=0;host.frame.commandBytes=0;}
    }},{backend:backend==='webgpu'?A.BACKEND_WEBGPU:A.BACKEND_WEBGL2,caps:A.CAP_GPU,gpuBackend:gpu,seed:1,displayWidth:320,displayHeight:200,arg0:0,arg1:0});
    host.init();const input=emptyInput();input.keys[66>>5]|=1<<(66&31); // HID F9: public Windows input selects the fixture branch.
    for(let i=0;i<200&&!logs.some(s=>s.includes('failure case done'));i++){
      host.writeInput(input);host.update();const frame=host.render();
      for(const item of frame.items)if(item.kind==='gpu'){ops.push({op:item.op,words:item.words});const code=gpu.execute(item);if(code)throw new Error(`native ${item.op}: ${code}; words=${item.words}; errors=${errors.join(';')}`);}
      host.consume();if(device)await device.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,0));
    }
    if(!logs.some(s=>s.includes('failure case done')))throw new Error(logs.join('\n'));
    if(gl)(gpu as InstanceType<typeof WebGL2Gpu>).restore();else await (gpu as InstanceType<typeof WebGPUCommands>).restore(device!);
    results.push({mode,injected,logs,errors,deletedScratch:ops.some(i=>i.op===A.GPU_OP.BUFFER_DELETE&&i.words[0]===1000),commandErrors:host.commandErrorCount});
    device?.destroy();
  }
  return results;
 },{backend:backendParam,root:'/@fs'+resolve('bgt')});
 expect(result).toHaveLength(3);
 for(const r of result){expect(r.injected).toBe(true);expect(r.deletedScratch).toBe(true);expect(r.errors).toEqual([]);expect(r.commandErrors).toBeGreaterThan(0);
   expect(r.logs.some(s=>s.includes('ok materialization limit surfaced'))).toBe(true);expect(r.logs.some(s=>s.includes('ok generated app source deleted'))).toBe(true);expect(r.logs.some(s=>s.includes('ok failed full upload retains native prefix'))).toBe(true);expect(r.logs.some(s=>s.includes('ok materialization failure leaves output untouched'))).toBe(true);expect(r.logs.filter(s=>s.includes('x64-gl-ranges FAIL'))).toEqual([]);}
});
