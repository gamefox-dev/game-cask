// Real-page update pacing (K50). The only pacing implementation; K51's identical copy was folded in at I17.
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

/** K66: default wall budget per display tick for updates that continue after a time-neutral transport yield. */
export const TRANSPORT_BURST_MS = 12;
/** One guest frame period (BGT_DT_US): a transport burst carries at most this much instruction time per tick. */
export const TRANSPORT_BURST_GUEST_US = 16667;
/**
 * K66: may the page loop run another update in this display tick? Only after an update that ended in a
 * time-neutral transport yield (no present, no guest-time boundary), while the tick's wall budget lasts and the
 * burst has carried less than one frame period of guest (instruction) time. Normal frames keep one update per tick.
 */
export function continueTransport(transportYield: boolean, elapsedMs: number, budgetMs: number,
  guestStartUs: number | null, guestNowUs: number | null): boolean {
  if (!transportYield || !(budgetMs > 0) || !(elapsedMs < budgetMs)) return false;
  return guestStartUs === null || guestNowUs === null || guestNowUs - guestStartUs < TRANSPORT_BURST_GUEST_US;
}
