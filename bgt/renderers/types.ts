// Backend-neutral renderer contract. Both backends consume the same decoded
// Frame (bgt/runtime/commands.ts), so semantics live in one place and the
// backends only translate draws, clips and texture ops.

import type { Frame, Rect, TextureTable } from '../runtime/commands';

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

export interface GpuStats {
  drawCalls: number;
  passes: number;
  vertexBytes: number;
  submitMs: number;
}

export interface Renderer {
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

export const WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);
