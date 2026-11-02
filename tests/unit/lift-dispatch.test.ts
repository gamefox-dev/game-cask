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
