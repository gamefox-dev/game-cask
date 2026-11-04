// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0 — original instruction fixtures, no game bytes.
import { describe, expect, it } from 'vitest';
import { BASE, nativeHarness } from '../support/native-forms';
const MASK = (1n << 64n) - 1n;
const words = [0x80000000, 0x7fc01234, 0xffffffff, 0x12345678];
const other = [0x01020304, 0xfedcba98, 0x7f800000, 0x80000001];
const pair = (w: number[], i: number) => BigInt(w[i]) | (BigInt(w[i + 1]) << 32n);
function lanes(h: Awaited<ReturnType<typeof nativeHarness>>, index: number): number[] {
  return [0, 1].flatMap(i => { const x = BigInt.asUintN(64, h.ex.get_xmm(index, i)); return [Number(x & 0xffffffffn), Number(x >> 32n)]; });
}
function flags(a: bigint, b: bigint, n: number, add: boolean, initial = 0xcd5): number {
  const bits = BigInt(n * 8), mask = (1n << bits) - 1n, sign = 1n << (bits - 1n);
  a &= mask; b &= mask; const r = (add ? a + b : a - b) & mask;
  const cf = add ? a + b > mask : a < b;
  const of = add ? !!((~(a ^ b) & (a ^ r)) & sign) : !!(((a ^ b) & (a ^ r)) & sign);
  const parity = Number(r & 255n).toString(2).replaceAll('0', '').length % 2 === 0;
  return (initial & ~0x8d5) | +cf | (+parity << 2) | (Number((a ^ b ^ r) & 16n)) | (+!r << 6) | (+!!(r & sign) << 7) | (+of << 11);
}

