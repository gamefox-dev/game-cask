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

// vK70 review. Breakage caught: a timed-out wait leaking one waiter per tick, a wait on a request polled before a newer
// request (the yield's real cause, e.g. a file read), a checkpoint restore stranding waiters, and a slow polled GPU
// result throttling a file-read loop (each update would wait out the tick budget: ~1 read per tick instead of K66's burst).
it('waiters are deduplicated, released on restore, and never outlive a newer cause',async()=>{
 const q=new Requests(), gpu=q.reserve(40); if(typeof gpu==='number') throw new Error('reserve failed');
 q.advance(); expect(q.status(40)).toBe(0);
 const a=q.whenDone(gpu), b=q.whenDone(gpu); expect(a).toBe(b); for(let i=0;i<100;i++) q.whenDone(gpu); expect(q.waiting).toBe(1);
 // A request issued after the poll is the newer cause: the older GPU poll is not awaited.
 const file=q.reserve(41); if(typeof file==='number') throw new Error('reserve failed'); expect(q.awaited()).toBeNull();
 q.wakeAll(); await a; expect(q.waiting).toBe(0);
});
it('a slow pending GPU result never makes a file-read loop wait (decision of the real GameHost.transportWait)',async()=>{
 const q=new Requests(), io=new Set<Promise<void>>();
 const host={requests:q,ioWork:io,settleRequests:()=>Promise.all([...io]).then(()=>{})};
 const wait=()=>(GameHost.prototype as unknown as {transportWait:(this:typeof host)=>Promise<void>|null}).transportWait.call(host);
 const gpu=q.reserve(1); if(typeof gpu==='number') throw new Error('reserve failed');
 q.advance(); expect(q.status(1)).toBe(0); // polled without blocking, never resolves
 let waits=0;
 for(let read=0;read<200;read++){
  // The guest polls the slow GPU result without blocking (every 10th update), then issues the next ReadFile chunk:
  // a resident range completes at once and is visible next update, so the read's yield must not wait (K66 burst).
  if(read%10===0) expect(q.status(1)).toBe(0);
  const t=q.reserve(); if(typeof t==='number') throw new Error('reserve failed'); q.complete(t,new Uint8Array(16));
  expect(q.status(t.id)).toBe(0); if(wait()) waits++;
  q.advance(); expect(q.status(t.id)).toBe(1); q.close(t.id);
 }
 expect(waits).toBe(0);
 // Polled after the read was issued (and before the yield): that update does wait, bounded by the tick budget.
 const r=q.reserve(); if(typeof r==='number') throw new Error('reserve failed'); q.complete(r,new Uint8Array(1));
 expect(q.status(1)).toBe(0); expect(wait()).not.toBeNull(); q.advance(); q.close(r.id);
 // A pending streamed read races the polled result: the wait ends when the I/O settles.
 let finish!:()=>void; io.add(new Promise<void>(r=>{finish=r;}));
 q.advance(); expect(q.status(1)).toBe(0);
 const w=wait()!; let ended=false; void w.then(()=>{ended=true;});
 await Promise.resolve(); expect(ended).toBe(false); finish(); await w; expect(ended).toBe(true);
});
