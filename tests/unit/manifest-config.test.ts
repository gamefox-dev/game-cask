// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0
// vK71: build-time validation of game.json "gpu" (copied verbatim into the manifest). Breakage caught: a typo'd key
// or a string "false" for recoveryShadows reaching the manifest (the runtime would ignore it or fail at init).
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped kit tool module
import { validateGpuConfig } from '../../tools/build/manifest-config.mjs';

describe('vK71 game.json gpu validation', () => {
  it('accepts absent, empty and the documented keys', () => {
    for (const ok of [undefined, {}, { budgetBytes: 16 * 1024 * 1024 }, { recoveryShadows: false }, { budgetBytes: 0xffffffff, recoveryShadows: true }, { limits: 'portable' }, { limits: 'device', recoveryShadows: false }])
      expect(() => validateGpuConfig(ok)).not.toThrow();
  });
  it('rejects unknown keys, non-boolean recoveryShadows, bad budgets and non-objects', () => {
    expect(() => validateGpuConfig({ recoveryShadow: false })).toThrow(/unknown key\(s\) "recoveryShadow"/);
    expect(() => validateGpuConfig({ recoveryShadows: 'false' })).toThrow(/must be a boolean/);
    expect(() => validateGpuConfig({ recoveryShadows: 0 })).toThrow(/must be a boolean/);
    expect(() => validateGpuConfig({ budgetBytes: 1024 })).toThrow(/budgetBytes/);
    // K73: a typo'd mode would silently fall back to portable at runtime (init failure); reject it at build time.
    for (const bad of ['Device', 'max', true, 1]) expect(() => validateGpuConfig({ limits: bad })).toThrow(/gpu.limits must be/);
    expect(() => validateGpuConfig({ budgetBytes: 2 ** 33 })).toThrow(/budgetBytes/);
    for (const bad of [null, [], 'x', 3]) expect(() => validateGpuConfig(bad)).toThrow(/must be an object/);
  });
});
