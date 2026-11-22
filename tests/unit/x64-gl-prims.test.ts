// @bgt-examples: x64-gl-prims
// SPDX-License-Identifier: CC0-1.0. Real GL profile path (K61): scissored/masked glClear, primitive modes without a
// native §13 topology (fans, loops, adjacency) and primitive restart lower to batched §13 commands with no GL error.
// Recording backend only (no rasterization or shader execution): pixel and transform-feedback contents are covered
// by tests/e2e/x64-gl-prims.spec.ts on both backends.
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import type { Frame } from '../../bgt/runtime/commands';
it('scissored/masked clears, expanded primitive modes and restart: no profile errors, one batched list per frame', async () => {
  const stream = glStream(), frames: { submits: number }[] = [];
  const execute = stream.executeFrame!;
  stream.executeFrame = (frame: Frame) => { frames.push({ submits: frame.submits }); execute(frame); };
  const h = await loadHeadless('x64-gl-prims', stream);
  for (let i = 0; i < 200 && !h.logs.some(l => /x64-gl-prims PASS failures=/.test(l)); i++) await h.stepAsync(1);
  const summary = h.logs.find(l => /x64-gl-prims PASS failures=/.test(l));
  expect(summary, h.logs.join('\n')).toBeDefined();
  // Breakage caught: K60 rejected these clears (GL_INVALID_OPERATION) and draws (GL_INVALID_ENUM), and 15 entries
  // were stubs (GL_INVALID_OPERATION); the guest-side census (glerror lines) must be empty.
  expect(h.logs.filter(l => l.includes('x64-gl-prims glerror ')), h.logs.join('\n')).toEqual([]);
  expect(summary).toMatch(/glerrors=0$/);
  // The recorder neither rasterizes nor runs shaders: only colour/feedback-content checks may fail here.
  const failures = h.logs.filter(l => /x64-gl-prims FAIL /.test(l));
  for (const f of failures) expect(f).toMatch(/vertex order|at \d+,\d+ got|screen tile/);
  for (const label of ['initial viewport is the window', 'GL_QUADS is not a core mode', 'range end before start', '64-bit query result',
    'restart index query', 'separate stencil state queries', 'separate stencil bad face', 'line width state',
    'aliased line width range is [1,1]', 'line width 0', 'hint state', 'polygon offset state', 'core polygon mode face',
    '64-bit integer query', 'blend state queries', 'colour writemask query', '64-bit buffer queries', 'fence signaled',
    'client wait signaled', 'deleted fence', 'wait on deleted fence'])
    expect(h.logs.some(l => l.includes(`x64-gl-prims ok ${label}`)), label).toBe(true);
  // Feedback primitive counts come from the profile's own expansion: exact even without shader execution.
  for (const [what, prims] of [['fan arrays first=1', 3], ['line loop arrays', 4], ['triangle strip adjacency', 3],
    ['restart fans', 4], ['restart disabled: index 7 is a vertex', 5], ['multi-draw loops base', 5]] as const)
    expect(h.logs.some(l => l.includes(`${what} vertex order (prims ${prims})`)), what).toBe(true);
  const m = h.host.metrics() as Record<string, any>;
  expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_approximations).toBe(0); expect(h.host.commandErrorCount).toBe(0);
  // Profile error census: exactly the fixture's deliberate invalid calls.
  expect(m.gl_error_calls).toEqual({ glHint: 1, glLineWidth: 1, glPointSize: 1, glPolygonMode: 1, glDrawArrays: 1,
    glDrawRangeElements: 1, glStencilFuncSeparate: 1, glClientWaitSync: 1 });
  expect(m.gl_errors_raised).toBe(8);
  expect(m.gl_expanded_draws).toBeGreaterThanOrEqual(30); expect(m.gl_partial_clears).toBeGreaterThanOrEqual(10);

  // One steady frame (no checks): every clear and expanded draw is batched into the frame's single list.
  await h.stepAsync(3);
  const before = h.host.metrics() as Record<string, number>, start = stream.items.length;
  await h.stepAsync(1);
  const after = h.host.metrics() as Record<string, number>, frame = stream.items.slice(start);
  const d = (k: string) => after[k] - before[k];
  expect(frames[frames.length - 1].submits).toBe(1);
  expect(d('gl_sync_submits')).toBe(0); expect(d('gl_batch_flushes')).toBe(1); expect(d('gl_errors_raised')).toBe(0);
  const ops = frame.map(i => i.op);
  expect(ops.filter(o => o === O.BUFFER_CREATE || o === O.BUFFER_DELETE)).toHaveLength(0);
  expect(ops.filter(o => o === O.DRAW)).toHaveLength(0);
  expect(ops.filter(o => o === O.DRAW_INDEXED)).toHaveLength(7);
  expect(d('gl_expanded_draws')).toBe(7);
  // Scissored colour clear (tile 0) and the scissored red + green-masked clears (tile 1) are CLEAR_BUFFER operations
  // after a SCISSOR; the whole clear is a load clear; the depth-masked depth clear sends nothing.
  const clears = frame.filter(i => i.op === O.CLEAR_BUFFER);
  expect(clears.map(c => [c.words[0], c.words[1]])).toEqual([[0xf0, 0], [0xf0, 0], [0x20, 0]]);
  for (const c of clears) expect(frame[frame.indexOf(c) - 1].op).toBe(O.SCISSOR);
  expect(frame.filter(i => i.op === O.PASS_BEGIN).length).toBe(1 + 3 + 7);
  // Expanded draws are triangle/line lists drawn indexed from private u32 index buffers. glDrawArrays fans share one
  // static fan list (base_vertex = first, no upload); the others upload their list into the ring in their own list.
  let index: number[] | undefined, upload: { handle: number; offset: number; n: number } | undefined;
  const fanHandles = new Set<number>(), ringHandles = new Set<number>(), ringOffsets: number[] = [];
  for (const it of frame) {
    if (it.op === O.BUFFER_UPDATE) upload = { handle: it.words[0], offset: it.words[1], n: it.data!.length };
    if (it.op === O.INDEX_BUFFER) index = it.words;
    if (it.op !== O.DRAW_INDEXED) continue;
    expect(index![1]).toBe(1); expect(it.words[2]).toBe(0);
    if (upload && upload.handle === index![0]) {
      expect(index![2]).toBe(upload.offset); expect(index![3]).toBe(upload.n); expect(it.words[0] * 4).toBe(upload.n);
      ringHandles.add(index![0]); ringOffsets.push(index![2]);
    } else { fanHandles.add(index![0]); expect(it.words[0]).toBe(6); }
    upload = undefined;
  }
  expect(fanHandles.size).toBe(1); expect(ringHandles.size).toBe(1);
  expect(ringOffsets).toHaveLength(3); expect(new Set(ringOffsets).size).toBe(3); // disjoint ring ranges
  expect([...fanHandles][0]).not.toBe([...ringHandles][0]);
}, 300000);
