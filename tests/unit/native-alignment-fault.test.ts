// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0
import { describe, expect, it } from 'vitest';
import { BASE, nativeHarness } from '../support/native-forms';

describe.each(['size', 'fast'])('native alignment cold flags %s', preset => {
  it('reconstructs otherwise-dead ADD flags on the SHUFPS alignment abort edge', async () => {
    // The trailing XOR kills ADD flags on the non-faulting path. An alignment #GP
    // must instead expose the complete ADD result/flags before SHUFPS changed XMM.
    const h = await nativeHarness('4883c1010fc603e531c0c3', preset);
    expect(h.stats.generic).toBe(0);
    for (const [input, expectedFlags] of [[0x7fffffffffffffffn, 0xc94], [0xffffffffffffffffn, 0x455], [15n, 0x410]] as const) {
      for (const offset of [1, 15]) {
        const run = (interpreted: number) => {
          h.ex.reset(BASE, 0); h.ex.set_reg(1, input); h.ex.set_reg(3, BigInt(0x2000 + offset));
          h.ex.set_flags(0xcd5); h.ex.set_xmm(0, 0x123456789abcdef0n, 0x76543210fedcba98n);
          const before = h.snapshot().ram;
          expect(() => h.ex.run(interpreted)).toThrow(WebAssembly.RuntimeError);
          expect(h.ex.get_flags()).toBe(expectedFlags);
          expect(BigInt.asUintN(64, h.ex.get_reg(1))).toBe(BigInt.asUintN(64, input + 1n));
          expect(BigInt.asUintN(64, h.ex.get_xmm(0, 0))).toBe(0x123456789abcdef0n);
          expect(BigInt.asUintN(64, h.ex.get_xmm(0, 1))).toBe(0x76543210fedcba98n);
          expect(h.ex.fault_address()).toBe(0x2000 + offset); expect(h.ex.generic()).toBe(0);
          const snapshot = h.snapshot(); expect(snapshot.ram).toEqual(before); return snapshot;
        };
        expect(run(0)).toEqual(run(1));
      }
    }
  });
});
