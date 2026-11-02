// @bgt-examples: none
// Original CC0 contracts: REAL runtime, not the codegen snapshot harness's boundary substitutes.
import { it, expect } from 'vitest';
import { compileC } from '../support/compile';

it('registry cache preserves exact ranges, misses, collisions, force-interpreter and registration invalidation', async () => {
  const { instance } = await WebAssembly.instantiate(await compileC('tests/fixtures/c/lift_dispatch.c'), {
    bgt: { coverage_entry: () => {}, abort: () => { throw new Error('guest abort'); } },
  });
  const ex = instance.exports as unknown as { cache(): number; nx(): void; thunk(): number };
  expect(ex.cache()).toBe(0);
  expect(ex.thunk()).toBe(0);
  expect(() => ex.nx()).toThrow('guest abort');
});

it.each([0, 1])('strict native chaining checks a foreign-owner lookup (warm=%s) before its first step', async (warm) => {
  const missing: [number, number][] = [];
  const { instance } = await WebAssembly.instantiate(await compileC('tests/fixtures/c/native_chain_strict.c'), {
    bgt: { slice_missing: (kind: number, address: number) => {
      missing.push([kind, address]); throw new Error('strict native stop');
    }, abort: () => { throw new Error('guest abort'); } },
  });
  const ex = instance.exports as unknown as { strict_chain(warm: number): void; native_steps(): number };
  expect(() => ex.strict_chain(warm)).toThrow('strict native stop');
  expect(missing).toEqual([[1, 0x2000]]);
  expect(ex.native_steps()).toBe(1); // caller only: the forbidden foreign owner's side effects never run
});

it('flat native chaining crosses owners without recursive host frames and respects nested callback returns', async () => {
  const { instance } = await WebAssembly.instantiate(await compileC('tests/fixtures/c/native_chain.c'), {
    bgt: { coverage_entry: () => {}, abort: () => { throw new Error('guest abort'); } },
  });
  const ex = instance.exports as unknown as { chain(): number; callback_chain(): number };
  expect(ex.chain()).toBe(0);
  expect(ex.callback_chain()).toBe(0);
});
