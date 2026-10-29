// Key/value persistence for bgt_storage_*. Backed by localStorage (namespaced
// per game id, base64 values); falls back to memory when storage is blocked
// (private mode, sandboxed iframe). `persistent` tells the game which it got.

import { E_IO } from '../runtime/abi';
import type { StorageSink } from '../runtime/host';

function toB64(d: Uint8Array): string {
  let s = '';
  for (let i = 0; i < d.length; i++) s += String.fromCharCode(d[i]);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class BrowserStorage implements StorageSink {
  readonly persistent: boolean;
  private mem = new Map<string, Uint8Array>();
  private prefix: string;

  constructor(gameId: string, opts: { ephemeral?: boolean } = {}) {
    this.prefix = `bgt:${gameId}:`;
    let ok = false;
    if (!opts.ephemeral) {
      try {
        const probe = `${this.prefix}__probe`;
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        ok = true;
      } catch {
        ok = false;
      }
    }
    this.persistent = ok;
  }

  read(key: string): Uint8Array | null {
    if (!this.persistent) return this.mem.get(key) ?? null;
    try {
      const v = localStorage.getItem(this.prefix + key);
      return v === null ? null : fromB64(v);
    } catch {
      return this.mem.get(key) ?? null;
    }
  }

  write(key: string, data: Uint8Array): number {
    this.mem.set(key, data);
    if (!this.persistent) return 0;
    try {
      localStorage.setItem(this.prefix + key, toB64(data));
      return 0;
    } catch {
      return E_IO;
    }
  }
}
