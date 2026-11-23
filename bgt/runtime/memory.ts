// K64 memory attribution: what the runtime can see of a game's footprint, by component.
// Pure math lives here so it is unit-testable; the runtime and renderers only supply the inputs.
// Everything is an ESTIMATE from runtime-owned accounting. Real process RSS (WebContent/GPU process on
// iPhone Safari) is not observable from a page and stays a hardware gate (docs/performance.md §Memory).

/** Default iPhone-class tab budget for the estimated total (1.5 GiB). Configurable per game/run. */
export const MEMORY_BUDGET_DEFAULT = 1536 * 1024 * 1024;
export const MEMORY_BUDGET_MIN = 16 * 1024 * 1024;
export const MEMORY_BUDGET_MAX = 64 * 1024 * 1024 * 1024;
/** When the runtime samples the estimate for `peakTotalBytes` (vK64). Spikes between samples are not seen. */
export const PEAK_SAMPLING = 'sampled at load milestones (game.wasm compiled, with its download buffer; instantiated; ' +
  'initialized; ready; first frame), every 30 presents and on every memory()/diagnostics() read';
/** Canvas backing store estimate: drawing buffer + one presented/swap buffer of RGBA8. */
export const CANVAS_BUFFERS = 2;

/** Native GPU objects a §13 executor holds, computed from its own resource tables. */
export interface GpuNativeMemory {
  backend: 'webgpu' | 'webgl2';
  /** bytes: guest-visible sizes (equal to the decoder's reservation); nativeBytes: allocation incl. padding. */
  buffers: { count: number; bytes: number; nativeBytes: number };
  /** Materialized mip levels × texel bytes; depthStencilBytes is the part in depth/stencil formats. `count` is every
   * live texture. K71 (Q128): `lazy` are reserved levels without native storage yet (created on first use), so
   * `bytes + lazy.bytes` equals the decoder's texture reservation once every item has executed. */
  textures: { count: number; bytes: number; depthStencilBytes: number;
    lazy?: { count: number; bytes: number; depthStencilBytes: number } };
  /** The kit allocates no renderbuffers (depth/stencil attachments are textures); kept explicit. */
  renderbuffers: { count: number; bytes: number };
  /** Renderer-owned objects that are not guest resources (logical screen, copy-on-write pool, scratch). */
  internal: { bytes: number; screenBytes: number; poolBytes: number; scratchBytes: number };
  /** CPU (JS heap) copies the executor keeps to restore contents after device/context loss. */
  shadows: { bufferBytes: number; textureBytes: number };
}

export interface GuestMemory {
  /** Highest guest address mapped in the flat window (drives linear memory size), if reported. */
  committedBytes: number | null;
  heapBytes: number | null;
  virtualLiveBytes: number | null;
  virtualPeakBytes: number | null;
  hostBytes: number | null;
  hostPeakBytes: number | null;
  hostReservedBytes: number | null;
  /** GL frontend's guest-side copies of buffer/texture data (wasm linear memory). */
  glFrontendBytes: number | null;
  glFrontendPeakBytes: number | null;
}

export interface MemoryInputs {
  wasm: { linearBytes: number; initialBytes: number; moduleBytes: number };
  guest: GuestMemory | null;
  gpu: {
    budgetBytes: number; reservedBytes: number; peakReservedBytes: number;
    reserved: { buffers: number; textures: number; shaders: number };
  } | null;
  native: GpuNativeMemory | null;
  /** v0.1/v0.2 texture table: one RGBA8 native texture per entry plus its CPU shadow. */
  legacyTextureBytes: number;
  canvas: { width: number; height: number };
  /** K71: texture recovery shadow policy (absent: default on). */
  recoveryShadows?: RecoveryShadowPolicy;
  js: { assetBytes: number; streamCacheBytes: number; gpuDecoderShadowBytes: number; audioQueuedBytes: number;
    /** Load-time buffers still held (the verified game.wasm bytes until compilation finishes); 0 after load. */
    loadBuffersBytes: number;
    heapUsedBytes: number | null };
  budget: { bytes: number; source: MemoryBudgetSource };
}

