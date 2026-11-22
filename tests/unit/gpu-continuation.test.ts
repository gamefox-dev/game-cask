import {it,expect} from 'vitest';
import * as A from '../../bgt/runtime/abi';
import {CommandEncoder,Frame,TextureTable,defaultState,decodeCommands,type DecodeContext} from '../../bgt/runtime/commands';
import {GpuState} from '../../bgt/runtime/commands-gpu';
const ctx=():DecodeContext=>({state:defaultState(16,16),frame:new Frame(),textures:new TextureTable(),linearFilter:true,triangles:true,gpu:new GpuState({languages:7,execute:()=>0})});
const submit=(c:DecodeContext,b:Uint8Array)=>decodeCommands(b,0,b.length,c);
const list=(op:number,w:number[]=[])=>new CommandEncoder().gpu(op,w).finish(A.CMD_GPU_CONTINUATION);
it('continues thousands of lists in exact item order, copies upload bytes, and resets budgets',()=>{
 const c=ctx(),O=A.GPU_OP;expect(submit(c,list(O.BUFFER_CREATE,[1,1,16,0,0])).status).toBe(0);
 for(let i=0;i<4096;i++){
  const b=list(O.BUFFER_UPDATE,[1,0,0,4]);const code=submit(c,b);expect(code.status).toBe(0);b.fill(0);
 }
 expect(c.frame.items).toHaveLength(4097);expect(c.frame.submits).toBe(4097);expect(c.frame.continuationSubmits).toBe(4097);
 expect(c.frame.items.every(i=>i.kind==='gpu')).toBe(true);
 expect(c.frame.items.slice(1).every(i=>i.kind==='gpu'&&i.op===O.BUFFER_UPDATE&&i.data?.[0]===0x42)).toBe(true);
 c.frame.reset(16,16);expect([c.frame.commandBytes,c.frame.commandCount,c.frame.submits,c.frame.continuationSubmits]).toEqual([0,0,0,0]);
});
it('atomically rejects non-GPU lists, unknown flags, unsupported backends and malformed framing',()=>{
 const c=ctx(),before=c.frame.items.length;
 expect(submit(c,new CommandEncoder().gpu(A.GPU_OP.BUFFER_CREATE,[1,1,16,0,0]).clear(0).finish(1)).status).toBe(A.E_UNSUPPORTED);
 expect(c.gpu!.buffers.size).toBe(0);expect(c.frame.items).toHaveLength(before);
 const malformed=list(A.GPU_OP.BUFFER_CREATE,[1,1,16,0,0]);new DataView(malformed.buffer).setUint32(20,4000,true);
 expect(submit(c,malformed).status).toBe(A.E_BOUNDS);expect(c.gpu!.buffers.size).toBe(0);expect(c.frame.submits).toBe(0);
 expect(submit(c,list(A.GPU_OP.PASS_END)).status).toBe(A.E_STATE); // semantic errors keep the ordinary contract
 expect(submit(c,new CommandEncoder().finish(2)).status).toBe(A.E_UNSUPPORTED);
 delete c.gpu;expect(submit(c,new CommandEncoder().finish(1)).status).toBe(A.E_UNSUPPORTED);
});
it('enforces exact aggregate byte and command ceilings including mixed legacy lists; rejection has no effects',()=>{
 for(const budget of ['bytes','commands'] as const){
  const c=ctx(),b=new CommandEncoder().finish(1);
  if(budget==='bytes')c.frame.commandBytes=A.GPU_CONTINUATION_LIMITS.bytes-b.length;
  else c.frame.commandCount=A.GPU_CONTINUATION_LIMITS.commands;
  expect(submit(c,b).status).toBe(0);
  const bad=budget==='bytes'?b:list(A.GPU_OP.BUFFER_CREATE,[1,1,16,0,0]);
  const old=[c.frame.commandBytes,c.frame.commandCount,c.frame.submits,c.frame.items.length];
  expect(submit(c,bad).status).toBe(A.E_LIMIT);expect([c.frame.commandBytes,c.frame.commandCount,c.frame.submits,c.frame.items.length]).toEqual(old);
  expect(c.gpu!.buffers.size).toBe(0);
  if(budget==='bytes')expect(submit(c,new CommandEncoder().clear(0).finish()).status).toBe(A.E_LIMIT);
 }
});
it('legacy allowance is independent and cannot be reset by continuation, nor can passes cross lists',()=>{
 const c=ctx();for(let i=0;i<256;i++)expect(submit(c,new CommandEncoder().finish()).status).toBe(0);
 expect(submit(c,new CommandEncoder().finish()).status).toBe(A.E_LIMIT);
 expect(submit(c,new CommandEncoder().finish(1)).status).toBe(0);
 expect(submit(c,new CommandEncoder().finish()).status).toBe(A.E_LIMIT);
 const b=list(A.GPU_OP.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,0,0,0,0,0,0,0]);expect(submit(c,b).status).toBe(A.E_STATE);expect(c.gpu!.pass).toBeUndefined();
});
it('K57: IF_HEAD commands run only after a successful unflagged head; per-command failures report offsets, whole rejections do not',()=>{
 const c=ctx(),O=A.GPU_OP;
 // Encoded lists: [head, flagged, flagged]; flag the 2nd and 3rd command prefixes (u16 at prefix+2).
 const flagged=(enc:CommandEncoder,cont=true)=>{const b=enc.finish(cont?A.CMD_GPU_CONTINUATION:0),dv=new DataView(b.buffer);
  let off=16;for(let i=0;off<b.length;i++){const n=dv.getUint32(off+4,true);if(i)dv.setUint16(off+2,A.CMD_FLAG_IF_HEAD,true);off+=8+n;}return b;};
 // Failed head (unknown handle): both dependents are skipped, reported as failures at their offsets.
 const r=submit(c,flagged(new CommandEncoder().gpu(O.BUFFER_UPDATE,[9,0,0,4]).gpu(O.BUFFER_CREATE,[1,1,16,0,0]).gpu(O.BUFFER_DELETE,[1])));
 expect(r.whole).toBeUndefined();expect(r.executed).toBe(0);expect(r.errors.map(e=>e.code)).toEqual([A.E_NOT_FOUND,A.E_STATE,A.E_STATE]);
 expect(r.errors.map(e=>e.offset)).toEqual([16,40,68]);expect(c.gpu!.buffers.size).toBe(0);
 // Successful head: dependents run; a failing dependent does not affect the next one (same head).
 const ok=submit(c,flagged(new CommandEncoder().gpu(O.BUFFER_CREATE,[1,1,16,0,0]).gpu(O.BUFFER_UPDATE,[1,0,0,64]).gpu(O.BUFFER_UPDATE,[1,0,0,4])));
 expect(ok.executed).toBe(2);expect(ok.errors.map(e=>e.code)).toEqual([A.E_BOUNDS]);expect(c.gpu!.buffers.has(1)).toBe(true);
 // The flag is unsupported outside continuation lists; framing failures are whole rejections.
 expect(submit(c,flagged(new CommandEncoder().clear(0).clear(0),false)).errors.map(e=>e.code)).toEqual([A.E_UNSUPPORTED]);
 expect(submit(c,new CommandEncoder().gpu(O.BUFFER_CREATE,[2,1,16,0,0]).clear(0).finish(1)).whole).toBe(true);
});
