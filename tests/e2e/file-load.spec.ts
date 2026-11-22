// SPDX-License-Identifier: CC0-1.0. Original fixture, never game assets (K66, Q123).
// Catches: a blocking load capped at one update per display tick (each ReadFile chunk waits a whole rAF frame:
// 60 reads/s), a page-loop change that alters the guest timeline (the guest's own log line, with virtual
// GetTickCount/QPC deltas, presents and the data checksum, must equal the back-to-back step() run), and a burst
// that leaks into normal frames (after the load: one update per present, no transport updates).
import { test, expect, openGame, assertBackend, step, diagnostics } from './fixtures';
const READS = 768; // 4 MiB in 16 KiB calls + 2 MiB in 4 KiB calls
const done = (lines: string[]) => lines.find((s) => s.includes('file-load done'));
test('blocking ReadFile load runs at transport speed on the real page with an unchanged guest timeline', async ({ page, backendParam }, info) => {
  test.setTimeout(180_000);
  const lines: string[] = [];
  page.on('console', (m) => { if (m.text().includes('file-load')) lines.push(m.text()); });
  // 1. Back-to-back reference: step() until the load finished.
  expect(await openGame(page, backendParam, { game: 'x64-file-load' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  let t0 = Date.now();
  for (let i = 0; i < 4000 && !done(lines); i++) await step(page, 10);
  const stepped = done(lines), steppedMs = Date.now() - t0;
  expect(stepped).toMatch(/file-load done ok reads=768 fnv=[0-9a-f]{8} presents=30 /);
  // 2. The page's own rAF loop from boot (no step()).
  lines.length = 0;
  // BGT_K66_IOBURST=0 reproduces the pre-K66 loop (one update per tick) for the before/after measurement.
  const burst = process.env.BGT_K66_IOBURST;
  expect(await openGame(page, backendParam, { game: 'x64-file-load', ...(burst === undefined ? {} : { ioburst: burst }) })).toBe('ready');
  t0 = Date.now();
  await page.evaluate(() => (window as any).__BGT_TEST__.resume());
  await expect.poll(() => !!done(lines), { timeout: 60_000, intervals: [50] }).toBe(true);
  const pageMs = Date.now() - t0;
  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  const loop = await page.evaluate(() => (window as any).__BGT_TEST__.pageLoop());
  console.log('K66 file-load', JSON.stringify({ backend: backendParam, burst: burst ?? 'default', pageMs, steppedMs, loop }));
  // Same guest-visible results and virtual time as back-to-back stepping.
  expect(done(lines)).toBe(stepped);
  // One update per tick would need >= READS / 60 Hz = 12.8 s. Measured ~1-3 s with the burst.
  expect(pageMs, `page ${pageMs} ms, stepped ${steppedMs} ms, loop ${JSON.stringify(loop)}`).toBeLessThan(READS / 60 * 1000 / 2);
  expect(loop.transportUpdates).toBeGreaterThan(READS / 2);
  expect(loop.maxUpdatesPerTick).toBeGreaterThan(2);
  info.annotations.push({ type: 'k66', description: JSON.stringify({ pageMs, steppedMs, loop }) });
  // 3. Normal frames after the load keep their pacing: one update per present, no burst.
  const w = await page.evaluate(() => (window as any).__BGT_TEST__.measurePage(1500, 200));
  expect(w.transport_updates).toBe(0);
  expect(w.updates_per_present).toBeLessThanOrEqual(1.05);
  expect(w.guest_presents_per_page_present).toBeLessThanOrEqual(1.05);
  expect(w.presents_per_second).toBeLessThanOrEqual((w.raf_per_second ?? 60) + 1);
  expect((await diagnostics(page)).errors).toEqual([]);
});
