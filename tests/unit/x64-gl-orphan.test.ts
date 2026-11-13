// @bgt-examples: x64-gl-orphan
// SPDX-License-Identifier: CC0-1.0. Real profile path: stable-store identity and upload ownership.
import {expect,it} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
import {GPU_OP as O} from '../../bgt/runtime/abi';
it('engine-shaped BufferData reuses live stores and owns per-batch bytes',async()=>{
 const stream=glStream(),h=await loadHeadless('x64-gl-orphan',stream);
 await h.stepAsync(12);
 const before=h.host.metrics() as Record<string,number>,start=stream.items.length;
 await h.stepAsync(1);
 const after=h.host.metrics() as Record<string,number>,frame=stream.items.slice(start);
 expect(after.gl_buffer_respec_reused-before.gl_buffer_respec_reused).toBe(80);
 expect(after.gl_buffer_respec_resized-before.gl_buffer_respec_resized).toBe(0);
 expect(frame.filter(i=>i.op===O.BUFFER_CREATE||i.op===O.BUFFER_DELETE)).toHaveLength(0);
 expect(frame.filter(i=>i.op===O.BUFFER_UPDATE)).toHaveLength(120);
 expect(frame.filter(i=>i.op===O.DRAW_INDEXED)).toHaveLength(40);
 const vertex=frame.filter(i=>i.op===O.BUFFER_UPDATE&&i.words[3]===24);
 expect(vertex).toHaveLength(40);expect([...vertex[0].data!]).toEqual([...vertex[39].data!]);
 expect(new Float32Array(vertex[0].data!.buffer,vertex[0].data!.byteOffset,6)).toEqual(new Float32Array([-1,-1,3,-1,-1,3]));
 expect(h.host.commandErrorCount).toBe(0);expect(h.logs.filter(s=>/FAIL|command error/.test(s))).toEqual([]);
},60000);
