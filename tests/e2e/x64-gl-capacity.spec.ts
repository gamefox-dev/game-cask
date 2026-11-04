// Original CC0-1.0. Catches the original255-name failure with real late-object pixels on both native backends.
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';
test('x64-gl-capacity: >600 live texture/buffer objects, late draws, real exhaustion', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam, { game: 'x64-gl-capacity' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  for (let i = 0; i < 150; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).logs.some(l => /x64-gl-capacity (PASS|FAIL) failures=/.test(l.message))) break;
  }
  await step(page, 3);
  const d = await diagnostics(page), m = d.metrics as Record<string, any>;
  expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
  expect(d.logs.filter(l => l.message.includes('x64-gl-capacity FAIL')), JSON.stringify(d.logs)).toEqual([]);
  expect(d.logs.some(l => l.message.includes('x64-gl-capacity PASS failures=0')), JSON.stringify(d.logs)).toBe(true);
  expect(m.gl_objects.textures).toMatchObject({ peak: 1023, failures: 2, failed_requests: 2 });
  expect(m.gl_objects.buffers).toMatchObject({ peak: 1024, failures: 0, failed_requests: 0 });
  for (const kind of ['vaos', 'samplers', 'fbos', 'rbos', 'gl_queries', 'shaders', 'programs']) expect(m.gl_objects[kind].peak).toBeGreaterThanOrEqual(600);
  expect(d.logs.filter(l => l.message.includes('GL_OUT_OF_MEMORY object=')).length).toBe(2);
  expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  const px = await readPixels(page);
  for (const [x0, rgb] of [[40, [255,0,0]], [120, [0,255,0]], [240, [0,0,255]]] as const) {
    const x = Math.floor(d.letterbox.x + (x0 + .5) * d.letterbox.w / 320);
    const y = Math.floor(d.letterbox.y + 100.5 * d.letterbox.h / 200);
    expect(Array.from(px.data.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 3))).toEqual([...rgb]);
  }
  await info.attach('capacity.png', { body: await page.locator('canvas').screenshot(), contentType: 'image/png' });
});
