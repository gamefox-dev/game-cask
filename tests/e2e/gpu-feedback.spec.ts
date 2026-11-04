// Original CC0 shader fixtures. Native backend regressions; no target/captured sources.
import {resolve} from 'node:path';
import {test,expect,openGame,assertBackend} from './fixtures';
import {feedbackExpressionSource,feedbackExpressionBytes} from '../support/glsl-feedback-regression';
test('GPU feedback preserves integer, aggregate, lazy and copy-out expressions', async ({page,backendParam,collector},info) => {
  void collector;
  expect(await openGame(page,backendParam,{game:'gpu-scenes'})).toBe('ready');
  await assertBackend(page,backendParam,info);
  const captures = await page.evaluate(async ({backend,root,sources}) => {
    const {GPU_OP:O} = await import(root+'/runtime/abi.ts');
    const {WebGL2Gpu} = await import(root+'/renderers/webgl2/gpu.ts');
    const {WebGPUCommands} = await import(root+'/renderers/webgpu/gpu.ts');
    const errors:string[] = [], canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const gl = backend === 'webgl2' ? canvas.getContext('webgl2')! : undefined;
    const adapter = backend === 'webgpu' ? await navigator.gpu.requestAdapter() : undefined;
    const device = adapter ? await adapter.requestDevice() : undefined;
    if (device) device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const gpu = gl ? new WebGL2Gpu(gl,(e:string)=>errors.push(e)) : new WebGPUCommands(device!,(e:string)=>errors.push(e));
    const send = (op:number,words:number[],extra:Record<string,unknown>={}) => {
      const code = gpu.execute({kind:'gpu',op,words,...extra});
      if (code) throw new Error(`GPU opcode ${op}: ${code}`);
    };
    const compile = (h:number,stage:number,language:number,source:string) => new Promise<void>((resolve,reject) => {
      send(O.SHADER_CREATE,[h,stage,language,0,source.length,h],{source,complete:(code:number,log:string)=>code?reject(new Error(log)):resolve()});
    });
    const read = (handle:number,size:number) => new Promise<number[]>((resolve,reject) => {
      send(O.BUFFER_READBACK,[handle,0,size,10],{readback:(data:Uint8Array|undefined,error:number)=>error?reject(new Error(String(error))):resolve([...data!])});
    });
    const captures:number[][][] = [];
    try {
      send(O.TEXTURE_CREATE,[1,16,16,1,0,3]);
      for (const [i,source] of sources.entries()) {
        const language = i+1, vs = i*2+1, fs = vs+1;
        await compile(vs,1,language,source);
        const version = language === 1 ? '#version 330 core' : '#version 300 es\nprecision highp float;';
        await compile(fs,2,language,version+'\nlayout(location=0) out vec4 c;void main(){c=vec4(1.0);}');
        for (const separate of [false,true]) {
          const h = i*2+(separate?2:1);
          send(O.PIPELINE_CREATE,[h,vs,fs,0,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,0,0,0,0,1,0,0,1,0,0,1,0,0,15]);
          const names = 'ref 12\nsignedValue 6\nvalues 3\n';
          send(O.FEEDBACK_VARYINGS,[h,Number(separate),3,0,names.length],{source:names});
          const sizes = separate ? [128,64,128] : [320];
          const capture = [1,...sizes.flatMap((size,j)=>[h*3+j,0,size])];
          while (capture.length < 13) capture.push(0);
          sizes.forEach((size,j)=>send(O.BUFFER_CREATE,[h*3+j,8,size,0,0]));
          send(O.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,1,0,0,0,0,0,0]);
          send(O.PIPELINE,[h]); send(O.FEEDBACK_CAPTURE,capture);
          send(O.DRAW,[4,2,0,0]); send(O.PASS_END,[]);
          const buffers:number[][] = [];
          for (const [j,size] of sizes.entries()) buffers.push(await read(h*3+j,size));
          captures.push(buffers);
        }
      }
      if (device) await device.queue.onSubmittedWorkDone();
      if (errors.length) throw new Error(errors.join('\n'));
      return captures;
    } finally { if (device) device.destroy(); }
  }, {backend:backendParam,root:'/@fs'+resolve('bgt'),sources:[feedbackExpressionSource(1),feedbackExpressionSource(2)]});
  // Two languages x interleaved/separate, eight invocations each. All bytes, including high integer bits.
  expect(captures).toHaveLength(4);
  expect(captures).toEqual([feedbackExpressionBytes(false),feedbackExpressionBytes(true),feedbackExpressionBytes(false),feedbackExpressionBytes(true)]);
});

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
    await compile(1,1,'#version 330 core\nlayout(location=0) in vec4 bytes;out vec4 result;out vec4 alternate;void main(){result=bytes;alternate=vec4(0.75);gl_Position=vec4(0.0,0.0,0.0,1.0);}');
    await compile(2,2,'#version 330 core\nlayout(location=0) out vec4 c;void main(){c=vec4(1.0,0.0,0.0,1.0);}');
    send(O.PIPELINE_CREATE,pipe(1,1,0,true));const names='result 3\n';send(O.FEEDBACK_VARYINGS,[1,0,1,0,names.length],{source:names});
    send(O.BUFFER_CREATE,[1,1,5,0,5],{data:new Uint8Array([0xee,0,255,0,255])});send(O.BUFFER_CREATE,[2,9,64,0,0]);
    const capture=()=>{begin();send(O.PIPELINE,[1]);send(O.VERTEX_BUFFER,[0,1,0,5]);send(O.FEEDBACK_CAPTURE,[1,2,0,64,0,0,0,0,0,0,0,0,0]);send(O.DRAW,[1,1,0,0]);send(O.PASS_END,[]);};
    capture();const normalized=await read(2,0,16),oddRead=await read(2,1,7);
    let replacementRejected=true,cleanup=true;
    const nativeReplacements: {code:number; retained:boolean; deletedOld:boolean; bytes:number[]}[]=[];
    let retryRetained=true;
    if(gl){
      // Direct backend defense: a failed candidate must leave its old native program/interface alive.
      for(const wrong of ['result 0\n','missing 3\n']){
        replacementRejected &&= send(O.FEEDBACK_VARYINGS,[1,0,1,0,wrong.length],{source:wrong})!==0;
        errors.splice(0);capture();if(errors.length)replacementRejected=false;
      }
      const state=gpu as unknown as {pipelines:Map<number,{object:WebGLProgram;vao:WebGLVertexArrayObject}>;feedback:Map<number,unknown>;capture?:readonly number[]};
      for(const mode of ['null','null-error','native-error']){
        const old=state.pipelines.get(1)!,layout=state.feedback.get(1);let deletedOld=false,inject=false;
        const create=gl.createVertexArray.bind(gl),getError=gl.getError.bind(gl),deleteProgram=gl.deleteProgram.bind(gl),deleteVAO=gl.deleteVertexArray.bind(gl);
        // lib.dom types this allocation as non-null; inject the actual native OOM result.
        gl.createVertexArray=(()=>{inject=mode!=='null';return mode==='native-error'?create():null;}) as typeof gl.createVertexArray;
        gl.getError=()=>{if(inject){inject=false;return gl.OUT_OF_MEMORY;}return getError();};
        gl.deleteProgram=p=>{if(p===old.object)deletedOld=true;deleteProgram(p);};
        gl.deleteVertexArray=v=>{if(v===old.vao)deletedOld=true;deleteVAO(v);};
        const candidate='alternate 3\n';let code:number;
        try{code=send(O.FEEDBACK_VARYINGS,[1,0,1,0,candidate.length],{source:candidate});}
        finally{gl.createVertexArray=create;gl.getError=getError;gl.deleteProgram=deleteProgram;gl.deleteVertexArray=deleteVAO;}
        const retained=state.pipelines.get(1)===old&&state.feedback.get(1)===layout;
        if(errors.length!==1)throw Error('Expected one native replacement diagnostic');errors.splice(0);
        capture();nativeReplacements.push({code,retained,deletedOld,bytes:await read(2,0,16)});
      }
      send(O.BUFFER_UPDATE,[2,0,0,64],{data:new Uint8Array(64)});
      begin();send(O.PIPELINE,[1]);send(O.VERTEX_BUFFER,[0,1,0,5]);send(O.FEEDBACK_CAPTURE,[1,2,0,64,0,0,0,0,0,0,0,0,0]);
      const armed=state.capture,original=gl.beginTransformFeedback.bind(gl);
      gl.beginTransformFeedback=()=>original(0xffffffff);
      const rejected=send(O.DRAW,[1,1,0,0]);gl.beginTransformFeedback=original;
      cleanup=!gl.isEnabled(gl.RASTERIZER_DISCARD)&&gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING)===null&&errors.length===1;
      retryRetained=rejected===-6&&state.capture===armed;
      errors.splice(0);send(O.DRAW,[1,1,0,0]);send(O.PASS_END,[]);
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
    if(device)device.destroy();return {normalized,oddRead,retained,replacementRejected,cleanup,retryRetained,nativeReplacements,restoreRejected,last,errors};
  },{backend:backendParam,root:'/@fs'+resolve('bgt')});
  expect(result.errors).toEqual([]);expect(result.replacementRejected).toBe(true);expect(result.cleanup).toBe(true);expect(result.restoreRejected).toBe(true);
  const expected=[...new Uint8Array(new Float32Array([0,1,0,1]).buffer)];expect(result.normalized).toEqual(expected);expect(result.oddRead).toEqual(expected.slice(1,8));expect(result.retained).toEqual(expected);
  expect(result.retryRetained).toBe(true);
  expect(result.nativeReplacements).toEqual(backendParam==='webgl2'?Array.from({length:3},()=>({code:-6,retained:true,deletedOld:false,bytes:expected})):[]);
  expect(result.last).toEqual([...new Uint8Array(new Float32Array([1399998,1399997,1399999]).buffer)]);
});
