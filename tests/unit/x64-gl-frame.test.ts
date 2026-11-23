// @bgt-examples: x64-gl-frame
// SPDX-License-Identifier: CC0-1.0. Real GL profile path (K60, Q115): an engine-shaped 2D frame whose draws read
// generic current attributes and which resets capabilities and raises one GL error every frame batches into one
// wire list. Recording backend only; pixels are covered by tests/e2e/gl-frame.spec.ts.
import {expect,it} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
import {GPU_OP as O} from '../../bgt/runtime/abi';
import type {Frame} from '../../bgt/runtime/commands';
it('per-item current attributes, capability resets and a validation error keep one wire list per frame',async()=>{
  const stream=glStream(),frames:{submits:number;continuation:number}[]=[];
  const execute=stream.executeFrame!;
  stream.executeFrame=(frame:Frame)=>{frames.push({submits:frame.submits,continuation:frame.continuationSubmits});execute(frame);};
  const h=await loadHeadless('x64-gl-frame',stream);
  for(let i=0;i<200&&!h.logs.some(l=>l.includes('x64-gl-frame PASS frame state'));i++)await h.stepAsync(1);
  expect(h.logs.some(l=>l.includes('x64-gl-frame PASS frame state')),h.logs.join('\n')).toBe(true);
  await h.stepAsync(2);
  const metrics=()=>h.host.metrics() as Record<string,number>;
  const before=metrics(),start=stream.items.length;
  await h.stepAsync(1);
  const after=metrics(),frame=stream.items.slice(start),last=frames[frames.length-1];
  const d=(k:string)=>after[k]-before[k];
  // Breakage caught (K57 shape): a synchronous current-attribute upload per constant-attribute draw (2 submits
  // each) and a flush at every GL error (glDisable of an untracked capability, the invalid glBlendEquation).
  expect(last.submits).toBe(1);expect(last.continuation).toBe(1);
  expect(d('gl_batch_flushes')).toBe(1);expect(d('gl_sync_submits')).toBe(0);
  const ops=frame.map(i=>i.op);
  expect(ops.filter(o=>o===O.BUFFER_CREATE||o===O.BUFFER_DELETE)).toHaveLength(0);
  expect(ops.filter(o=>o===O.FEEDBACK_CAPTURE)).toHaveLength(8);
  expect(ops.filter(o=>o===O.BLIT)).toHaveLength(2);
  expect(ops.filter(o=>o===O.DRAW_INDEXED)).toHaveLength(8);
  expect(ops.filter(o=>o===O.DRAW)).toHaveLength(48+8+4+1);
  // No separate current-attribute buffer traffic: each item's colour rides in its program's uniform upload.
  expect(frame.filter(i=>i.op===O.BUFFER_UPDATE&&i.words[0]===1023)).toHaveLength(0);
  // Each item draw binds its constant slot to the 256-byte tail of the uniform slot it just uploaded, and
  // consecutive draws of one program use distinct ring slots (disjoint bytes: no copy-on-write on WebGPU).
  let upload:{handle:number;offset:number;bytes:Uint8Array}|undefined;
  const uniformBinding=new Map<number,{handle:number;offset:number;size:number}>(),vertexBinding=new Map<number,{handle:number;offset:number;size:number}>();
  const slots=new Map<number,Set<number>>(),colours:string[]=[];let items=0;
  for(const it of frame){
    if(it.op===O.BUFFER_UPDATE&&it.words[0]>=256&&it.words[0]<700)upload={handle:it.words[0],offset:it.words[1],bytes:it.data!};
    if(it.op===O.UNIFORM_BUFFER)uniformBinding.set(it.words[0],{handle:it.words[1],offset:it.words[2],size:it.words[3]});
    if(it.op===O.VERTEX_BUFFER)vertexBinding.set(it.words[0],{handle:it.words[1],offset:it.words[2],size:it.words[3]});
    if(it.op===O.PASS_BEGIN){uniformBinding.clear();vertexBinding.clear();}
    if(it.op!==O.DRAW||it.words[1]!==1||!upload)continue;
    const u=uniformBinding.get(0)!,c=vertexBinding.get(1);
    if(!c||c.handle!==upload.handle)continue; // not an item draw (composite, captures)
    expect(u.handle).toBe(upload.handle);expect(u.offset).toBe(upload.offset);expect(u.offset%256).toBe(0);
    expect(c.size).toBe(256);expect(c.offset).toBe(upload.offset+upload.bytes.length-256);
    const tail=new Float32Array(upload.bytes.slice(upload.bytes.length-256).buffer);
    colours.push(Array.from(tail.slice(4,8)).map(v=>v.toFixed(3)).join());
    const set=slots.get(upload.handle)??new Set<number>();set.add(upload.offset);slots.set(upload.handle,set);items++;
  }
  expect(items).toBe(48);
  // K67 (Q115): the 4 instanced sprite draws read a generic current "glow" colour too. Breakage caught: the K60
  // synchronous per-instance upload to private buffer 1023 (2 ABI submits per instanced draw: 9 submits per frame).
  // Their constant slot is stride 0 (one 256-byte tail for all 48 instances) and bound to the uniform slot just uploaded.
  const strides=new Map<number,number[][]>();
  for(const it of stream.items)if(it.op===O.PIPELINE_CREATE)strides.set(it.words[0],Array.from({length:it.words[23]},(_,k)=>[it.words[26+k*2],it.words[27+k*2]]));
  let pipe=0;const glows:string[]=[];upload=undefined;vertexBinding.clear();
  for(const it of frame){
    if(it.op===O.PIPELINE)pipe=it.words[0];
    if(it.op===O.BUFFER_UPDATE&&it.words[0]>=256&&it.words[0]<700)upload={handle:it.words[0],offset:it.words[1],bytes:it.data!};
    if(it.op===O.VERTEX_BUFFER)vertexBinding.set(it.words[0],{handle:it.words[1],offset:it.words[2],size:it.words[3]});
    if(it.op!==O.DRAW||it.words[1]!==48)continue;
    const layout=strides.get(pipe)!,slot=layout.findIndex(([stride])=>stride===0);
    expect(slot).toBeGreaterThanOrEqual(0);expect(layout[slot][1]).toBe(1);
    const c=vertexBinding.get(slot)!;expect(c.handle).toBe(upload!.handle);expect(c.size).toBe(256);
    expect(c.offset).toBe(upload!.offset+upload!.bytes.length-256);
    glows.push(Array.from(new Float32Array(upload!.bytes.slice(upload!.bytes.length-256).buffer).slice(8,12)).map(v=>v.toFixed(3)).join());
  }
  expect(glows).toHaveLength(4);expect(new Set(glows).size).toBe(4);
  expect(new Set(colours).size).toBeGreaterThan(24); // per-item glVertexAttrib4f values, not one stale colour
  for(const set of slots.values())expect(set.size).toBeGreaterThan(1);
  const m=metrics();
  expect(m.gl_approximations).toBe(0); // DITHER/MULTISAMPLE resets never approximate; disables render exactly
  expect(h.host.commandErrorCount).toBe(0);expect(h.logs.filter(s=>/FAIL|command error/.test(s))).toEqual([]);
},90000);
