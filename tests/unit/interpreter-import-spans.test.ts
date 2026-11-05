// @bgt-examples: none
// Original CC0. I14 composition: interpreted CALL -> native driver -> K29 leaf
// or bound API. K26 must exclude API work, retain nested interpreted callbacks,
// and freeze on exceptions, including a rejected JSPI resume / Asyncify rewind.
import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileC} from '../support/compile';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error plain ESM
import {transform} from '../../tools/build/asyncify.mjs';
// @ts-expect-error plain ESM
import {WASM_OPT_FEATURES} from '../../tools/build/build.mjs';
type Ex={set_import_mode(n:number):void;total():number;sample_open():number;idle_end():void;import_calls():number;direct_calls():bigint;leaf_calls():bigint;bgt_profile_abort(n:number):void};
for(const suspension of ['asyncify',...(jspiApi()?['jspi']:[])] as const)it('hand-times direct leaf / bound imports and exception cleanup in '+suspension,async()=>{
 const raw=await compileC('tests/fixtures/c/interpreter-dispatch-spans.c',['MODE64=1','X86_PROFILE_ENABLED=1'],true);
 const dir=mkdtempSync(join(tmpdir(),'bgt-import-spans-'));
 try {
  writeFileSync(join(dir,'raw.wasm'),raw);
  transform(join(dir,'raw.wasm'),join(dir,'async.wasm'),[...WASM_OPT_FEATURES,'-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield']);
  const wasm=suspension==='jspi'?raw:readFileSync(join(dir,'async.wasm'));
  for(const mode of [1,2,3])for(const fault of ['none','api','callback','resumed'] as const) {
   if(fault==='callback'&&mode===1||fault==='resumed'&&mode!==3)continue;
   let now=0,throwApi=false;
   const original=new Error('I14 import service failure');
   const host=await GameHost.create(wasm,{vfs:new Vfs(),now:()=>now,log:n=>{
    now+=n;
    if(throwApi&&n===100||fault==='callback'&&n===10&&now>100)throw original;
   }},{backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,suspensionMode:suspension});
   host.init();const ex=(host as unknown as {exports:Ex}).exports;ex.set_import_mode(mode);
   const cleanup=vi.spyOn(ex,'bgt_profile_abort');
   throwApi=fault==='api';
   if(mode===3&&fault!=='api'&&fault!=='callback') {
    await host.update();expect(host.suspended).toBe(true);expect(ex.total()).toBe(40000);
    expect(cleanup).not.toHaveBeenCalled();now+=1000;expect(ex.total()).toBe(40000);
    throwApi=fault==='resumed';
   }
   if(fault==='none') {
    await host.update();expect(host.suspended).toBe(false);expect(cleanup).not.toHaveBeenCalled();
    expect(ex.total()).toBe(mode===1?40000:60000);
    expect(host.profile.updateMs).toBe(mode===1?140:260);
   } else {
    const error=await Promise.resolve().then(()=>host.update()).then(()=>null,e=>e);
    expect(error).toBe(original);expect(cleanup).toHaveBeenCalledTimes(1);
    const measured=fault==='api'?20000:fault==='callback'?30000:40000;
    expect(ex.total()).toBe(measured);expect(host.frameIndex).toBe(mode===3&&fault==='resumed'?1:0);
    expect(host.profile.updateMs).toBe(fault==='api'?120:fault==='callback'?130:240);
   }
   expect(ex.import_calls()).toBe(1);
   // A throwing leaf never increments success counters. Bound dispatch counts entry.
   expect(ex.direct_calls()).toBe(mode===1&&fault!=='none'?0n:1n);
   expect(ex.leaf_calls()).toBe(mode===1&&fault==='none'?1n:0n);
   expect(ex.sample_open()).toBe(0);
   const frozen=ex.total();now+=1000;ex.idle_end();now+=1000;host.profileReset();
   expect(ex.total()).toBe(frozen);expect(ex.total()).toBeLessThanOrEqual(host.profile.updateMs*1000);
   const summary=(host.metrics() as {execution_summary:{interpreter:{timing_status:string;measured_ms:number}}}).execution_summary.interpreter;
   expect(summary.timing_status).toBe('measured');expect(summary.measured_ms).toBe(frozen/1000);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},600000);
