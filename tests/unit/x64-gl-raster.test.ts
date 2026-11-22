// @bgt-examples: x64-gl-raster
// SPDX-License-Identifier: CC0-1.0. Real GL profile path (K62): viewports past the target, reversed glDepthRange,
// glProvokingVertex, GL_UNSIGNED_BYTE indices, the varying-capacity link check and every GL 3.3 limit.
// Recording backend only (no rasterization): pixel contents are covered by tests/e2e/x64-gl-raster.spec.ts.
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { checkGl33Limits } from '../support/gl33-limits';

const f = (u: number) => new Float32Array(new Uint32Array([u]).buffer)[0];
it('x64-gl-raster: off-target viewports, depth range, provoking vertex and byte indices lower exactly; limits vs GL 3.3', async () => {
  const stream = glStream();
  const h = await loadHeadless('x64-gl-raster', stream);
  for (let i = 0; i < 200 && !h.logs.some(l => /x64-gl-raster PASS failures=/.test(l)); i++) await h.stepAsync(1);
  const summary = h.logs.find(l => /x64-gl-raster PASS failures=/.test(l));
  expect(summary, h.logs.join('\n')).toBeDefined();
  // Breakage caught: K61 rejected every draw whose viewport left the target (GL_INVALID_VALUE), raised
  // GL_INVALID_ENUM for GL_UNSIGNED_BYTE indices and GL_INVALID_VALUE for glDepthRange(n > f); glProvokingVertex was a stub.
  expect(h.logs.filter(l => l.includes('x64-gl-raster glerror ')), h.logs.join('\n')).toEqual([]);
  expect(summary).toMatch(/checks=87 glerrors=0$/);
  // The recorder neither rasterizes nor runs shaders: only colour checks may fail here.
  for (const l of h.logs.filter(l => /x64-gl-raster FAIL /.test(l))) expect(l).toMatch(/ at \d+,\d+ got | values$/);
  for (const label of ['reversed depth range query', 'viewport size clamped to MAX_VIEWPORT_DIMS, origin kept', 'MAX_VIEWPORT_DIMS 16384',
    'negative viewport width is GL_INVALID_VALUE', 'provoking vertex query (initial last)', 'provoking vertex query (first)',
    'bad provoking vertex mode is GL_INVALID_ENUM', '46-component varying interface links iff within MAX_VARYING_COMPONENTS', 'MAX_VARYING_COMPONENTS float varyings link',
    'one varying component over the limit fails to link with an info log'])
    expect(h.logs.some(l => l.includes(`x64-gl-raster ok ${label}`)), label).toBe(true);
  expect(h.logs).toContain('guest: x64-gl-raster varying-limit=60'); // no backend capacity stated: GL 3.3's 60
  const m = h.host.metrics() as Record<string, any>;
  expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_approximations).toBe(0); expect(h.host.commandErrorCount).toBe(0);
  // Profile census: the deliberate invalid calls plus the eight geometry-shader limit queries (no geometry stage).
  expect(m.gl_error_calls).toEqual({ glViewport: 1, glGetIntegerv: 8, glProvokingVertex: 1 });

  // Every GL 3.3 implementation-dependent value against the minimum table (documented exceptions exact).
  const limits = new Map<number, string>();
  for (const l of h.logs) { const r = /x64-gl-raster limit 0x([0-9a-f]{4}) (.*)$/.exec(l); if (r) limits.set(parseInt(r[1], 16), r[2]); }
  expect(checkGl33Limits(limits, { varyings: 60, uniformBlock: 65536 })).toEqual([]);

  // Wire: off-target viewports reach §13 VIEWPORT unclamped (top-left origin), reversed depth ranges as (f, n).
  const vps = stream.items.filter(i => i.op === O.VIEWPORT).map(i => i.words.map(f));
  const has = (v: number[]) => vps.some(w => v.every((x, k) => Math.abs(w[k] - x) < 1e-6));
  expect(has([0, 0 - 128, 256, 160, 0, 1])).toBe(true);           // window viewport into the 32x32 FBO: y = 32 - 0 - 160
  expect(has([-16, 32 + 8 - 40, 48, 40, 0, 1])).toBe(true);       // negative origin
  expect(has([20, 32 - 24 - 40, 40, 40, 0, 1])).toBe(true);       // partially off the target
  expect(has([40, 32 - 0 - 10, 10, 10, 0, 1])).toBe(true);        // entirely off the target
  expect(has([-32768, -32768, 1, 1, 0, 1])).toBe(true);           // zero-size viewport: 1x1 far outside
  expect(has([0, 0, 32, 32, 0.25, 0.75])).toBe(true); expect(has([-16, 0, 48, 40, 0, 1])).toBe(true);
  expect(vps.some(w => w[4] === 0.25 && w[5] === 0.75 && w[0] === 0)).toBe(true);
  expect(has([-128, 160 + 80 - 320, 512, 320, 0, 1])).toBe(true); // default framebuffer, twice the window
  // Reversed ranges are sent as (f, n) with the profile's meta.y z flip in the uniform upload.
  expect(vps.filter(w => w[4] === 0.25 && w[5] === 0.75).length).toBeGreaterThanOrEqual(3);
  expect(vps.some(w => w[4] === 0 && w[5] === 1 && w[0] === -16)).toBe(true);
  // Expanded index lists uploaded into the profile's ring (u32): GL_UNSIGNED_BYTE indices are widened in GL order;
  // with GL_FIRST_VERTEX_CONVENTION each primitive is rotated so GL's first-convention provoking vertex is last.
  const uploads = stream.items.filter(i => i.op === O.BUFFER_UPDATE && i.data && i.data.length % 4 === 0)
    .map(i => [...new Uint32Array(i.data!.buffer.slice(i.data!.byteOffset, i.data!.byteOffset + i.data!.length))].join(','));
  for (const [what, list] of [
    ['u8 triangles (last)', '2,0,1,5,3,4'], ['u8 fan (last)', '3,2,1,3,1,0'],
    ['triangles (first)', '1,2,0,4,5,3'], ['strip (first): even (b,c,a), odd (c,a,b)', '1,2,0,3,2,1'],
    ['fan (first): (c,a,b)', '2,0,1,3,0,2'], ['u16 indexed (first)', '2,0,1,5,3,4'], ['u8 indexed (first)', '0,1,2,3,4,5'],
    ['u8 fan (first)', '1,3,2,0,3,1'], ['line (first)', '1,0'], ['line strip from first=2 (first; base_vertex 2)', '1,0,2,1'],
  ] as const) expect(uploads, what).toContain(list);
});
