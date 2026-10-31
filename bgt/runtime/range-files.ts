// Chunk-backed immutable files: only requested chunks are fetched; bounded verified LRU cache.
import { normalizeAssetPath } from './vfs';
export interface FileChunk { offset: number; size: number; url: string; sha256: string; missing?: boolean }
export class OutsideDataRange extends Error {
  constructor(readonly path:string,readonly offset:number,readonly length:number){super(`outside this slice: ${path} at ${offset}+${length}`);}
}
export interface StreamedFile { path: string; size: number; chunkSize: number; chunks: FileChunk[] }
export interface RangeRead { path: string; offset: number; length: number }
export class RangeFiles {
  private files = new Map<string, StreamedFile>();
  private cache = new Map<string, Uint8Array<ArrayBuffer>>();
  private pending = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  private bytes = 0;
  private reads = new Map<string, RangeRead>();
  fetchedBytes = 0;
  constructor(private readonly base: string, private readonly fetcher: typeof fetch = (input,init) => globalThis.fetch(input,init), readonly cacheBudget = 16*1024*1024) {}
  add(file: StreamedFile): void {
    if (!normalizeAssetPath(file.path) || !Number.isSafeInteger(file.size) || file.size<0 || !Number.isInteger(file.chunkSize) || file.chunkSize<4096 || file.chunkSize>1024*1024) throw new Error('invalid streamed file');
    let end=0;
    for (const c of file.chunks) {
      if (c.offset!==end || !Number.isInteger(c.size) || c.size<1 || c.size>file.chunkSize || !/^[a-f0-9]{64}$/.test(c.sha256)) throw new Error('invalid streamed chunk');
      if (!c.url || /(^\/|\.\.|:|\\)/.test(c.url)) throw new Error('unsafe streamed chunk URL');
      end+=c.size;
    }
    if(end!==file.size) throw new Error('streamed chunks do not cover file');
    this.files.set(file.path,file);
  }
  coverage(): RangeRead[] { return [...this.reads.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.offset-b.offset); }
  get cacheBytes(): number { return this.bytes; }
  private async chunk(c: FileChunk): Promise<Uint8Array<ArrayBuffer>> {
    const key=c.sha256, cached=this.cache.get(key);
    if(cached) { this.cache.delete(key);this.cache.set(key,cached);return cached; }
    const pending=this.pending.get(key);if(pending)return pending;
    const promise=(async()=>{
      const r=await this.fetcher(this.base+c.url);
      if(!r.ok)throw new Error(`stream chunk HTTP ${r.status}`);
      const reader=r.body?.getReader(); const data=new Uint8Array(c.size);let n=0;
      if(reader) for(;;) { const part=await reader.read();if(part.done)break;if(n+part.value.length>data.length){await reader.cancel();throw new Error('oversized stream chunk');}data.set(part.value,n);n+=part.value.length; }
      else { const b=new Uint8Array(await r.arrayBuffer());if(b.length>data.length)throw new Error('oversized stream chunk');data.set(b);n=b.length; }
      if(n!==c.size)throw new Error('short stream chunk');
      if(!globalThis.crypto?.subtle)throw new Error('stream integrity requires a secure context');
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
      const hash=[...digest].map((v)=>v.toString(16).padStart(2,'0')).join('');
      if(hash!==c.sha256)throw new Error('stream chunk integrity mismatch');
      this.fetchedBytes+=data.length;
      while(this.bytes+data.length>this.cacheBudget && this.cache.size) {
        const [old,bytes]=this.cache.entries().next().value!;this.cache.delete(old);this.bytes-=bytes.length;
      }
      if(data.length<=this.cacheBudget){this.cache.set(key,data);this.bytes+=data.length;}
      return data;
    })();
    this.pending.set(key,promise);
    try{return await promise;}finally{this.pending.delete(key);}
  }
  async read(path: string, offset: number, length: number, ahead = false): Promise<Uint8Array<ArrayBuffer>> {
    const file=this.files.get(path);if(!file)throw new Error('unknown streamed path');
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(length)||length<0||length>8*1024*1024)throw new Error('invalid streamed range');
    let size=Math.max(0,Math.min(length,file.size-offset));const out=new Uint8Array(size);let n=0;
    // Binary search the first overlapping chunk, avoiding a linear scan of a multi-GB file.
    let lo=0,hi=file.chunks.length;
    while(lo<hi){const m=(lo+hi)>>>1;if(file.chunks[m].offset+file.chunks[m].size<=offset)lo=m+1;else hi=m;}
    // Speculation never crosses even a small manifest chunk / omitted slice boundary.
    if(ahead && lo<file.chunks.length)size=Math.min(size,file.chunks[lo].offset+file.chunks[lo].size-offset);
    for(let i=lo;i<file.chunks.length&&n<size;i++) {
      const c=file.chunks[i];if(!ahead)this.reads.set(`${path}:${c.offset}`,{path,offset:c.offset,length:c.size});
      if(c.missing)throw new OutsideDataRange(path,c.offset,c.size);
      const b=await this.chunk(c),start=Math.max(0,offset-c.offset),count=Math.min(b.length-start,size-n);
      out.set(b.subarray(start,start+count),n);n+=count;
    }
    return out.subarray(0,n);
  }
}
