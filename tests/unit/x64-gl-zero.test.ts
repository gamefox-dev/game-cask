// @bgt-examples: x64-gl-zero
// SPDX-License-Identifier: CC0-1.0. K66 (Q120): zero-size glBufferData orphaning on the real profile path.
// Catches: size 0 rejected with GL_INVALID_VALUE (49 failed calls per Godot frame), a zero-size orphan that
// churns native stores (DELETE/CREATE per batch) or emits commands, and a census without error codes.
import {expect,it} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
import {GPU_OP as O} from '../../bgt/runtime/abi';
it('zero-size glBufferData is a valid, command-free orphan; the census records error codes',async()=>{
 const stream=glStream(),h=await loadHeadless('x64-gl-zero',stream);
 await h.stepAsync(12);
 expect(h.logs.filter(s=>s.includes('zero '))).toEqual([expect.stringMatching(/^guest: zero checks=8 failed=0 pixel=/)]);
 const before=h.host.metrics() as Record<string,unknown>,start=stream.items.length;
 await h.stepAsync(1);
 const after=h.host.metrics() as Record<string,never>,frame=stream.items.slice(start);
 // The two deliberate startup errors only: a negative size and a draw past a zero-size store.
 expect(after.gl_error_calls).toEqual({glBufferData:1,glBufferSubData:1,glMapBufferRange:1,glDrawArrays:1});
 expect(after.gl_error_codes).toEqual({glBufferData:{'0x501':1},glBufferSubData:{'0x501':1},glMapBufferRange:{'0x502':1},glDrawArrays:{'0x502':1}});
 expect(Number(after.gl_errors_raised)).toBe(Number(before.gl_errors_raised));
 // 80 zero-size orphans per frame: no command, no store churn; each following upload rewrites its store in place.
 expect(Number(after.gl_buffer_zero_stores)-Number(before.gl_buffer_zero_stores)).toBe(80);
 expect(Number(after.gl_buffer_capacity_reused)-Number(before.gl_buffer_capacity_reused)).toBe(80);
 expect(frame.filter(i=>i.op===O.BUFFER_CREATE||i.op===O.BUFFER_DELETE)).toHaveLength(0);
 expect(frame.filter(i=>i.op===O.BUFFER_UPDATE&&(i.words[3]===24||i.words[3]===6))).toHaveLength(80);
 expect(frame.filter(i=>i.op===O.DRAW_INDEXED)).toHaveLength(40);
 expect(h.host.commandErrorCount).toBe(0);expect(h.logs.filter(s=>/FAIL|command error/.test(s))).toEqual([]);
},60000);
