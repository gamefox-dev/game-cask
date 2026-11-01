// LANE-GL: recording-only §13 backend. This does not compile GLSL or rasterize pixels.
import type { Frame } from '../../bgt/runtime/commands';
import type { GpuItem } from '../../bgt/renderers/types';
import type { StreamOptions } from './headless';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { TEXEL_BYTES, canonicalize, isDepthFormat, mipExtent, toCanonicalTexture, type CanonicalTexture }
  from '../../bgt/renderers/gpu-texture';

/** Uploaded texel storage only: lets read-back known-answer tests see exactly what was uploaded, never render output. */
class TextureMemory {
  private textures = new Map<number, { desc: CanonicalTexture; levels: Uint8Array[] }>();
  apply(item: GpuItem): void {
    if (item.op === O.TEXTURE_DELETE) { this.textures.delete(item.words[0]); return; }
    if (item.op !== O.TEXTURE_CREATE && item.op !== O.TEXTURE_CREATE_EX && item.op !== O.TEXTURE_UPDATE &&
      item.op !== O.TEXTURE_UPDATE_EX) return;
    const { op, words } = canonicalize(item.op, item.words);
    if (op === O.TEXTURE_CREATE_EX) {
      const desc = toCanonicalTexture(words);
      const levels = Array.from({ length: desc.mips }, (_, mip) => {
        const e = mipExtent(desc, mip); return new Uint8Array(e.width * e.height * e.depth * TEXEL_BYTES[desc.format]);
      });
      this.textures.set(words[0], { desc, levels }); return;
    }
    const t = this.textures.get(words[0]); if (!t || isDepthFormat(t.desc.format) || !item.data) return;
    const [, mip, x, y, z, w, h, d] = words, e = mipExtent(t.desc, mip), bpp = TEXEL_BYTES[t.desc.format];
    for (let k = 0; k < d; k++) for (let r = 0; r < h; r++) {
      t.levels[mip].set(item.data.subarray((k * h + r) * w * bpp, (k * h + r + 1) * w * bpp),
        (((z + k) * e.height + y + r) * e.width + x) * bpp);
    }
  }
  read(words: readonly number[]): Uint8Array | undefined {
    const t = this.textures.get(words[0]); if (!t || isDepthFormat(t.desc.format)) return undefined;
    const [, mip, x, y, z, w, h, d] = words, e = mipExtent(t.desc, mip), bpp = TEXEL_BYTES[t.desc.format];
    const out = new Uint8Array(w * h * d * bpp);
    for (let k = 0; k < d; k++) for (let r = 0; r < h; r++) {
      const at = (((z + k) * e.height + y + r) * e.width + x) * bpp;
      out.set(t.levels[mip].subarray(at, at + w * bpp), (k * h + r) * w * bpp);
    }
    return out;
  }
}

/** Ignore wasm transport addresses, but include every semantic word and owned upload/source byte. */
export function gpuDigest(items: GpuItem[]): string {
  let hash = 2166136261;
  const byte = (b: number) => { hash = Math.imul(hash ^ b, 16777619) >>> 0; };
  const word = (w: number) => { for (let i = 0; i < 4; i++) byte((w >>> (8 * i)) & 255); };
  for (const item of items) {
    word(item.op); word(item.words.length);
    const pointer = item.op === O.BUFFER_CREATE || item.op === O.SHADER_CREATE ? 3 :
      item.op === O.BUFFER_UPDATE ? 2 : item.op === O.TEXTURE_UPDATE ? 6 :
      item.op === O.TEXTURE_UPDATE_EX ? 8 : -1;
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
  const memory = new TextureMemory();
  let lastHash = '';
  const result = {
    frameHash: () => lastHash,
    items,
    readbacks: 0,
    gpuBackend: { languages: 2, execute: (item: GpuItem) => {
      items.push(item);
      item.complete?.(compileStatus, compileLog);
      memory.apply(item);
      if (item.op === O.TEXTURE_READBACK) {
        // Uploaded content when known; otherwise transport bytes. NEVER rendered output.
        let bytes = memory.read(item.words);
        if (!bytes) {
          bytes = new Uint8Array(item.words[5] * item.words[6] * item.words[7] * 4);
          for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
        }
        item.readback?.(bytes as Uint8Array<ArrayBuffer>);
      }
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
