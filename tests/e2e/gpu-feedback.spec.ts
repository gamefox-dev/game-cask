// Original CC0 shader fixtures. Native backend regressions; no target/captured sources.
import {resolve} from 'node:path';
import {test,expect,openGame,assertBackend} from './fixtures';
test('GPU feedback: odd-byte input, atomic replacement, setup cleanup, expanded dispatch and loss contract',async({page,backendParam,collector},info)=>{
  void collector;expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready');await assertBackend(page,backendParam,info);
  const result=await page.evaluate(async ({backend,root})=>{
    const {GPU_OP:O}=await import(root+'/runtime/abi.ts');
    const {WebGL2Gpu}=await import(root+'/renderers/webgl2/gpu.ts');
    const {WebGPUCommands}=await import(root+'/renderers/webgpu/gpu.ts');
    const errors:string[]=[], canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
    const gl=backend==='webgl2'?canvas.getContext('webgl2')!:undefined;
    const adapter=backend==='webgpu'?await navigator.gpu.requestAdapter():undefined;
    const device=adapter?await adapter.requestDevice():undefined;
    if(device)device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const gpu=gl?new WebGL2Gpu(gl,(e:string)=>errors.push(e)):new WebGPUCommands(device!, (e:string)=>errors.push(e));
    const send=(op:number,words:number[],extra:Record<string,unknown>={})=>gpu.execute({kind:'gpu',op,words,...extra});
    const compile=(h:number,stage:number,source:string)=>new Promise<void>((resolve,reject)=>{
      send(O.SHADER_CREATE,[h,stage,1,0,source.length,h],{source,complete:(code:number,log:string)=>code?reject(new Error(log)):resolve()});
    });
    const read=(h:number,offset:number,size:number)=>new Promise<number[]>((resolve,reject)=>{
      send(O.BUFFER_READBACK,[h,offset,size,10],{readback:(data:Uint8Array|undefined,error:number)=>error?reject(new Error(String(error))):resolve([...data!])});
    });
    const begin=()=>send(O.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,1,0,0,0,0,0,0]);
    const pipe=(h:number,vs:number,topology:number,attrs:boolean)=>[h,vs,2,topology,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,0,0,attrs?1:0,attrs?1:0,1,...(attrs?[8,0,0,0,1,4]:[]),0,0,1,0,0,1,0,0,15];
    send(O.TEXTURE_CREATE,[1,16,16,1,0,3]);
    await compile(1,1,'#version 330 core\nlayout(location=0) in vec4 bytes;out vec4 result;void main(){result=bytes;gl_Position=vec4(0.0,0.0,0.0,1.0);}');
    await compile(2,2,'#version 330 core\nlayout(location=0) out vec4 c;void main(){c=vec4(1.0,0.0,0.0,1.0);}');
    send(O.PIPELINE_CREATE,pipe(1,1,0,true));const names='result 3\n';send(O.FEEDBACK_VARYINGS,[1,0,1,0,names.length],{source:names});
    send(O.BUFFER_CREATE,[1,1,5,0,5],{data:new Uint8Array([0xee,0,255,0,255])});send(O.BUFFER_CREATE,[2,9,64,0,0]);
    const capture=()=>{begin();send(O.PIPELINE,[1]);send(O.VERTEX_BUFFER,[0,1,0,5]);send(O.FEEDBACK_CAPTURE,[1,2,0,64,0,0,0,0,0,0,0,0,0]);send(O.DRAW,[1,1,0,0]);send(O.PASS_END,[]);};
    capture();const normalized=await read(2,0,16),oddRead=await read(2,1,7);
    let replacementRejected=true,cleanup=true;
    if(gl){
      // Direct backend defense: a failed candidate must leave its old native program/interface alive.
      for(const wrong of ['result 0\n','missing 3\n']){
        replacementRejected &&= send(O.FEEDBACK_VARYINGS,[1,0,1,0,wrong.length],{source:wrong})!==0;
        errors.splice(0);capture();if(errors.length)replacementRejected=false;
      }
      const original=gl.beginTransformFeedback.bind(gl);
      gl.beginTransformFeedback=()=>original(0xffffffff);capture();gl.beginTransformFeedback=original;
      cleanup=!gl.isEnabled(gl.RASTERIZER_DISCARD)&&gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING)===null&&errors.length===1;
      errors.splice(0);capture();
    }
    const retained=await read(2,0,16);
    // Captured content is not an upload shadow. Recovery must fail visibly instead of restoring zero data.
    let restoreRejected=false;try{await gpu.restore(device);}catch(e){restoreRejected=String(e).includes('live transform-feedback');}
    // Reuploading the complete buffer reestablishes a recoverable authoritative upload.
    send(O.BUFFER_UPDATE,[2,0,0,64],{data:new Uint8Array(64)});
    if(gl)gpu.restore();else await gpu.restore(device);
    // The expanded strip crosses the 65,535 * 64 one-dimensional dispatch boundary.
    await compile(3,1,'#version 330 core\nout float result;void main(){result=float(bgt_vertex_index);gl_Position=vec4(0.0,0.0,0.0,1.0);}');
    const n=1400000,total=(n-2)*3;send(O.BUFFER_CREATE,[3,8,total*4,0,0]);send(O.PIPELINE_CREATE,pipe(2,3,4,false));
    const scalar='result 0\n';send(O.FEEDBACK_VARYINGS,[2,0,1,0,scalar.length],{source:scalar});begin();send(O.PIPELINE,[2]);send(O.FEEDBACK_CAPTURE,[1,3,0,total*4,0,0,0,0,0,0,0,0,0]);send(O.DRAW,[n,1,0,0]);send(O.PASS_END,[]);
    const last=await read(3,(total-3)*4,12);if(device)await device.queue.onSubmittedWorkDone();
    if(device)device.destroy();return {normalized,oddRead,retained,replacementRejected,cleanup,restoreRejected,last,errors};
  },{backend:backendParam,root:'/@fs'+resolve('bgt')});
  expect(result.errors).toEqual([]);expect(result.replacementRejected).toBe(true);expect(result.cleanup).toBe(true);expect(result.restoreRejected).toBe(true);
  const expected=[...new Uint8Array(new Float32Array([0,1,0,1]).buffer)];expect(result.normalized).toEqual(expected);expect(result.oddRead).toEqual(expected.slice(1,8));expect(result.retained).toEqual(expected);
  expect(result.last).toEqual([...new Uint8Array(new Float32Array([1399998,1399997,1399999]).buffer)]);
});
