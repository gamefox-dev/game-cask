// K74 (Q137): what the browser's GPU process holds for a game beyond the native objects the executors count.
//
// `memory().gpu.native` counts the bytes of the §13 objects the executors created. The GPU process holds more: the
// canvas swap chain (drawing buffer plus the compositor's surfaces), depth/stencil padding, and the upload staging it
// keeps after write calls (Chromium's WebGPU: sized by the largest call, hence the executor's upload bands). None of that
// is observable from a page, so this module models it from factors measured in isolation by
// `npm run bench:gpu-footprint` (tools/report/gpu-footprint.mjs: one browser per scenario, a page without the runtime,
// a known allocation, macOS `footprint` of the GPU process before and after). The browser's own GPU-process memory with
// no context (`baseBytes`) is reported beside it and never counted: it is there for every page.
//
// Desktop Chromium/WebKit on Apple silicon is what was measured; the iPhone remains a hardware gate.

export type GpuEngine = 'chromium' | 'webkit';
export type GpuApi = 'webgl2' | 'webgpu';

export interface GpuOverheadFactors {
  /** Where the numbers come from (tool, browser build, host). */
  source: string;
  /** GPU process of an active page without any context (browser compositor, caches): reported, never counted.
   * Chromium trims it to ~80-92 MB after ~8 s without presents; pages that render keep ~157-160 MB. */
  baseBytes: number;
  /** Canvas surfaces per canvas pixel (drawing buffer + swap chain + compositor copies; the in-page resize slope), and
   * a fixed part (the context itself: what a 960x540 context costs beyond the slope). */
  canvasBytesPerPixel: number;
  canvasFixedBytes: number;
  /** Extra GPU-process bytes per depth/stencil texture byte (Metal has no packed D24S8: it stores D32F+S8). Color
   * formats (R8, RG8, RGBA8, RGBA16F, mip chains) and buffers measured 0.93-1.08 bytes per byte: no factor. */
  depthStencilFactor: number;
  /** Upload staging the browser keeps once uploads happened: max(fixed, perLargest x the largest single call). */
  stagingFixedBytes: number;
  stagingPerLargestUpload: number;
}

const MiB = 2 ** 20;
/** Measured with `npm run bench:gpu-footprint` (K74 handoff has the table). */
export const GPU_OVERHEAD_FACTORS: Record<GpuEngine, Record<GpuApi, GpuOverheadFactors>> = {
  chromium: {
    webgl2: { source: 'K74 bench:gpu-footprint, Chromium 1248 (ANGLE Metal), Apple M4', baseBytes: 158 * MiB,
      canvasBytesPerPixel: 17.6, canvasFixedBytes: 16 * MiB, depthStencilFactor: 0.3, stagingFixedBytes: 14 * MiB, stagingPerLargestUpload: 2 },
    webgpu: { source: 'K74 bench:gpu-footprint, Chromium 1248 (Dawn Metal), Apple M4', baseBytes: 158 * MiB,
      canvasBytesPerPixel: 13, canvasFixedBytes: 14 * MiB, depthStencilFactor: 0.2, stagingFixedBytes: 32 * MiB, stagingPerLargestUpload: 8.5 },
  },
  webkit: {
    webgl2: { source: 'K74 bench:gpu-footprint, WebKit 2370 (ANGLE Metal), Apple M4', baseBytes: 24 * MiB,
      canvasBytesPerPixel: 17.2, canvasFixedBytes: 2 * MiB, depthStencilFactor: 0.27, stagingFixedBytes: 0, stagingPerLargestUpload: 0 },
    webgpu: { source: 'K74 bench:gpu-footprint, WebKit 2370 (Metal), Apple M4', baseBytes: 24 * MiB,
      canvasBytesPerPixel: 15.7, canvasFixedBytes: 1 * MiB, depthStencilFactor: 0.27, stagingFixedBytes: 0, stagingPerLargestUpload: 0 },
  },
};

/** The page's engine from its user agent (Chromium-based or WebKit/Safari); null when neither. */
export function gpuEngine(userAgent: string): GpuEngine | null {
  if (/\b(Chrome|Chromium|HeadlessChrome|Edg)\//.test(userAgent)) return 'chromium';
  if (/AppleWebKit\//.test(userAgent) && !/\bGecko\)\s+Chrome/.test(userAgent)) return 'webkit';
  return null;
}

export interface GpuOverheadInputs {
  engine: GpuEngine | null;
  api: GpuApi;
  canvas: { width: number; height: number };
  /** What gpuNative already counts for the canvas (memory.ts CANVAS_BUFFERS RGBA8 copies). */
  canvasCountedBytes: number;
  /** Materialized depth/stencil texture bytes (native.textures.depthStencilBytes). */
  depthStencilBytes: number;
  /** Renderer presentation intermediates not in `native` (the retained full-canvas snapshot). */
  presentationBytes: number;
  /** Largest single upload call the executor issued so far (texture or buffer write); 0 = no upload yet. */
  largestUploadBytes: number;
}

export interface GpuOverhead {
  /** Factors used: engine/API and their measurement source; `assumed` when the engine was not recognized. */
  model: { engine: GpuEngine; api: GpuApi; source: string; assumed: boolean };
  /** Canvas surfaces beyond the `CANVAS_BUFFERS` copies gpuNative already counts. */
  canvasBytes: number;
  /** Runtime-owned presentation textures outside the executors (WebGL 2's retained full-canvas snapshot). */
  presentationBytes: number;
  /** Depth/stencil storage the backend pads (D24S8 as D32F+S8). */
  depthStencilBytes: number;
  /** Upload staging kept by the browser after write calls. */
  stagingBytes: number;
  /** Sum of the above: counted in `estimate.components.gpuOverhead`. */
  totalBytes: number;
  /** The browser's GPU process with no context at all: informational, not counted. */
  browserBaseBytes: number;
}

export function gpuOverhead(i: GpuOverheadInputs): GpuOverhead {
  const engine = i.engine ?? 'chromium', f = GPU_OVERHEAD_FACTORS[engine][i.api];
  const pixels = Math.max(0, i.canvas.width * i.canvas.height);
  const canvasBytes = pixels ? Math.max(0, Math.round(pixels * f.canvasBytesPerPixel + f.canvasFixedBytes) - i.canvasCountedBytes) : 0;
  const depthStencilBytes = Math.round(Math.max(0, i.depthStencilBytes) * f.depthStencilFactor);
  const stagingBytes = i.largestUploadBytes > 0 ? Math.round(Math.max(f.stagingFixedBytes, i.largestUploadBytes * f.stagingPerLargestUpload)) : 0;
  const presentationBytes = Math.max(0, i.presentationBytes);
  return { model: { engine, api: i.api, source: f.source, assumed: i.engine === null },
    canvasBytes, presentationBytes, depthStencilBytes, stagingBytes,
    totalBytes: canvasBytes + presentationBytes + depthStencilBytes + stagingBytes, browserBaseBytes: f.baseBytes };
}
