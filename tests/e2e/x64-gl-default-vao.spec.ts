// Original CC0-1.0. Catches lost core-VAO0 element uploads, fake map success, stale generated
// snapshots, implicit commits of unflushed bytes, and silent/unaccounted compatibility leniency.
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';

const kinds = ['binding', 'data upload', 'sub-data upload', 'map', 'mapped upload']
  .map(k => 'core VAO 0 element-buffer ' + k);
test('x64-gl-default-vao: core upload under VAO0 persists into five real indexed VAOs with exact pixels',
  async ({ page, backendParam, collector }, info) => {
    void collector;
    expect(await openGame(page, backendParam, { game: 'x64-gl-default-vao' })).toBe('ready');
    await assertBackend(page, backendParam, info);
    for (let i = 0; i < 180; i++) {
      await step(page, 1); await page.waitForTimeout(10);
      if ((await diagnostics(page)).logs.some(l => /x64-gl-default-vao (PASS|FAIL) failures=/.test(l.message))) break;
    }
    await step(page, 3);
    const d = await diagnostics(page), m = d.metrics as Record<string, any>;
    expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
    expect(d.logs.filter(l => l.message.includes('x64-gl-default-vao FAIL')), JSON.stringify(d.logs)).toEqual([]);
    expect(d.logs.some(l => l.message.includes('x64-gl-default-vao PASS failures=0')), JSON.stringify(d.logs)).toBe(true);
    for (const label of ['WGL 3.3 core flags2 context', 'VAO0 upload size49152', 'all five index ranges retained',
      'mapped generated native words', 'odd flush preserves native neighbours and unflushed bytes', 'mapped index draw rejected'])
      expect(d.logs.some(l => l.message.includes('x64-gl-default-vao ok ' + label)), label).toBe(true);
    expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
    expect(m.gl_approximations).toBe(14); expect(m.gl_approximation_kinds.slice().sort()).toEqual(kinds.slice().sort());
    for (const kind of kinds) expect(d.logs.filter(l => l.message === 'GL approximation or unsupported: ' + kind)).toHaveLength(1);
    const px = await readPixels(page), expected = [[255,0,0,255], [0,255,0,255], [0,0,255,255], [0,255,255,255], [255,255,0,255]];
    for (let panel = 0; panel < 5; panel++) {
      const x = Math.floor(d.letterbox.x + (panel * 64 + 32.5) * d.letterbox.w / 320);
      const y = Math.floor(d.letterbox.y + 100.5 * d.letterbox.h / 200), at = (y * px.width + x) * 4;
      expect(Array.from(px.data.slice(at, at + 4)), 'panel ' + panel).toEqual(expected[panel]);
    }
    await info.attach('default-vao-' + backendParam + '.png', { body: await page.locator('canvas').screenshot(), contentType: 'image/png' });
  });
