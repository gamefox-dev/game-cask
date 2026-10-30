// In-memory read-only virtual file system. Assets are preloaded
// asynchronously before bgt_init; the game then reads synchronously.

import { E_INVALID, E_LIMIT, E_NOT_FOUND, E_STATE, LIMITS } from './abi';

interface OpenFile {
  path: string;
  data: Uint8Array | null;
  size: number;
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
  private streamed = new Map<string, number>();
  addStream(path: string, size: number): void {
    const p=normalizeAssetPath(path);
    if (!p || !Number.isSafeInteger(size) || size<0 || this.files.has(p) || this.streamed.has(p)) throw new Error('invalid or duplicate streamed file');
    this.streamed.set(p,size);
  }
  pathFor(handle: number): string | null { return this.open.get(handle)?.path ?? null; }
  range(handle: number, offset: number, length: number): Uint8Array<ArrayBuffer> | null {
    const f=this.open.get(handle);
    if(f?.data) { this.record(f.path,offset,length,f.size);return f.data.slice(offset,offset+length); }
    return null;
  }
  private open = new Map<number, OpenFile>();
  private nextHandle = 1;
  readonly missing = new Set<string>();
  private ranges = new Map<string,{path:string;offset:number;length:number}>();
  coverage(): {path:string;offset:number;length:number}[] { return [...this.ranges.values()]; }
  private record(path:string,offset:number,length:number,size:number):void {
    for(let off=Math.floor(offset/65536)*65536;off<Math.min(offset+length,size);off+=65536)
      this.ranges.set(`${path}:${off}`,{path,offset:off,length:Math.min(65536,size-off)});
  }
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
    return this.files.size + this.streamed.size;
  }

  list(): string[] {
    return [...this.files.keys(),...this.streamed.keys()].sort();
  }

  openFile(path: string): number {
    const p = normalizeAssetPath(path);
    if (!p) return E_INVALID;
    const data = this.files.get(p);
    if (!data && !this.streamed.has(p)) {
      this.missing.add(p);
      return E_NOT_FOUND;
    }
    if (this.open.size >= LIMITS.assetHandles) return E_LIMIT;
    while (this.open.has(this.nextHandle)) this.nextHandle = (this.nextHandle % 0x7fffffff) + 1;
    const h = this.nextHandle;
    this.nextHandle = (this.nextHandle % 0x7fffffff) + 1;
    this.open.set(h, { path: p, data: data ?? null, size: data?.length ?? this.streamed.get(p)!, pos: 0 });
    return h;
  }

  size(handle: number): number {
    const f = this.open.get(handle);
    return f ? f.size : E_NOT_FOUND;
  }

  /** Copies up to `size` bytes into `dst`; returns bytes copied. */
  read(handle: number, dst: Uint8Array): number {
    const f = this.open.get(handle);
    if (!f) return E_NOT_FOUND;
    if (!f.data) return E_STATE; // streamed files require asset_range_request + yield
    const n = Math.min(dst.byteLength, f.size - f.pos);
    dst.set(f.data.subarray(f.pos, f.pos + n));
    this.record(f.path,f.pos,n,f.size);
    f.pos += n;
    return n;
  }

  seek(handle: number, offset: number): number {
    const f = this.open.get(handle);
    if (!f) return E_NOT_FOUND;
    if (offset > f.size) return E_INVALID;
    f.pos = offset;
    return 0;
  }

  close(handle: number): number {
    return this.open.delete(handle) ? 0 : E_NOT_FOUND;
  }
}
