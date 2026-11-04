// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0 — original instruction fixtures, no game bytes.
import { describe, expect, it } from 'vitest';
import { BASE, nativeHarness, nativeCases } from '../support/native-forms';
const MASK = (1n << 64n) - 1n;
const words = [0x80000000, 0x7fc01234, 0xffffffff, 0x12345678];
const other = [0x01020304, 0xfedcba98, 0x7f800000, 0x80000001];
const pair = (w: number[], i: number) => BigInt(w[i]) | (BigInt(w[i + 1]) << 32n);
function lanes(h: Awaited<ReturnType<typeof nativeHarness>>, index: number): number[] {
  return [0, 1].flatMap(i => { const x = BigInt.asUintN(64, h.ex.get_xmm(index, i)); return [Number(x & 0xffffffffn), Number(x >> 32n)]; });
}
function flags(a: bigint, b: bigint, n: number, add: boolean, initial = 0xcd5, carry = 0n): number {
  const bits = BigInt(n * 8), mask = (1n << bits) - 1n, sign = 1n << (bits - 1n);
  a &= mask; b &= mask; const r = (add ? a + b + carry : a - b - carry) & mask;
  const cf = add ? a + b + carry > mask : a < b + carry;
  const of = add ? !!((~(a ^ b) & (a ^ r)) & sign) : !!(((a ^ b) & (a ^ r)) & sign);
  const parity = Number(r & 255n).toString(2).replaceAll('0', '').length % 2 === 0;
  return (initial & ~0x8d5) | +cf | (+parity << 2) | (Number((a ^ b ^ r) & 16n)) | (+!r << 6) | (+!!(r & sign) << 7) | (+of << 11);
}

