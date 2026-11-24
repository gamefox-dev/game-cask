// Compile while downloading, but never hand an unverified module to GameHost.
// SHA-256 currently needs the complete bytes; streaming saves compile latency, not that buffer.
async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // existing insecure-context integrity limitation
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,'0')).join('');
}

export interface WasmLoadResult {
  module: WebAssembly.Module;
  streaming: boolean;
  downloadCompileVerifyMs: number;
  /** K64 load evidence: why streaming compilation was (not) used, and what the server sent. */
  streamingReason: 'streaming' | 'no-compileStreaming' | 'no-body' | 'wrong-content-type' | 'checkpoint-rewrite';
  contentType: string | null;
  contentEncoding: string | null;
  /** The module's own linear memory limits (bytes), from its memory section; null if imported/absent. */
  memoryLimits: { initialBytes: number; maximumBytes: number | null } | null;
}

/** K64: exported memory limits from the module bytes. Walks section headers only (stops at the memory section). */
export function wasmMemoryLimits(bytes: Uint8Array): { initialBytes: number; maximumBytes: number | null } | null {
  let p = 8;
  const leb = (): number => {
    let result = 0, shift = 0;
    for (;;) {
      if (p >= bytes.length || shift > 35) throw new Error('truncated LEB128');
      const b = bytes[p++]; result += (b & 0x7f) * 2 ** shift; shift += 7;
      if (!(b & 0x80)) return result;
    }
  };
  try {
    if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) return null;
    while (p < bytes.length) {
      const id = bytes[p++], size = leb(), end = p + size;
      if (id === 5) {
        if (leb() < 1) return null;
        const flags = leb(); if (flags & 4) return null; // memory64: not a BGT layout
        const initial = leb(), maximum = flags & 1 ? leb() : null;
        return { initialBytes: initial * 65536, maximumBytes: maximum === null ? null : maximum * 65536 };
      }
      // Known sections are ordered and every one with id > 5 (incl. tag 13, data count 12) follows memory.
      if (id > 5) return null;
      p = end;
    }
  } catch { /* malformed: the compiler reports it */ }
  return null;
}

export async function compileVerifiedWasm(response: Response, expected: { size: number; sha256: string },
  progress: (bytes: number) => void = () => {}, checkpoint = false): Promise<WasmLoadResult> {
  if (!response.ok) throw new Error(`failed to load game.wasm (HTTP ${response.status})`);
  if (!Number.isSafeInteger(expected.size) || expected.size < 0) throw new Error('invalid game.wasm manifest size');
  const start = performance.now();
  // Enforce the bound upstream of tee/compileStreaming: cancelling only the hash
  // branch would leave the compiler consuming an arbitrarily large response.
  if (response.body) {
    let observed = 0;
    const bounded = response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
      transform(chunk,controller) {
        observed += chunk.byteLength;
        if (observed > expected.size) controller.error(new Error('game.wasm exceeds manifest size'));
        else controller.enqueue(chunk);
      },
    }));
    response = new Response(bounded,{status:response.status,headers:response.headers});
  }
  const contentType = response.headers.get('content-type'), contentEncoding = response.headers.get('content-encoding');
  const streamingReason: WasmLoadResult['streamingReason'] = typeof WebAssembly.compileStreaming !== 'function' ? 'no-compileStreaming' :
    !response.body ? 'no-body' : contentType?.split(';')[0].trim().toLowerCase() !== 'application/wasm' ? 'wrong-content-type' : 'streaming';
  // Keep the dynamic import under the build-time guard so flag-off builds
  // do not emit a savestate chunk. Only compile the bytes we will instantiate.
  const rewrite = (typeof import.meta.env !== 'undefined' && (import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1')) && checkpoint
    ? async (bytes: Uint8Array<ArrayBuffer>) => (await import('./savestate-wasm')).instrumentCheckpointWasm(bytes,true) : undefined;
  const streaming = streamingReason === 'streaming' && !rewrite;
  const copy = streaming ? response.clone() : response;
  const compiled = streaming ? WebAssembly.compileStreaming(response) : null;
  // Attach a rejection handler immediately; an early compile error must not be unhandled during download.
  const compileResult = compiled?.then((module) => ({module}), (error: unknown) => ({error}));
  // K64: write chunks straight into one buffer of the manifest size. Collecting chunks and then concatenating
  // held the module twice (273 MB -> 546 MB transient for a large lifted game) at the load-time peak.
  let bytes: Uint8Array<ArrayBuffer>; let size = 0;
  if (copy.body) {
    bytes = new Uint8Array(expected.size);
    const reader = copy.body.getReader();
    try {
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        if (size + value.byteLength > expected.size) throw new Error('game.wasm exceeds manifest size');
        bytes.set(value,size); size += value.byteLength; progress(value.byteLength);
      }
    } catch (e) { void reader.cancel().catch(() => {}); throw e; }
    finally { reader.releaseLock(); }
  } else {
    bytes = new Uint8Array(await copy.arrayBuffer()); size = bytes.length; progress(size);
  }
  if (size !== expected.size) throw new Error('game.wasm size does not match manifest');
  const got = await sha256Hex(bytes.buffer);
  if (got && got !== expected.sha256) throw new Error('integrity check failed for game.wasm');
  const result = await compileResult;
  if (result && 'error' in result) throw result.error;
  const module = result?.module ?? await WebAssembly.compile(rewrite ? await rewrite(bytes) : bytes);
  return {module,streaming,downloadCompileVerifyMs:performance.now()-start,
    streamingReason:rewrite?'checkpoint-rewrite':streamingReason,contentType,contentEncoding,
    memoryLimits:wasmMemoryLimits(bytes)};
}