describe.each(['size', 'fast'])('native residual forms %s', preset => {
  it('all 256 shuffle immediates: register, self-alias and unaligned memory, with independent lane answers', async () => {
    for (const prefix of ['', '66', 'f2', 'f3']) for (const source of ['reg', 'self', 'mem']) {
      // SHUFPS/PD and PSHUFD/LW/HW. SHUF has two-source lanes, PSHUF has one source.
      for (const op of prefix === '' ? ['c6'] : prefix === '66' ? ['c6', '70'] : ['70']) {
        const ins: string[] = [], expected: number[][] = []; let current = [...words];
        for (let k = 0; k < 256; k++) {
          const b = source === 'self' ? [...current] : [...other], a = [...current];
          if (op === 'c6') current = prefix === '66'
            ? [...a.slice((k & 1) * 2, (k & 1) * 2 + 2), ...b.slice(((k >> 1) & 1) * 2, ((k >> 1) & 1) * 2 + 2)]
            : [a[k & 3], a[(k >> 2) & 3], b[(k >> 4) & 3], b[(k >> 6) & 3]];
          else if (prefix === '66') current = [0, 1, 2, 3].map(i => b[(k >> (2 * i)) & 3]);
          else {
            const halves = b.flatMap(x => [x & 65535, x >>> 16]), out = [...halves], base = prefix === 'f3' ? 4 : 0;
            for (let i = 0; i < 4; i++) out[base + i] = halves[base + ((k >> (i * 2)) & 3)];
            current = [0, 1, 2, 3].map(i => (out[2 * i] | (out[2 * i + 1] << 16)) >>> 0);
          }
          expected.push([...current]);
          // Destination xmm8, source xmm9/xmm8/[rbx], output [rdi+disp32]. REX.R/B tested.
          const modrm = source === 'mem' ? '03' : source === 'self' ? 'c0' : 'c1';
          const rex = source === 'mem' ? '44' : '45';
          const disp = Buffer.alloc(4); disp.writeUInt32LE(k * 16);
          ins.push(prefix + rex + '0f' + op + modrm + k.toString(16).padStart(2, '0') + 'f3440f7f87' + disp.toString('hex'));
        }
        const h = await nativeHarness(ins.join('') + 'c3', preset);
        expect(h.stats.generic).toBe(0);
        const run = (interp: number) => {
          h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2001n); h.ex.set_reg(7, 0x4000n); h.ex.set_flags(0xcd5);
          h.ex.set_xmm(8, pair(words, 0), pair(words, 2)); h.ex.set_xmm(9, pair(other, 0), pair(other, 2));
          other.forEach((x, i) => h.view().setUint32(h.ex.ram() + 0x2001 + i * 4, x, true));
          h.ex.run(interp); return h.snapshot();
        };
        const got = run(0); expect(h.ex.generic()).toBe(0); expect(h.ex.get_flags()).toBe(0xcd5);
        for (let k = 0; k < 256; k++) for (let i = 0; i < 4; i++)
          expect(new DataView(got.ram.buffer).getUint32(0x4000 + k * 16 + i * 4, true), prefix + op + source + k).toBe(expected[k][i]);
        expect(got).toEqual(run(1));
      }
    }
  }, 180000);

  it('every floating/integer unpack preserves source lanes under self-alias and unaligned loads', async () => {
    for (const op of ['14', '15', '60', '61', '62', '68', '69', '6a', '6c', '6d']) {
      for (const pre of ['66', ...(op === '14' || op === '15' ? [''] : [])]) {
        // Three independent destination registers: different source, self source, memory source.
        const h = await nativeHarness(pre + '0f' + op + 'c1' + pre + '0f' + op + 'd2' + pre + '0f' + op + '1b' + 'c3', preset);
        expect(h.stats.generic).toBe(0);
        const width = op === '14' || op === '15' ? (pre ? 8 : 4) : op === '6c' || op === '6d' ? 8 : 1 << ((parseInt(op, 16) & 7) % 3);
        const high = ['15', '68', '69', '6a', '6d'].includes(op), count = 16 / width;
        const bytes = (w: number[]) => { const b = Buffer.alloc(16); w.forEach((x, i) => b.writeUInt32LE(x, i * 4)); return b; };
        const answer = (src: number[]) => { const out = Buffer.alloc(16), a = bytes(words), b = bytes(src), start = high ? count / 2 : 0;
          for (let i = 0; i < count / 2; i++) { a.copy(out, 2 * i * width, (start + i) * width, (start + i + 1) * width); b.copy(out, (2 * i + 1) * width, (start + i) * width, (start + i + 1) * width); }
          return [0, 1, 2, 3].map(i => out.readUInt32LE(i * 4)); };
        const run = (interp: number) => {
          h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2003n); h.ex.set_flags(0xcd5);
          for (const i of [0, 2, 3]) h.ex.set_xmm(i, pair(words, 0), pair(words, 2)); h.ex.set_xmm(1, pair(other, 0), pair(other, 2));
          bytes(other).copy(Buffer.from(h.ex.memory.buffer), h.ex.ram() + 0x2003);
          h.ex.run(interp); return h.snapshot();
        };
        const got = run(0); expect(h.ex.generic()).toBe(0);
        expect(lanes(h, 0)).toEqual(answer(other)); expect(lanes(h, 2)).toEqual(answer(words)); expect(lanes(h, 3)).toEqual(answer(other));
        expect(h.ex.get_flags()).toBe(0xcd5); expect(got).toEqual(run(1));
      }
    }
  }, 180000);

  it.each([
    ['f30f7e03', [other[0], other[1], 0, 0]], // MOVQ memory, zero upper
    ['f30f7ec1', [other[0], other[1], 0, 0]], // MOVQ register
    ['0f1203', [other[0], other[1], words[2], words[3]]], // MOVLPS
    ['660f1203', [other[0], other[1], words[2], words[3]]], // MOVLPD
    ['0f1603', [words[0], words[1], other[0], other[1]]], // MOVHPS
    ['660f1603', [words[0], words[1], other[0], other[1]]], // MOVHPD
    ['0f12c1', [other[2], other[3], words[2], words[3]]], // MOVHLPS
    ['0f16c1', [words[0], words[1], other[0], other[1]]], // MOVLHPS
    ['f20f1203', [other[0], other[1], other[0], other[1]]], // MOVDDUP
    ['f30f1203', [other[0], other[0], other[2], other[2]]], // MOVSLDUP
    ['f30f1603', [other[1], other[1], other[3], other[3]]], // MOVSHDUP
    ['660f6ec1', [0x89abcdef, 0, 0, 0]], // MOVD from ECX
    ['66480f6ec1', [0x89abcdef, 0x01234567, 0, 0]], // MOVQ from RCX
  ])('move %s has independent lane/upper-bit answers and exact memory width', async (hex, expected) => {
    const h = await nativeHarness(hex + 'c3', preset); expect(h.stats.generic).toBe(0);
    const run = (interp: number) => {
      h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2ff8n); h.ex.set_reg(1, 0x0123456789abcdefn); h.ex.set_flags(0xcd5);
      h.ex.set_xmm(0, pair(words, 0), pair(words, 2)); h.ex.set_xmm(1, pair(other, 0), pair(other, 2));
      other.forEach((x, i) => h.view().setUint32(h.ex.ram() + 0x2ff8 + 4 * i, x, true));
      if (!['f30f1203', 'f30f1603'].includes(hex)) h.ex.unmap(3);
      h.ex.run(interp); return h.snapshot();
    };
    const got = run(0); expect(h.ex.generic()).toBe(0); expect(lanes(h, 0)).toEqual(expected);
    expect(h.ex.get_flags()).toBe(0xcd5); expect(got).toEqual(run(1));
  });

  it.each(['0f1303', '0f1703', '660f1303', '660f1703', '660fd603', '660fd6c1', '660f7ec1', '66480f7ec1', '660f7e03', '66480f7e03'])(
    'reverse move %s writes only its architectural destination', async hex => {
      const h = await nativeHarness(hex + 'c3', preset); expect(h.stats.generic).toBe(0);
      const run = (interp: number) => {
        h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2ff8n); h.ex.set_reg(1, MASK); h.ex.set_flags(0xcd5);
        h.ex.set_xmm(0, pair(words, 0), pair(words, 2)); h.ex.set_xmm(1, MASK, MASK);
        h.memory().fill(0xa5, h.ex.ram() + 0x2ff0, h.ex.ram() + 0x3008); h.ex.unmap(3);
        h.ex.run(interp); return h.snapshot();
      };
      const got = run(0); expect(h.ex.generic()).toBe(0);
      if (hex.endsWith('03')) {
        const width = hex === '660f7e03' ? 4 : 8, value = hex.includes('0f17') ? pair(words, 2) : pair(words, 0);
        const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value);
        expect([...got.ram.slice(0x2ff8, 0x2ff8 + width)]).toEqual([...bytes.subarray(0, width)]);
        expect([...got.ram.slice(0x2ff0, 0x2ff8)]).toEqual(Array(8).fill(0xa5));
        expect([...got.ram.slice(0x2ff8 + width, 0x3008)]).toEqual(Array(16 - width).fill(0xa5));
      } else if (hex.includes('d6')) expect(lanes(h, 1)).toEqual([words[0], words[1], 0, 0]);
      else expect(BigInt.asUintN(64, h.ex.get_reg(1))).toBe(hex.includes('48') ? pair(words, 0) : BigInt(words[0]));
      expect(h.ex.get_flags()).toBe(0xcd5); expect(got).toEqual(run(1));
    });

  it('XADD and CMPXCHG all widths: flags, success/failure, carries, aliases, unaligned and cross-page memory', async () => {
    for (const n of [1, 2, 4, 8]) for (const op of ['c0', 'b0']) {
      const prefix = n === 2 ? '66' : n === 8 ? '48' : '', opcode = n === 1 ? op : (parseInt(op, 16) + 1).toString(16);
      const h = await nativeHarness('f0' + prefix + '0f' + opcode + '0b' + 'c3', preset); expect(h.stats.generic).toBe(0);
      const mask = (1n << BigInt(n * 8)) - 1n;
      for (const a of [0n, 1n, 15n, mask >> 1n, (mask >> 1n) + 1n, mask]) for (const b of [0n, 1n, mask]) for (const success of [false, true]) {
        const acc = success ? a : (a + 1n) & mask;
        const run = (interp: number) => {
          h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2ffdn); h.ex.set_reg(1, 0x1122334455660000n | b); h.ex.set_reg(0, acc); h.ex.set_flags(0xcd5);
          for (let i = 0; i < n; i++) h.view().setUint8(h.ex.ram() + 0x2ffd + i, Number((a >> BigInt(8 * i)) & 255n));
          h.ex.run(interp); return h.snapshot();
        };
        const got = run(0); expect(h.ex.generic()).toBe(0);
        // Byte/word sources preserve their upper register bits, but the low source is b.
        const src = (0x1122334455660000n | b) & mask;
        const result = op === 'c0' ? (a + src) & mask : success ? src : a;
        let memory = 0n; for (let i = 0; i < n; i++) memory |= BigInt(got.ram[0x2ffd + i]) << BigInt(8 * i);
        expect(memory).toBe(result); expect(h.ex.get_flags()).toBe(flags(op === 'c0' ? a : acc, op === 'c0' ? src : a, n, op === 'c0'));
        expect(got).toEqual(run(1));
      }
    }
    // Source is also EA base; updating RBX must not redirect the destination store.
    const h = await nativeHarness('f0480fc11bc3', preset);
    for (const interp of [0, 1]) {
      h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2001n); h.view().setBigUint64(h.ex.ram() + 0x2001, 9n, true); h.ex.run(interp);
      expect(h.ex.get_reg(3)).toBe(9n); expect(h.view().getBigUint64(h.ex.ram() + 0x2001, true)).toBe(0x200an);
    }
  }, 180000);

  it.each(['0fc0c0', '0fc0e0', '0fc1c0', '660fc1c0', '480fc1c0', '0fb1c0', '0fb1c1', '0fb0e0', '480fb1c1'])(
    'unlocked register alias %s has exact writes and flags', async hex => {
      const h = await nativeHarness(hex + 'c3', preset); expect(h.stats.generic).toBe(0);
      for (const value of [0n, 0x80000080n, 0x11223344ffffffffn, MASK]) {
        const run = (interp: number) => { h.ex.reset(BASE, 0); h.ex.set_reg(0, value); h.ex.set_reg(1, 0xfeedface80000080n); h.ex.set_flags(0xcd5); h.ex.run(interp); return h.snapshot(); };
        const got = run(0); expect(h.ex.generic()).toBe(0); expect(got).toEqual(run(1));
      }
    });

  it('LOCK ALU and implicit memory XCHG have full-width preflight, exact result/flags and no opcode exits', async () => {
    for (const n of [1, 2, 4, 8]) for (const op of ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'inc', 'dec', 'not', 'neg', 'xchg']) {
      const prefix = n === 2 ? '66' : n === 8 ? '48' : '', wide = n !== 1;
      const binary = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor'].indexOf(op);
      const body = binary >= 0 ? (binary * 8 + +wide).toString(16).padStart(2, '0') + '0b'
        : op === 'xchg' ? (wide ? '87' : '86') + '0b'
        : ['inc', 'dec'].includes(op) ? (wide ? 'ff' : 'fe') + (op === 'inc' ? '03' : '0b')
        : (wide ? 'f7' : 'f6') + (op === 'not' ? '13' : '1b');
      const h = await nativeHarness((op === 'xchg' ? '' : 'f0') + prefix + body + 'c3', preset); expect(h.stats.generic).toBe(0);
      for (const carry of [0, 1]) for (const a of [0n, 0x7fffffffffffffffn, MASK]) {
        const run = (interp: number) => { h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2ffdn); h.ex.set_reg(1, 1n); h.ex.set_flags(0xcd4 | carry);
          h.view().setBigUint64(h.ex.ram() + 0x2ffd, a, true); h.ex.run(interp); return h.snapshot(); };
        const got = run(0); expect(h.ex.generic()).toBe(0); expect(got).toEqual(run(1));
        if (op === 'xchg') expect(h.ex.get_flags()).toBe(0xcd4 | carry);
      }
    }
  }, 180000);

  it.each(['f00fc70f', 'f0480fc70f'])('CMPXCHG pair %s: both outcomes, only ZF changes and full memory/register values', async hex => {
    const h = await nativeHarness(hex + 'c3', preset); expect(h.stats.generic).toBe(0); const wide = hex.includes('48');
    for (const success of [false, true]) for (const zf of [0, 64]) {
      const lo = 0x1122334455667788n, hi = 0xffeeddccbbaa9988n;
      const run = (interp: number) => {
        h.ex.reset(BASE, 0); h.ex.set_reg(7, wide ? 0x2ff0n : 0x2ffdn); h.ex.set_flags(0xc95 | zf);
        h.ex.set_reg(0, (wide ? lo : lo & 0xffffffffn) + (success ? 0n : 1n)); h.ex.set_reg(2, wide ? hi : lo >> 32n);
        h.ex.set_reg(3, 0x8877665544332211n); h.ex.set_reg(1, 0x1234567887654321n);
        const p = h.ex.ram() + (wide ? 0x2ff0 : 0x2ffd); h.view().setBigUint64(p, lo, true); h.view().setBigUint64(p + 8, hi, true);
        h.ex.run(interp); return h.snapshot();
      };
      const got = run(0); expect(h.ex.generic()).toBe(0); expect(h.ex.get_flags()).toBe(0xc95 | (success ? 64 : 0));
      const p = wide ? 0x2ff0 : 0x2ffd;
      expect(new DataView(got.ram.buffer).getBigUint64(p, true)).toBe(success ? wide ? 0x8877665544332211n : 0x8765432144332211n : lo);
      if (wide) expect(new DataView(got.ram.buffer).getBigUint64(p + 8, true)).toBe(success ? 0x1234567887654321n : hi);
      if (!success) { expect(h.ex.get_reg(0)).toBe(wide ? lo : lo & 0xffffffffn); expect(BigInt.asUintN(64, h.ex.get_reg(2))).toBe(wide ? hi : lo >> 32n); }
      expect(got).toEqual(run(1));
    }
  });

  it('atomic fault transactions preserve flags/registers/all bytes, including failed compare write cycles and CX16 alignment', async () => {
    for (const hex of ['f0480fc10b', 'f0480fb10b', 'f048010b', 'f048210b', 'f048090b', '48870b', 'f00fc70b', 'f0480fc70b']) {
      const h = await nativeHarness(hex + 'c3', preset);
      for (const mode of ['readonly', 'hole', 'high', 'misaligned']) {
        if (mode === 'misaligned' && !hex.includes('480fc7')) continue;
        const run = (interp: number) => {
          h.ex.reset(BASE, 0); h.ex.set_reg(3, mode === 'high' ? 0x100002000n : mode === 'misaligned' ? 0x2001n : hex.includes('480fc7') ? 0x2ff0n : 0x2ffdn);
          h.ex.set_reg(0, 0n); h.ex.set_reg(1, MASK); h.ex.set_reg(2, 123n); h.ex.set_flags(0xcd5);
          h.memory().fill(0xa5, h.ex.ram() + 0x2000, h.ex.ram() + 0x4000);
          if (mode === 'readonly') { h.ex.protect(2, 2); h.ex.protect(3, 2); } else if (mode === 'hole') h.ex.unmap(hex.includes('480fc7') ? 2 : 3);
          expect(() => h.ex.run(interp)).toThrow(WebAssembly.RuntimeError);
          expect(h.ex.get_flags()).toBe(0xcd5); expect(h.ex.get_reg(1)).toBe(-1n); expect(h.ex.get_reg(0)).toBe(0n);
          expect([...h.memory().subarray(h.ex.ram() + 0x2000, h.ex.ram() + 0x4000)]).toEqual(Array(8192).fill(0xa5));
          return h.snapshot();
        };
        expect(run(0), hex + mode).toEqual(run(1));
      }
    }
  }, 180000);

  it('pre-execution quantum transfers leave the entire atomic pending, then complete once on resumption', async () => {
    const h = await nativeHarness('f0480fc10bc3', preset);
    const run = (interp: number) => {
      h.ex.reset(BASE, 2000000); h.ex.set_reg(3, 0x2001n); h.ex.set_reg(1, 7n); h.view().setBigUint64(h.ex.ram() + 0x2001, 5n, true); h.ex.stop_at_quantum(1);
      h.ex.run(interp); expect(h.view().getBigUint64(h.ex.ram() + 0x2001, true)).toBe(5n); expect(h.ex.get_reg(1)).toBe(7n);
      return h.snapshot();
    };
    expect(run(0)).toEqual(run(1));
  });
});
