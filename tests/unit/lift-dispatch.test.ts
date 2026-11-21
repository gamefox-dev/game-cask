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

it.each([0,1])('native fast paths invalidate site caches and reject replaced, null and NX targets (stats=%s)', async(stats)=>{
  const {exports}=await instantiateFixture(await compileC('tests/fixtures/c/native_fast_guards.c',['X86_NATIVE_STATS='+stats]));
  expect((exports.guards as ()=>number)()).toBe(0);
  expect(()=> (exports.nx_fast as ()=>void)()).toThrow(GameAbort);
});

it.each([0,1])('warm exact-PC admission certificates preserve all live guards (kind=%s)',async(kind)=>{
 const {exports}=await instantiateFixture(await compileC('tests/fixtures/c/native_cached_guards.c'));
 expect((exports.cached_guards as (k:number)=>number)(kind)).toBe(0);
 expect(()=>(exports.cached_nx as (k:number)=>void)(kind)).toThrow(GameAbort);
});
it.each([0,1])('cached enter/resume recheck tightened strict membership (kind=%s)',async(kind)=>{
 const {exports}=await instantiateFixture(await compileC('tests/fixtures/c/native_cached_guards.c',['X86_COVERAGE_MODE=2']));
 expect(()=>(exports.cached_strict as (k:number)=>void)(kind)).toThrow(new OutsideSlice(1,0x2000));
});
it('registry growth and an override installed mid-frame invalidate direct, indirect and resume admissions',async()=>{
  const {exports}=await instantiateFixture(await compileC('tests/fixtures/c/native_registry_growth.c'));
  expect((exports.growth as ()=>number)()).toBe(0);
  expect(()=>(exports.nx_resume as ()=>void)()).toThrow(GameAbort);
});

it.each([0,1,2,3])('warm fast path rechecks tightened strict policy before execution (kind=%s)',async(kind)=>{
  const {exports}=await instantiateFixture(await compileC('tests/fixtures/c/native_fast_strict.c'));
  expect(()=>(exports.strict_fast as (n:number)=>void)(kind)).toThrow(new OutsideSlice(1,0x2000));
  expect((exports.native_steps as ()=>number)()).toBe(0);
});

it('guarded import bindings preserve full-width operands, stale loaded targets and suspension token ownership', async () => {
  const { exports } = await instantiateFixture(await compileC('tests/fixtures/c/import_bindings.c'));
  expect((exports.bindings as () => number)()).toBe(0);
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
