// Shared §13.7 texture helpers. Backends execute only the canonical *_EX forms, so legacy 2D opcodes,
// 3D / 2D-array textures and the extended formats share one code path per renderer.
import { GPU_OP as OP } from '../runtime/abi';

export const TEXEL_BYTES = [4, 4, 1, 2, 8, 4, 4, 4, 2, 4, 4, 8, 16] as const;
/** Components of each color format (depth formats: 1). Used by readback packing. */
export const TEXEL_COMPONENTS = [4, 4, 1, 2, 4, 1, 1, 4, 1, 2, 1, 2, 4] as const;
export const isDepthFormat = (format: number) => format === 5 || format === 6;
export const bitsOf = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];

export interface CanonicalTexture {
  handle: number; dimension: number; width: number; height: number; depth: number; mips: number;
  format: number; usage: number;
}
export function mipExtent(t: Pick<CanonicalTexture, 'width' | 'height' | 'depth' | 'dimension'>, mip: number) {
  return {
    width: Math.max(1, t.width >> mip), height: Math.max(1, t.height >> mip),
    depth: t.dimension === 1 ? Math.max(1, t.depth >> mip) : t.depth,
  };
}
/** Legacy ops are mapped to the canonical forms; everything else returns unchanged. */
export function canonicalize(op: number, w: readonly number[]): { op: number; words: number[] } {
  switch (op) {
    case OP.TEXTURE_CREATE: return { op: OP.TEXTURE_CREATE_EX, words: [w[0], 0, w[1], w[2], 1, w[3], w[4], w[5]] };
    case OP.TEXTURE_UPDATE:
      return { op: OP.TEXTURE_UPDATE_EX, words: [w[0], w[1], w[2], w[3], 0, w[4], w[5], 1, w[6], w[7]] };
    case OP.SAMPLER_CREATE:
      return { op: OP.SAMPLER_CREATE_EX, words: [w[0], w[1], w[2], w[3], w[4], w[5], 0, w[6], w[7], bitsOf(0), bitsOf(1000)] };
    default: return { op, words: [...w] };
  }
}
export function toCanonicalTexture(w: readonly number[]): CanonicalTexture {
  return { handle: w[0], dimension: w[1], width: w[2], height: w[3], depth: w[4], mips: w[5], format: w[6], usage: w[7] };
}

const half = (bits: number): number => {
  const e = (bits >> 10) & 31, m = bits & 1023, sign = bits & 0x8000 ? -1 : 1;
  return e === 0 ? sign * m * 2 ** -24 : e === 31 ? (m ? NaN : sign * Infinity) : sign * (1 + m / 1024) * 2 ** (e - 15);
};
const scratch = new DataView(new ArrayBuffer(4));
const halfBits = (value: number): number => {
  scratch.setFloat32(0, value);
  const x = scratch.getUint32(0), sign = (x >>> 16) & 0x8000, exp = (x >>> 23) & 0xff, man = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (man ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = (man | 0x800000) >> (1 - e);
    return sign | ((m >> 13) + (((m & 0x1fff) > 0x1000 || ((m & 0x1fff) === 0x1000 && (m & 0x2000))) ? 1 : 0));
  }
  const m = man >> 13, rest = man & 0x1fff;
  return sign | (((e << 10) | m) + ((rest > 0x1000 || (rest === 0x1000 && (m & 1))) ? 1 : 0));
};
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Decode one texel of a color format to 4 floats (stored components only; the rest stay 0). */
function decodeTexel(format: number, dv: DataView, at: number, out: number[]): void {
  out.fill(0);
  const n = TEXEL_COMPONENTS[format];
  if (format <= 3) for (let c = 0; c < n; c++) out[c] = dv.getUint8(at + c) / 255;
  else if (format === 4 || format === 8 || format === 9) for (let c = 0; c < n; c++) out[c] = half(dv.getUint16(at + c * 2, true));
  else if (format >= 10) for (let c = 0; c < n; c++) out[c] = dv.getFloat32(at + c * 4, true);
  else if (format === 7) {
    const v = dv.getUint32(at, true);
    out[0] = (v & 1023) / 1023; out[1] = ((v >>> 10) & 1023) / 1023; out[2] = ((v >>> 20) & 1023) / 1023; out[3] = (v >>> 30) / 3;
  }
}
function encodeTexel(format: number, dv: DataView, at: number, v: number[]): void {
  const n = TEXEL_COMPONENTS[format], u8 = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  if (format <= 3) for (let c = 0; c < n; c++) dv.setUint8(at + c, u8(v[c]));
  else if (format === 4 || format === 8 || format === 9) for (let c = 0; c < n; c++) dv.setUint16(at + c * 2, halfBits(v[c]), true);
  else if (format >= 10) for (let c = 0; c < n; c++) dv.setFloat32(at + c * 4, v[c], true);
  else if (format === 7) {
    const q = (x: number, m: number) => Math.round(Math.min(1, Math.max(0, x)) * m);
    dv.setUint32(at, (q(v[0], 1023) | (q(v[1], 1023) << 10) | (q(v[2], 1023) << 20) | (q(v[3], 3) << 30)) >>> 0, true);
  }
}

/** 2x2x2 box downsample of one mip level (clamped at odd edges); sRGB averages in linear space. */
export function downsampleBox(format: number, src: Uint8Array, sw: number, sh: number, sd: number,
  dw: number, dh: number, dd: number): Uint8Array<ArrayBuffer> {
  const bpp = TEXEL_BYTES[format], out = new Uint8Array(dw * dh * dd * bpp);
  const sv = new DataView(src.buffer, src.byteOffset, src.byteLength), dv = new DataView(out.buffer);
  const t = [0, 0, 0, 0], sum = [0, 0, 0, 0];
  for (let z = 0; z < dd; z++) for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    sum.fill(0); let count = 0;
    for (let k = 0; k < (sd > dd ? 2 : 1); k++) for (let j = 0; j < (sh > dh ? 2 : 1); j++) for (let i = 0; i < (sw > dw ? 2 : 1); i++) {
      const sx = Math.min(sw - 1, x * 2 + i), sy = Math.min(sh - 1, y * 2 + j), sz = Math.min(sd - 1, z * 2 + k);
      decodeTexel(format, sv, ((sz * sh + sy) * sw + sx) * bpp, t);
      for (let c = 0; c < 4; c++) sum[c] += format === 1 && c < 3 ? toLinear(t[c]) : t[c];
      count++;
    }
    for (let c = 0; c < 4; c++) { sum[c] /= count; if (format === 1 && c < 3) sum[c] = toSrgb(sum[c]); }
    encodeTexel(format, dv, ((z * dh + y) * dw + x) * bpp, sum);
  }
  return out;
}
