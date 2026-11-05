// @bgt-examples: none
// Original CC0-1.0. Catches direct-call stack/state loss across real guest SEH,
// and prevents silently claiming that i386 has an exception dispatcher.
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadHeadless } from '../support/headless';
import { jspiApi } from '../../bgt/runtime/jspi';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { analyzePeMetadata } from '../../tools/x86/pe-metadata.mjs';

for (const width of [64,32]) it('real guest SEH '+width+': native call/unwind or explicit missing-dispatch boundary',async()=>{
 const root=join(ROOT,'node_modules/.cache/bgt/native-seh');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'case-')),id='k32-seh-'+width;
 const modes:('asyncify'|'jspi')[]=['asyncify',...(jspiApi()?['jspi' as const]:[])];
 if(process.env.BGT_TEST_JSPI==='1')expect(modes).toContain('jspi');
 const evidence=[];
 try {
  for(const file of ['native-seh.c',...(width===64?['native-seh64.S']:[])])cpSync(join(ROOT,'tests/fixtures/win32',file),join(dir,file));
  // Diagnostic exports exist in this CC0 build only. No production export/ABI change.
  writeFileSync(join(dir,'probe.c'),`#include "x86_guest.h"
#include "bgt.h"
BGT_EXPORT(k32_seh_stats) unsigned stats(void){return (unsigned)(uintptr_t)&x86_native_stats;}
BGT_EXPORT(k32_seh_cpu) unsigned cpu(void){return (unsigned)(uintptr_t)&X;}
BGT_EXPORT(k32_seh_cpu_size) unsigned size(void){return sizeof X;}
BGT_EXPORT(k32_seh_chain) unsigned chain(void){return x86_rd32(X.fs_base);}
BGT_EXPORT(k32_seh_read) unsigned read_guest(unsigned a){return x86_rd32(a);}
`);
  writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 K32 real SEH '+width,
   sources:['probe.c'],cflags:['-DX86_NATIVE_STATS=1','-DX86_ACCOUNTING_ENABLED=1'],includes:['platforms/x86'],
   pipeline:{platform:'win32',fixture:{target:width===64?'x86_64-windows-gnu':'x86-windows-gnu',
    sources:['native-seh.c',...(width===64?['native-seh64.S']:[])],out:'seh.exe',libs:['kernel32']},
    modules:[{from:'./build/seh.exe',main:true}]}}));
  buildGame(dir,{quiet:true});buildGame(dir,{quiet:true,interpretOnly:true});
  const pe=analyzePeMetadata(join(ROOT,'node_modules/.cache/bgt/pipeline',id,'fixture/seh.exe'));
  if(width===64){
   expect(pe.errors).toEqual([]);
   expect(pe.runtimeFunctions.filter((f:{flags:number})=>f.flags&1).length).toBeGreaterThanOrEqual(2);
   expect(pe.runtimeFunctions.some((f:{flags:number})=>(f.flags&3)===3)).toBe(true);
  }
  const states=[];
  for(const suspension of modes){
   const runs=[];
   for(const interpreted of [false,true]){
    const markers:{message:string;calls:number}[]=[];
    const h=await loadHeadless(id+(interpreted?'-interp':''),{suspension,onLog:message=>{
     if(message==='guest: SEH bridge'||message==='guest: SEH raising'){
      const p=(exports.k32_seh_stats as ()=>number)();
      markers.push({message,calls:Number(new DataView((exports.memory as WebAssembly.Memory).buffer).getBigUint64(p+8,true))});
     }
    }});
    const exports=(h.host as unknown as {exports:WebAssembly.Exports}).exports;
    const hashes=[];let parked=false;
    if(width===64){
     for(let frame=0;frame<300;frame++){await h.stepAsync(1);parked ||= h.host.suspended;hashes.push(h.host.stateHash());}
     expect(parked).toBe(true); // Actual Sleep park/resume, not just dual build metadata.
     expect(h.logs.filter(s=>s.startsWith('guest: '))).toEqual(['guest: SEH before','guest: SEH bridge','guest: SEH raising',
      'guest: SEH PASS filtered=1 searched=1 unwound=1 landed=1']);
     expect(h.host.metrics()).toMatchObject({exited:1,stubs:[],...(interpreted?{}:{interp_insns:0})});
     expect(markers.map(m=>m.message)).toEqual(['guest: SEH bridge','guest: SEH raising']);
     // No other guest call between these markers: this proves bridge -> raise really entered N directly.
     expect(markers[1].calls-markers[0].calls).toBe(interpreted?0:1);
    }else{
     await expect(h.stepAsync(1)).rejects.toThrow(/guest RaiseException \(structured exceptions are not supported\)/);
     expect(h.logs).toContain('guest: SEH i386 frame installed');
     expect(h.logs.some(s=>s.includes('SEH FAIL'))).toBe(false);
     const chain=(exports.k32_seh_chain as ()=>number)()>>>0;
     expect(chain).not.toBe(0xffffffff);
     expect(((exports.k32_seh_read as (p:number)=>number)(chain)>>>0)).toBe(0xffffffff);
     expect((exports.k32_seh_read as (p:number)=>number)(chain+4)).toBeGreaterThan(0);
     hashes.push(h.host.stateHash());
    }
    const memory=new Uint8Array((exports.memory as WebAssembly.Memory).buffer);
    const cpu=(exports.k32_seh_cpu as ()=>number)(),size=(exports.k32_seh_cpu_size as ()=>number)();
    const accounting=(h.host.metrics() as any).execution_accounting;
    expect(accounting.enabled).toBe(1);
    expect(BigInt(accounting.retired.total)).toBeGreaterThan(0n);
    runs.push({hashes,cpu:memory.slice(cpu,cpu+size),logs:h.logs,retired:accounting.retired.total,
     threads:accounting.threads.map((t:any)=>t.retired.total)});
    evidence.push({width,suspension,interpreted,parked,markers,cpuHash:createHash('sha256').update(memory.slice(cpu,cpu+size)).digest('hex'),hash:createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),metrics:h.host.metrics()});
   }
   expect(runs[0]).toEqual(runs[1]); // All 300 trace hashes + complete architectural CPU bytes + guest logs.
   states.push(runs[0]);
  }
  for(const state of states)expect(state).toEqual(states[0]); // Cross-suspension identity too.
  if(process.env.BGT_K32_SEH_REPORT)writeFileSync(process.env.BGT_K32_SEH_REPORT+'-'+width+'.json',JSON.stringify(evidence,null,2)+'\n');
 }finally{
  for(const suffix of ['','-interp']){
   rmSync(join(ROOT,'web/public/games',id+suffix),{recursive:true,force:true});
   rmSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id+suffix),{recursive:true,force:true});
  }
  rmSync(dir,{recursive:true,force:true});
 }
},120_000);
