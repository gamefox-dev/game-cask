// @bgt-examples: none
// Original CC0-1.0 (K50). Breakage caught: dropping the sub-step remainder after every single
// pipeline update halves a 60 Hz page; retaining unbounded backlog lets a stall spiral.
import { expect, it } from 'vitest';
import { retainedAccumulator } from '../../bgt/runtime/page-pacing';

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
  expect(simulate((acc, n) => n === 1 ? 0 : acc)).toBeLessThan(0.55); // the pre-fix K50 behaviour
  expect(simulate((acc, n) => retainedAccumulator(acc, n, 1, step))).toBeGreaterThan(0.99);
  expect(retainedAccumulator(250 - step, 1, 1, step)).toBe(step); // stall: at most one step retained
  expect(retainedAccumulator(80, 4, 4, step)).toBe(0); // native BGT catch-up unchanged
  expect(retainedAccumulator(5, 0, 1, step)).toBe(5);
});
// K66 (Q123). Breakage caught: a burst after a normal (presenting/time-advancing) update, a burst without a wall
// budget or without the one-period guest-time cap, and ?ioburst=0 not restoring one update per tick.
it('transport bursts continue only after time-neutral transport yields, within budget and one guest period', async () => {
  const { continueTransport, TRANSPORT_BURST_MS, TRANSPORT_BURST_GUEST_US } = await import('../../bgt/runtime/page-pacing');
  expect(TRANSPORT_BURST_MS).toBe(12); expect(TRANSPORT_BURST_GUEST_US).toBe(16667);
  expect(continueTransport(true, 3, 12, 100, 200)).toBe(true);
  expect(continueTransport(false, 3, 12, 100, 200)).toBe(false); // a normal frame: one update per tick
  expect(continueTransport(true, 12, 12, 100, 200)).toBe(false); // wall budget spent
  expect(continueTransport(true, 3, 0, 100, 200)).toBe(false); // ?ioburst=0
  expect(continueTransport(true, 3, 12, 100, 100 + 16667)).toBe(false); // one frame period of instruction time
  expect(continueTransport(true, 3, 12, null, null)).toBe(true); // no guest clock export: budget only
});
// K70 (Q126). Breakage caught: a burst wait that never times out (a lost renderer result would hang the tick) or
// that reports a timeout for a result that arrived in time.
it('settlesWithin bounds a burst wait by the remaining tick budget', async () => {
  const { settlesWithin } = await import('../../bgt/runtime/page-pacing');
  expect(await settlesWithin(new Promise(() => {}), 5)).toBe(false);
  expect(await settlesWithin(new Promise((r) => setTimeout(r, 1)), 200)).toBe(true);
  expect(await settlesWithin(Promise.reject(new Error('x')), 50)).toBe(true);
  expect(await settlesWithin(Promise.resolve(), 0)).toBe(true);
});
