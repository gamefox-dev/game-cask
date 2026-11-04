// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0 — architectural effective-address regressions from vK27.
import { describe, expect, it } from 'vitest';
import { BASE, nativeCases, nativeHarness } from '../support/native-forms';

describe.each(['size', 'fast'])('native AMD64 address regressions %s', preset => {
  it('adds FS/GS after address-size truncation at full linear width for scalar/SIMD/atomic operands', async () => {
    const forms = ['f30f7e03', '0f1303', '0fc603e5', 'f0480fc10b', 'f0480fb10b', '48870b', '488b03', '488903'];
    const cases = ['64', '65'].flatMap(seg => forms.map(form => seg + '67' + form));
    const h = await nativeCases(cases, preset);
    expect(h.stats.generic).toBe(0);
    for (const [i, hex] of cases.entries()) for (const segment of [0x1000n, 0xfffff000n]) {
      const run = (interpreted: number) => {
        h.ex.reset(h.pcs[i], 0); h.ex.set_reg(3, 0x123400002200n); h.ex.set_reg(1, 7n);
        h.ex.set_reg(0, 5n); h.ex.set_segments(segment, segment); h.ex.set_flags(0xcd5);
        h.ex.set_xmm(0, 0x8877665544332211n, 0x0123456789abcdefn);
        h.view().setBigUint64(h.ex.ram() + 0x1200, 5n, true);
        h.view().setBigUint64(h.ex.ram() + 0x3200, 5n, true);
        if (segment === 0xfffff000n) {
          // Offset0x2200 + segment0xfffff000 is0x100001200, not low mapping0x1200.
          expect(() => h.ex.run(interpreted), hex + ':' + interpreted).toThrow(WebAssembly.RuntimeError);
          expect(h.view().getBigUint64(h.ex.ram() + 0x1200, true)).toBe(5n);
          expect(h.ex.get_flags()).toBe(0xcd5);
          expect(h.ex.get_reg(1)).toBe(7n);
        } else h.ex.run(interpreted);
        expect(h.ex.generic()).toBe(0); return h.snapshot();
      };
      expect(run(0), hex + ':' + segment.toString(16)).toEqual(run(1));
    }
  }, 180000);

  it('decodes long-mode addr32 ModRM no-base as EIP-relative, with length, wrap, FS/GS and SIB controls', async () => {
    const forms = ['f30f7e05', '0f1305', '0fc605e5', 'f0480fc10d', '488b05', '488d05'];
    const cases: string[] = [];
    for (const segment of ['', '64', '65']) for (const form of forms) {
      // SHUFPS has an immediate after disp32; relative PC is the end of the entire instruction.
      const shuffle = form.startsWith('0fc6');
      const opcode = shuffle ? form.slice(0, -2) : form;
      const length = segment.length / 2 + 1 + opcode.length / 2 + 4 + +shuffle;
      const displacement = Buffer.alloc(4); displacement.writeUInt32LE((0x2000 - (BASE + length)) >>> 0);
      cases.push(segment + '67' + opcode + displacement.toString('hex') + (shuffle ? 'e5' : ''));
    }
    for (const hex of cases) {
      const h = await nativeHarness(hex + 'c3', preset); expect(h.stats.generic).toBe(0);
      const run = (interpreted: number) => {
        h.ex.reset(BASE, 0); h.ex.set_reg(1, 7n); h.ex.set_segments(0x1000n, 0x1000n); h.ex.set_flags(0xcd5);
        h.ex.set_xmm(0, 0x1122334455667788n, 0x0123456789abcdefn);
        for (const address of [0x2000, 0x3000]) h.view().setBigUint64(h.ex.ram() + address, 0x12345678abcdef01n, true);
        h.ex.run(interpreted);
        if (hex.includes('f30f7e')) expect(BigInt.asUintN(64, h.ex.get_xmm(0, 0))).toBe(0x12345678abcdef01n);
        if (hex.includes('488d')) expect(h.ex.get_reg(0)).toBe(0x2000n); // LEA ignores segment bases.
        expect(h.ex.generic()).toBe(0); return h.snapshot();
      };
      expect(run(0), hex).toEqual(run(1));
    }
    // Unlike mod00/rm101, SIB base101 remains absolute disp32 in long mode, with or without67.
    for (const hex of ['67f30f7e042500200000', 'f30f7e042500200000']) {
      const h = await nativeHarness(hex + 'c3', preset);
      const run = (interpreted: number) => {
        h.ex.reset(BASE, 0); h.view().setBigUint64(h.ex.ram() + 0x2000, 99n, true); h.ex.run(interpreted);
        expect(h.ex.get_xmm(0, 0)).toBe(99n); return h.snapshot();
      };
      expect(run(0)).toEqual(run(1));
    }
  }, 180000);
});
