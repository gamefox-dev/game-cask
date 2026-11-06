// Original CC0-1.0. Opt-in compiler experiment; all flags enter existing object keys.
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../../tests/support/headless';
import { k35Fixture, type K35Fixture } from './k35-fixture';
// @ts-expect-error plain ESM
import { experimentalBuilder } from './k36-build.mjs';
it('prepares isolated lifted-chunk compiler variants and checks both actual suspension modes', async()=>{
 const {buildGame}=await experimentalBuilder();
 const out=process.env.BGT_K36_OUT!; mkdirSync(out,{recursive:true});
 const {id,dir,expected}=k35Fixture((process.env.BGT_K35_FIXTURE??'vm') as K35Fixture);
 const flags=JSON.parse(process.env.BGT_K36_CLANG_FLAGS??'[]');
 const manifest=buildGame(dir,{quiet:true});
 cpSync(join(ROOT,'web/public/games',id),join(out,'game'),{recursive:true});
 const interpreted=buildGame(dir,{quiet:true,interpretOnly:true});
 const oracles=[];
 for(const mode of ['asyncify','jspi'] as const){
  const states=[]; const metrics=[];
  for(const variant of [id,id+'-interp']){
   const h=await loadHeadless(variant,{suspension:mode});const hashes=[];
   for(let n=0;n<300;n++){await h.stepAsync(1); hashes.push(h.host.stateHash());}
   expect(h.logs).toContain(expected);states.push(hashes);metrics.push(h.host.metrics());
  }
  expect(states[0]).toEqual(states[1]);
  expect((metrics[0] as {interp_insns:number}).interp_insns).toBe(0);
  expect((metrics[0] as {stubs:unknown[]}).stubs).toEqual([]);
  oracles.push({mode,states,metrics});
 }
 writeFileSync(join(out,'evidence.json'),JSON.stringify({flags,manifest,interpreted,oracles},null,2));
});
