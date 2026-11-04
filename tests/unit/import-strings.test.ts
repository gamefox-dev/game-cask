// @bgt-examples: none
// Shared native CRT primitives: exact unsigned-byte results, no overread or pointer truncation.
import { it, expect } from 'vitest';
import { compileC } from '../support/compile';
import { instantiateFixture } from '../support/wasm-fixture';
import { GameAbort } from '../../bgt/runtime/host';
it('CRT comparison/length leaves preserve full Win64 pointers, readonly page edges and zero bounds', async () => {
  const { exports } = await instantiateFixture(await compileC('tests/fixtures/c/import_strings.c', [], true));
  const call = exports.strings as (mode: number) => bigint;
  expect(call(0)).toBe(127n);
  expect(call(1)).toBe(127n);
  expect(call(8)).toBe(1n);
  expect(call(6)).toBe(0n); // n=0 must not inspect even a high unmapped pointer
  expect(call(7)).toBe(1n);
  for (const mode of [2, 3, 4]) expect(() => call(mode)).toThrow(GameAbort);
  // Prefixes differ: neither implementation may probe past their first difference.
  expect(call(5)).toBe(127n);
});
