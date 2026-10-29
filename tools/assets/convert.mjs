#!/usr/bin/env node
// Asset transforms for ports: legacy image formats -> BGTI (raw RGBA8 with a
// 16-byte header), loadable in C via bgt/include/bgt_image.h.
//
//   node tools/assets/convert.mjs bmp  IN.BMP  OUT.bgti
//   node tools/assets/convert.mjs pcx  IN.PCX  OUT.bgti
//   node tools/assets/convert.mjs raw8 IN.RAW  OUT.bgti --width W --height H --palette PAL [--vga6] [--offset N] [--key INDEX]
//   node tools/assets/convert.mjs pal  IN.PAL  OUT.pal.bgti [--vga6]       (palette as a 16x16 swatch)
//
// BGTI: "BGTI" | u32 width | u32 height | u32 flags(0) | width*height*4 RGBA bytes.
// Inputs are read only; write outputs to port/assets/ (private, git-ignored).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function bgti(width, height, rgba) {
  const out = Buffer.alloc(16 + width * height * 4);
  out.write('BGTI', 0, 'latin1');
  out.writeUInt32LE(width, 4);
  out.writeUInt32LE(height, 8);
  out.writeUInt32LE(0, 12);
  Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(out, 16);
  return out;
}

export function palette(buf, { vga6 = false, offset = 0 } = {}) {
  const pal = [];
  for (let i = 0; i < 256; i++) {
    const o = offset + i * 3;
    const s = (v) => (vga6 ? Math.round(((v & 63) * 255) / 63) : v);
    pal.push([s(buf[o] ?? 0), s(buf[o + 1] ?? 0), s(buf[o + 2] ?? 0)]);
  }
  return pal;
}

export function indexedToRgba(idx, width, height, pal, key = -1) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const c = pal[idx[i]] ?? [0, 0, 0];
    out.set([c[0], c[1], c[2], idx[i] === key ? 0 : 255], i * 4);
  }
  return out;
}

export function decodeBmp(b) {
  if (b.toString('latin1', 0, 2) !== 'BM') throw new Error('not a BMP');
  const dataOff = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const hRaw = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28);
  const comp = b.readUInt32LE(30);
  if (comp !== 0 && comp !== 3) throw new Error(`compressed BMP (${comp}) unsupported`);
  const h = Math.abs(hRaw);
  const topDown = hRaw < 0;
  const stride = Math.ceil((w * bpp) / 32) * 4;
  const hdr = b.readUInt32LE(14);
  const pal = [];
  if (bpp <= 8) {
    const n = b.readUInt32LE(46) || 1 << bpp;
    for (let i = 0; i < n; i++) {
      const o = 14 + hdr + i * 4;
      pal.push([b[o + 2], b[o + 1], b[o]]);
    }
  }
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = dataOff + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      let r, g, bl, a = 255;
      if (bpp === 8) [r, g, bl] = pal[b[row + x]] ?? [0, 0, 0];
      else if (bpp === 4) [r, g, bl] = pal[(b[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15] ?? [0, 0, 0];
      else if (bpp === 24) [bl, g, r] = [b[row + x * 3], b[row + x * 3 + 1], b[row + x * 3 + 2]];
      else if (bpp === 32) [bl, g, r, a] = [b[row + x * 4], b[row + x * 4 + 1], b[row + x * 4 + 2], b[row + x * 4 + 3]];
      else throw new Error(`BMP ${bpp} bpp unsupported`);
      out.set([r, g, bl, a], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, rgba: out };
}

export function decodePcx(b) {
  if (b[0] !== 0x0a || b[2] !== 1) throw new Error('not an RLE PCX');
  const bpp = b[3], planes = b[65], bpl = b.readUInt16LE(66);
  const w = b.readUInt16LE(8) - b.readUInt16LE(4) + 1;
  const h = b.readUInt16LE(10) - b.readUInt16LE(6) + 1;
  if (bpp !== 8 || planes !== 1) throw new Error(`PCX ${bpp}bpp x${planes} planes unsupported (8-bit indexed only)`);
  const idx = new Uint8Array(w * h);
  let p = 128;
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < bpl) {
      let v = b[p++], n = 1;
      if ((v & 0xc0) === 0xc0) {
        n = v & 0x3f;
        v = b[p++];
      }
      for (; n > 0 && x < bpl; n--, x++) if (x < w) idx[y * w + x] = v;
    }
  }
  const palOff = b.length - 769;
  if (b[palOff] !== 0x0c) throw new Error('PCX missing 256-color palette');
  return { width: w, height: h, rgba: indexedToRgba(idx, w, h, palette(b, { offset: palOff + 1 })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kind, inp, out, ...rest] = process.argv.slice(2);
  const opt = (k) => {
    const i = rest.indexOf(k);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (!kind || !inp || !out) {
    console.error('usage: convert.mjs bmp|pcx|raw8|pal IN OUT [options]');
    process.exit(1);
  }
  const b = readFileSync(inp);
  let img;
  if (kind === 'bmp') img = decodeBmp(b);
  else if (kind === 'pcx') img = decodePcx(b);
  else if (kind === 'raw8') {
    const w = Number(opt('--width')), h = Number(opt('--height')), off = Number(opt('--offset') ?? 0);
    const pal = palette(readFileSync(opt('--palette')), { vga6: rest.includes('--vga6') });
    img = { width: w, height: h, rgba: indexedToRgba(b.subarray(off, off + w * h), w, h, pal, Number(opt('--key') ?? -1)) };
  } else if (kind === 'pal') {
    const pal = palette(b, { vga6: rest.includes('--vga6') });
    img = { width: 16, height: 16, rgba: indexedToRgba(Uint8Array.from({ length: 256 }, (_, i) => i), 16, 16, pal) };
  } else throw new Error(`unknown kind ${kind}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bgti(img.width, img.height, img.rgba));
  console.log(`${inp} -> ${out} (${img.width}x${img.height})`);
}
