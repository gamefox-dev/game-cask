// @bgt-examples: win32-hello
// SPDX-License-Identifier: CC0-1.0
// Integration K18/K19: record from startup, including a yielding pipeline guest.
// Catches losing recorder installation or drawing before an awaited JSPI update.
import { test, expect, openGame, diagnostics, step, stateHash, readPixels, assertBackend } from './fixtures';
import type { RecordedFrame } from '../../bgt/renderers/recording';

test('startup recorder preserves every frame across Asyncify and JSPI loader variants', async ({ page, backendParam, collector }, info) => {
  void collector;
  let frames: RecordedFrame[] = [];
  await page.exposeFunction('__BGT_RECORD_FRAME__', (frame: RecordedFrame) => {
    frames.push(frame);
    return true;
  });
  const runs = [];
  for (const suspension of ['asyncify', 'jspi']) {
    frames = [];
    expect(await openGame(page, backendParam, { game: 'win32-hello', suspension })).toBe('ready');
    await assertBackend(page, backendParam, info);
    const available = await page.evaluate(async () => !!(await (await fetch('/games/win32-hello/manifest.json')).json()).variants?.jspi);
    // Normal single-variant builds retain fallback coverage; the integration matrix
    // sets BGT_JSPI=1 and must actually execute the second artifact, not fallback.
    if (process.env.BGT_JSPI === '1') expect(available).toBe(true);
    expect((await diagnostics(page)).suspension).toBe(suspension === 'jspi' && available ? 'jspi' : 'asyncify');
    await step(page, 5);
    const pixels = await readPixels(page);
    const d = await diagnostics(page);
    expect(d.errors).toEqual([]);
    expect(d.yields).toBeGreaterThan(0);
    expect(frames[0].update).toBe(0);
    expect([...new Set(frames.map(f => f.update))]).toEqual([0, 1, 2, 3, 4, 5]);
    // Copy now: later renders must not mutate recorded uploads/metadata.
    runs.push({ frames: JSON.stringify(frames), hash: await stateHash(page), pixels });
  }
  expect(runs[1]).toEqual(runs[0]);
});
