// Backend-neutral renderer contract. Both backends consume the same decoded
// Frame (bgt/runtime/commands.ts), so semantics live in one place and the
// backends only translate draws, clips and texture ops.

import type { Frame, Rect, TextureTable, ReadbackItem } from '../runtime/commands';

export type BackendKind = 'webgpu' | 'webgl2';

export interface Letterbox {
  /** Game area inside the canvas, device pixels, origin top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

export interface Pixels {
  width: number;
  height: number;
  /** RGBA8, rows top-to-bottom. */
  data: Uint8Array<ArrayBuffer>;
}

/** Per-rendered-frame WebGL synchronization census; WebGPU does not make these queries. */
export interface NativeSyncQueries {
  getError: number;
  checkFramebufferStatus: number;
  /** Correctness readback for GPU-generated vertices requiring CPU wide-stride/sparse-ID repacking. */
  generatedBufferReadbacks: number;
}

export interface GpuStats {
  drawCalls: number;
  /** Logical passes: 2D passes plus §13 PASS_BEGIN items. */
  passes: number;
  vertexBytes: number;
  submitMs: number;
  /** K53 per-frame native census. WebGPU: render passes actually encoded (merged §13 passes count once)
   * and GPUQueue.submit calls. WebGL 2: framebuffer attachment (re)binds and 0 submits. */
  nativePasses?: number;
  nativeSubmits?: number;
  /** §13 passes continued in the previous native pass / WebGPU copy-on-write buffer renames. */
  mergedPasses?: number;
  bufferRenames?: number;
  /** K60 WebGPU: bytes rewritten by renames; transform-feedback GLSL translations / compute lowerings this frame (cache misses). */
  renameBytes?: number;
  captureTranslations?: number;
  captureLowerings?: number;
  /** K67 WebGPU: command buffers in the frame's GPUQueue submits; GPUBuffers created while encoding the frame. */
  commandBuffers?: number;
  buffersCreated?: number;
  /** K67 WebGPU: bytes held by the renderer's buffer recycle pool after the frame (renderer-internal, not guest memory). */
  poolBytes?: number;
  /** WebGL 2: redundant program/VAO/viewport/scissor/depth-range/blend-color calls skipped by the state shadow. */
  skippedBinds?: number;
  /** Opt-in GPU time (ms) of a recently completed frame's §13 passes; null when unavailable/pending. */
  gpuMs?: number | null;
  gpuTiming?: 'off' | 'unavailable' | 'timestamp-query' | 'timer-query';
}

/** Validated §13 command; words follow GPU_LAYOUT, uploads/source are owned copies.
 * Dispatch execute at this item's exact position in Frame.items, never during decoding.
 * For SHADER_CREATE invoke complete exactly once, including failure/device loss.
 */
export interface GpuItem {
  kind: 'gpu';
  op: number;
  words: readonly number[];
  data?: Uint8Array<ArrayBuffer>;
  source?: string;
  complete?: (code: number, log?: string) => void;
  /** TEXTURE_READBACK result delivery: tightly packed texels, or a nonzero error. Exactly once. */
  readback?: (data?: Uint8Array<ArrayBuffer>, error?: number) => void;
}
export interface GpuBackend {
  /** Full nonzero-u32 buffer IDs, only after host-side explicit negotiation. */
  readonly bufferHandles?: boolean;
  /** Bit language: WGSL=1, GLSL330=2, GLSLES300=4. Zero means unsupported (no CAP_GPU). */
  readonly languages: number;
  readonly nativeSyncQueries?: NativeSyncQueries;
  /** WebGL native-query policy; unrelated to test API availability. */
  readonly nativeQueryPolicy?: 'production' | 'strict';
  readonly nativeSyncQueryOps?: Record<string, { getError: number; checkFramebufferStatus: number }>;
  /** K51: largest UNIFORM_BUFFER range (and std140 block) the native device accepts, bytes. Absent means the
   * portable 65536 ceiling. Hosts clamp it to [16384, 65536], multiple of 16, and report it at §13.6 offset 52. */
  readonly maxUniformRange?: number;
  /** K62: GLSL user varying components (vertex outputs = fragment inputs, gl_Position excluded) that every program
   * of at most this many components links with on this device; reported at §13.6 offset 76. Absent means 60. */
  readonly maxVaryingComponents?: number;
  /** K62: implements CAP_GPU_GL_RASTER (VIEWPORT past the attachment, GLSL flat = last vertex). */
  readonly glRaster?: boolean;
  /** K67: implements CAP_GPU_CONST_ATTRIB (stride-0 vertex buffer slots). */
  readonly constAttrib?: boolean;
  /** K51 diagnostics only: native renderer/adapter identity captured at init (never a per-frame query). */
  readonly device?: GpuDeviceInfo;
  /** Return BGT_OK, or a synchronous backend error; compile failures use complete(-6, log). */
  execute(item: GpuItem): number;
}
export interface GpuDeviceInfo {
  /** WebGL2: UNMASKED_RENDERER_WEBGL (else RENDERER); WebGPU: adapter vendor/architecture/description. */
  renderer: string | null;
  /** True when the renderer string names a CPU rasterizer (SwiftShader/llvmpipe/WARP). */
  software: boolean;
  /** Native maximum before clamping to the portable ceiling. */
  nativeMaxUniformRange: number;
}
export const softwareRenderer = (s: string | null): boolean => !!s && /swiftshader|llvmpipe|softpipe|microsoft basic render|\bwarp\b/i.test(s);
export const UNSUPPORTED_GPU: GpuBackend = { languages: 0, execute: () => -4 };

