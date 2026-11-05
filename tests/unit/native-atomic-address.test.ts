// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0 — independent bit-string address arithmetic.
import { describe, expect, it } from 'vitest';
import { nativeCases } from '../support/native-forms';

describe.each(['size', 'fast'])('native LOCK bit addressing %s', preset => {
  it('applies signed operand-width displacement, address-size wrap, then FS/GS addition', async () => {
    const cases: { n: number; op: string; addr32: boolean; segment: string; hex: string }[] = [];
    for (const n of [2, 4, 8]) for (const op of ['ab', 'b3', 'bb'])
      for (const addr32 of [false, true]) for (const segment of ['', '64', '65'])
        cases.push({ n, op, addr32, segment, hex: 'f0' + segment + (addr32 ? '67' : '') + (n === 2 ? '66' : n === 8 ? '48' : '') + '0f' + op + '0b' });
    const h = await nativeCases(cases.map(c => c.hex), preset);
    expect(h.stats.generic).toBe(0);
    for (const [i, { n, op, addr32, segment }] of cases.entries()) {
      for (const [base, index, segmentBase] of [
        [0x2203n, 0n, 0x1000n], [0x2203n, -1n, 0x1000n], [0x2203n, -129n, 0x1000n],
        [addr32 ? 0x1234fffffff8n : 0xfffffffffffffff8n, 64n, 0x2000n],
        [0x2203n, 1n, 0xfffff000n], // A representable segment base must not wrap the final linear address at 4 GiB.
      ]) {
        const bits = BigInt(n * 8), signed = BigInt.asIntN(n * 8, index);
        // BigInt division truncates: explicitly use floor for negative bit-string indices.
        const element = signed >= 0n ? signed / bits : -((-signed + bits - 1n) / bits);
        const offset = BigInt.asUintN(addr32 ? 32 : 64, base + element * BigInt(n));
        const address = BigInt.asUintN(64, offset + (segment ? segmentBase : 0n));
        const bit = 1n << BigInt.asUintN(n * 8, index) % bits;
        const mask = (1n << bits) - 1n, initial = op === 'ab' ? 0n : mask;
        const answer = op === 'ab' ? initial | bit : initial & ~bit;
        const run = (interpreted: number) => {
          h.ex.reset(h.pcs[i], 0); h.ex.set_reg(3, base); h.ex.set_reg(1, index);
          h.ex.set_segments(segmentBase, segmentBase); h.ex.set_flags(0xcd4);
          if (address < 65528n) h.view().setBigUint64(h.ex.ram() + Number(address), initial, true);
          if (address >= 65528n) {
            expect(() => h.ex.run(interpreted), cases[i].hex + ':mode=' + interpreted + ':base=' + base.toString(16) + ':index=' + index + ':seg=' + segmentBase.toString(16) + ':expected=' + address.toString(16)).toThrow(WebAssembly.RuntimeError);
            expect(h.ex.get_flags()).toBe(0xcd4);
          } else {
            h.ex.run(interpreted);
            expect(h.view().getBigUint64(h.ex.ram() + Number(address), true) & mask).toBe(answer);
            expect(h.ex.get_flags()).toBe(0xcd4 | Number(!!(initial & bit)));
          }
          expect(h.ex.generic()).toBe(0); return h.snapshot();
        };
        expect(run(0), cases[i].hex + ':' + base + ':' + index).toEqual(run(1));
      }
    }
  }, 180000);
});
