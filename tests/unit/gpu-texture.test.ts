import { expect, it } from 'vitest';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { canonicalize, downsampleBox, generatedMipShadows, mipExtent, type CanonicalTexture }
  from '../../bgt/renderers/gpu-texture';

const desc = (dimension: number, depth: number, format = 0): CanonicalTexture =>
  ({ handle: 1, dimension, width: 2, height: 2, depth, mips: 2, format, usage: 1 });

it('canonicalizes legacy operations without mutating their words and keeps array depth constant', () => {
  const words = [1, 8, 4, 4, 0, 3];
  expect(canonicalize(O.TEXTURE_CREATE, words)).toEqual({ op: O.TEXTURE_CREATE_EX, words: [1, 0, 8, 4, 1, 4, 0, 3] });
  expect(words).toEqual([1, 8, 4, 4, 0, 3]);
  expect(mipExtent(desc(1, 4), 1)).toEqual({ width: 1, height: 1, depth: 2 });
  expect(mipExtent(desc(2, 4), 1)).toEqual({ width: 1, height: 1, depth: 4 });
});

it('generates volume recovery shadows with depth halving at every level', () => {
  const data = new Uint8Array([0, 60, 255, 180].flatMap(r =>
    Array.from({ length: 4 }, () => [r, r === 255 ? 255 : 100, r === 255 ? 255 : 100, 255]).flat()));
  const t = { ...desc(1, 4), mips: 3 }, before = data.slice();
  const levels = generatedMipShadows(t, 0, data);
  expect(levels.map(l => [l.mip, l.data.length])).toEqual([[1, 8], [2, 4]]);
  expect([...levels[1].data]).toEqual([124, 139, 139, 255]);
  expect(data).toEqual(before);
});

it('generates each array layer independently and respects a nonzero generation base', () => {
  const data = new Uint8Array([[255, 0, 0, 255], [0, 255, 0, 255]].flatMap(pixel =>
    Array.from({ length: 4 }, () => pixel).flat()));
  expect([...generatedMipShadows(desc(2, 2), 0, data)[0].data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  const t = { ...desc(0, 1), width: 4, height: 4, mips: 3 };
  expect(generatedMipShadows(t, 1, data.subarray(0, 16)).map(l => l.mip)).toEqual([2]);
});

it('averages sRGB in linear space and keeps alpha linear', () => {
  const pixels = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
  expect([...downsampleBox(1, pixels, 2, 1, 1, 1, 1, 1)]).toEqual([188, 188, 188, 128]);
});

it('preserves out-of-range floats and packs RGB10A2 recovery texels', () => {
  const floats = new Uint8Array(new Float32Array([2, -1, 4, 1, 4, 1, 2, 1]).buffer);
  const result = downsampleBox(12, floats, 2, 1, 1, 1, 1, 1);
  expect([...new Float32Array(result.buffer)]).toEqual([3, 0, 3, 1]);
  const packed = new Uint8Array(new Uint32Array([0xc00003ff, 0xc00ffc00]).buffer);
  expect(new DataView(downsampleBox(7, packed, 2, 1, 1, 1, 1, 1).buffer).getUint32(0, true)).toBe(0xc0080200);
});
