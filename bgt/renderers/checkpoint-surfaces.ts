// Test-only native surface transfer. No guest command or production execution path.
import type { Letterbox, Pixels, GpuItem } from './types';
import type { ReplayIndexSource } from '../runtime/savestate-draw-budget';
export interface CheckpointBuffer {handle:number;shadow:Uint8Array<ArrayBuffer>;generated:boolean}
export interface CheckpointShadows {
  buffers: CheckpointBuffer[];
  textures: {handle:number;levels?:(Uint8Array<ArrayBuffer>|undefined)[];uploads?:GpuItem[];
    generated?:{base:number;data?:Uint8Array<ArrayBuffer>;source?:GpuItem;overridden:Set<number>}}[];
}
export interface CheckpointSurfaces extends CheckpointShadows {
  physical: Pixels; logical?: Pixels; retained: boolean; letterbox: Letterbox;
}
export interface CheckpointInspection {
  // Borrowed until the controller has budgeted and cloned the surface payloads.
  shadows: CheckpointShadows;
  pixelBytes: number;
  pixelStagingBytes: number;
  lazy: Map<number, readonly ({color?: number[]; depth?: number; stencil?: number} | undefined)[]>;
}
export interface CheckpointRenderer {
  /** Borrow committed CPU-authoritative indices during synchronous replay preflight. */
  checkpointIndices?(): ReplayIndexSource;
  /** Legacy vertex store and logical surface not included in the §13 census. */
  checkpointStorageBytes?(): number;
  inspectTestSurfaces(): CheckpointInspection;
  captureTestSurfaces(letterbox: Letterbox, shadows: CheckpointShadows): Promise<CheckpointSurfaces>;
  restoreTestSurfaces(state: CheckpointSurfaces): void;
}
