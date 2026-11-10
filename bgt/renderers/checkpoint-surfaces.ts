// Test-only native surface transfer. No guest command or production execution path.
import type { Letterbox, Pixels } from './types';
export interface CheckpointBuffer {handle:number;shadow:Uint8Array<ArrayBuffer>;generated:boolean}
export interface CheckpointSurfaces {
  buffers: CheckpointBuffer[];
  physical: Pixels; logical?: Pixels; retained: boolean; letterbox: Letterbox;
}
export interface CheckpointRenderer {
  captureTestSurfaces(letterbox: Letterbox): Promise<CheckpointSurfaces>;
  restoreTestSurfaces(state: CheckpointSurfaces): void;
}
