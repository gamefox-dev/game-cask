// @bgt-examples: none
// Original CC0: catches real dispatcher nesting, return/unwind leaks, and park/reset
// regressions against a hand clock inside actual GameHost.update wall intervals.
import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileC} from '../support/compile';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build tool
import {transform} from '../../tools/build/asyncify.mjs';
type Ex={total():number;done():number;started():number;set_quantum(n:number):void;insns():number;string_run(budget:number,count:number):void;remaining():number;transfer():number;long_run():void};
for(const width of [0,1])it('hand-times the real '+(width?'AMD64':'i386')+' dispatcher across native/API callbacks and 300 host updates',async()=>{
 for(const enabled of [0,1]){
  const raw=await compileC('tests/fixtures/c/interpreter-dispatch-spans.c',['MODE64='+width,'X86_PROFILE_ENABLED='+enabled],true);
  const dir=mkdtempSync(join(tmpdir(),'bgt-dispatch-spans-'));
  try{
   const input=join(dir,'raw.wasm'),output=join(dir,'async.wasm');writeFileSync(input,raw);
   transform(input,output,['-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield']);
   for(const mode of ['asyncify',...(jspiApi()?['jspi']:[])] as ('asyncify'|'jspi')[]){
    let now=0;
    const host=await GameHost.create(mode==='asyncify'?readFileSync(output):raw,{vfs:new Vfs(),now:()=>now,
     log:(duration)=>{now+=duration;}},{backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,suspensionMode:mode});
    const ex=(host as unknown as {exports:Ex}).exports;host.init();
    const complete=width?90:80,atPark=complete-20;
    for(let f=1;f<=300;f++){
     const before=ex.total(),wall=host.profile.updateMs;
     await host.update();
     const runs=Math.floor(f/2),expected=runs*complete+(f%2?atPark:0);
     expect(ex.total()).toBe(enabled?expected*1000:0);
     expect(ex.total()-before).toBeLessThanOrEqual((host.profile.updateMs-wall)*1000);
     expect(ex.total()).toBeLessThanOrEqual(host.profile.updateMs*1000);
     const summary=(host.metrics() as {execution_summary:{interpreter:{timing_status:string;measured_ms:number|null;estimated_share:number|null}}}).execution_summary.interpreter;
     expect(summary.timing_status).toBe(enabled?'measured':'disabled');
     expect(summary.measured_ms).toBe(enabled?expected:null);
     if(enabled)expect(summary.estimated_share).toBeLessThanOrEqual(1);
     expect(ex.done()).toBe(runs);expect(ex.started()).toBe(Math.ceil(f/2));
     expect(host.suspended).toBe(f%2===1);
     const total=ex.total();now+=1000000;host.profileReset();host.render();host.consume();
     expect(ex.total()).toBe(total); // idle and observation calls cannot accrue interpretation
    }
    expect(ex.insns()).toBe(150*9);expect(host.yields).toBe(150);
    // A pre-execution scheduler transfer must close the enclosing interval on return.
    ex.set_quantum(2000000);const total=ex.total();await host.update();
    expect(ex.total()-total).toBe(enabled&&width?10000:0);
    expect(host.suspended).toBe(false);const frozen=ex.total();now+=1000000;expect(ex.total()).toBe(frozen);
    // Real REP pre-execution transfer, followed by a completed zero-count REP.
    ex.string_run(1999999,2);expect(ex.remaining()).toBe(2);expect(ex.transfer()).not.toBe(0);
    expect(ex.total()-frozen).toBe(enabled?10000:0);
    const partial=ex.total();now+=1000000;expect(ex.total()).toBe(partial);
    ex.string_run(0,0);expect(ex.remaining()).toBe(0);expect(ex.transfer()).toBe(0);
    expect(ex.total()-partial).toBe(enabled?20000:0);
    const beforeLoop=ex.total(),clocks=host.importCounts.time_us ?? 0;ex.long_run();
    expect(ex.total()-beforeLoop).toBe(enabled?100020000:0);
    // 10,002 real decoded instructions; coarse transitions plus raw ~1/1024 samples,
    // NOT a clock at every interpreted dispatch. Disabled timing has no clock imports.
    expect((host.importCounts.time_us ?? 0)-clocks).toBeLessThan(100);
    if(!enabled)expect((host.importCounts.time_us ?? 0)-clocks).toBe(0);
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
},600000);
