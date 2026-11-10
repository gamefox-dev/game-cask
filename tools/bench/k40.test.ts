// Original CC0-1.0. Serial preparation; immutable artifacts; separate uninstrumented pairs.
import {it,expect,vi} from 'vitest';
import {Session} from 'node:inspector';
import {BGTRuntime} from '../../bgt/runtime/runtime';
import {cpSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {loadavg,freemem} from 'node:os';
import {loadHeadless,ROOT} from '../../tests/support/headless';
import {k35Fixture,type K35Fixture} from './k35-fixture';
// @ts-expect-error plain ESM
import {k40Fixture} from './k40-fixture.mjs';
// @ts-expect-error plain ESM
import {buildGame} from '../build/build.mjs';
const out=process.env.BGT_TRIAL_SCRATCH!;
const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
it('measures exact admission on mixed calls, VM and memory with both actual suspension modes',async()=>{
 const kind=process.env.BGT_K40_FIXTURE??'calls';
 const f=kind==='calls'?k40Fixture(join(ROOT,'node_modules/.cache/bgt/k40-calls')):k35Fixture(kind as K35Fixture);
 if(process.env.BGT_K40_PROFILE==='1'){
  for(const mode of ['asyncify','jspi'] as const){
   const h=await loadHeadless(f.id,{dir:join(out,'base',kind,'game'),suspension:mode});await h.stepAsync(30);
   const session=new Session();session.connect();
   const post=(method:string,params:Record<string,unknown>={})=>new Promise<Record<string,unknown>>((resolve,reject)=>session.post(method,params,(e,r)=>e?reject(e):resolve(r as Record<string,unknown>)));
   await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:100});await post('Profiler.start');
   const before=h.host.metrics();await h.stepAsync(300);const {profile}=await post('Profiler.stop');session.disconnect();
   writeFileSync(join(out,'profile-'+kind+'-'+mode+'.json'),JSON.stringify({before,after:h.host.metrics(),profile}));
   expect(h.logs).toContain(f.expected);
  }return;
 }
 if(process.env.BGT_K40_RECORD_PREPARE){
  const revision=process.env.BGT_K40_RECORD_PREPARE;const input=join(out,'record-input',kind);mkdirSync(input,{recursive:true});
  const base=join(out,'base',kind,'game');const manifest=JSON.parse(readFileSync(join(base,'manifest.json'),'utf8'));
  const config=JSON.parse(readFileSync(join(f.dir,'game.json'),'utf8'));delete config.pipeline.fixture;
  config.pipeline.modules=manifest.pipeline.modules.map((m:{name:string},i:number)=>{const file=join(input,m.name);cpSync(join(base,'assets','loader',m.name),file);return {...config.pipeline.modules[i],from:'./'+m.name};});
  writeFileSync(join(input,'game.json'),JSON.stringify(config));
  const dest=join(out,'record-build',revision,kind);mkdirSync(dest,{recursive:true});
  buildGame(input,{quiet:true});cpSync(join(ROOT,'web/public/games',f.id),join(dest,'game'),{recursive:true});
  for(const root of ['web/public/games','node_modules/.cache/bgt/pipeline'])rmSync(join(ROOT,root,f.id),{recursive:true,force:true});
  return;
 }
 if(process.env.BGT_K40_RECORD==='1'){
  const clock=vi.spyOn(performance,'now').mockReturnValue(1);
  try{for(const mode of ['asyncify','jspi'] as const){
   let baseline:string|undefined;let retired:unknown;
   for(const revision of ['base','final']){
    const dir=join(out,'record-build',revision,kind,'game');const h=await loadHeadless(f.id,{dir,suspension:mode});const totals=[];
    for(let i=0;i<330;i++){await h.stepAsync(1);const m=h.host.metrics() as {execution_accounting:unknown};totals.push(m.execution_accounting);}
    const common=JSON.parse(readFileSync(join(out,'record-build','base',kind,'game','manifest.json'),'utf8'));
    const rt={host:h.host,manifest:common,vfs:h.host['services'].vfs,rangeFiles:null,
     gpuWallMs:0,gpuSubmitTotalMs:0,errors:[],sliceEvents:0,firstFrameMs:0,frameTimes:[],diagnostics:()=>({timing:{frameIntervalMs:{last:0,avg:0,p95:0},updateMs:0,renderMs:0,decodeMs:0,gpuSubmitMs:0,wasmDownloadCompileVerifyMs:0,wasmInstantiateMs:0,wasmStreaming:false}})};
    const bytes=JSON.stringify(BGTRuntime.prototype.coverageSnapshot.call(rt as unknown as BGTRuntime))+'\n';
    writeFileSync(join(out,'record-'+kind+'-'+mode+'-'+revision+'.json'),bytes);
    if(baseline!==undefined){expect(bytes).toBe(baseline);expect(totals).toEqual(retired);}else{baseline=bytes;retired=totals;}
   }
  }}finally{clock.mockRestore();}return;
 }
 if(process.env.BGT_K40_COUNT==='1'){
  for(const [m,mode]of (['asyncify','jspi'] as const).entries()){
  const h=await loadHeadless(f.id,{dir:join(out,'count-both',kind,mode,'game'),suspension:mode});
  const ex=(h.host as unknown as {exports:WebAssembly.Exports}).exports;
  const counters=Object.entries(ex).filter(([n,v])=>n.startsWith('k39_')&&v instanceof WebAssembly.Global) as [string,WebAssembly.Global][];
  const hashes=[];let before:unknown;
  for(let n=0;n<330;n++){
   if(n===30){before=h.host.metrics();for(const [,v]of counters)v.value=0n;}
   await h.stepAsync(1);hashes.push(h.host.stateHash());
  }
  const counts=Object.fromEntries(counters.map(([n,v])=>[n.slice(4),String(v.value)]));
  const metrics=h.host.metrics();const base=JSON.parse(readFileSync(join(out,'base',kind,'evidence.json'),'utf8')).evidence[m].rows[0];
  expect(hashes).toEqual(base.hashes);
  for(const key of ['execution_accounting','guest_instruction_clock','lifted_calls','coverage_events','coverage_crossings','coverage_cache_hits','interp_insns','generic_insn_execs','stubs'])expect((metrics as Record<string,unknown>)[key]).toEqual(base.metrics[key]);
  expect({code:[...h.host.codeCoverage].sort((a,b)=>a[0]-b[0]),dropped:h.host.codeCoverageDropped}).toEqual(base.coverage);
  writeFileSync(join(out,'count-both',kind,mode,'counts.json'),JSON.stringify({counts,before,metrics}));
  }return;
 }
 const revision=process.env.BGT_K40_PREPARE;
 if(revision){
  const dest=join(out,revision,kind);mkdirSync(dest,{recursive:true});
  const manifest=buildGame(f.dir,{quiet:true});cpSync(join(ROOT,'web/public/games',f.id),join(dest,'game'),{recursive:true});
  buildGame(f.dir,{quiet:true,interpretOnly:true});
  const evidence=[];
  for(const mode of ['asyncify','jspi'] as const){
   const rows=[];
   for(const interpreted of [false,true]){
    const h=await loadHeadless(f.id,{dir:interpreted?join(ROOT,'web/public/games',f.id+'-interp'):join(dest,'game'),suspension:mode});const hashes=[];
    for(let n=0;n<330;n++){await h.stepAsync(1);hashes.push(h.host.stateHash());}
    expect(h.logs).toContain(f.expected);rows.push({hashes,metrics:h.host.metrics(),coverage:{code:[...h.host.codeCoverage].sort((a,b)=>a[0]-b[0]),dropped:h.host.codeCoverageDropped}});
   }
   expect(rows[0].hashes).toEqual(rows[1].hashes);
   const retirement=(metrics:unknown)=>{const m=metrics as {execution_accounting:{retired:{total:string};threads:{id:number;retired:{total:string}}[]}};return {total:m.execution_accounting.retired.total,threads:m.execution_accounting.threads.map(t=>({id:t.id,total:t.retired.total}))};};
   expect(rows[0].metrics).toMatchObject({execution_accounting:{enabled:1}});
   expect(retirement(rows[0].metrics)).toEqual(retirement(rows[1].metrics));
   expect(rows[0].metrics).toMatchObject({interp_insns:0,stubs:[]});
   evidence.push({mode,rows});
  }
  writeFileSync(join(dest,'evidence.json'),JSON.stringify({manifest,evidence}));
  for(const suffix of ['','-interp']){rmSync(join(ROOT,'web/public/games',f.id+suffix),{recursive:true,force:true});rmSync(join(ROOT,'node_modules/.cache/bgt/pipeline',f.id+suffix),{recursive:true,force:true});}
  return;
 }
 const revisions=(process.env.BGT_K40_PAIR??'base,lookup').split(',');
 const evidence=revisions.map(r=>JSON.parse(readFileSync(join(out,r,kind,'evidence.json'),'utf8')));
 for(const e of evidence.slice(1))for(let m=0;m<2;m++){
  expect(e.evidence[m].rows[0].hashes).toEqual(evidence[0].evidence[m].rows[0].hashes);
  expect(e.evidence[m].rows[0].coverage).toEqual(evidence[0].evidence[m].rows[0].coverage);
 }
 const rows=[];
 for(const mode of ['asyncify','jspi'] as const){
  const samples:number[][]=revisions.map(()=>[]),resources=[];
  for(let pair=-1;pair<9;pair++){
   const order=revisions.map((_,i)=>i);if(pair&1)order.reverse();resources.push({pair,load:loadavg(),free:freemem()});
   for(const i of order){
    const h=await loadHeadless(f.id,{dir:join(out,revisions[i],kind,'game'),suspension:mode});await h.stepAsync(30);
    const before=h.host.metrics();const start=performance.now();await h.stepAsync(300);const ms=performance.now()-start;
    if(pair>=0)samples[i].push(ms);expect(h.logs).toContain(f.expected);expect(h.host.metrics()).toMatchObject({interp_insns:0,stubs:[]});
    if(pair===-1)writeFileSync(join(out,kind+'-'+revisions[i]+'-'+mode+'-metrics.json'),JSON.stringify({before,after:h.host.metrics()}));
    await new Promise(r=>setTimeout(r,0));
   }
  }
  rows.push({mode,samples,medians:samples.map(median),resources,paired:samples.slice(1).map(a=>{const delta=a.map((v,i)=>v-samples[0][i]);return {delta,median:median(delta),range:[Math.min(...delta),Math.max(...delta)]};})});
 }
 writeFileSync(join(out,'pair-'+kind+'-'+revisions.join('-')+'.json'),JSON.stringify({revisions,rows,method:'30 warm +300 timed updates, 1 discarded +9 alternating fresh-instance pairs; accounting ON, profiling OFF; not guest frames or isolated CPU cycles.'}));
});
