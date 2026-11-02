// @bgt-examples: none
// Original CC0 contracts: REAL runtime, not the codegen snapshot harness's boundary substitutes.
import { it, expect } from 'vitest';
import { compileC } from '../support/compile';
import { instantiateFixture } from '../support/wasm-fixture';
import { GameAbort, OutsideSlice } from '../../bgt/runtime/host';

it('registry cache preserves exact ranges, misses, collisions, force-interpreter and registration invalidation', async () => {
  const { exports } = await instantiateFixture(await compileC('tests/fixtures/c/lift_dispatch.c'));
  const ex = exports as unknown as { cache(): number; nx(): void; thunk(): number };
  expect(ex.cache()).toBe(0);
  expect(ex.thunk()).toBe(0);
  expect(() => ex.nx()).toThrow(GameAbort);
});

it.each([0, 1])('strict native chaining checks a foreign-owner lookup (warm=%s) before its first step', async (warm) => {
  const { host, exports } = await instantiateFixture(await compileC('tests/fixtures/c/native_chain_strict.c'));
  const ex = exports as unknown as { strict_chain(warm: number): void; native_steps(): number };
  expect(() => ex.strict_chain(warm)).toThrow(new OutsideSlice(1, 0x2000));
  expect([...host.codeCoverage]).toEqual([[0x2000, 2]]);
  expect(ex.native_steps()).toBe(1); // caller only: the forbidden foreign owner's side effects never run
});

it('flat native chaining crosses owners without recursive host frames and respects nested callback returns', async () => {
  const { exports } = await instantiateFixture(await compileC('tests/fixtures/c/native_chain.c'));
  const ex = exports as unknown as { chain(): number; callback_chain(): number };
  expect(ex.chain()).toBe(0);
  expect(ex.callback_chain()).toBe(0);
});
