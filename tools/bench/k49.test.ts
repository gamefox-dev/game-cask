// Original CC0-1.0. Serial preparation, immutable artifacts; separate timing and census.
import {it,expect} from 'vitest';
import {mkdirSync,cpSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Session} from 'node:inspector';
import {loadavg} from 'node:os';
import {ROOT,loadHeadless} from '../../tests/support/headless';
import {oracle} from '../../tests/oracle/oracle';
// @ts-expect-error plain ESM
import {dispatchFixture} from './k49-fixture.mjs';
// @ts-expect-error plain ESM
import {buildGame} from '../build/build.mjs';
const out=process.env.BGT_K49_OUT!;
const patterns=(process.env.BGT_K49_PATTERNS??'direct,indirect,regions,mixed').split(',');
it('prepares exact counter-OFF/ON controls, both-mode 300-update oracles, immutable artifacts',async()=>{
 if(process.env.BGT_K49_PAIR)return;
 mkdirSync(out,{recursive:true});const rows=[];
 for(const pattern of patterns)for(const enabled of [0,1]){
  process.env.BGT_DISPATCH_COUNTERS=String(enabled);
  const dir=join(ROOT,'node_modules/.cache/bgt/k49-'+pattern);
  const fixture=dispatchFixture(dir,pattern,Number(process.env.BGT_K49_COUNT??100000));
  const {id}=fixture;
  try {
   const manifest=buildGame(dir,{quiet:true});buildGame(dir,{quiet:true,interpretOnly:true});
   const comparisons=[];
   for(const suspension of ['asyncify','jspi']){
    process.env.BGT_ORACLE_SUSPENSION=suspension;
    const comparison=await oracle(id,300);
    expect(comparison.errors).toEqual({lifted:null,interpreted:null});expect(comparison.identical).toBe(true);
    comparisons.push({suspension,comparison});
   }
   const dest=join(out,pattern+'-'+enabled);mkdirSync(dest,{recursive:true});
   cpSync(join(ROOT,'web/public/games',id),join(dest,'game'),{recursive:true});
   cpSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id),join(dest,'pipeline'),{recursive:true});
   rows.push({fixture,enabled,manifest,comparisons});
  }finally{
   for(const suffix of ['','-interp']){
    rmSync(join(ROOT,'web/public/games',id+suffix),{recursive:true,force:true});
    rmSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id+suffix),{recursive:true,force:true});
   }
   rmSync(dir,{recursive:true,force:true});
  }
 }
 for(const pattern of patterns){
  const same=rows.filter(r=>r.fixture.pattern===pattern);
  expect(same[0].comparisons.map(c=>c.comparison.hashes)).toEqual(same[1].comparisons.map(c=>c.comparison.hashes));
 }
 writeFileSync(join(out,'prepare.json'),JSON.stringify(rows,null,2));
});
it('alternates warmed fresh instances; profiles separately, with the porter category split',async()=>{
 if(!process.env.BGT_K49_PAIR)return;
 mkdirSync(out,{recursive:true});
 const roots=process.env.BGT_K49_PAIR.split(',');const rows=[];
 for(const mode of ['asyncify','jspi'] as const)for(const pattern of patterns){
  const samples=[];
  for(let pair=-1;pair<9;pair++)for(const index of pair%2===0?[1,0]:[0,1]){
   const root=roots[index],label=index?'after':'before';let begin=0,end=0;
   const h=await loadHeadless('k49-'+pattern,{dir:join(root,pattern+'-'+(process.env.BGT_K49_OVERHEAD?String(index):(process.env.BGT_K49_ENABLED??'0')),'game'),suspension:mode,onLog:m=>{
    if(m==='guest: CALLS begin')begin=performance.now();if(m==='guest: CALLS end')end=performance.now();
   }});
   const load=loadavg(),started=performance.now();await h.stepAsync(300);const totalMs=performance.now()-started;expect(h.logs).toContain('guest: CALLS PASS');expect(end).toBeGreaterThan(begin);
   const metrics=h.host.metrics() as Record<string,unknown>;expect(metrics).toMatchObject({interp_insns:0,stubs:[],exited:1});
   samples.push({pair,label,warmup:pair<0,ms:end-begin,totalMs,load,metrics});
  }
  // V8 inspector uses the same CDP CPU profiler protocol. No timers/counters are
  // added to guest code. Fresh instances share already-warmed compiled wasm code.
  const profiles=[];
  for(const [index,root] of (process.env.BGT_K49_NO_PROFILE?[]:roots.entries())){
   const session=new Session();session.connect();
   const post=(method:string,params:Record<string,unknown>={})=>new Promise<Record<string,unknown>>((resolve,reject)=>session.post(method,params,(e,r)=>e?reject(e):resolve(r as Record<string,unknown>)));
   await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:100});
   const captures=[];
   for(let n=0;n<12;n++){
    let beginUs=0,endUs=0;
    const h=await loadHeadless('k49-'+pattern,{dir:join(root,pattern+'-0','game'),suspension:mode,onLog:m=>{
     if(m==='guest: CALLS begin')beginUs=Number(process.hrtime.bigint()/1000n);
     if(m==='guest: CALLS end')endUs=Number(process.hrtime.bigint()/1000n);
    }});
    await post('Profiler.start');await h.stepAsync(300);const {profile}=await post('Profiler.stop');
    captures.push({...profile as object,window:{beginUs,endUs}});
    expect(h.logs).toContain('guest: CALLS PASS');
   }
   const profile=captures;session.disconnect();
   const file=mode+'-'+pattern+'-'+index+'.cpuprofile';writeFileSync(join(out,file),JSON.stringify(profile));profiles.push(file);
  }
  rows.push({mode,pattern,samples,profiles});
 }
 writeFileSync(join(out,'pairs.json'),JSON.stringify({method:'9 alternating pairs + discarded warmup; profile capture separate; shared host',rows},null,2));
 // OFF/ON and cross-revision traces must agree for every retained oracle/mode.
 const a=JSON.parse(readFileSync(join(roots[0],'prepare.json'),'utf8')),b=JSON.parse(readFileSync(join(roots[1],'prepare.json'),'utf8'));
 for(const row of a)expect(b.find((r:{fixture:{pattern:string};enabled:number})=>r.fixture.pattern===row.fixture.pattern&&r.enabled===row.enabled).comparisons.map((c:{comparison:{hashes:unknown}})=>c.comparison.hashes)).toEqual(row.comparisons.map((c:{comparison:{hashes:unknown}})=>c.comparison.hashes));
});
