// Test-only native surface transfer. No guest command or production execution path.
import type { Letterbox, Pixels, GpuItem } from './types';
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
  lazy: Map<number, readonly ({color?: number[]; depth?: number; stencil?: number} | undefined)[]>;
}
export interface CheckpointRenderer {
  inspectTestSurfaces(): CheckpointInspection;
  captureTestSurfaces(letterbox: Letterbox, shadows: CheckpointShadows): Promise<CheckpointSurfaces>;
  restoreTestSurfaces(state: CheckpointSurfaces): void;
}
