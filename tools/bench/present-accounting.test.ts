// @bgt-examples: none
// CC0. Isolates snapshot capture with real scheduler/core and host clocks; no GPU
// or guest instruction work. This is not a game-overhead or executing-rate test.
import {it,expect} from 'vitest';
import {writeFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {compileC} from '../../tests/support/compile';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
// @ts-expect-error ESM
import {transform} from '../build/asyncify.mjs';
// @ts-expect-error ESM
import {WASM_OPT_FEATURES} from '../build/build.mjs';
// @ts-expect-error ESM
import {resourceSnapshot} from '../probe/resources.mjs';
const median=(v:number[])=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)];
it('isolates native-present capture cost for one and 64 scheduler identities',async()=>{
 const report=process.env.BGT_PRESENT_ACCOUNTING_REPORT;if(!report)throw new Error('owned report path required');
 const dir=mkdtempSync(join(tmpdir(),'bgt-present-overhead-')),rows:unknown[]=[],variants:Uint8Array<ArrayBuffer>[][]=[];
 const start=resourceSnapshot();
 try {
  for(const enabled of [0,1]) {
   const raw=await compileC('tests/fixtures/c/present-overhead.c',['X86_ACCOUNTING_ENABLED='+enabled,'X86_PROFILE_ENABLED=1'],false,['platforms/x86','platforms/win32']);
   const input=join(dir,'raw'+enabled+'.wasm'),output=join(dir,'async'+enabled+'.wasm');writeFileSync(input,raw);
   transform(input,output,[...WASM_OPT_FEATURES,'-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield']);
   variants.push([readFileSync(output),raw]);
  }
  const hashes=variants.map(v=>v.map(b=>createHash('sha256').update(b).digest('hex')));
  for(const threads of [1,64])for(const mode of ['asyncify','jspi'] as const) {
   const hosts=[];
   for(const enabled of [0,1]){
    const host=await GameHost.create(variants[enabled][mode==='jspi'?1:0],{vfs:new Vfs(),now:()=>performance.now(),log:()=>{}},
     {backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,suspensionMode:mode});
    host.init();const ex=(host as unknown as {exports:{prepare(n:number):void;run(n:number):void;presents():bigint;drops():bigint}}).exports;
    ex.prepare(threads);hosts.push(ex);
   }
   const samples:number[][]=[[],[]],presents=100000;
   for(let n=-1;n<9;n++)for(const enabled of (n%2===0?[1,0]:[0,1])){
    const begin=performance.now();hosts[enabled].run(presents);const ms=performance.now()-begin;
    if(n>=0)samples[enabled].push(ms);
   }
   for(const enabled of [0,1]){
    expect(hosts[enabled].presents()).toBe(1000000n);
    expect(hosts[enabled].drops()).toBe(enabled?999936n:0n);
   }
   const off=median(samples[0]),on=median(samples[1]);
   rows.push({threads,mode,presents,samples,offMedianMs:off,onMedianMs:on,incrementalNanosecondsPerPresent:(on-off)*1e6/presents,resources:resourceSnapshot()});
   writeFileSync(report,JSON.stringify({schema:'game-cask/present-accounting-overhead/1',start,hashes,rows},null,2)+'\n');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},600000);
