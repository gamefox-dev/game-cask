// Test-only GPU history accounting. CPU backing buffers are counted once per
// graph, not once per view; a view can keep much more than its own length alive.
import { checkpointFrameBytes } from './savestate-recording';
import type { CheckpointFrame } from './savestate-recording';
import type { GPUCheckpoint } from './savestate-gpu';
import type { Renderer } from '../renderers/types';
import type { CheckpointShadows } from '../renderers/checkpoint-surfaces';

const MiB = 1024 ** 2;
export const GPU_HISTORY_BYTES = 512 * MiB;
// The 400 MiB buffer contract can retain both native data and recovery shadows.
// A bounded workspace additionally allows compaction and restore to overlap
// two such states and one isolated renderer without overwriting the live one.
export const GPU_CAPTURE_BUDGET = { retained: 1024 * MiB, workspace: 3 * 1024 * MiB };
export type GPUCaptureBudget = typeof GPU_CAPTURE_BUDGET;
export const checkGPUBytes = (bytes: number, limit: number, area: string) => {
  if (!(bytes <= limit)) throw new Error('Savestate exceeds bounded GPU ' + area + ' bytes');
};

export function checkpointShadowBytes(shadows: CheckpointShadows, seen: Set<ArrayBufferLike>): number {
  // Include command/source data and a conservative per-entry metadata cost.
  let n = 128;
  for (const b of shadows.buffers) n += 96 + backingBytes(b.shadow, seen);
  for (const t of shadows.textures) {
    n += 128;
    for (const data of t.levels ?? []) n += 8 + backingBytes(data, seen);
    for (const u of t.uploads ?? []) n += 96 + u.words.length * 8 + backingBytes(u.data, seen);
    if (t.generated) {
      const {source, data, overridden} = t.generated;
      n += 128 + 16 * overridden.size + backingBytes(data, seen);
      if (source) n += 96 + source.words.length * 8 + backingBytes(source.data, seen);
    }
  }
  return n;
}
export function backingBytes(view: ArrayBufferView | undefined, seen: Set<ArrayBufferLike>): number {
  if (!view || seen.has(view.buffer)) return 0;
  seen.add(view.buffer);
  return view.buffer.byteLength;
}
export function checkpointGPUBytes(base: GPUCheckpoint | null, journal: CheckpointFrame[] = []): number {
  const seen = new Set<ArrayBufferLike>();
  let bytes = 0;
  if (base) {
    const s = base.surfaces;
    bytes = checkpointFrameBytes(base.frame, seen) + checkpointShadowBytes(s, seen) +
      backingBytes(s.physical.data, seen) + backingBytes(s.logical?.data, seen);
  }
  for (const f of journal) bytes += checkpointFrameBytes(f, seen);
  return bytes;
}

// Detachment is additional to the executing renderer. Count resources, canvas,
// recovery copies, pool/scratch and reserve even the detached lazy levels. The
// replay cursor adds legacy textures and shader sources from the command stream.
export function detachedRendererBytes(r: Renderer): number {
  const m = r.gpu?.memory?.();
  return r.canvas.width * r.canvas.height * 8 + (r.presentationBytes?.() ?? 0) + (m ?
    m.buffers.nativeBytes + m.textures.bytes + (m.textures.lazy?.bytes ?? 0) + m.renderbuffers.bytes + m.internal.bytes +
    m.shadows.bufferBytes + (m.shadows.sharedBufferBytes ?? 0) + m.shadows.textureBytes : 0);
}
