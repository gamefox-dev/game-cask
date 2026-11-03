// Renderer-input recording, not guest memory or CPU upload-shadow checkpoints.
import { Frame, type FrameItem } from '../runtime/commands';
import type { Letterbox } from './types';

export interface RecordedFrame {
  type: 'frame'; update: number; width: number; height: number;
  logicalW: number; logicalH: number; letterbox: Letterbox;
  vertices: string; items: Record<string, unknown>[];
}
export function encodeBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
export function decodeBytes(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
/** Snapshot before drawFrame/consume. Functions are completion plumbing, never renderer input. */
export function recordFrame(frame: Frame, letterbox: Letterbox, update: number, width: number, height: number): RecordedFrame {
  return { type: 'frame', update, width, height, logicalW: frame.logicalW, logicalH: frame.logicalH,
    letterbox: { ...letterbox }, vertices: encodeBytes(frame.vertexBytes()), items: frame.items.map(item => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) if (typeof v !== 'function')
        out[k] = v instanceof Uint8Array ? encodeBytes(v) : structuredClone(v);
      return out;
    }) };
}
export function restoreFrame(record: RecordedFrame): Frame {
  const frame = new Frame(); frame.reset(record.logicalW, record.logicalH);
  const vertices = decodeBytes(record.vertices);
  if (vertices.length % 20 || !frame.reserve(vertices.length / 20)) throw new Error('Invalid recorded vertex bytes');
  frame.vertexCount = vertices.length / 20; frame.vertexBytes().set(vertices);
  frame.items = record.items.map(item => ({ ...item,
    ...(typeof item.data === 'string' ? { data: decodeBytes(item.data) } : {}),
    ...(item.kind === 'readback' ? { complete: () => {} } : {}),
  })) as FrameItem[];
  return frame;
}
