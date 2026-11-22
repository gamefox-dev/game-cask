// @bgt-examples: x64-gl-zero
// SPDX-License-Identifier: CC0-1.0. K66 (Q120): zero-size glBufferData orphaning on the real profile path.
// Catches: size 0 rejected with GL_INVALID_VALUE (49 failed calls per Godot frame), a zero-size orphan that
// churns native stores (DELETE/CREATE per batch) or emits commands, and a census without error codes.
import {expect,it} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
import {GPU_OP as O,GPU_LIMITS} from '../../bgt/runtime/abi';
const CODES={glBufferData:{'0x501':1},glBufferSubData:{'0x501':1},glMapBufferRange:{'0x502':1},glDrawArrays:{'0x502':2},
 glCopyBufferSubData:{'0x501':1},glBindBufferRange:{'0x501':2},glBeginTransformFeedback:{'0x502':1}};
it('zero-size glBufferData is a valid, command-free orphan; the census records error codes',async()=>{
 const stream=glStream(),h=await loadHeadless('x64-gl-zero',stream);
 for(let i=0;i<120&&!h.logs.some(s=>s.includes('zero replay'));i++)await h.stepAsync(1); // shader results take updates
 await h.stepAsync(4);
 expect(h.logs.filter(s=>/zero (checks|replay|FAIL)/.test(s))).toEqual([expect.stringMatching(/^guest: zero checks=15 failed=0 pixel=/),'guest: zero replay size=0 error=0x0']);
 const before=h.host.metrics() as Record<string,unknown>,start=stream.items.length;
 await h.stepAsync(1);
 const after=h.host.metrics() as Record<string,never>,frame=stream.items.slice(start);
 // The deliberate startup errors only (negative size; sub-data, map, copy, ranges, draws, capture on zero-size stores).
 expect(after.gl_error_codes).toEqual(CODES);
 expect(after.gl_error_calls).toEqual(Object.fromEntries(Object.entries(CODES).map(([k,v])=>[k,Object.values(v)[0]])));
 expect(Number(after.gl_errors_raised)).toBe(Number(before.gl_errors_raised));
 // 80 zero-size orphans per frame: no command, no store churn; each following upload rewrites its store in place.
 expect(Number(after.gl_buffer_zero_stores)-Number(before.gl_buffer_zero_stores)).toBe(80);
 expect(Number(after.gl_buffer_capacity_reused)-Number(before.gl_buffer_capacity_reused)).toBe(80);
 expect(frame.filter(i=>i.op===O.BUFFER_CREATE||i.op===O.BUFFER_DELETE)).toHaveLength(0);
 expect(frame.filter(i=>i.op===O.BUFFER_UPDATE&&(i.words[3]===24||i.words[3]===6))).toHaveLength(80);
 expect(frame.filter(i=>i.op===O.DRAW_INDEXED)).toHaveLength(40);
 expect(h.host.commandErrorCount).toBe(0);expect(h.logs.filter(s=>/FAIL|command error/.test(s))).toEqual([]);
},60000);
// vK66: catches a zero-size orphan lost when its batch is replayed (no pend_resize journal record: the rejected
// re-specification's undo would restore the 24-byte store instead of the zero size).
it('a zero-size orphan survives a replayed batch rejection',async()=>{
 const ref:{host?:{frame:{gpuUploadBytes:number}}}={};
 const stream=glStream(),h=await loadHeadless('x64-gl-zero',{...stream,onLog:(m:string)=>{
  if(ref.host&&m.endsWith('zero inject'))ref.host.frame.gpuUploadBytes=GPU_LIMITS.budget;
  if(ref.host&&m.endsWith('zero restore'))ref.host.frame.gpuUploadBytes=0;
 }});
 ref.host=h.host as never;
 for(let i=0;i<120&&!h.logs.some(s=>s.includes('zero replay'));i++)await h.stepAsync(1);
 expect(h.logs).toContain('guest: zero replay size=0 error=0x505'); // the update: GL_OUT_OF_MEMORY; the orphan kept
 expect(Number((h.host.metrics() as Record<string,never>).gl_batch_replays)).toBeGreaterThan(0);
 expect(h.logs.filter(s=>/zero FAIL/.test(s))).toEqual([]);
},60000);
