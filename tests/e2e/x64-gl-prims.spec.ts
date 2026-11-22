// SPDX-License-Identifier: CC0-1.0. Original fixture (examples/x64-gl-prims), never game assets.
// K61: scissored and write-masked glClear, TRIANGLE_FAN / LINE_LOOP / adjacency modes, primitive restart, multi and
// range draws and separate stencil render exactly what GL renders, on both backends. The guest checks 94 exact
// results (RGBA8 glReadPixels of an FBO and of the default framebuffer, transform-feedback vertex order and primitive
// counts); this spec requires all of them, an empty guest error census, one submit per steady frame, and samples the
// eight screen tiles. Breakage caught: K60 rejected the clears (GL_INVALID_OPERATION) and the draws
// (GL_INVALID_ENUM), so tiles 0-7 stayed the background colour and every feedback check read zeros; a wrong
// expansion (vertex order, base vertex, restart split, adjacency vertices used) fails the order checks and tiles.
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';

// GL bottom-left coordinates in the 256x160 default framebuffer, expected RGB.
const tiles: [number, number, number[], string][] = [
  [32, 120, [0, 255, 0], 'scissored clear'], [8, 120, [64, 64, 64], 'outside the scissor box'],
  [96, 120, [255, 255, 0], 'colour-masked scissored clear'], [160, 120, [0, 0, 255], 'fan arrays (first=3)'],
  [224, 120, [255, 0, 255], 'fan elements (base vertex)'], [16, 40, [0, 255, 255], 'restart strip'],
  [32, 40, [64, 64, 64], 'restart gap'], [80, 16, [255, 128, 0], 'triangles adjacency'],
  [116, 60, [64, 64, 64], 'adjacency vertices ignored'], [148, 40, [255, 255, 0], 'front face (separate stencil)'],
  [172, 40, [64, 64, 64], 'back face fails separate stencil'], [224, 40, [255, 255, 255], 'depth-masked clear keeps depth'],
];
test('x64-gl-prims: scissored/masked clears, fans, loops, adjacency and restart render exactly', async ({ page, backendParam }, info) => {
  expect(await openGame(page, backendParam, { game: 'x64-gl-prims' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  for (let i = 0; i < 200; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).logs.some(l => /x64-gl-prims PASS failures=/.test(l.message))) break;
  }
  await step(page, 3);
  const d = await diagnostics(page), m = d.metrics as Record<string, any>;
  expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
  expect(d.logs.filter(l => /x64-gl-prims (FAIL|glerror) /.test(l.message)).map(l => l.message)).toEqual([]);
  expect(d.logs.some(l => /x64-gl-prims PASS failures=0 checks=94 glerrors=0/.test(l.message)), JSON.stringify(d.logs.slice(-5))).toBe(true);
  expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_approximations).toBe(0);
  expect(m.gl_error_calls).toEqual({ glHint: 1, glLineWidth: 1, glPointSize: 1, glPolygonMode: 1, glDrawArrays: 1,
    glDrawRangeElements: 1, glStencilFuncSeparate: 1, glClientWaitSync: 1 });
  // Steady frames: 3 clear passes + 7 expanded draws batch into one ABI submit.
  expect(d.lastFrame.submits).toBe(1);
  const px = await readPixels(page), b = d.letterbox;
  for (const [x, y, rgb, what] of tiles) {
    const cx = Math.floor(b.x + (x + 0.5) * b.w / 256), cy = Math.floor(b.y + (160 - y - 0.5) * b.h / 160);
    const at = (cy * px.width + cx) * 4;
    for (let c = 0; c < 3; c++) expect(Math.abs(px.data[at + c] - rgb[c]), `${what} channel ${c}`).toBeLessThanOrEqual(2);
  }
  await info.attach(`prims-${backendParam}.png`, { body: await page.locator('canvas').screenshot(), contentType: 'image/png' });
});
