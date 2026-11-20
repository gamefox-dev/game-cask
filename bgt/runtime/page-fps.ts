// K51 real-page frame-rate measurement. The page's own requestAnimationFrame loop runs (no step());
// the runtime records every loop tick and every completed canvas present into a bounded log, and
// summarizePageWindow reduces one fixed wall-clock window to presents/s, frame-time mean/p95 and
// updates per present. Recording is a few array writes per rAF tick; it never reads GPU state.

/** One loop observation. kind: 0 rAF tick, 1 busy tick (previous update/render still running),
 * 2 canvas present completed (n = host updates that preceded it in its tick). */
export interface PageLoopLog { t: Float64Array; kind: Uint8Array; n: Uint16Array; length: number; dropped: number }
export const PAGE_LOG_CAPACITY = 1 << 16;
export const newPageLog = (): PageLoopLog => ({ t: new Float64Array(PAGE_LOG_CAPACITY), kind: new Uint8Array(PAGE_LOG_CAPACITY),
  n: new Uint16Array(PAGE_LOG_CAPACITY), length: 0, dropped: 0 });
export function pageLogPush(log: PageLoopLog, kind: 0 | 1 | 2, t: number, n = 0): void {
  if (log.length === PAGE_LOG_CAPACITY) { log.dropped++; return; }
  log.t[log.length] = t; log.kind[log.length] = kind; log.n[log.length] = Math.min(n, 65535); log.length++;
}

export interface PageWindowSummary {
  schema: 'game-cask/page-fps/1';
  window_ms: number;
  raf_ticks: number; raf_per_second: number | null; busy_ticks: number;
  presents: number; presents_per_second: number | null;
  /** Intervals between consecutive canvas presents inside the window (ms). */
  frame_ms: { mean: number | null; p50: number | null; p95: number | null; max: number | null; samples: number };
  updates: number; updates_per_present: number | null;
  guest_presents: number | null; guest_presents_per_second: number | null; guest_presents_per_page_present: number | null;
  log_dropped: number;
}
const pct = (sorted: number[], q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null;

/** Reduce log entries with start <= t < end. guestPresents is the native guest present delta over the same window. */
export function summarizePageWindow(log: PageLoopLog, start: number, end: number, guestPresents: number | null = null): PageWindowSummary {
  const presents: number[] = []; let ticks = 0, busy = 0, updates = 0;
  for (let i = 0; i < log.length; i++) {
    const t = log.t[i]; if (t < start || t >= end) continue;
    if (log.kind[i] === 0) ticks++; else if (log.kind[i] === 1) { ticks++; busy++; }
    else { presents.push(t); updates += log.n[i]; }
  }
  const intervals = presents.slice(1).map((t, i) => t - presents[i]).sort((a, b) => a - b);
  const seconds = (end - start) / 1000, per = (n: number) => seconds > 0 ? n / seconds : null;
  return {
    schema: 'game-cask/page-fps/1', window_ms: end - start,
    raf_ticks: ticks, raf_per_second: per(ticks), busy_ticks: busy,
    presents: presents.length, presents_per_second: per(presents.length),
    frame_ms: { mean: intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null,
      p50: pct(intervals, 0.5), p95: pct(intervals, 0.95), max: intervals.length ? intervals[intervals.length - 1] : null, samples: intervals.length },
    updates, updates_per_present: presents.length ? updates / presents.length : null,
    guest_presents: guestPresents, guest_presents_per_second: guestPresents === null ? null : per(guestPresents),
    guest_presents_per_page_present: guestPresents === null || !presents.length ? null : guestPresents / presents.length,
    log_dropped: log.dropped,
  };
}
