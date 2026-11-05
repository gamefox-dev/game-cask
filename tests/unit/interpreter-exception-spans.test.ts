// @bgt-examples: none
// Original CC0. Fails if host exceptions/traps abandon physical spans, sampled
// stack pointers, or idle restorations. These assertions inspect raw time first,
// not merely the summary's rejection of an impossible budget.
import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileC} from '../support/compile';
import {GameHost,GameAbort,OutsideSlice} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build tool
import {transform} from '../../tools/build/asyncify.mjs';
// @ts-expect-error ESM build feature contract
import {WASM_OPT_FEATURES} from '../../tools/build/build.mjs';
type Ex={sample_open():number;total():number;set_failure(n:number):void;set_phase(n:number):void;idle_end():void;long_run():void;bgt_profile_abort(now:number):void;bgt_profile_reset():void;insns():number};
const modes=()=>['asyncify',...(jspiApi()?['jspi']:[])] as ('asyncify'|'jspi')[];
const config={backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0};
async function variants(strict:boolean,width:number,run:(wasm:Uint8Array<ArrayBuffer>,mode:'asyncify'|'jspi')=>Promise<void>,onlyMode?:'asyncify'|'jspi') {
 const raw=await compileC('tests/fixtures/c/interpreter-dispatch-spans.c',[
  'MODE64='+width,'X86_PROFILE_ENABLED=1','X86_COVERAGE_MODE='+(strict?2:0)],true);
 const dir=mkdtempSync(join(tmpdir(),'bgt-exception-spans-'));
 try {
  writeFileSync(join(dir,'raw.wasm'),raw);
  transform(join(dir,'raw.wasm'),join(dir,'async.wasm'),[...WASM_OPT_FEATURES,'-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield']);
  for(const mode of onlyMode?[onlyMode]:modes())await run(mode==='jspi'?raw:new Uint8Array(readFileSync(join(dir,'async.wasm'))),mode);
 } finally {rmSync(dir,{recursive:true,force:true});}
}
function interpreter(host:GameHost) {
 return (host.metrics() as {execution_summary:{interpreter:{timing_status:string;measured_ms:number|null}}}).execution_summary.interpreter;
}
for(const width of [0,1]) {
 for(const suspension of modes())it('freezes '+(width?'AMD64':'i386')+' strict OutsideSlice in '+suspension+' (reviewer reproducer)',async()=>{
  await variants(true,width,async(wasm,mode)=>{
   for(const nested of [false,true]) {
    let now=0;
    const host=await GameHost.create(wasm,{vfs:new Vfs(),now:()=>now,log:(n)=>{now+=n;}},{...config,suspensionMode:mode,sliceCode:[0x3000],sliceCodeRanges:nested?[{addr:0x1000,end:0x1020}]:[]});
    host.init();const ex=(host as unknown as {exports:Ex}).exports;
    const error=await Promise.resolve().then(()=>host.update()).then(()=>null,e=>e);
    expect(error).toBeInstanceOf(OutsideSlice);
    expect((error as OutsideSlice).address).toBe(nested?0x2000:0x1000);
    // First entry fails before hand work; nested callback fails after 10/20ms
    // interpreted (i386 CALL fastpath / AMD64 semantic) +100ms native. Failed wall belongs in the budget, not frames.
    const expected=nested?(width?20:10):0;
    expect(ex.total()).toBe(expected*1000);expect(host.frameIndex).toBe(0);
    expect(host.profile.updateMs).toBe(nested?expected+100:0);
    const frozen=ex.total();now+=1000;
    expect(ex.total()).toBe(frozen);host.profileReset();host.render();host.consume();
    expect(ex.total()).toBe(frozen);
    expect(interpreter(host)).toMatchObject({timing_status:'measured',measured_ms:expected});
    // Closing twice cannot double-count; stale idle_end cannot resurrect a span.
    ex.bgt_profile_abort(now*1000);now+=1000;expect(ex.total()).toBe(frozen);
   }
  },suspension);
 },600000);
 it('cleans '+(width?'AMD64':'i386')+' traps, aborts, arbitrary host errors, resumed failures and transfer returns',async()=>{
  await variants(false,width,async(wasm,mode)=>{
   for(const failure of ['trap','abort','host','clock','resumed','transfer','yield-context','yield-idle-context'] as const) {
    let now=0,throwWork=false,throwClock=false;
    const original=new Error('original host service error');
    const host=await GameHost.create(wasm,{vfs:new Vfs(),now:()=>{if(throwClock)throw original;return now;},log:(n)=>{
     now+=n;if(throwWork && n===10){if(failure==='clock')throwClock=true;throw original;}
    }},{...config,suspensionMode:mode});
    host.init();const ex=(host as unknown as {exports:Ex}).exports;
    const cleanup=vi.spyOn(ex,'bgt_profile_abort');
    if(failure==='resumed') {
     await host.update();expect(host.suspended).toBe(true);
     expect(cleanup).not.toHaveBeenCalled(); // NOT exception cleanup on normal yield
     const parked=ex.total();now+=1000;expect(ex.total()).toBe(parked);
     await host.update();expect(cleanup).not.toHaveBeenCalled();
     expect(ex.total()).toBe((width?90:80)*1000); // resume restores original interval state
     await host.update(); // a second real park, then throw from interpreted work after rewind
     now+=1000;throwWork=true;
    } else if(failure==='host' || failure==='clock')throwWork=true;
    else ex.set_failure(failure==='trap'?1:failure==='abort'?2:failure==='transfer'?4:failure==='yield-idle-context'?5:3);
    if(failure==='transfer') {
     await host.update();expect(cleanup).not.toHaveBeenCalled();
     const frozen=ex.total();expect(frozen).toBe(10000);now+=1000;expect(ex.total()).toBe(frozen);
     continue;
    }
    // Invalid yield context is a suspension error from a diagnostic export, not
    // a normal host.update yield. It must go through the same generic boundary.
    const error=await Promise.resolve().then(()=>failure.startsWith('yield-')?ex.long_run():host.update()).then(()=>null,e=>e);
    if(failure==='trap')expect(error).toBeInstanceOf(WebAssembly.RuntimeError);
    else if(failure==='abort' || failure.startsWith('yield-'))expect(error).toBeInstanceOf(GameAbort);
    else expect(error).toBe(original); // do not wrap/replace a host exception
    expect(cleanup).toHaveBeenCalledTimes(1);throwClock=false;
    expect(ex.sample_open()).toBe(0); // no pointer into the abandoned sampled C stack
    const frozen=ex.total();
    if(failure==='clock')expect(frozen).toBe(0); // no usable exit clock: discard open interval
    else expect(frozen).toBeGreaterThan(0);
    now+=1000;expect(ex.total()).toBe(frozen);
    ex.idle_end();now+=1000;expect(ex.total()).toBe(frozen);
    if(!failure.startsWith('yield-')) {
     expect(frozen).toBeLessThanOrEqual(host.profile.updateMs*1000);
     expect(interpreter(host).timing_status).toBe('measured');
    }
    // Discard with no clock is safe and idempotent, even after an idle path.
    ex.bgt_profile_abort(NaN);now+=1000;expect(ex.total()).toBe(frozen);
    // Even a failing cleanup/clock must not replace the original guest error.
    cleanup.mockImplementation(()=>{throw new Error('cleanup failed');});
    throwClock=true;
    expect(()=>ex.long_run()).toThrow(original);throwClock=false;
    cleanup.mockRestore();
   }
  });
 },600000);
}
it('closes lifecycle and diagnostic failures without depending on update cleanup',async()=>{
 await variants(false,0,async(wasm,mode)=>{
  for(const phase of [1,2,3,4,5]) {
   let now=0;
   const host=await GameHost.create(wasm,{vfs:new Vfs(),now:()=>now,log:(n)=>{now+=n;}},{...config,suspensionMode:mode});
   const ex=(host as unknown as {exports:Ex}).exports;
   if(phase!==1)host.init();
   ex.set_failure(1);ex.set_phase(phase);
   const call=()=>phase===1?host.init():phase===2?host.render():phase===3?host.metrics():phase===4?host.stateHash():host.shutdown();
   expect(call).toThrow(WebAssembly.RuntimeError);
   expect(ex.total()).toBe(10000);now+=1000;expect(ex.total()).toBe(10000);
  }
 });
},600000);
it('preserves errors for older modules without the optional cleanup export',async()=>{
 const wasm=await compileC('tests/fixtures/c/bad_game.c',['VARIANT=4']);
 for(const mode of modes()) {
  const host=await GameHost.create(wasm,{vfs:new Vfs(),now:()=>0,log:()=>{}},{...config,suspensionMode:mode});
  host.init();
  expect((host as unknown as {exports:{bgt_profile_abort?:unknown}}).exports.bgt_profile_abort).toBeUndefined();
  const error=await Promise.resolve().then(()=>host.update()).then(()=>null,e=>e);
  expect(error).toBeInstanceOf(WebAssembly.RuntimeError);
 }
});
