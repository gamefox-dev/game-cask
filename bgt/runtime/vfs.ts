// In-memory read-only virtual file system. Assets are preloaded
// asynchronously before bgt_init; the game then reads synchronously.

import { E_INVALID, E_LIMIT, E_NOT_FOUND, LIMITS } from './abi';

interface OpenFile {
  path: string;
  data: Uint8Array;
  pos: number;
}

export function normalizeAssetPath(path: string): string | null {
  if (path.length === 0 || path.length > 512) return null;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null;
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return parts.join('/');
}

export class Vfs {
  private files = new Map<string, Uint8Array>();
  private open = new Map<number, OpenFile>();
  private nextHandle = 1;
  readonly missing = new Set<string>();
  totalBytes = 0;

  add(path: string, data: Uint8Array): void {
    const p = normalizeAssetPath(path);
    if (!p) throw new Error(`invalid asset path: ${path}`);
    const prev = this.files.get(p);
    if (prev) this.totalBytes -= prev.byteLength;
    this.files.set(p, data);
    this.totalBytes += data.byteLength;
  }

  get fileCount(): number {
    return this.files.size;
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  openFile(path: string): number {
    const p = normalizeAssetPath(path);
    if (!p) return E_INVALID;
    const data = this.files.get(p);
    if (!data) {
      this.missing.add(p);
      return E_NOT_FOUND;
    }
    if (this.open.size >= LIMITS.assetHandles) return E_LIMIT;
    while (this.open.has(this.nextHandle)) this.nextHandle = (this.nextHandle % 0x7fffffff) + 1;
    const h = this.nextHandle;
    this.nextHandle = (this.nextHandle % 0x7fffffff) + 1;
    this.open.set(h, { path: p, data, pos: 0 });
    return h;
  }

  size(handle: number): number {
    const f = this.open.get(handle);
    return f ? f.data.byteLength : E_NOT_FOUND;
  }

  /** Copies up to `size` bytes into `dst`; returns bytes copied. */
  read(handle: number, dst: Uint8Array): number {
    const f = this.open.get(handle);
    if (!f) return E_NOT_FOUND;
    const n = Math.min(dst.byteLength, f.data.byteLength - f.pos);
    dst.set(f.data.subarray(f.pos, f.pos + n));
    f.pos += n;
    return n;
  }

  seek(handle: number, offset: number): number {
    const f = this.open.get(handle);
    if (!f) return E_NOT_FOUND;
    if (offset > f.data.byteLength) return E_INVALID;
    f.pos = offset;
    return 0;
  }

  close(handle: number): number {
    return this.open.delete(handle) ? 0 : E_NOT_FOUND;
  }
}
