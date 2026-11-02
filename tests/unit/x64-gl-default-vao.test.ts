// @bgt-examples: x64-gl-default-vao
// Original CC0-1.0. Recorder proves state/upload transport, NOT GPU-generated values or pixels.
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';

it('core default element-buffer uploads are owned and retained across real VAOs; leniency is visible', async () => {
  const stream = glStream(), h = await loadHeadless('x64-gl-default-vao', stream);
  for (let i = 0; i < 160 && !h.logs.some(l => /x64-gl-default-vao (PASS|FAIL) failures=/.test(l)); i++) await h.stepAsync(1);
  expect(h.logs.some(l => /x64-gl-default-vao (PASS|FAIL) failures=/.test(l)), h.logs.join('\n')).toBe(true);
  await h.stepAsync(3);
  const failures = h.logs.filter(l => /x64-gl-default-vao FAIL /.test(l) && !/failures=/.test(l));
  // Recorder deliberately cannot compute feedback/raster results. Actual backends must pass all seven.
  expect(failures.map(l => l.replace(/^guest: /, '')).sort()).toEqual([
    ...Array.from({ length: 5 }, (_, i) => 'x64-gl-default-vao FAIL exact pixel ' + i),
    'x64-gl-default-vao FAIL mapped generated native words',
    'x64-gl-default-vao FAIL odd flush preserves native neighbours and unflushed bytes',
  ].sort());
  expect(h.host.commandErrorCount).toBe(0);
  const m = h.host.metrics() as Record<string, any>;
  expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_approximations).toBe(14); expect(m.gl_approximation_kinds).toHaveLength(5);
  for (const kind of m.gl_approximation_kinds)
    expect(h.logs.filter(l => l.endsWith('GL approximation or unsupported: ' + kind))).toHaveLength(1);
  const creates = stream.items.filter(i => i.op === O.BUFFER_CREATE && i.words[0] === 10);
  expect(creates).toHaveLength(1); expect(creates[0].data).toHaveLength(49152);
  expect(Array.from(new Uint16Array(creates[0].data!.buffer, creates[0].data!.byteOffset, 6))).toEqual([0,1,2,2,1,3]);
  const updates = stream.items.filter(i => i.op === O.BUFFER_UPDATE && i.words[0] === 10);
  for (const offset of [12, 36, 48]) {
    const u = updates.find(i => i.words[1] === offset)!; expect(u, 'offset ' + offset).toBeDefined();
    expect(Array.from(new Uint16Array(u.data!.buffer, u.data!.byteOffset, 6))).toEqual([0,1,2,2,1,3]);
  }
  expect(updates.some(i => i.words[1] === 0 && i.data!.length === 49152)).toBe(true);
  const indexed = stream.items.filter(i => i.op === O.DRAW_INDEXED);
  expect(indexed.length).toBeGreaterThanOrEqual(6);
  expect(indexed[0].words).toEqual([1,1,0,0,0]); // valid no-attribute named-VAO control
  expect(indexed.slice(1, 6).map(i => i.words)).toEqual([0,6,12,18,24].map(first => [6,1,first,0,0]));
  const indexBindings = stream.items.filter(i => i.op === O.INDEX_BUFFER);
  expect(indexBindings.length).toBe(indexed.length);
  expect(indexBindings.every(i => i.words.join() === '10,0,0,49152')).toBe(true);
}, 120000);
