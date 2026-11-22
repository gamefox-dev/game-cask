// @bgt-examples: x64-gl-respec
// SPDX-License-Identifier: CC0-1.0. Real GL profile path (K57): varying-size glBufferData reuses native capacity,
// and allocations, transform-feedback draws and blits join the frame's single deferred wire list.
// Recording backend only; pixels are covered by tests/e2e/gl-respec.spec.ts.
import {expect,it} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
import {GPU_OP as O} from '../../bgt/runtime/abi';
import type {Frame} from '../../bgt/runtime/commands';
it('batches a varying-size orphaning, feedback and blit frame into one wire list with exact logical sizes',async()=>{
  const stream=glStream(),frames:{submits:number;continuation:number}[]=[];
  const execute=stream.executeFrame!;
  stream.executeFrame=(frame:Frame)=>{frames.push({submits:frame.submits,continuation:frame.continuationSubmits});execute(frame);};
  const h=await loadHeadless('x64-gl-respec',stream);
  // Warm up past shader compilation, pipeline creation and the first capacity growth.
  for(let i=0;i<200&&!((h.host.metrics() as Record<string,number>).gl_draws>57*4);i++)await h.stepAsync(1);
  await h.stepAsync(2);
  const metrics=()=>h.host.metrics() as Record<string,number>;
  const before=metrics(),start=stream.items.length;
  await h.stepAsync(1);
  const after=metrics(),frame=stream.items.slice(start),last=frames[frames.length-1];
  const d=(k:string)=>after[k]-before[k];
  // Breakage caught: allocation, feedback or blit sync points splitting the frame (K53 shape: 181 submits),
  // or varying sizes reallocating (delete/create) instead of reusing the live native capacity.
  expect(last.submits).toBe(1);expect(last.continuation).toBe(1);
  expect(d('gl_batch_flushes')).toBe(1);expect(d('gl_sync_submits')).toBe(0);
  expect(d('gl_buffer_respec_resized')).toBe(60);expect(d('gl_buffer_capacity_reused')).toBe(60);
  expect(d('gl_buffer_capacity_grown')).toBe(0);expect(d('gl_buffer_respec_reused')).toBe(0);
  const ops=frame.map(i=>i.op);
  expect(ops.filter(o=>o===O.BUFFER_CREATE||o===O.BUFFER_DELETE)).toHaveLength(0);
  expect(ops.filter(o=>o===O.FEEDBACK_CAPTURE)).toHaveLength(18);
  expect(ops.filter(o=>o===O.BLIT)).toHaveLength(4);
  expect(ops.filter(o=>o===O.DRAW_INDEXED)).toHaveLength(20);
  expect(ops.filter(o=>o===O.DRAW)).toHaveLength(37); // 8 tiles + 18 captures + 6 particle draws + 4 effects + composite
  // Every canvas draw sees its own three re-specified stores at their exact logical sizes: the update lengths
  // and the bound vertex/index ranges are q*64, q*16 and q*12 bytes, never the larger native capacity.
  const updates=new Map<number,number>(), bound=new Map<number,{handle:number;size:number}>();
  let index:{handle:number;size:number}|undefined,canvas=0,blitsBefore=0;
  for(const it of frame){
    if(it.op===O.BUFFER_UPDATE&&it.words[1]===0)updates.set(it.words[0],it.data!.length);
    if(it.op===O.VERTEX_BUFFER)bound.set(it.words[0],{handle:it.words[1],size:it.words[3]});
    if(it.op===O.INDEX_BUFFER)index={handle:it.words[0],size:it.words[3]};
    if(it.op===O.BLIT&&canvas===10)blitsBefore++;
    if(it.op!==O.DRAW_INDEXED)continue;
    const q=it.words[0]/6;expect(Number.isInteger(q)&&q>=1&&q<=8).toBe(true);
    const pos=bound.get(0)!,col=bound.get(1)!;
    expect([pos.size,col.size,index!.size]).toEqual([q*64,q*16,q*12]);
    expect([updates.get(pos.handle),updates.get(col.handle),updates.get(index!.handle)]).toEqual([q*64,q*16,q*12]);
    updates.delete(pos.handle);updates.delete(col.handle);updates.delete(index!.handle);canvas++;
  }
  expect(canvas).toBe(20);
  expect(blitsBefore).toBe(1); // the screen-read copy stays between canvas batches 10 and 11
  expect(h.host.commandErrorCount).toBe(0);expect(h.logs.filter(s=>/FAIL|command error/.test(s))).toEqual([]);
},60000);
