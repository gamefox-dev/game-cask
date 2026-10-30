// Bounded asynchronous request results. Visibility advances only at simulation-update boundaries.
import { E_INVALID, E_LIMIT, E_NOT_FOUND, E_STATE, E_IO } from './abi';
export interface RequestToken { id: number; issued: number; done: boolean; data?: Uint8Array<ArrayBuffer>; error?: number }
export class Requests {
  private entries = new Map<number, RequestToken>();
  private epoch = 0;
  private bytes = 0;
  private next = 1;
  advance(): void { this.epoch++; }
  reserve(id?: number): RequestToken | number {
    if (this.entries.size >= 32) return E_LIMIT;
    if (id === undefined) { while (this.entries.has(this.next)) this.next = this.next % 0x7fffffff + 1; id = this.next; this.next = id % 0x7fffffff + 1; }
    if (!Number.isInteger(id) || id < 1 || id > 0x7fffffff) return E_INVALID;
    if (this.entries.has(id)) return E_STATE;
    const token = { id, issued: this.epoch, done: false };
    this.entries.set(id, token); return token;
  }
  complete(token: RequestToken, data?: Uint8Array<ArrayBuffer>, error = E_IO): void {
    if (this.entries.get(token.id) !== token || token.done) return; // cancelled/stale completion
    token.done = true;
    if (data && this.bytes + data.length <= 8 * 1024 * 1024) { token.data = data.slice(); this.bytes += data.length; }
    else token.error = data ? E_LIMIT : error;
  }
  status(id: number): number {
    const t = this.entries.get(id);
    if (!t) return E_NOT_FOUND;
    if (!t.done || t.issued === this.epoch) return 0;
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
    this.bytes -= t.data?.length ?? 0; this.entries.delete(id); return 0;
  }
}
