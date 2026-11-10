// Test-only native surface transfer. No guest command or production execution path.
import type { Letterbox, Pixels, GpuItem } from './types';
export interface CheckpointBuffer {handle:number;shadow:Uint8Array<ArrayBuffer>;generated:boolean}
export interface CheckpointSurfaces {
  buffers: CheckpointBuffer[];
  textures: {handle:number;levels?:Uint8Array<ArrayBuffer>[];uploads?:GpuItem[];
    generated?:{base:number;data?:Uint8Array<ArrayBuffer>;source?:GpuItem;overridden:Set<number>}}[];
  physical: Pixels; logical?: Pixels; retained: boolean; letterbox: Letterbox;
}
export interface CheckpointRenderer {
  captureTestSurfaces(letterbox: Letterbox): Promise<CheckpointSurfaces>;
  restoreTestSurfaces(state: CheckpointSurfaces): void;
}
