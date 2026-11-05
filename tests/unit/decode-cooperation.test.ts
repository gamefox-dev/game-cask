// @bgt-examples: none
// Original CC0. A parked CRT qsort callback must not execute the other task's
// colliding decoded SSE store. Checks every comparator quantum position and real
// Asyncify/JSPI rewind, plus many interleavings and native return-stop ownership.
import {it, expect} from 'vitest';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compileC} from '../support/compile';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build tool
import {transform} from '../../tools/build/asyncify.mjs';
// @ts-expect-error ESM feature flags
import {WASM_OPT_FEATURES} from '../../tools/build/build.mjs';
type Ex={configure(mode:number,at:number,every:number,park:number,rounds:number):void;result():number;done():number;switches():number};
it('qsort callbacks own decoded instructions and continuations across two colliding guest tasks',async()=>{
 const raw=await compileC('tests/fixtures/c/decode-cooperation.c',[],true,['platforms/x86','platforms/win32']);
 const dir=mkdtempSync(join(tmpdir(),'bgt-decode-cooperation-'));
 try {
  const input=join(dir,'raw.wasm'),output=join(dir,'async.wasm');writeFileSync(input,raw);
  transform(input,output,[...WASM_OPT_FEATURES,'-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield']);
  const hashes:string[]=[];
  for(const mode of ['asyncify',...(jspiApi()?['jspi']:[])] as ('asyncify'|'jspi')[]) {
   for(const at of [0,2,4,9,12,15,18])for(const lifted of [0,1]) {
    const host=await GameHost.create(mode==='asyncify'?readFileSync(output):raw,{vfs:new Vfs(),now:()=>0,log:()=>{}},
     {backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,suspensionMode:mode});
    const ex=(host as unknown as {exports:Ex}).exports;host.init();ex.configure(lifted,at,1,1,1);
    for(let f=0;f<300;f++)await host.update();
    expect(ex.done()).toBe(1);expect(ex.result()).toBe(0);expect(ex.switches()).toBeGreaterThan(0);
    expect(host.yields).toBe(ex.switches());hashes.push(host.stateHash()!);
   }
   // Aperiodic callback-level interleavings over 100 sorts, without host waits.
   for(const lifted of [0,1])for(const every of [1,3,7,13]) {
    const host=await GameHost.create(mode==='asyncify'?readFileSync(output):raw,{vfs:new Vfs(),now:()=>0,log:()=>{}},
     {backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,suspensionMode:mode});
    const ex=(host as unknown as {exports:Ex}).exports;host.init();ex.configure(lifted,0,every,0,100);
    await host.update();expect(ex.done()).toBe(1);expect(ex.result()).toBe(0);
    expect(ex.switches()).toBeGreaterThan(100);hashes.push(host.stateHash()!);
   }
  }
  expect(new Set(hashes).size).toBe(1);
 }finally {rmSync(dir,{recursive:true,force:true});}
},60000);
