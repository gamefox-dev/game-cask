// Original CC0-1.0. Same-process alternating fresh instances; builds/oracles prepared serially.
import {it,expect} from 'vitest';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadavg} from 'node:os';
import {loadHeadless} from '../../tests/support/headless';
it('pairs five A/B trials per workload in both actual suspension modes',async()=>{
 const before=process.env.BGT_CALLS_BEFORE!,after=process.env.BGT_CALLS_AFTER!,rows=[];
 const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
 for(const mode of ['asyncify','jspi'] as const)for(const pattern of ['direct','deep','indirect','tail','regions']){
  const calls=100000*(pattern==='direct'?16:pattern==='deep'?96:1),id='k32-'+pattern,samples=[];
  for(let pair=-1;pair<5;pair++)for(const revision of ['before','after'] as const){
   let begin=0,end=0;
   const load=loadavg();
   const h=await loadHeadless(id,{dir:join(revision==='before'?before:after,id),suspension:mode,onLog:m=>{
    if(m==='guest: CALLS begin')begin=performance.now();if(m==='guest: CALLS end')end=performance.now();
   }});
   await h.stepAsync(300);expect(h.logs).toContain('guest: CALLS PASS');expect(end).toBeGreaterThan(begin);
   expect(h.host.metrics()).toMatchObject({interp_insns:0,stubs:[],exited:1});
   samples.push({pair,warmup:pair<0,revision,ns:(end-begin)*1e6/calls,loadBefore:load,loadAfter:loadavg()});
  }
  const a=samples.filter(s=>!s.warmup&&s.revision==='before').map(s=>s.ns),b=samples.filter(s=>!s.warmup&&s.revision==='after').map(s=>s.ns);
  const delta=b.map((n,i)=>n-a[i]);
  rows.push({mode,pattern,calls,samples,beforeMedian:median(a),afterMedian:median(b),pairedDeltaMedian:median(delta),pairedDeltaRange:[Math.min(...delta),Math.max(...delta)],beforeRange:[Math.min(...a),Math.max(...a)],afterRange:[Math.min(...b),Math.max(...b)]});
 }
 const oracles=['before','after'].map(rev=>JSON.parse(readFileSync(join(rev==='before'?before:after,'report.json'),'utf8')));
 for(const row of oracles[0].rows)expect(oracles[1].rows.find((r:{pattern:string})=>r.pattern===row.pattern).oracle.hashes).toEqual(row.oracle.hashes);
 writeFileSync(process.env.BGT_CALLS_REPORT!,JSON.stringify({at:new Date().toISOString(),method:'5 alternating A/B pairs + warmup; uninstrumented; shared machine',rows},null,2));
});
