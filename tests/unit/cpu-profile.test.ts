// Original CC0 measurements: precise retained census counts and honest sampled timing/resource failures.
import { it, expect } from 'vitest';
import { compileC } from '../support/compile';
// @ts-expect-error ESM tool
import { profileRange, mapProfile } from '../../tools/probe/cpu-profile.mjs';
// @ts-expect-error ESM tool
import { resourceSnapshot } from '../../tools/probe/resources.mjs';

it('retains separate address/reason counts, instruction totals and visible bounded overflow', async()=>{
  let now=0;
  const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/cpu_profile.c'),{bgt:{time_us:()=>++now}});
  const ex=instance.exports as any;
  const a=ex.census(0x1234,1,3),b=ex.census(0x1234,2,7);
  expect(a).not.toBe(b);expect(ex.census(0x1234,1,2)).toBe(a);
  expect(ex.count(a)).toBe(2);expect(ex.instructions(a)).toBe(5);expect(ex.instructions(b)).toBe(7);
  const elapsed=ex.timing(100000);
  expect(ex.samples()).toBeGreaterThan(70);expect(ex.samples()).toBeLessThan(150);
  expect(elapsed).toBe(ex.samples());
  const before=ex.clock();ex.idle_start();now+=5000;ex.idle_end();
  expect(ex.clock()-before).toBe(2); // only the explicit clock and idle-begin calls remain active
  for(let i=0;i<300000;i++)ex.census(i,7,1);
  expect(ex.dropped()).toBeGreaterThan(0);expect(ex.count(a)).toBe(2);
  ex.reset_census();expect(ex.generation()).toBe(1);expect(ex.dropped()).toBe(0);
  const fresh=ex.census(0x1234,1,7);expect(ex.count(fresh)).toBe(1);expect(ex.instructions(fresh)).toBe(7);
  ex.stale_instruction(a);expect(ex.instructions(fresh)).toBe(7); // suspended old-window tokens cannot contaminate the new one
  expect(ex.samples()).toBeGreaterThan(70);
});
it('validates frame ranges and maps native region/function names without inventing guest addresses',()=>{
  expect(profileRange('100:200')).toEqual({start:100,end:200});
  for(const s of ['1','2:1','-1:2','0:0','0:NaN'])expect(()=>profileRange(s)).toThrow();
  const mapped=mapProfile({nodes:[{id:1,callFrame:{functionName:'R_01001000_01001200'},hitCount:3},
    {id:2,callFrame:{functionName:'wasm-function[51]'}},{id:3,callFrame:{functionName:'jsWork'}}]});
  expect(mapped[0]).toMatchObject({guestAddress:0x1001000,regionAddress:0x1001200,hitCount:3});
  expect(mapped[1]).toMatchObject({guestAddress:null,wasmFunction:'51'});expect(mapped[2].guestAddress).toBeNull();
});
it('takes a best-effort resource snapshot with unavailable observations explicitly null',()=>{
  const r=resourceSnapshot();expect(r.cpuCount).toBeGreaterThan(0);expect(r.totalRamBytes).toBeGreaterThan(0);
  expect(r.loadAverage).toHaveLength(3);expect(Array.isArray(r.errors)).toBe(true);
  expect(r.topCpuProcesses===null || Array.isArray(r.topCpuProcesses)).toBe(true);
  expect(r.heavyGate.slots).toBeGreaterThan(0);
});