export interface Renderer {
  /** Absent in existing renderers: equivalent to UNSUPPORTED_GPU. Never advertises CAP_GPU. */
  readonly gpu?: GpuBackend;
  readonly kind: BackendKind;
  readonly canvas: HTMLCanvasElement;
  readonly maxTextureSize: number;
  readonly stats: GpuStats;
  lost: boolean;
  /** Resize backing store (device px). */
  resize(width: number, height: number): void;
  /** Execute one frame. If `readback`, return the canvas pixels after drawing. */
  drawFrame(frame: Frame, letterbox: Letterbox, readback: boolean): Promise<Pixels | null> | Pixels | null;
  /** Resolve once submitted GPU work has completed. */
  finish(): Promise<void>;
  /** Recreate GPU objects for every texture in the table (after device/context loss). */
  restoreTextures(textures: TextureTable): void;
  /** Debug: provoke a device/context loss; `unrecoverable` makes recovery fail (WebGPU). */
  simulateLoss(opts?: { unrecoverable?: boolean }): Promise<void>;
  onLost(cb: (reason: string) => void): void;
  /** The backend gave up recovering; the runtime should switch backends or stop. */
  onUnrecoverable(cb: (reason: string) => void): void;
  onRestored(cb: () => void): void;
  onError(cb: (message: string) => void): void;
  destroy(): void;
}

export function computeLetterbox(canvasW: number, canvasH: number, logicalW: number, logicalH: number, integer: boolean): Letterbox {
  let scale = Math.min(canvasW / logicalW, canvasH / logicalH);
  if (integer && scale >= 1) scale = Math.floor(scale);
  const w = Math.max(1, Math.round(logicalW * scale));
  const h = Math.max(1, Math.round(logicalH * scale));
  return { x: Math.floor((canvasW - w) / 2), y: Math.floor((canvasH - h) / 2), w, h, scale };
}

/** Logical clip rect -> device-pixel rect (top-left origin), clamped to the letterbox. */
export function clipToDevice(clip: Rect, lb: Letterbox, logicalW: number, logicalH: number): Rect {
  const sx = lb.w / logicalW;
  const sy = lb.h / logicalH;
  const x0 = Math.round(lb.x + clip.x * sx);
  const y0 = Math.round(lb.y + clip.y * sy);
  const x1 = Math.round(lb.x + (clip.x + clip.w) * sx);
  const y1 = Math.round(lb.y + (clip.y + clip.h) * sy);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Crop a backend readback to the ABI's tightly packed, logical, top-down RGBA8 rectangle. */
export function readbackRect(px: Pixels, it: ReadbackItem, lw: number, lh: number, lb: Letterbox): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(it.w * it.h * 4);
  for (let y=0;y<it.h;y++) for (let x=0;x<it.w;x++) {
    const sx = it.target ? it.x+x : Math.min(px.width-1,Math.max(0,Math.floor(lb.x+(it.x+x+0.5)*lb.w/lw)));
    const sy = it.target ? it.y+y : Math.min(px.height-1,Math.max(0,Math.floor(lb.y+(it.y+y+0.5)*lb.h/lh)));
    const o=(sy*px.width+sx)*4; data.set(px.data.subarray(o,o+4),(y*it.w+x)*4);
  }
  return data;
}

export const WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);
