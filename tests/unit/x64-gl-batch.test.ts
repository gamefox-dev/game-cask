// @bgt-examples: x64-gl-batch
// SPDX-License-Identifier: CC0-1.0. Real GL profile path (K53): one deferred wire list per frame, exact
// stream order and batch-owned upload bytes. Recording backend only; pixels are covered by gl-batch.spec.ts.
import {expect,it} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
import {GPU_OP as O} from '../../bgt/runtime/abi';
import type {Frame} from '../../bgt/runtime/commands';

/** The fixture's sprite quad for frame f, sprite i (same integer/float formula as examples/x64-gl-batch/gl.c). */
function quad(f:number,i:number):Float32Array {
  const F=Math.fround,x=F(F(-0.95)+F(((i*37+f*3)%180)/100)),y=F(F(-0.95)+F(((i*53+f)%170)/100));
  const w=F(F(0.12)+F((i%3)*F(0.04))),h=F(F(0.10)+F((i%4)*F(0.03))),c=[[0,0],[1,0],[0,1],[1,0],[1,1],[0,1]];
  return new Float32Array(c.flatMap(([u,v])=>[F(x+F(u*w)),F(y+F(v*h)),u,v]));
}
it('defers a whole GL frame into one ordered wire list with owned per-draw upload bytes',async()=>{
  const stream=glStream(),frames:{submits:number;continuation:number;start:number}[]=[];
  const execute=stream.executeFrame!;
  stream.executeFrame=(frame:Frame)=>{frames.push({submits:frame.submits,continuation:frame.continuationSubmits,start:stream.items.length});execute(frame);};
  const h=await loadHeadless('x64-gl-batch',stream);
  await h.stepAsync(12);
  const metrics=()=>h.host.metrics() as Record<string,number>;
  const before=metrics(),start=stream.items.length;
  await h.stepAsync(1);
  const after=metrics(),frame=stream.items.slice(start),last=frames[frames.length-1];
  // Breakage caught: per-call submission (K47 shape was ~3 submits/draw) or a frame split by a needless sync point.
  expect(last.submits).toBe(1);expect(last.continuation).toBe(1);
  expect(after.gl_batch_flushes-before.gl_batch_flushes).toBe(1);
  expect(after.gl_sync_submits-before.gl_sync_submits).toBe(0);
  expect(after.gl_batched_lists-before.gl_batched_lists).toBeGreaterThanOrEqual(41*3);
  const ops=frame.map(i=>i.op);
  expect(ops.filter(o=>o===O.DRAW)).toHaveLength(41);
  expect(ops.filter(o=>o===O.PASS_BEGIN)).toHaveLength(43);
  expect(ops.filter(o=>o===O.PASS_END)).toHaveLength(43);
  expect(ops.filter(o=>o===O.TEXTURE_UPDATE||o===O.TEXTURE_UPDATE_EX)).toHaveLength(2);
  // Each streamed quad must be the bytes at its own glBufferSubData call, although the guest rewrites
  // the same client array before the deferred list is submitted. Recover f from the atlas patch
  // (GL bottom-up rows are uploaded top-down: the first wire row is client row 3, bytes 48..63).
  const patch=frame.find(i=>i.op===O.TEXTURE_UPDATE||i.op===O.TEXTURE_UPDATE_EX)!.data!;
  let f=-1;for(let k=0;k<256;k++)if(((k*11+48*5)&255)===patch[0])f=k;
  expect(f).toBeGreaterThan(0);
  const vertex=frame.filter(i=>i.op===O.BUFFER_UPDATE&&i.words[3]===96);
  expect(vertex).toHaveLength(41);
  const order=[...Array.from({length:24},(_,i)=>i),-1,...Array.from({length:7},(_,i)=>40+i),...Array.from({length:8},(_,i)=>24+i),-1];
  order.forEach((sprite,k)=>{
    const got=new Float32Array(vertex[k].data!.buffer,vertex[k].data!.byteOffset,24);
    if(sprite>=0)expect([...got]).toEqual([...quad(f,sprite)]);
    else expect([...got.slice(0,2)]).toEqual([-1,-1]);
  });
  // Stream order: every draw follows its own vertex upload, never a later one.
  let pending=0;for(const it of frame){if(it.op===O.BUFFER_UPDATE&&it.words[3]===96)pending++;if(it.op===O.DRAW){expect(pending).toBe(1);pending=0;}}
  expect(h.host.commandErrorCount).toBe(0);expect(h.logs.filter(s=>/FAIL|command error/.test(s))).toEqual([]);
},60000);
