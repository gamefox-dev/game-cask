// @bgt-examples: none
// Original CC0. On/off isolates retirement at profile0, and scheduler/snapshots at
// profile1. Artifacts coexist privately; samples interleave, no publication race.
import {it,expect} from 'vitest';
import {cpSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadHeadless,ROOT} from '../../tests/support/headless';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build tool
import {buildGame} from '../build/build.mjs';
// @ts-expect-error ESM resource observer
import {resourceSnapshot} from '../probe/resources.mjs';
const median=(v:number[])=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)];
it('measures matched CC0 CPU-heavy and full scale accounting overhead, both real suspension modes',async()=>{
 expect(jspiApi()).not.toBeNull();
 const root=join(ROOT,'node_modules/.cache/bgt/k31-overhead');mkdirSync(root,{recursive:true});
 const report=process.env.BGT_ACCOUNTING_REPORT;
 if(!report)throw new Error('BGT_ACCOUNTING_REPORT must be an owned absolute evidence path');
 let sum=1;
 for(let k=0;k<2048;k++)for(let i=0;i<64;i++)for(let j=0;j<32;j++)sum=((sum+i*313+j*17+1)^(i*7351+j*393+19))>>>0;
 let source=`/* CC0 */
#include <windows.h>
int _tls_index;
`;
 for(let i=0;i<64;i++){
  source+='__declspec(noinline) unsigned f'+i+'(unsigned x){';
  for(let j=0;j<32;j++)source+='x+='+ (i*313+j*17+1)+'u;x^='+ (i*7351+j*393+19)+'u;';
  source+='return x;}\n';
 }
 source+='unsigned(*const fns[])(unsigned)={'+Array.from({length:64},(_,i)=>'f'+i).join(',')+'};\n';
 source+='void entry(void){unsigned x=1;for(unsigned k=0;k<2048;k++)for(unsigned i=0;i<64;i++)x=fns[i](x);char s[80];wsprintfA(s,"accounting checksum %08x",x);OutputDebugStringA(s);for(;;)Sleep(5);}\n';
 const rows:unknown[]=[],start=resourceSnapshot(),identity=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const save=()=>writeFileSync(report,JSON.stringify({schema:'game-cask/accounting-overhead/1',identity,node:process.version,start,end:resourceSnapshot(),
  method:'300 headless update/render/consume per fresh instance; init/compile excluded. One discarded warmup per artifact/mode; 9 interleaved paired samples with alternating order. Same guest/API/state traces required. profile0 isolates exact retirement; profile1 on/off additionally measures scheduler/snapshot cost. Shared machine, no GPU rasterization or game-speed claim.',rows},null,2)+'\n');
 const profiles=(process.env.BGT_ACCOUNTING_PROFILES??'0,1').split(',');
 const ids=process.env.BGT_ACCOUNTING_IDS?.split(',')??['cpu-x86','cpu-x64','x64-scale'];
 for(const id of ids) {
  const dir=join(root,id);mkdirSync(dir,{recursive:true});
  if(id==='x64-scale')cpSync(join(ROOT,'examples/x64-scale'),dir,{recursive:true,filter:p=>!p.endsWith('/build')});
  else {
   writeFileSync(join(dir,'cpu.c'),source);
   writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 retirement CPU-heavy',pipeline:{platform:'win32',fixture:{
    target:id==='cpu-x64'?'x86_64-windows-gnu':'x86-windows-gnu',sources:['cpu.c'],out:'cpu.exe',libs:['kernel32','user32']},modules:[{from:'./build/cpu.exe',main:true}]}}));
  }
  for(const profile of profiles) {
   const paths:string[]=[],builds:unknown[]=[];
   for(const account of ['0','1']) {
    process.env.BGT_CPU_PROFILE=profile;process.env.BGT_CPU_ACCOUNTING=account;
    const out=join(root,'artifacts',id,profile,account);
    const manifest=buildGame(dir,{outRoot:out,quiet:true});paths.push(join(out,id));
    builds.push({account,wasm:manifest.wasm,variants:manifest.suspension,metrics:manifest.pipeline.metrics});
   }
   for(const mode of ['asyncify','jspi'] as const) {
    const samples:number[][]=[[],[]],observations:unknown[][]=[[],[]];
    let expected:unknown=null;
    for(let n=-1;n<9;n++)for(const account of (n%2===0?[1,0]:[0,1])) {
     const h=await loadHeadless(id,{dir:paths[account],suspension:mode});
     const begin=performance.now();await h.stepAsync(300);const ms=performance.now()-begin;
     const m=h.host.metrics() as any;
     const semantic={hash:h.host.stateHash(),trace:m.trace_hash,logs:h.logs,lifted:m.lifted_calls,generic:m.generic_insn_execs,interp:m.interp_insns,stubs:m.stubs};
     if(expected===null)expected=semantic;else expect(semantic).toEqual(expected);
     expect(m.interp_insns).toBe(0);expect(m.stubs).toEqual([]);
     if(id!=='x64-scale')expect(h.logs).toContain('guest: accounting checksum '+sum.toString(16).padStart(8,'0'));
     expect(m.execution_accounting.enabled).toBe(account);
     if(n>=0){samples[account].push(ms);observations[account].push({n,ms,retired:m.execution_accounting.retired,frameDrops:m.execution_accounting.frames?.dropped??null});}
    }
    const off=median(samples[0]),on=median(samples[1]);
    rows.push({id,profile,mode,builds,samples,observations,offMedianMs:off,onMedianMs:on,overheadPercent:100*(on/off-1),resources:resourceSnapshot(),semantic:expected});save();
    console.log(JSON.stringify({id,profile,mode,off,on,overheadPercent:100*(on/off-1)}));
   }
   for(const path of paths)rmSync(path,{recursive:true,force:true});
  }
 }
 save();
},3600000);