describe.each(['size', 'fast'])('native residual forms %s', preset => {
  it('all 256 shuffle immediates: register, self-alias and aligned memory, with independent lane answers', async () => {
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
          h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2010n); h.ex.set_reg(7, 0x4000n); h.ex.set_flags(0xcd5);
          h.ex.set_xmm(8, pair(words, 0), pair(words, 2)); h.ex.set_xmm(9, pair(other, 0), pair(other, 2));
          other.forEach((x, i) => h.view().setUint32(h.ex.ram() + 0x2010 + i * 4, x, true));
          h.ex.run(interp); return h.snapshot();
        };
        const got = run(0); expect(h.ex.generic()).toBe(0); expect(h.ex.get_flags()).toBe(0xcd5);
        for (let k = 0; k < 256; k++) for (let i = 0; i < 4; i++)
          expect(new DataView(got.ram.buffer).getUint32(0x4000 + k * 16 + i * 4, true), prefix + op + source + k).toBe(expected[k][i]);
        expect(got).toEqual(run(1));
      }
    }
  }, 180000);

  it('every floating/integer unpack preserves source lanes under self-alias and aligned loads', async () => {
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
          h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2010n); h.ex.set_flags(0xcd5);
          for (const i of [0, 2, 3]) h.ex.set_xmm(i, pair(words, 0), pair(words, 2)); h.ex.set_xmm(1, pair(other, 0), pair(other, 2));
          bytes(other).copy(Buffer.from(h.ex.memory.buffer), h.ex.ram() + 0x2010);
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
        const initialAcc = (0x8899aabbccdd0000n & ~mask) | acc, initialSource = 0x1122334455660000n | b;
        const run = (interp: number) => {
          h.ex.reset(BASE, 0); h.ex.set_reg(3, 0x2ffdn); h.ex.set_reg(1, initialSource); h.ex.set_reg(0, initialAcc); h.ex.set_flags(0xcd5);
          for (let i = 0; i < n; i++) h.view().setUint8(h.ex.ram() + 0x2ffd + i, Number((a >> BigInt(8 * i)) & 255n));
          h.ex.run(interp); return h.snapshot();
        };
        const got = run(0); expect(h.ex.generic()).toBe(0);
        // Byte/word sources preserve their upper register bits, but the low source is b.
        const src = (0x1122334455660000n | b) & mask;
        const result = op === 'c0' ? (a + src) & mask : success ? src : a;
        let memory = 0n; for (let i = 0; i < n; i++) memory |= BigInt(got.ram[0x2ffd + i]) << BigInt(8 * i);
        expect(memory).toBe(result); expect(h.ex.get_flags()).toBe(flags(op === 'c0' ? a : acc, op === 'c0' ? src : a, n, op === 'c0'));
        const merge = (original: bigint, low: bigint) => n < 4 ? (original & ~mask) | low : low;
        expect(BigInt.asUintN(64, h.ex.get_reg(1))).toBe(op === 'c0' ? merge(initialSource, a) : initialSource);
        expect(BigInt.asUintN(64, h.ex.get_reg(0))).toBe(op === 'c0' || success ? initialAcc : merge(initialAcc, a));
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
    const cases: { n: number; op: string; hex: string }[] = [];
    for (const n of [1, 2, 4, 8]) for (const op of ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'inc', 'dec', 'not', 'neg', 'xchg']) {
      const prefix = n === 2 ? '66' : n === 8 ? '48' : '', wide = n !== 1;
      const binary = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor'].indexOf(op);
      const body = binary >= 0 ? (binary * 8 + +wide).toString(16).padStart(2, '0') + '0b'
        : op === 'xchg' ? (wide ? '87' : '86') + '0b'
        : ['inc', 'dec'].includes(op) ? (wide ? 'ff' : 'fe') + (op === 'inc' ? '03' : '0b')
        : (wide ? 'f7' : 'f6') + (op === 'not' ? '13' : '1b');
      cases.push({ n, op, hex: (op === 'xchg' ? '' : 'f0') + prefix + body });
    }
    const h = await nativeCases(cases.map(c => c.hex), preset); expect(h.stats.generic).toBe(0);
    for (const [index, { n, op }] of cases.entries()) {
      for (const carry of [0, 1]) for (const a of [0n, 0x7fffffffffffffffn, MASK]) {
        const run = (interp: number) => { h.ex.reset(h.pcs[index], 0); h.ex.set_reg(3, 0x2ffdn); h.ex.set_reg(1, 1n); h.ex.set_flags(0xcd4 | carry);
          h.view().setBigUint64(h.ex.ram() + 0x2ffd, a, true); h.ex.run(interp); return h.snapshot(); };
        const got = run(0); expect(h.ex.generic()).toBe(0); expect(got).toEqual(run(1));
        const mask = (1n << BigInt(n * 8)) - 1n, value = a & mask, initial = 0xcd4 | carry;
        const answer = op === 'xchg' ? 1n : op === 'not' ? ~value : op === 'neg' ? -value :
          op === 'inc' || op === 'add' ? value + 1n : op === 'dec' || op === 'sub' ? value - 1n :
          op === 'adc' ? value + 1n + BigInt(carry) : op === 'sbb' ? value - 1n - BigInt(carry) :
          op === 'or' ? value | 1n : op === 'and' ? value & 1n : value ^ 1n;
        let memory = 0n; for (let i = 0; i < n; i++) memory |= BigInt(got.ram[0x2ffd + i]) << BigInt(8 * i);
        expect(memory).toBe(answer & mask);
        if (op === 'xchg' || op === 'not') expect(h.ex.get_flags()).toBe(initial);
        else if (op === 'neg') expect(h.ex.get_flags()).toBe(flags(0n, value, n, false, initial));
        else if (['and', 'or', 'xor'].includes(op)) {
          const f = flags(answer & mask, 0n, n, true, initial) & ~0x801;
          expect(h.ex.get_flags() & ~0x10).toBe(f & ~0x10); // AF is architecturally undefined.
        } else {
          let f = flags(value, 1n, n, ['add', 'adc', 'inc'].includes(op), initial, ['adc', 'sbb'].includes(op) ? BigInt(carry) : 0n);
          if (op === 'inc' || op === 'dec') f = (f & ~1) | carry;
          expect(h.ex.get_flags()).toBe(f);
        }
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
    const codes = ['f0480fc10b', 'f0480fb10b', 'f048010b', 'f048210b', 'f048090b', '48870b', 'f00fc70b', 'f0480fc70b'];
    const h = await nativeCases(codes.map(c => c), preset);
    for (const [index, hex] of codes.entries()) {
      for (const mode of ['readonly', 'hole', 'high', 'misaligned']) {
        if (mode === 'misaligned' && !hex.includes('480fc7')) continue;
        const run = (interp: number) => {
          h.ex.reset(h.pcs[index], 0); h.ex.set_reg(3, mode === 'high' ? 0x100002000n : mode === 'misaligned' ? 0x2001n : hex.includes('480fc7') ? 0x2ff0n : 0x2ffdn);
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


  it('LOCK bit RMW uses signed register bit-string offsets and masked immediate indexes', async () => {
    const cases: { n: number; op: string; immediate: boolean; hex: string }[] = [];
    for (const n of [2, 4, 8]) for (const [op, group] of [['ab', '2b'], ['b3', '33'], ['bb', '3b']]) {
      const prefix = n === 2 ? '66' : n === 8 ? '48' : '';
      for (const immediate of [false, true]) {
        cases.push({ n, op, immediate, hex: 'f0' + prefix + '0f' + (immediate ? 'ba' + group + 'ff' : op + '0b') });
      }
    }
    const h = await nativeCases(cases.map(c => c.hex), preset); expect(h.stats.generic).toBe(0);
    for (const [caseIndex, { n, op, immediate }] of cases.entries()) {
        for (const index of [-129, -65, -1, 0, 15, 31, 63, 64, 127, 255]) {
          const i = immediate ? 255 : index, offset = immediate ? 0 : Math.floor(i / (n * 8)) * n;
          const bit = ((i % (n * 8)) + n * 8) % (n * 8), address = 0x2803 + offset;
          for (const initial of [0n, MASK]) {
            const mask = (1n << BigInt(n * 8)) - 1n, old = initial & mask, b = 1n << BigInt(bit);
            const expected = op === 'ab' ? old | b : op === 'b3' ? old & ~b : old ^ b;
            const run = (interp: number) => {
              h.ex.reset(h.pcs[caseIndex], 0); h.ex.set_reg(3, 0x2803n); h.ex.set_reg(1, BigInt(index)); h.ex.set_flags(0xcd4);
              h.view().setBigUint64(h.ex.ram() + address, initial, true); h.ex.run(interp); return h.snapshot();
            };
            const got = run(0); expect(h.ex.generic()).toBe(0);
            let result = 0n; for (let j = 0; j < n; j++) result |= BigInt(got.ram[address + j]) << BigInt(8 * j);
            expect(result).toBe(expected & mask); expect(h.ex.get_flags()).toBe(0xcd4 | +!!(old & b));
            expect(got).toEqual(run(1));
          }
        }
    }
  }, 180000);

  it('address-size override wraps signed bit-string offsets before segment addition', async () => {
    const h = await nativeHarness('f067480fab0bc3', preset);
    const run = (interp: number) => {
      h.ex.reset(BASE, 0); h.ex.set_reg(3, 0xfffffff8n); h.ex.set_reg(1, 64n); h.ex.set_flags(0xcd5);
      h.ex.run(interp); expect(h.ex.generic()).toBe(0);
      expect(h.view().getBigUint64(h.ex.ram(), true)).toBe(1n); return h.snapshot();
    };
    expect(run(0)).toEqual(run(1));
  });

  it('decoder refuses invalid LOCK, memory-only registers and unsupported MMX rather than mislifting them', async () => {
    const h = await nativeHarness('c3', preset);
    for (const [valid, codes] of [
      [false, ['f001c1', 'f00fc1c1', 'f00fb1c1', 'f0480fc7c8', 'f08903', 'f03903', '0fc7c8', '660f12c1', '660f16c1', '0f13c1', '0f17c1', 'f20f1603', '0f6ec1', '0f7ec1', '0f70c100', '0f60c1', 'f20fc6c100']],
      [true, ['f00103', 'f00fc103', 'f00fb103', '480fc70b', '0fc70b', '0f12c1', '0f16c1', '660f1203', '660f1603', 'f30f7ec1', '660f6ec1', 'f20f70c100', '660f60c1']],
    ] as const) for (const code of codes) {
      Buffer.from(code, 'hex').copy(Buffer.from(h.ex.memory.buffer), h.ex.ram() + 0x2000);
      expect(!!h.ex.decode_valid(0x2000, code.length / 2), code).toBe(valid);
    }
  });

  it('native bit-move reads respect read-only pages and stores fault without a protection bypass', async () => {
    const codes = ['f30f7e03', '0f1203', '0f1603', 'f20f1203', 'f30f1203', 'f30f1603', '660f6e03', '66480f6e03', '0fc603e5', '660f7003e5', '660f1403', '660f6003', '0f1303', '0f1703', '660f7e03', '66480f7e03', '660fd603'];
    const h = await nativeCases(codes.map(c => '4889cb' + c), preset);
    for (const [index, hex] of codes.entries()) {
      // Mutating the EA base inside the block prevents whole-block deoptimization from masking
      // the native operand check (the test exercises the emitted read/write permission path).
      const store = ['0f1303', '0f1703', '660f7e03', '66480f7e03', '660fd603'].includes(hex);
      for (const mode of [2, 0x10, 1]) {
        const run = (interp: number) => {
          h.ex.reset(h.pcs[index], 0); h.ex.set_reg(3, 0x2000n); h.ex.set_reg(1, ['0fc603e5', '660f7003e5', '660f1403', '660f6003'].includes(hex) ? 0x2800n : 0x2801n); h.ex.set_flags(0xcd5);
          h.ex.set_xmm(0, pair(words, 0), pair(words, 2)); h.ex.protect(2, mode);
          if (store || mode !== 2) expect(() => h.ex.run(interp)).toThrow(WebAssembly.RuntimeError);
          else h.ex.run(interp);
          expect(h.ex.generic()).toBe(0); return h.snapshot();
        };
        expect(run(0), hex + ':' + mode).toEqual(run(1));
      }
    }
  }, 180000);

  it('legacy shuffle/unpack m128 alignment faults before changing XMM, flags or memory', async () => {
    const codes = ['0fc603e5', '660fc603e5', '660f7003e5', 'f20f7003e5', 'f30f7003e5', '0f1403', '0f1503', '660f1403', '660f1503', '660f6003', '660f6103', '660f6203', '660f6803', '660f6903', '660f6a03', '660f6c03', '660f6d03'];
    const h = await nativeCases(codes.map(c => c), preset);
    for (const [index, hex] of codes.entries()) {
      for (let offset = 1; offset < 16; offset++) {
        const run = (interp: number) => {
          h.ex.reset(h.pcs[index], 0); h.ex.set_reg(3, BigInt(0x2000 + offset)); h.ex.set_flags(0xcd5);
          h.ex.set_xmm(0, pair(words, 0), pair(words, 2));
          expect(() => h.ex.run(interp)).toThrow(WebAssembly.RuntimeError);
          expect(h.ex.fault_address()).toBe(0x2000 + offset); expect(lanes(h, 0)).toEqual(words);
          expect(h.ex.get_flags()).toBe(0xcd5); expect(h.ex.generic()).toBe(0); return h.snapshot();
        };
        expect(run(0), hex + ':' + offset).toEqual(run(1));
      }
    }
  }, 180000);

  it('MOVD GPR result invalidates cold flag replay dependencies before a subsequent native memory fault', async () => {
    const h = await nativeHarness('4883c101660f7ec14889cbf30f7e0331c0c3', preset);
    const run = (interp: number) => {
      h.ex.reset(BASE, 0); h.ex.set_reg(1, 0xffffffffn); h.ex.set_reg(3, 0x2000n);
      h.ex.set_xmm(0, 0x2801n, MASK); h.ex.set_flags(0xcd5); h.ex.protect(2, 1);
      expect(() => h.ex.run(interp)).toThrow(WebAssembly.RuntimeError);
      expect(h.ex.get_flags()).toBe(flags(0xffffffffn, 1n, 8, true));
      expect(h.ex.get_reg(1)).toBe(0x2801n); return h.snapshot();
    };
    expect(run(0)).toEqual(run(1));
  });

  it('pre-execution quantum transfers leave the entire atomic pending, then complete once on resumption', async () => {
    const h = await nativeHarness('f0480fc10bc3', preset);
    const run = (interp: number) => {
      h.ex.reset(BASE, 2000000); h.ex.set_reg(3, 0x2001n); h.ex.set_reg(1, 7n); h.view().setBigUint64(h.ex.ram() + 0x2001, 5n, true); h.ex.stop_at_quantum(1);
      h.ex.run(interp); expect(h.view().getBigUint64(h.ex.ram() + 0x2001, true)).toBe(5n); expect(h.ex.get_reg(1)).toBe(7n);
      const stopped = h.snapshot();
      expect(h.ex.yields()).toBe(1);
      h.ex.resume(); h.ex.run(interp);
      expect(h.view().getBigUint64(h.ex.ram() + 0x2001, true)).toBe(12n);
      expect(h.ex.get_reg(1)).toBe(5n); expect(h.ex.yields()).toBe(1);
      return { stopped, resumed: h.snapshot() };
    };
    expect(run(0)).toEqual(run(1));
  });

  it('real cooperative scheduler interleaves pending atomic contexts only at instruction boundaries', async () => {
    for (const [hex, result, returned] of [['f0480fc10b', 19n, 12n], ['f0480fb10b', 7n, 7n]] as const) {
      const h = await nativeHarness(hex + 'c3', preset);
      const run = (interp: number) => {
        h.ex.reset(BASE, 2000000); h.ex.set_reg(3, 0x2001n); h.ex.set_reg(1, 7n); h.ex.set_reg(0, 5n);
        h.view().setBigUint64(h.ex.ram() + 0x2001, 5n, true);
        h.ex.stop_at_quantum(1); h.ex.run(interp);
        expect(h.view().getBigUint64(h.ex.ram() + 0x2001, true)).toBe(5n);
        // Both tasks are poised before the same instruction. The actual scheduler saves/restores
        // the whole guest CPU, never a wasm/native stack or a half-completed transaction.
        h.ex.tasks_init(); h.ex.task_clone(1);
        expect(h.ex.task_next()).toBe(1); h.ex.resume(); h.ex.run(interp);
        expect(h.view().getBigUint64(h.ex.ram() + 0x2001, true)).toBe(hex.includes('c1') ? 12n : 7n);
        const first = h.snapshot();
        expect(h.ex.task_next()).toBe(0); h.ex.resume(); h.ex.run(interp);
        expect(h.view().getBigUint64(h.ex.ram() + 0x2001, true)).toBe(result);
        expect(h.ex.get_reg(hex.includes('c1') ? 1 : 0)).toBe(returned);
        return { first, second: h.snapshot() };
      };
      expect(run(0)).toEqual(run(1));
    }
  });
});
