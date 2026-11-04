// @bgt-examples: none
// Original CC0 C++ pipeline input: catches Binaryen duplicate-name normalization,
// profile/global/table mismatches, unsafe native exclusions, and real loader regressions.
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,loadHeadless} from '../support/headless';
// @ts-expect-error ESM build orchestration
import {buildGame,WASM_OPT_FEATURES} from '../../tools/build/build.mjs';
// @ts-expect-error ESM partition orchestration
import {transform} from '../../tools/build/asyncify.mjs';
// @ts-expect-error ESM metadata
import {functionNames} from '../../tools/build/wasm-names.mjs';
it('matches whole-module Asyncify on 300 C++ pipeline frames with real native exclusions',async()=>{
 const cache=join(ROOT,'node_modules/.cache/bgt');mkdirSync(cache,{recursive:true});const dir=mkdtempSync(join(cache,'partition-pipeline-'));
 try{
  const input=join(dir,'raw.wasm');
  const manifest=buildGame('examples/x64-cpprt',{quiet:true,onLinkedWasm:(p:string)=>writeFileSync(input,readFileSync(p))});
  const remove=functionNames(readFileSync(input)).filter((n:any)=>n.name.startsWith('N_')).map((n:any)=>n.name);
  const result=transform(input,join(dir,'game.wasm'),[...WASM_OPT_FEATURES,'-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield',...(remove.length?['--pass-arg=asyncify-removelist@'+remove.join(',')]:[])],{wholeLimit:0,partitionBytes:4194304});
  expect(result.partitions).toBeGreaterThan(1);
  manifest.wasm.url='game.wasm';delete manifest.suspension;
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));
  symlinkSync(join(ROOT,'web/public/games/x64-cpprt/assets'),join(dir,'assets'));
  const baseline=await loadHeadless('x64-cpprt',{suspension:'asyncify'}),partitioned=await loadHeadless('x64-cpprt',{dir,suspension:'asyncify'});
  for(let f=0;f<300;f++){await baseline.stepAsync();await partitioned.stepAsync();expect(partitioned.host.stateHash()).toBe(baseline.host.stateHash());}
  expect(partitioned.logs).toEqual(baseline.logs);expect(partitioned.host.metrics()).toMatchObject({interp_insns:0,stubs:[]});
 }finally{rmSync(dir,{recursive:true,force:true});}
},300000);
