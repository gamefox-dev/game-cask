// Original CC0-1.0. Frozen old limits until explicit per-host opt-in; no rendering claim.
import {beforeAll,expect,it} from 'vitest';
import {compileC} from '../support/compile';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
import * as A from '../../bgt/runtime/abi';
import {CommandEncoder} from '../../bgt/runtime/commands';
let wasm:WebAssembly.Module,old:WebAssembly.Module;
beforeAll(async()=>{wasm=await WebAssembly.compile(await compileC('tests/fixtures/c/gpu_buffer_handles_probe.c'));old=await WebAssembly.compile(await compileC('tests/fixtures/c/gpu_buffer_handles_probe.c',['PROBE_VERSION=0x200']));});
async function host(negotiate:number,supported=true,module=wasm){
 const h=await GameHost.create(module,{log:()=>{},vfs:new Vfs(),now:()=>0},{backend:3,caps:A.CAP_GPU|A.CAP_GPU_BUFFER_HANDLES,gpuBudgetBytes:16*1024*1024,seed:1,displayWidth:64,displayHeight:64,arg0:negotiate,arg1:0,gpuBackend:{languages:7,bufferHandles:supported,execute:()=>0}});
 h.init();return h;
}
const create=(h:GameHost,id:number,size=4)=>h.submitExternal(new CommandEncoder().gpu(A.GPU_OP.BUFFER_CREATE,[id,15,size,0,0]).finish());
it.each([false,true])('advertisement alone never raises the buffer limit, supported=%s',async supported=>{
 const h=await host(0,supported),words=new Uint32Array(h.peek(0,16)!.buffer);
 expect(!!(words[0]&A.CAP_GPU_BUFFER_HANDLES)).toBe(supported);expect(words[1]).toBe(0xdeadbeef);expect(words[2]).toBe(A.CAP_GPU_BUFFER_HANDLES);expect(A.CAP_GPU_BUFFER_HANDLES).toBe(1<<14);
 expect(create(h,1023).status).toBe(0);expect(create(h,1024).status).toBe(A.E_INVALID);expect(create(h,0xffffffff).status).toBe(A.E_INVALID);
});
it('negotiation is per-host, capability-gated, idempotent, and v0.2 stays frozen',async()=>{
 const unsupported=await host(1,false),legacy=await host(1,true,old),enabled=await host(1),other=await host(0);
 for(const h of [unsupported,legacy]){const w=new Uint32Array(h.peek(0,16)!.buffer);expect(w[0]&A.CAP_GPU_BUFFER_HANDLES).toBe(0);expect(w[1]|0).toBe(A.E_UNSUPPORTED);expect(create(h,1024).status).toBe(A.E_INVALID);}
 enabled.init();expect(new Uint32Array(enabled.peek(0,16)!.buffer)[1]).toBe(0);
 expect(create(enabled,0).status).toBe(A.E_INVALID);expect(create(enabled,0xffffffff).status).toBe(0);expect(create(enabled,0xffffffff).status).toBe(A.E_STATE);
 expect(create(other,1024).status).toBe(A.E_INVALID);
 for(const [op,words] of [[A.GPU_OP.TEXTURE_CREATE,[1024,1,1,1,0,1]],[A.GPU_OP.SAMPLER_CREATE,[1024,0,0,0,0,0,0,7]],[A.GPU_OP.SHADER_CREATE,[1024,1,0,0,0,1]]] as const)
  expect(enabled.submitExternal(new CommandEncoder().gpu(op,[...words]).finish()).status).toBe(A.E_INVALID);
});
it('negotiation inside a pass fails without changing the old limit',async()=>{
 const h=await host(0);
 // Unit-only pass-state injection; submit normally closes a pass before returning to wasm.
 // The actual wasm import must still reject this state and leave negotiation unchanged.
 const gpu=(h as unknown as {gpu:{pass?:unknown}}).gpu;
 gpu.pass={};h.update();expect(new Uint32Array(h.peek(0,16)!.buffer)[3]|0).toBe(A.E_STATE);gpu.pass=undefined;
 expect(create(h,1024).status).toBe(A.E_INVALID);h.update();expect(new Uint32Array(h.peek(0,16)!.buffer)[3]).toBe(0);expect(create(h,1024).status).toBe(0);
});
it('12,000+ distinct full-u32 IDs, ordered churn and existing real byte-budget failures',async()=>{
 const h=await host(1),O=A.GPU_OP;
 for(let cycle=0;cycle<3;cycle++){
  const createAll=new CommandEncoder();for(let i=0;i<12000;i++)createAll.gpu(O.BUFFER_CREATE,[0xffff0000+i,15,4,0,0]);
  expect(h.submitExternal(createAll.finish()).errors).toEqual([]);h.consume();
  const del=new CommandEncoder();for(let i=0;i<12000;i++)del.gpu(O.BUFFER_DELETE,[0xffff0000+i]);
  expect(h.submitExternal(del.finish()).errors).toEqual([]);h.consume();
 }
 for(let i=0;i<4;i++)expect(create(h,1024+i,4*1024*1024).status).toBe(0);
 expect(create(h,60000).status).toBe(A.E_LIMIT);
 expect(h.submitExternal(new CommandEncoder().gpu(O.BUFFER_DELETE,[1024]).finish()).status).toBe(0);
 expect(create(h,60000).status).toBe(0);
});
it('backend replacement clears the opt-in and recalculates support',async()=>{
 const h=await host(1);h.consume();h.setBackend(2,{languages:7,bufferHandles:true,execute:()=>0});
 expect(create(h,1024).status).toBe(A.E_INVALID);h.init();expect(create(h,1024).status).toBe(0);
});
