// @bgt-examples: x64-gl-pacing
// SPDX-License-Identifier: CC0-1.0. Real GL profile path (K67, Q115/Q116) on the recording backend: the GPU-bound
// pacing fixture's frame is one wire list; its 32 stream batches re-specify the vertex and index buffers in place
// (capacity reuse, no BUFFER_CREATE/DELETE), and its 4 instanced current-attribute draws bind a stride-0 constant
// slot to the uniform tail instead of uploading per instance to private buffer 1023. Breakage caught: synchronous
// current-attribute uploads (K60 shape: 9 submits per frame), allocation churn per batch, an ungated or missing
// stride-0 layout. Page pacing and pixels: tests/e2e/gl-page-fps.spec.ts.
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import type { Frame } from '../../bgt/runtime/commands';

it('x64-gl-pacing: one wire list per frame, in-place stream updates, stride-0 constants for instanced draws', async () => {
  const stream = glStream(), submits: number[] = [];
  const execute = stream.executeFrame!;
  stream.executeFrame = (frame: Frame) => { submits.push(frame.submits); execute(frame); };
  const h = await loadHeadless('x64-gl-pacing', stream);
  for (let i = 0; i < 200 && !h.logs.some(l => l.includes('x64-gl-pacing PASS frame state')); i++) await h.stepAsync(1);
  expect(h.logs.some(l => l.includes('x64-gl-pacing PASS frame state')), h.logs.join('\n')).toBe(true);
  await h.stepAsync(2);
  const start = stream.items.length, metrics = () => h.host.metrics() as Record<string, number>, before = metrics();
  await h.stepAsync(1);
  const frame = stream.items.slice(start), after = metrics();
  expect(submits[submits.length - 1]).toBe(1);
  expect(after.gl_sync_submits - before.gl_sync_submits).toBe(0);
  const ops = frame.map(i => i.op);
  expect(ops.filter(o => o === O.BUFFER_CREATE || o === O.BUFFER_DELETE)).toHaveLength(0);
  expect(ops.filter(o => o === O.DRAW_INDEXED)).toHaveLength(32);
  expect(ops.filter(o => o === O.DRAW)).toHaveLength(4 + 1 + 1);
  expect(frame.filter(i => (i.op === O.BUFFER_UPDATE || i.op === O.BUFFER_CREATE) && i.words[0] === 1023)).toHaveLength(0);
  const layouts = new Map<number, number[][]>();
  for (const it of stream.items) if (it.op === O.PIPELINE_CREATE)
    layouts.set(it.words[0], Array.from({ length: it.words[23] }, (_, k) => [it.words[26 + k * 2], it.words[27 + k * 2]]));
  let pipe = 0, instanced = 0;
  for (const it of frame) {
    if (it.op === O.PIPELINE) pipe = it.words[0];
    if (it.op === O.DRAW && it.words[1] > 1) { instanced++; expect(layouts.get(pipe)!.some(([stride, step]) => stride === 0 && step === 1)).toBe(true); }
  }
  expect(instanced).toBe(4);
  expect(h.host.commandErrorCount).toBe(0); expect(h.logs.filter(s => /FAIL|command error/.test(s))).toEqual([]);
}, 90000);