export type MemoryBudgetSource = 'default' | 'manifest' | 'option' | 'url';

/** K71 (Q129): whether executors keep CPU copies of uploaded texture levels for GPU loss recovery. */
export interface RecoveryShadowPolicy { enabled: boolean; source: MemoryBudgetSource }
/** Resolve `gpu.recoveryShadows`: explicit option > `?recoveryshadows=0|1` > manifest > default (on, today's
 * behaviour). Off: no texture upload shadows; a device/context loss after any texture upload is a reported fatal
 * error (`device-lost`), never a silent restore with missing texels. Invalid URL values throw (reported, ignored). */
export function resolveRecoveryShadows(option?: boolean, url?: string | null, manifest?: unknown): RecoveryShadowPolicy {
  if (option !== undefined) return { enabled: option, source: 'option' };
  if (url !== null && url !== undefined && url !== '') {
    if (url !== '0' && url !== '1') throw new RangeError(`invalid ?recoveryshadows=${url} (use 0 or 1)`);
    return { enabled: url === '1', source: 'url' };
  }
  if (manifest !== undefined) {
    if (typeof manifest !== 'boolean') throw new RangeError('manifest gpu.recoveryShadows must be a boolean');
    return { enabled: manifest, source: 'manifest' };
  }
  return { enabled: true, source: 'default' };
}

export interface MemoryDiagnostics {
  schema: 'bgt-memory/1';
  wasm: { linearBytes: number; peakLinearBytes: number; initialBytes: number; moduleBytes: number;
    /** Machine code the engine compiled from the module: not observable from a page. */
    compiledBytes: null };
  guest: GuestMemory | null;
  gpu: (NonNullable<MemoryInputs['gpu']> & { native: GpuNativeMemory | null; legacyTextureBytes: number;
    canvasBytesEstimate: number; recoveryShadows: RecoveryShadowPolicy }) | null;
  js: MemoryInputs['js'] & { gpuRecoveryShadowBytes: number; legacyTextureShadowBytes: number; heldBytes: number };
  estimate: {
    totalBytes: number;
    /** Sampled high-water mark: the maximum over samples, not a continuous measurement (see PEAK_SAMPLING). */
    peakTotalBytes: number; peakSampling: string;
    components: { wasmLinear: number; wasmModule: number; gpuNative: number; jsHeld: number };
    budgetBytes: number; budgetSource: MemoryBudgetSource; overBudget: boolean; status: 'ok' | 'over-budget';
    scope: string;
  };
}

const n = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
};

/** Guest-side memory from the platform profile's bgt_metrics JSON (Win32 profile); null for native games. */
export function guestMemoryFromMetrics(metrics: unknown): GuestMemory | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const m = metrics as Record<string, unknown>;
  const g: GuestMemory = {
    committedBytes: n(m.guest_committed_bytes), heapBytes: n(m.heap_bytes),
    virtualLiveBytes: n(m.virtual_live_bytes), virtualPeakBytes: n(m.virtual_peak_bytes),
    hostBytes: n(m.host_bytes), hostPeakBytes: n(m.host_peak), hostReservedBytes: n(m.host_reserved),
    glFrontendBytes: n(m.gl_frontend_bytes), glFrontendPeakBytes: n(m.gl_frontend_peak),
  };
  return Object.values(g).some((v) => v !== null) ? g : null;
}

