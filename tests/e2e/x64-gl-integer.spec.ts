import { test, expect, openGame, assertBackend, step, diagnostics } from './fixtures';

// Real integer samplers/render outputs must preserve every bit, not float-round 32-bit values.
test('x64-gl-integer: all 18 integer formats convert, sample, render and read back exactly', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam, { game: 'x64-gl-integer' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  for (let i = 0; i < 250; i++) {
    await step(page, 1); await page.waitForTimeout(10);
    if ((await diagnostics(page)).logs.some(l => /x64-gl-integer (PASS|FAIL) failures=/.test(l.message))) break;
  }
  const d = await diagnostics(page);
  expect(d.logs.filter(l => /x64-gl-integer FAIL/.test(l.message)), JSON.stringify(d.logs)).toEqual([]);
  expect(d.logs.some(l => /x64-gl-integer PASS failures=0 checks=198/.test(l.message)), JSON.stringify(d.logs)).toBe(true);
  // Named native boundary: GL 3.3 supplies no portable out-of-range integer fragment-output result.
  expect(d.logs.some(l => l.message.includes(`native-boundary unsigned=1 value=${backendParam === 'webgl2' ? 0 : 255}`))).toBe(true);
  expect(d.logs.some(l => l.message.includes(`native-boundary unsigned=0 value=${backendParam === 'webgl2' ? 1 : 4294967168}`))).toBe(true);
  expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
});
