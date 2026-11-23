// Bounded asynchronous request results. Visibility advances only at simulation-update boundaries.
import type { captureRequests } from './savestate-host';
import { E_INVALID, E_LIMIT, E_NOT_FOUND, E_STATE, E_IO } from './abi';
export interface RequestToken { id: number; issued: number; done: boolean; data?: Uint8Array<ArrayBuffer>; error?: number }
export class Requests {
  private entries = new Map<number, RequestToken>();
  private epoch = 0;
  private bytes = 0;
  private next = 1;
  /** K70: the request the last status() poll found unresolved (0) in the current update; pacing only, never state. */
  private polled: RequestToken | null = null;
  /** vK70: at most one waiter per pending request (deduplicated; a timed-out burst wait reuses it, never adds one). */
  private waiters = new Map<RequestToken, { done: Promise<void>; resolve: () => void }>();
  declare checkpoint: () => ReturnType<typeof captureRequests>;
  declare restoreCheckpoint: (s: ReturnType<typeof captureRequests>) => void;
  advance(): void { this.epoch++; this.polled = null; }
  reserve(id?: number): RequestToken | number {
    if (this.entries.size >= 32) return E_LIMIT;
    if (id === undefined) { while (this.entries.has(this.next)) this.next = this.next % 0x7fffffff + 1; id = this.next; this.next = id % 0x7fffffff + 1; }
    if (!Number.isInteger(id) || id < 1 || id > 0x7fffffff) return E_INVALID;
    if (this.entries.has(id)) return E_STATE;
    const token = { id, issued: this.epoch, done: false };
    // vK70: a request issued after the poll is the newer cause of the next yield; never wait on the older poll.
    this.polled = null;
    this.entries.set(id, token); return token;
  }
  complete(token: RequestToken, data?: Uint8Array<ArrayBuffer>, error = E_IO): void {
    if (this.entries.get(token.id) !== token || token.done) return; // cancelled/stale completion
    token.done = true; this.wake(token);
    if (data && this.bytes + data.length <= 8 * 1024 * 1024) { token.data = data.slice(); this.bytes += data.length; }
    else token.error = data ? E_LIMIT : error;
  }
  status(id: number): number {
    const t = this.entries.get(id);
    if (!t) return E_NOT_FOUND;
    if (!t.done || t.issued === this.epoch) { this.polled = t; return 0; }
    if (this.polled === t) this.polled = null;
    return t.error ?? 1;
  }
  read(id: number, dst: Uint8Array): number {
    const status = this.status(id);
    if (status !== 1) return status === 0 ? E_STATE : status;
    const data = this.entries.get(id)!.data!;
    if (dst.length < data.length) return E_LIMIT;
    dst.set(data); return data.length;
  }
  close(id: number): number {
    const t = this.entries.get(id);
    if (!t) return E_NOT_FOUND;
    this.bytes -= t.data?.length ?? 0; this.entries.delete(id); this.wake(t); return 0;
  }
  /**
   * K70: the unresolved request a transport-yielding update last polled, if its result has not arrived yet
   * (a renderer result such as a shader compile, pipeline or readback, or a streamed read). The page loop waits
   * for it instead of re-running an update that can only poll the same 0 again (Q126). A result that already
   * arrived but becomes visible only at the next update boundary returns null: the next update makes progress.
   */
  awaited(): RequestToken | null {
    const t = this.polled;
    return t && !t.done && this.entries.get(t.id) === t ? t : null;
  }
  /** Settles when `token` completes or is closed (never rejects). Unrelated to guest-visible timing.
   * One shared promise per pending request: repeated (timed-out) waits do not accumulate waiters. */
  whenDone(token: RequestToken): Promise<void> {
    if (token.done || this.entries.get(token.id) !== token) return Promise.resolve();
    let w = this.waiters.get(token);
    if (!w) { let resolve!: () => void; const done = new Promise<void>((r) => { resolve = r; }); w = { done, resolve }; this.waiters.set(token, w); }
    return w.done;
  }
  /** Pending waiters (tests: bounded by the pending requests, never by the number of waits). */
  get waiting(): number { return this.waiters.size; }
  private wake(token: RequestToken): void {
    const w = this.waiters.get(token); if (!w) return;
    this.waiters.delete(token); w.resolve();
  }
  /** vK70: a checkpoint restore replaces every entry; release waiters of the replaced ones. */
  wakeAll(): void { const all = [...this.waiters.values()]; this.waiters.clear(); this.polled = null; for (const w of all) w.resolve(); }
}
