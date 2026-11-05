// @bgt-examples: none
// Shared native CRT primitives: exact unsigned-byte results, no overread or pointer truncation.
import { it, expect } from 'vitest';
import { compileC } from '../support/compile';
import { instantiateFixture } from '../support/wasm-fixture';
import { GameAbort } from '../../bgt/runtime/host';
it('leaf eligibility refuses callback, transfer, wait, yield and deferred contexts without consuming them', async () => {
  const { exports } = await instantiateFixture(await compileC('tests/fixtures/c/import_leaf_context.c', [], false, ['platforms/x86']));
  expect((exports.leaf_context as () => number)()).toBe(0);
});
it('CRT comparison/length leaves preserve full Win64 pointers, readonly page edges and zero bounds', async () => {
  const { exports } = await instantiateFixture(await compileC('tests/fixtures/c/import_strings.c', [], true, ['platforms/x86']));
  const call = exports.strings as (mode: number) => bigint;
  expect(call(0)).toBe(127n);
  expect(call(1)).toBe(127n);
  expect(call(8)).toBe(1n);
  expect(call(6)).toBe(0n); // n=0 must not inspect even a high unmapped pointer
  expect(call(7)).toBe(1n);
  for (const [mode, diagnostic] of [
    [2, "64-bit guest pointer outside low address space at 0x00000000"],
    [3, "64-bit guest pointer outside low address space at 0x00000000"],
    [4, "guest memory access violation at 0x00003ffe"],
    [9, "guest memory access violation at 0x00004000"],
    [10, "64-bit guest pointer outside low address space at 0x00000000"],
    [12, "guest memory access violation at 0x00003ffe"],
    [15, "64-bit guest pointer outside low address space at 0x00000000"],
    [16, "64-bit guest pointer outside low address space at 0x00000000"],
    [17, "guest memory access violation at 0x00004000"],
  ] as const) {
    let error: unknown;
    try { call(mode); } catch (e) { error = e; }
    expect(error, `fault mode ${mode}`).toBeInstanceOf(GameAbort);
    expect((error as Error).message).toContain(diagnostic);
  }
  expect(call(11)).toBe(127n); // size_t is not truncated to a zero bound
  expect(call(13)).toBe(32767n);
  expect(call(14)).toBe(1n);
  // Prefixes differ: neither implementation may probe past their first difference.
  expect(call(5)).toBe(127n);
});
