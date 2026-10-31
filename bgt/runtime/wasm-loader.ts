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
}

export async function compileVerifiedWasm(response: Response, expected: { size: number; sha256: string },
  progress: (bytes: number) => void = () => {}): Promise<WasmLoadResult> {
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
  const streaming = typeof WebAssembly.compileStreaming === 'function' && !!response.body &&
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/wasm';
  const copy = streaming ? response.clone() : response;
  const compiled = streaming ? WebAssembly.compileStreaming(response) : null;
  // Attach a rejection handler immediately; an early compile error must not be unhandled during download.
  const compileResult = compiled?.then((module) => ({module}), (error: unknown) => ({error}));
  const chunks: Uint8Array[] = []; let size = 0;
  if (copy.body) {
    const reader = copy.body.getReader();
    try {
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > expected.size) throw new Error('game.wasm exceeds manifest size');
        chunks.push(value); progress(value.byteLength);
      }
    } catch (e) { void reader.cancel().catch(() => {}); throw e; }
    finally { reader.releaseLock(); }
  } else {
    const b = new Uint8Array(await copy.arrayBuffer()); chunks.push(b); size = b.length; progress(size);
  }
  if (size !== expected.size) throw new Error('game.wasm size does not match manifest');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c,offset); offset += c.length; }
  const got = await sha256Hex(bytes.buffer);
  if (got && got !== expected.sha256) throw new Error('integrity check failed for game.wasm');
  const result = await compileResult;
  if (result && 'error' in result) throw result.error;
  const module = result?.module ?? await WebAssembly.compile(bytes);
  return {module,streaming,downloadCompileVerifyMs:performance.now()-start};
}