/** Resolve the configured budget: explicit option > URL > manifest > default; invalid values are rejected. */
export function resolveMemoryBudget(option?: number, url?: string | null, manifest?: number):
  { bytes: number; source: MemoryBudgetSource } {
  const valid = (v: number) => Number.isSafeInteger(v) && v >= MEMORY_BUDGET_MIN && v <= MEMORY_BUDGET_MAX;
  const check = (v: number, what: string) => {
    if (!valid(v)) throw new RangeError(`${what} memory budget must be an integer byte count in [${MEMORY_BUDGET_MIN}, ${MEMORY_BUDGET_MAX}]`);
    return v;
  };
  if (option !== undefined) return { bytes: check(option, 'option'), source: 'option' };
  if (url !== null && url !== undefined && url !== '') {
    // ?memorybudget= accepts bytes or a MiB/GiB suffix, e.g. 1536m, 1.5g.
    const m = /^(\d+(?:\.\d+)?)([mg]?)$/i.exec(url.trim());
    if (!m) throw new RangeError(`invalid ?memorybudget=${url}`);
    const scale = m[2].toLowerCase() === 'g' ? 1024 ** 3 : m[2].toLowerCase() === 'm' ? 1024 ** 2 : 1;
    return { bytes: check(Math.round(Number(m[1]) * scale), 'URL'), source: 'url' };
  }
  if (manifest !== undefined) return { bytes: check(manifest, 'manifest'), source: 'manifest' };
  return { bytes: MEMORY_BUDGET_DEFAULT, source: 'default' };
}

/** Bytes of a texture's allocated levels [0, allocatedMips). Layers are constant; 3D depth halves per level. */
export function textureLevelBytes(t: { width: number; height: number; depth: number; dimension: number },
  allocatedMips: number, texelBytes: number): number {
  let bytes = 0;
  for (let mip = 0; mip < allocatedMips; mip++) {
    const w = Math.max(1, t.width >> mip), h = Math.max(1, t.height >> mip);
    const d = t.dimension === 1 ? Math.max(1, t.depth >> mip) : t.depth;
    bytes += w * h * d * texelBytes;
  }
  return bytes;
}

/** Combine the parts. Components are disjoint: each byte is counted once, in the place that holds it. */
export function memoryBreakdown(input: MemoryInputs, peaks: { linear: number; total: number }): MemoryDiagnostics {
  const native = input.native;
  const canvasBytesEstimate = Math.max(0, input.canvas.width * input.canvas.height * 4 * CANVAS_BUFFERS);
  const gpuNative = (native ? native.buffers.nativeBytes + native.textures.bytes + native.renderbuffers.bytes + native.internal.bytes : 0)
    + input.legacyTextureBytes + canvasBytesEstimate;
  const gpuRecoveryShadowBytes = native ? native.shadows.bufferBytes + native.shadows.textureBytes : 0;
  const legacyTextureShadowBytes = input.legacyTextureBytes;
  const js = input.js;
  const heldBytes = js.assetBytes + js.streamCacheBytes + js.gpuDecoderShadowBytes + js.audioQueuedBytes + js.loadBuffersBytes
    + gpuRecoveryShadowBytes + legacyTextureShadowBytes;
  const components = { wasmLinear: input.wasm.linearBytes, wasmModule: input.wasm.moduleBytes, gpuNative, jsHeld: heldBytes };
  const totalBytes = components.wasmLinear + components.wasmModule + components.gpuNative + components.jsHeld;
  const overBudget = totalBytes > input.budget.bytes;
  return {
    schema: 'bgt-memory/1',
    wasm: { ...input.wasm, peakLinearBytes: Math.max(peaks.linear, input.wasm.linearBytes), compiledBytes: null },
    guest: input.guest,
    gpu: input.gpu || native || input.legacyTextureBytes ? {
      ...(input.gpu ?? { budgetBytes: 0, reservedBytes: 0, peakReservedBytes: 0, reserved: { buffers: 0, textures: 0, shaders: 0 } }),
      native, legacyTextureBytes: input.legacyTextureBytes, canvasBytesEstimate,
      recoveryShadows: input.recoveryShadows ?? { enabled: true, source: 'default' } } : null,
    js: { ...js, gpuRecoveryShadowBytes, legacyTextureShadowBytes, heldBytes },
    estimate: {
      totalBytes, peakTotalBytes: Math.max(peaks.total, totalBytes), peakSampling: PEAK_SAMPLING, components,
      budgetBytes: input.budget.bytes, budgetSource: input.budget.source, overBudget,
      status: overBudget ? 'over-budget' : 'ok',
      scope: 'runtime-owned bytes (wasm linear memory, module bytes, native GPU objects, JS-held copies); excludes compiled ' +
        'machine code, browser/driver overhead and the JS engine; not process RSS, which on iPhone Safari is a hardware gate',
    },
  };
}
