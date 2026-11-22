// SPDX-License-Identifier: CC0-1.0
// K64: load-phase math, compression evidence, wasm memory limits and the single-buffer loader.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { compileVerifiedWasm, wasmMemoryLimits } from '../../bgt/runtime/wasm-loader';
import { compressionOf, loadSummary, type LoadMarks } from '../../bgt/runtime/load-metrics';

// (module (type (func)) (memory (export "memory") 2 10))
const withMemory = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  1, 4, 1, 0x60, 0, 0, // type section: one func type
  0, 3, 1, 0x61, 0, // custom section "a"
  5, 4, 1, 1, 2, 10, // memory: has max, min 2 pages, max 10
  7, 10, 1, 6, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 2, 0]);
const header = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

describe('wasm memory limits', () => {
  it('reads initial and maximum pages from the memory section', () => {
    expect(WebAssembly.validate(withMemory)).toBe(true);
    expect(wasmMemoryLimits(withMemory)).toEqual({ initialBytes: 2 * 65536, maximumBytes: 10 * 65536 });
  });
  it('a multi-byte LEB initial without maximum', () => {
    // 300 pages = 0xac 0x02
    const m = new Uint8Array([...header, 5, 4, 1, 0, 0xac, 0x02]);
    expect(WebAssembly.validate(m)).toBe(true);
    expect(wasmMemoryLimits(m)).toEqual({ initialBytes: 300 * 65536, maximumBytes: null });
  });
  it('null without a memory section, for non-wasm or truncated bytes', () => {
    expect(wasmMemoryLimits(header)).toBeNull();
    expect(wasmMemoryLimits(new Uint8Array([...header, 10, 1, 0]))).toBeNull(); // code section first
    expect(wasmMemoryLimits(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(wasmMemoryLimits(new Uint8Array([...header, 5, 4, 1, 1, 0x80]))).toBeNull();
  });
});

describe('single-buffer loader', () => {
  const expected = { size: withMemory.length, sha256: createHash('sha256').update(withMemory).digest('hex') };
  const chunked = (type: string) => new Response(new ReadableStream<Uint8Array>({ start(c) {
    for (let i = 0; i < withMemory.length; i += 5) c.enqueue(withMemory.slice(i, i + 5)); c.close();
  } }), { headers: { 'content-type': type, 'content-encoding': 'br' } });
  it.each([['application/wasm', true, 'streaming'], ['application/octet-stream', false, 'wrong-content-type']] as const)(
    'assembles chunks in place (%s) and reports delivery evidence', async (type, streaming, reason) => {
      let n = 0;
      const r = await compileVerifiedWasm(chunked(type), expected, (b) => n += b);
      expect(r.module).toBeInstanceOf(WebAssembly.Module);
      expect(WebAssembly.Module.exports(r.module)).toEqual([{ name: 'memory', kind: 'memory' }]);
      expect(n).toBe(withMemory.length);
      expect(r).toMatchObject({ streaming, streamingReason: reason, contentType: type, contentEncoding: 'br',
        memoryLimits: { initialBytes: 131072, maximumBytes: 655360 } });
    });
  it('still rejects a short body against the preallocated manifest size', async () => {
    await expect(compileVerifiedWasm(chunked('application/wasm'), { ...expected, size: expected.size + 4 })).rejects.toThrow(/size/);
  });
});

describe('load summary', () => {
  const marks: LoadMarks = { manifestMs: 5, wasmMs: 120, assetsMs: 40, instantiateMs: 8, initMs: 3, readyMs: 140,
    firstFrameMs: 160, firstUpdateMs: 155 };
  it('compression evidence from headers or resource timing', () => {
    expect(compressionOf(null, null)).toEqual({ ratio: null, compressed: null });
    expect(compressionOf(null, 'gzip')).toEqual({ ratio: null, compressed: true });
    expect(compressionOf(null, 'identity')).toEqual({ ratio: null, compressed: false });
    const t = { transferSize: 300, encodedBodySize: 250, decodedBodySize: 1000, durationMs: 9 };
    expect(compressionOf(t, null)).toEqual({ ratio: 0.25, compressed: true });
    expect(compressionOf({ ...t, encodedBodySize: 1000 }, null)).toEqual({ ratio: 1, compressed: false });
    expect(compressionOf({ ...t, encodedBodySize: 0, decodedBodySize: 0 }, null)).toEqual({ ratio: null, compressed: null });
  });
  it('copies marks and exposes time to first frame / interactive update', () => {
    const s = loadSummary(marks, { url: 'games/x/game.wasm', bytes: 1000, streamingReason: 'streaming', contentType: 'application/wasm',
      contentEncoding: null, memoryLimits: { initialBytes: 65536, maximumBytes: null } }, null,
    { downloadCompileVerifyMs: 110, instantiateMs: 8, streaming: true, assetBytes: 77 });
    expect(s).toMatchObject({ schema: 'bgt-load/1', timeToFirstFrameMs: 160, timeToFirstInteractiveUpdateMs: 155, assetBytes: 77,
      wasm: { bytes: 1000, streaming: true, initialMemoryBytes: 65536, maximumMemoryBytes: null, compressed: null } });
    marks.firstFrameMs = 999;
    expect(s.marks.firstFrameMs).toBe(160);
    expect(loadSummary(marks, null, null, { downloadCompileVerifyMs: 0, instantiateMs: 0, streaming: false, assetBytes: 0 }).wasm.url).toBeNull();
  });
});
