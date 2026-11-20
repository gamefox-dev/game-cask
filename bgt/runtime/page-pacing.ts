// Real-page update pacing (K50, equivalent to K51's page-fps.ts retainedAccumulator).
/**
 * Accumulator left after a rAF tick ran `updates` fixed steps with at most `limit` per tick.
 * Pipeline games run one update per tick (limit 1): keep the sub-step remainder, but at most one
 * step, so a 60 Hz rAF (ticks of ~16.66 ms, just under 16.667) updates on every tick while a stall
 * still drops its backlog. Zeroing after each update halved a 60 Hz page (~34 presents/s).
 * Native BGT catch-up (limit 4) keeps its old policy: a full catch-up drops all backlog.
 */
export function retainedAccumulator(acc: number, updates: number, limit: number, stepMs: number): number {
  if (updates < limit) return acc;
  return limit === 1 ? Math.min(acc, stepMs) : 0;
}
