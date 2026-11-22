// @bgt-examples: none
// Original CC0-1.0 (K51). Real-page measurement reduction and the pipeline loop's pacing.
import { expect, it } from 'vitest';
import { newPageLog, pageLogPush, summarizePageWindow, PAGE_LOG_CAPACITY } from '../../bgt/runtime/page-fps';
import { retainedAccumulator } from '../../bgt/runtime/page-pacing'; // the single pacing implementation (K50)
// @ts-expect-error plain ESM
import { parsePageFpsArgs } from '../../tools/bench/page-fps.mjs';

it('summarizes only the window: presents/s, frame-time mean/p95, updates per present, guest presents', () => {
  const log = newPageLog();
  pageLogPush(log, 2, 50, 1); // before the window
  for (let i = 0; i < 60; i++) { pageLogPush(log, i % 10 === 9 ? 1 : 0, 100 + i * 16); if (i % 2 === 0) pageLogPush(log, 2, 108 + i * 16, i % 4 ? 2 : 1); }
  pageLogPush(log, 2, 1100, 1); // at the end boundary: excluded
  const s = summarizePageWindow(log, 100, 1100, 45);
  expect(s.window_ms).toBe(1000); expect(s.raf_ticks).toBe(60); expect(s.busy_ticks).toBe(6);
  expect(s.presents).toBe(30); expect(s.presents_per_second).toBe(30);
  expect(s.frame_ms).toEqual({ mean: 32, p50: 32, p95: 32, max: 32, samples: 29 });
  expect(s.updates).toBe(45); expect(s.updates_per_present).toBe(1.5);
  expect(s.guest_presents_per_second).toBe(45); expect(s.guest_presents_per_page_present).toBe(1.5);
});
it('reports unavailable values as null and bounds the log', () => {
  const log = newPageLog();
  const s = summarizePageWindow(log, 0, 1000);
  expect(s.presents_per_second).toBe(0); expect(s.frame_ms.mean).toBeNull(); expect(s.updates_per_present).toBeNull();
  expect(s.guest_presents).toBeNull(); expect(s.guest_presents_per_page_present).toBeNull();
  for (let i = 0; i <= PAGE_LOG_CAPACITY; i++) pageLogPush(log, 0, i);
  expect(log.length).toBe(PAGE_LOG_CAPACITY); expect(log.dropped).toBe(1);
});
// Catches the K50 regression: dropping the remainder after every single pipeline update halves a 60 Hz page.
it('pipeline pacing: one update per ~60 Hz rAF tick with jitter, backlog still dropped after a stall', () => {
  const step = 1000 / 60;
  const simulate = (pace: (acc: number, n: number) => number) => {
    let acc = 0, updates = 0; const ticks = 600;
    for (let i = 0; i < ticks; i++) {
      const d = 16.66 + (i % 3 - 1) * 0.004; acc += Math.min(d, 250);
      let n = 0; while (acc >= step && n < 1) { acc -= step; n++; } updates += n; acc = pace(acc, n);
    }
    return updates / ticks;
  };
  expect(simulate((acc, n) => n === 1 ? 0 : acc)).toBeLessThan(0.55); // the old behaviour
  expect(simulate((acc, n) => retainedAccumulator(acc, n, 1, step))).toBeGreaterThan(0.99);
  expect(retainedAccumulator(250 - step, 1, 1, step)).toBe(step); // stall: at most one step retained
  expect(retainedAccumulator(80, 4, 4, step)).toBe(0); // native BGT catch-up unchanged
  expect(retainedAccumulator(5, 0, 1, step)).toBe(5);
});
it('page-fps CLI arguments', () => {
  expect(parsePageFpsArgs(['--game', 'x64-smoke'])).toMatchObject({ backends: ['webgl2', 'webgpu'], modes: ['asyncify', 'jspi'], windowMs: 5000 });
  expect(() => parsePageFpsArgs([])).toThrow(/usage/);
  expect(() => parsePageFpsArgs(['--game', 'g', '--backends', 'vulkan'])).toThrow(/backends/);
  expect(() => parsePageFpsArgs(['--game', 'g', '--window-ms', '5'])).toThrow(/window/);
});
// K66: transport-burst updates (kind 3) are counted, not taken for ticks or presents.
it('counts transport-burst updates and the most updates in one tick', () => {
  const log = newPageLog();
  pageLogPush(log, 0, 10); pageLogPush(log, 2, 11, 1); pageLogPush(log, 3, 12); pageLogPush(log, 2, 13, 1); pageLogPush(log, 3, 14); pageLogPush(log, 2, 15, 1);
  pageLogPush(log, 0, 27); pageLogPush(log, 2, 28, 1);
  const s = summarizePageWindow(log, 0, 100);
  expect(s.raf_ticks).toBe(2); expect(s.presents).toBe(4); expect(s.updates).toBe(4);
  expect(s.transport_updates).toBe(2); expect(s.max_updates_per_tick).toBe(3); expect(s.updates_per_present).toBe(1);
});
