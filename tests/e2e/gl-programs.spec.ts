// SPDX-License-Identifier: CC0-1.0. Original fixture, never game assets (K70, Q126).
// Catches: a transport burst that busy-polls a renderer result (shader compile, stage module, readback) that
// resolves asynchronously outside host I/O work: the page loop re-ran the polling update ~1000 times per display
// tick on WebGPU (the porter's r29: 32.7k updates/s) instead of waiting for the result. Also catches a wait that
// changes the guest timeline (the guest's own line with statuses, pixels and virtual GetTickCount/QPC deltas
// must equal the back-to-back step() run) and a burst that leaks into normal frames after startup.
import { test, expect, openGame, assertBackend, step, diagnostics } from './fixtures';
const PROGRAMS = 24;
// Blocking request results per program: 2 compiles, 2 link stage modules, 1 glReadPixels.
const WAITS = PROGRAMS * 5;
const done = (lines: string[]) => lines.find((s) => s.includes('gl-programs done'));
test('a startup that polls many GL program results waits for them instead of busy-polling the page loop', async ({ page, backendParam }, info) => {
  test.setTimeout(180_000);
  const lines: string[] = [];
  page.on('console', (m) => { if (m.text().includes('gl-programs')) lines.push(m.text()); });
  // 1. Back-to-back reference: step() until the programs are built.
  expect(await openGame(page, backendParam, { game: 'x64-gl-programs' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  let t0 = Date.now();
  for (let i = 0; i < 4000 && !done(lines); i++) await step(page, 5);
  const stepped = done(lines), steppedMs = Date.now() - t0;
  expect(stepped).toMatch(new RegExp(`gl-programs done programs=${PROGRAMS} compiled=${2 * PROGRAMS} linked=${PROGRAMS} pixels=${PROGRAMS} fnv=[0-9a-f]{8} error=0x0 `));
  // 2. The page's own rAF loop from boot (no step()).
  lines.length = 0;
  // BGT_K70_IOWAIT=0 reproduces the pre-K70 burst (re-run the update without waiting) for the before/after measurement.
  const wait = process.env.BGT_K70_IOWAIT;
  expect(await openGame(page, backendParam, { game: 'x64-gl-programs', ...(wait === undefined ? {} : { iowait: wait }) })).toBe('ready');
  t0 = Date.now();
  await page.evaluate(() => (window as any).__BGT_TEST__.resume());
  await expect.poll(() => !!done(lines), { timeout: 90_000, intervals: [20] }).toBe(true);
  const pageMs = Date.now() - t0;
  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  const loop = await page.evaluate(() => (window as any).__BGT_TEST__.pageLoop());
  const rate = Math.round(loop.transportUpdates / (pageMs / 1000));
  console.log('K70 gl-programs', JSON.stringify({ backend: backendParam, wait: wait ?? 'default', pageMs, steppedMs,
    msPerProgram: +(pageMs / PROGRAMS).toFixed(1), transportUpdatesPerSecond: rate, loop }));
  info.annotations.push({ type: 'k70', description: JSON.stringify({ pageMs, steppedMs, rate, loop }) });
  // Same guest-visible results and virtual time as back-to-back stepping.
  expect(done(lines)).toBe(stepped);
  // Every blocking wait costs at most a few updates: the one that polls 0 and yields, the one that sees the result,
  // and at most one more per display tick whose wait ran out of budget. Busy-polling ran ~1000 per tick.
  const bound = 3 * WAITS + 2 * loop.ticks;
  expect(loop.transportUpdates, `transport updates ${loop.transportUpdates} > ${bound}: ${JSON.stringify(loop)}`).toBeLessThanOrEqual(bound);
  expect(loop.maxUpdatesPerTick, JSON.stringify(loop)).toBeLessThanOrEqual(WAITS * 3);
  // 3. Normal frames after startup keep their pacing: one update per present, no burst.
  const w = await page.evaluate(() => (window as any).__BGT_TEST__.measurePage(1500, 200));
  expect(w.transport_updates).toBe(0);
  expect(w.updates_per_present).toBeLessThanOrEqual(1.05);
  expect((await diagnostics(page)).errors).toEqual([]);
});
