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
