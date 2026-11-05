// @bgt-examples: none
// Original CC0: detects scaled timer bias, nested double counting, parked time,
// and Asyncify rewind side effects; checks every boundary, not just final totals.
import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileC} from '../support/compile';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build tool
import {transform} from '../../tools/build/asyncify.mjs';
// @ts-expect-error ESM build feature contract
import {WASM_OPT_FEATURES} from '../../tools/build/build.mjs';
type Ex={memory:WebAssembly.Memory;run:()=>void;total:()=>number;reset:()=>void;buffer:()=>number;prepare:()=>void;
 asyncify_get_state:()=>number;asyncify_start_unwind:(p:number)=>void;asyncify_stop_unwind:()=>void;asyncify_start_rewind:(p:number)=>void;asyncify_stop_rewind:()=>void;bias:(n:number)=>number};
it('demonstrates that extrapolated timer cost alone can exceed the entire wall interval',async()=>{
 let now=0;
 const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/interpreter-spans.c'),{bgt:{time_us:()=>++now,log:()=>{},yield:()=>{}}});
 const estimate=(instance.exports as unknown as Ex).bias(100000);
 expect(estimate).toBeGreaterThan(now*100); // no work: all elapsed time IS clock overhead
});
it('matches hand-timed exclusive spans through native nesting, scheduler work, reset and 300 actual suspensions',async()=>{
 for(const enabled of [0,1]){
  const raw=await compileC('tests/fixtures/c/interpreter-spans.c',['X86_PROFILE_ENABLED='+enabled]);
  const dir=mkdtempSync(join(tmpdir(),'bgt-spans-'));
  try{
   const input=join(dir,'raw.wasm'),out=join(dir,'async.wasm');writeFileSync(input,raw);
   transform(input,out,[...WASM_OPT_FEATURES,'-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield']);
   for(const mode of ['plain','asyncify',...(jspiApi()?['jspi']:[])]){
    let now=0,parked=0;
    const api=jspiApi();
    const pause=()=>{
     parked++;
     expect(e.total()).toBe(enabled?56*(parked-1)+45:0);
     const before=e.total();now+=1000000;e.reset();expect(e.total()).toBe(before);
    };
    const yieldFn=mode==='asyncify'?()=>{if(e.asyncify_get_state()===2)e.asyncify_stop_rewind();else{pause();e.asyncify_start_unwind(e.buffer());}}:mode==='jspi'?new api!.Suspending(async()=>{pause();await Promise.resolve();}):pause;
    const {instance}=await WebAssembly.instantiate(mode==='asyncify'?readFileSync(out):raw,{bgt:{time_us:()=>now,log:(us:number)=>{now+=us;},yield:yieldFn}});
    const e=instance.exports as unknown as Ex;e.prepare();
    const run=mode==='jspi'?api!.promising(e.run):e.run;
    for(let n=1;n<=300;n++){
     await run(0);
     if(mode==='asyncify'){expect(e.asyncify_get_state()).toBe(1);e.asyncify_stop_unwind();expect(e.total()).toBe(enabled?56*(n-1)+45:0);e.asyncify_start_rewind(e.buffer());e.run();expect(e.asyncify_get_state()).toBe(0);}
     expect(e.total()).toBe(enabled?56*n:0);
     expect(now-n*1000000).toBe(356*n); // 56 interpreted +300 excluded, per update
     expect(e.total()).toBeLessThanOrEqual(now-n*1000000);
    }
    expect(parked).toBe(300);
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
},600000);
