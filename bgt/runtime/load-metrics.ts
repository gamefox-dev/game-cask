// K64 load metrics: phase times since BGTRuntime.load() started, and how the server delivered game.wasm.
// Pure so the math is unit-testable; the runtime records the marks.

/** Milliseconds since load start (performance.now() based), null until reached. */
export interface LoadMarks {
  manifestMs: number | null;
  /** game.wasm downloaded, compiled and verified (streaming compilation overlaps the download). */
  wasmMs: number | null;
  /** all preloaded assets fetched and verified (in parallel with the wasm). */
  assetsMs: number | null;
  /** WebAssembly.instantiate duration (not a mark: a span). */
  instantiateMs: number | null;
  /** bgt_init duration (span). */
  initMs: number | null;
  readyMs: number | null;
  firstFrameMs: number | null;
  /** First completed bgt_update once ready: input is live from here (measure without ?paused=1). */
  firstUpdateMs: number | null;
}

export interface ResourceTransfer { transferSize: number; encodedBodySize: number; decodedBodySize: number; durationMs: number }

export interface LoadDiagnostics {
  schema: 'bgt-load/1';
  marks: LoadMarks;
  wasm: {
    url: string | null; bytes: number; downloadCompileVerifyMs: number; instantiateMs: number;
    streaming: boolean; streamingReason: string | null; contentType: string | null; contentEncoding: string | null;
    /** From PerformanceResourceTiming once available (0 sizes for a cache hit or an opaque cross-origin entry). */
    transfer: ResourceTransfer | null;
    /** encodedBodySize / decodedBodySize; < 1 means the server compressed the transfer. null when unknown. */
    compressionRatio: number | null;
    compressed: boolean | null;
    initialMemoryBytes: number | null; maximumMemoryBytes: number | null;
  };
  assetBytes: number;
  /** Time to first frame and to the first interactive update (copies of the marks, for quick reading). */
  timeToFirstFrameMs: number | null;
  timeToFirstInteractiveUpdateMs: number | null;
}

export function compressionOf(transfer: ResourceTransfer | null, contentEncoding: string | null): { ratio: number | null; compressed: boolean | null } {
  const encoded = transfer?.encodedBodySize ?? 0, decoded = transfer?.decodedBodySize ?? 0;
  const ratio = encoded > 0 && decoded > 0 ? encoded / decoded : null;
  const enc = contentEncoding?.trim().toLowerCase();
  if (enc && enc !== 'identity') return { ratio, compressed: true };
  return { ratio, compressed: ratio === null ? (enc === 'identity' ? false : null) : ratio < 0.999 };
}

export function loadSummary(marks: LoadMarks,
  wasm: { url: string; bytes: number; streamingReason: string; contentType: string | null; contentEncoding: string | null;
    memoryLimits: { initialBytes: number; maximumBytes: number | null } | null } | null,
  transfer: ResourceTransfer | null,
  timing: { downloadCompileVerifyMs: number; instantiateMs: number; streaming: boolean; assetBytes: number }): LoadDiagnostics {
  const c = compressionOf(transfer, wasm?.contentEncoding ?? null);
  return {
    schema: 'bgt-load/1', marks: { ...marks },
    wasm: { url: wasm?.url ?? null, bytes: wasm?.bytes ?? 0, downloadCompileVerifyMs: timing.downloadCompileVerifyMs,
      instantiateMs: timing.instantiateMs, streaming: timing.streaming, streamingReason: wasm?.streamingReason ?? null,
      contentType: wasm?.contentType ?? null, contentEncoding: wasm?.contentEncoding ?? null, transfer: transfer ? { ...transfer } : null,
      compressionRatio: c.ratio, compressed: c.compressed,
      initialMemoryBytes: wasm?.memoryLimits?.initialBytes ?? null, maximumMemoryBytes: wasm?.memoryLimits?.maximumBytes ?? null },
    assetBytes: timing.assetBytes,
    timeToFirstFrameMs: marks.firstFrameMs, timeToFirstInteractiveUpdateMs: marks.firstUpdateMs,
  };
}
