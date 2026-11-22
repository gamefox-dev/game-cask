// SPDX-License-Identifier: CC0-1.0. Original fixture (examples/x64-gl-raster), never game assets.
// K62: viewports larger than the target, with negative or off-target origins, empty, scissored and with normal /
// reversed glDepthRange render what GL renders (rasterization clipped to the target), flat varyings take GL's
// provoking vertex (last by default, first after glProvokingVertex) for triangles, strips, fans, u16/u8-indexed
// draws and lines, many varyings link and pass values (packed interface), the varying limit is the device's, and
// every GL 3.3 limit meets the minimum table or its documented exception. The guest checks every pixel itself (RGBA8
// glReadPixels, values from GL's formulas); this spec requires all of them and samples the final screen.
// Breakage caught: K61 rejected off-target viewports (GL_INVALID_VALUE: nothing drawn), WebGPU flat varyings took the
// FIRST vertex (fans showed the centre vertex), GL_UNSIGNED_BYTE indices were GL_INVALID_ENUM, glDepthRange(n > f)
// GL_INVALID_VALUE, and >16 varyings failed WebGPU pipeline creation.
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';
import { checkGl33Limits } from '../support/gl33-limits';

const grad = (x: number, y: number) => [(x + 0.5 + 128) / 512, (y + 0.5 + 80) / 320, 0.6].map(v => Math.round(v * 255));
const vertex = (k: number) => [17 * k, 255 - 17 * k, 51];
// GL bottom-left coordinates in the 256x160 default framebuffer, expected RGB.
const tiles: [number, number, number[], string][] = [
  [10, 10, grad(10, 10), 'gradient (viewport twice the window)'], [150, 130, grad(150, 130), 'gradient top'],
  [120, 70, grad(120, 70), 'gradient centre'], [250, 100, vertex(2), 'flat fan triangle 0 = vertex 2 (viewport past the edge)'],
  [200, 150, vertex(3), 'flat fan triangle 1 = vertex 3'],
];
test('x64-gl-raster: off-target viewports, depth range, provoking vertex, byte indices, varyings and limits', async ({ page, backendParam }, info) => {
  expect(await openGame(page, backendParam, { game: 'x64-gl-raster' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  for (let i = 0; i < 300; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).logs.some(l => /x64-gl-raster PASS failures=/.test(l.message))) break;
  }
  await step(page, 3);
  const d = await diagnostics(page), m = d.metrics as Record<string, any>, logs = d.logs.map(l => l.message);
  expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
  expect(logs.filter(l => /x64-gl-raster (FAIL|glerror) /.test(l)), logs.filter(l => /error/i.test(l)).join('\n').slice(0, 4000)).toEqual([]);
  const summary = logs.find(l => /x64-gl-raster PASS failures=/.test(l));
  expect(summary, JSON.stringify(logs.slice(-8))).toMatch(/PASS failures=0 checks=\d+ glerrors=0/);
  expect(Number(/checks=(\d+)/.exec(summary!)![1])).toBe(105);
  expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_approximation_kinds).toEqual(['polygon offset (GL_POLYGON_OFFSET_FILL, nonzero factor/units) not rendered']);
  expect(m.gl_error_calls).toEqual({ glViewport: 1, glGetIntegerv: 8, glProvokingVertex: 1 });
  // Device-derived limits: the varying capacity of this backend (WebGPU: 4 * inter-stage locations - 6; WebGL 2:
  // 3 * (MAX_VARYING_VECTORS - 1)) and the uniform block size, then the whole GL 3.3 table.
  const varyings = Number(/varying-limit=(\d+)/.exec(logs.find(l => l.includes('varying-limit='))!)![1]);
  const limits = new Map<number, string>();
  for (const l of logs) { const r = /x64-gl-raster limit 0x([0-9a-f]{4}) (.*)$/.exec(l); if (r) limits.set(parseInt(r[1], 16), r[2]); }
  expect(checkGl33Limits(limits, { varyings, uniformBlock: Number(limits.get(0x8a30)) })).toEqual([]);
  await info.attach(`limits-${backendParam}.json`, { body: JSON.stringify(Object.fromEntries([...limits].map(([k, v]) => [`0x${k.toString(16)}`, v])), null, 1), contentType: 'application/json' });
  expect(varyings).toBeGreaterThanOrEqual(60);
  // Steady frames: clear + gradient + fan in one ABI submit.
  expect(d.lastFrame.submits).toBe(1);
  const px = await readPixels(page), b = d.letterbox;
  for (const [x, y, rgb, what] of tiles) {
    const cx = Math.floor(b.x + (x + 0.5) * b.w / 256), cy = Math.floor(b.y + (160 - y - 0.5) * b.h / 160);
    const at = (cy * px.width + cx) * 4;
    for (let c = 0; c < 3; c++) expect(Math.abs(px.data[at + c] - rgb[c]), `${what} channel ${c}`).toBeLessThanOrEqual(3);
  }
  await info.attach(`raster-${backendParam}.png`, { body: await page.locator('canvas').screenshot(), contentType: 'image/png' });
});
