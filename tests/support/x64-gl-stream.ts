// LANE-GL: recording-only §13 backend. This does not compile GLSL or rasterize pixels.
import type { Frame } from '../../bgt/runtime/commands';
import type { GpuItem } from '../../bgt/renderers/types';
import type { StreamOptions } from './headless';
import { GPU_OP as O } from '../../bgt/runtime/abi';

/** Ignore wasm transport addresses, but include every semantic word and owned upload/source byte. */
export function gpuDigest(items: GpuItem[]): string {
  let hash = 2166136261;
  const byte = (b: number) => { hash = Math.imul(hash ^ b, 16777619) >>> 0; };
  const word = (w: number) => { for (let i = 0; i < 4; i++) byte((w >>> (8 * i)) & 255); };
  for (const item of items) {
    word(item.op); word(item.words.length);
    const pointer = item.op === O.BUFFER_CREATE || item.op === O.SHADER_CREATE ? 3 :
      item.op === O.BUFFER_UPDATE ? 2 : item.op === O.TEXTURE_UPDATE ? 6 : -1;
    item.words.forEach((w, i) => word(i === pointer ? 0 : w));
    const source = new TextEncoder().encode(item.source ?? '');
    word(source.length); source.forEach(byte);
    word(item.data?.length ?? 0); item.data?.forEach(byte);
  }
  return hash.toString(16).padStart(8, '0');
}

export function glStream(compileStatus = 0, compileLog = ''):
StreamOptions & { items: GpuItem[]; readbacks: number; frameHash: () => string } {
  const items: GpuItem[] = [];
  let lastHash = '';
  const result = {
    frameHash: () => lastHash,
    items,
    readbacks: 0,
    gpuBackend: { languages: 2, execute: (item: GpuItem) => {
      items.push(item);
      item.complete?.(compileStatus, compileLog);
      return 0;
    } },
    executeFrame: (frame: Frame) => {
      lastHash = gpuDigest(frame.items.filter((it): it is GpuItem => it.kind === 'gpu'));
      for (const item of frame.items) {
        if (item.kind === 'gpu') result.gpuBackend.execute(item);
        if (item.kind === 'readback') {
          result.readbacks++;
          // Known transport bytes, NOT rendered output: checks request/yield/row conversion only.
          const bytes = new Uint8Array(item.w * item.h * 4);
          for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
          item.complete(bytes);
        }
      }
    },
  };
  return result;
}
