import {it,expect} from 'vitest';
import { compileC } from '../support/compile';
import { GameHost } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { Requests } from '../../bgt/runtime/requests';
import {E_LIMIT,E_NOT_FOUND,E_STATE,E_UNSUPPORTED,E_INVALID} from '../../bgt/runtime/abi';
import {CommandEncoder,Frame,TextureTable,defaultState,decodeCommands} from '../../bgt/runtime/commands';

it('the v0.3 host still boots, updates and renders an explicitly v0.2 module unchanged', async()=>{
 const h=await GameHost.create(await compileC('tests/fixtures/c/legacy_v02.c'),{log:()=>{},vfs:new Vfs(),now:()=>0},{backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0});
 h.init();h.update();h.render(); expect(h.stateHash()).toBe('00000001');expect(h.commandErrorCount).toBe(0);
});

it('request results have bounded lifetimes, update-boundary visibility and cancellation-safe completion',()=>{
 const q=new Requests(), t=q.reserve(77); if(typeof t==='number') throw new Error('reserve failed');
 q.complete(t,new Uint8Array([1,2,3]));
 expect(q.status(77)).toBe(0); expect(q.read(77,new Uint8Array(3))).toBe(E_STATE);
 q.advance(); expect(q.status(77)).toBe(1); expect(q.read(77,new Uint8Array(2))).toBe(E_LIMIT);
 const dst=new Uint8Array(3); expect(q.read(77,dst)).toBe(3); expect([...dst]).toEqual([1,2,3]);
 expect(q.reserve(77)).toBe(E_STATE); q.close(77); const next=q.reserve(77); if(typeof next==='number') throw new Error('reserve failed');
 q.complete(t,new Uint8Array([9])); expect(q.status(77)).toBe(0); q.close(77); expect(q.status(77)).toBe(E_NOT_FOUND);
 for(let i=0;i<32;i++) expect(typeof q.reserve()).toBe('object'); expect(q.reserve()).toBe(E_LIMIT);
});

it('readback commands validate capabilities, handles, size and malformed framing before reserving requests',()=>{
 const frame=new Frame();frame.reset(64,64); const q=new Requests();
 const ctx={state:defaultState(64,64),frame,textures:new TextureTable(),linearFilter:true,triangles:true};
 const commands=new CommandEncoder().readback(7,0,0,0,2,2).finish();
 expect(decodeCommands(commands,0,commands.length,ctx).status).toBe(E_UNSUPPORTED);
 const c={...ctx,readback:(id:number)=>{ const t=q.reserve(id); return typeof t==='number'?t:(d?:Uint8Array<ArrayBuffer>)=>q.complete(t,d); }};
 const bad=commands.slice();new DataView(bad.buffer).setUint32(8,bad.length+4,true);
 expect(decodeCommands(bad,0,bad.length,c).status).toBe(E_INVALID); expect(q.status(7)).toBe(E_NOT_FOUND);
 expect(decodeCommands(commands,0,commands.length,c).status).toBe(0); expect(frame.items[0].kind).toBe('readback');
 expect(decodeCommands(commands,0,commands.length,c).status).toBe(E_STATE);
});

// K70 (Q126). Breakage caught: a page-loop burst that cannot tell which unresolved result the guest is polling
// (renderer results resolve outside host I/O work), a waiter that never settles on completion/close, and a result
// that already arrived (visible at the next update) being reported as still awaited.
it('requests expose the unresolved result the last poll found, and settle waiters on completion or close',async()=>{
 const q=new Requests(), t=q.reserve(5), u=q.reserve(6); if(typeof t==='number'||typeof u==='number') throw new Error('reserve failed');
 q.advance(); expect(q.awaited()).toBeNull();
 expect(q.status(5)).toBe(0); expect(q.awaited()).toBe(t);
 let woke=0; const w=q.whenDone(t).then(()=>{woke++;});
 await Promise.resolve(); expect(woke).toBe(0);
 q.complete(t,new Uint8Array([1])); await w; expect(woke).toBe(1);
 expect(q.awaited()).toBeNull(); // arrived: the next update sees it, nothing to wait for
 q.advance(); expect(q.awaited()).toBeNull(); expect(q.status(5)).toBe(1);
 // Done in the same update it was polled: visible next update, not awaited.
 const r=q.reserve(7); if(typeof r==='number') throw new Error('reserve failed'); q.complete(r,new Uint8Array([2]));
 expect(q.status(7)).toBe(0); expect(q.awaited()).toBeNull();
 // A closed (cancelled) request releases its waiters and is never awaited.
 q.advance(); expect(q.status(6)).toBe(0); expect(q.awaited()).toBe(u);
 const c=q.whenDone(u); q.close(6); await c; expect(q.awaited()).toBeNull();
 await q.whenDone(u); // stale token: settled at once
 // advance() clears the poll: a request nobody polled this update is not a reason to wait.
 const v=q.reserve(8); if(typeof v==='number') throw new Error('reserve failed');
 q.advance(); expect(q.status(8)).toBe(0); q.advance(); expect(q.awaited()).toBeNull();
});
