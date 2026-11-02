// @bgt-examples: none
/* eslint-disable @typescript-eslint/no-explicit-any */
// Original kit fixtures only. Same toolchain; isolated sequential variants, no republishing races.
import {it,expect} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadHeadless,ROOT} from '../../tests/support/headless';
// @ts-expect-error ESM build tool
import {buildGame} from '../build/build.mjs';
// @ts-expect-error ESM resource observer
import {resourceSnapshot} from '../probe/resources.mjs';

it('A/B coverage crossings and Asyncify boundary restrictions against 300-frame reference execution',async()=>{
 const rows:any[]=[];
 const hotDir=join(ROOT,'node_modules/.cache/bgt/k10-coverage-hot');mkdirSync(hotDir,{recursive:true});
 let source='/* Original CC0 dispatch-heavy coverage fixture. */\n#include <windows.h>\nint _tls_index;\n';
 for(let i=0;i<64;i++)source+=`__declspec(noinline) unsigned f${i}(unsigned x){return (x^${i*313+19}u)+${i*17+3}u;}\n`;
 source+='unsigned (*const fns[])(unsigned)={'+Array.from({length:64},(_,i)=>`f${i}`).join(',')+'};\n';
 source+='void entry(void){unsigned x=1;for(unsigned k=0;k<65536;k++)for(unsigned i=0;i<64;i++)x=fns[i](x);char s[80];wsprintfA(s,"coverage checksum %08x",x);OutputDebugStringA(s);for(;;)Sleep(5);}\n';
 writeFileSync(join(hotDir,'hot.c'),source);writeFileSync(join(hotDir,'game.json'),JSON.stringify({id:'k10-coverage-hot',name:'CC0 coverage dispatch fixture',pipeline:{platform:'win32',fixture:{target:'x86_64-windows-gnu',sources:['hot.c'],out:'hot.exe',entry:'entry',libs:['kernel32','user32']},modules:[{from:'./build/hot.exe',main:true}]}}));
 let expectedHot=1;for(let k=0;k<65536;k++)for(let i=0;i<64;i++)expectedHot=((expectedHot^(i*313+19))+i*17+3)>>>0;
 const ids=process.env.BGT_EXECUTION_IDS?.split(',') ?? ['x64-crt','x64-cpp','x64-scale','k10-coverage-hot'];
 for(const id of ids) {
  let expected:string|null=null;
  for(const variant of ['direct-full','buffered-full','buffered-restricted','reference']) {
   process.env.BGT_COVERAGE_DIRECT=variant==='direct-full'?'1':'0';
   process.env.BGT_ASYNCIFY_FULL=variant.endsWith('full')?'1':'0';
   const resources={start:resourceSnapshot(),end:null as unknown};
   const start=performance.now();const manifest=buildGame(id==='k10-coverage-hot'?hotDir:`examples/${id}`, {quiet:true,interpretOnly:variant==='reference'});
   const buildMs=performance.now()-start;
   const runId=id+(variant==='reference'?'-interp':'');
   const samples:number[]=[];let runtime:any,logs:string[]=[],hash:string|null=null;
   for(let n=0;n<6;n++) {
    const h=await loadHeadless(runId);const start=performance.now();await h.stepAsync(300);
    if(n)samples.push(performance.now()-start);runtime=h.host.metrics();hash=h.host.stateHash();logs=h.logs;
    expect(logs.some(l=>/\bFAIL\b/.test(l)),id).toBe(false);expect(runtime.stubs).toEqual([]);
    if(id==='k10-coverage-hot')expect(logs).toContain(`guest: coverage checksum ${expectedHot.toString(16).padStart(8,'0')}`);
    if(variant!=='reference')expect(runtime.interp_insns).toBe(0);
    if(expected===null)expected=hash;else expect(hash,`${id} ${variant}`).toBe(expected);
   }
   resources.end=resourceSnapshot();samples.sort((a,b)=>a-b);
   rows.push({id,variant,frames:300,resources,buildMs,build:manifest.pipeline.metrics,
    wallMsMedian:samples[2],wallMsSamples:samples,hash,logs,runtime,
    genericPerLiftedCall:runtime.lifted_calls?runtime.generic_insn_execs/runtime.lifted_calls:null,
    instructionClock:runtime.guest_instruction_clock,
    note:'Raw active-context AMD64 clock, not exact multi-thread process retirement.'});
   console.log(JSON.stringify({id,variant,wallMs:samples[2],wasmBytes:manifest.wasm.size,asyncifyMs:manifest.pipeline.metrics.asyncify_ms,
    cached:manifest.pipeline.metrics.asyncify_cached,coverageCrossings:runtime.coverage_crossings,coverageEvents:runtime.coverage_events}));
   writeFileSync(process.env.BGT_EXECUTION_REPORT ?? 'reports/execution.json',JSON.stringify({schema:'game-cask/execution-benchmark/1',
    commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,
    method:'300 headless update/render/consume frames, median five fresh instances after one warmup. Compile/init excluded. Variants sequential, C instrumentation enabled throughout. First build cold unless cache metric explicitly true. No GPU rasterization.',rows},null,2)+'\n');
  }
 }
 expect(JSON.parse(readFileSync(process.env.BGT_EXECUTION_REPORT ?? 'reports/execution.json','utf8')).rows).toHaveLength(ids.length*4);
});
