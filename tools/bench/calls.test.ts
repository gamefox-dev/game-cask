// Original CC0-1.0. Same workload for all revisions; no host PE execution.
import { it, expect } from 'vitest';
import { writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadHeadless, ROOT } from '../../tests/support/headless';
import { oracle } from '../../tests/oracle/oracle';
// @ts-expect-error plain ESM
import { callsFixture } from './calls-fixture.mjs';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';
// @ts-expect-error plain ESM
import { resourceSnapshot } from '../probe/resources.mjs';
interface Metrics { interp_insns:number; stubs:string[]; exited:number; lifted_calls:number; generic_insn_execs:number; cpu_profile:{census_dropped:number; exits:{reason:number;count:number}[]} }
it('measures small calls, bounded deep recursion, vtables, tail jumps and same-owner regions', async()=>{
 const rows=[];
 const resources={start:resourceSnapshot(),end:null as unknown};
 for(const pattern of (process.env.BGT_CALLS_PATTERNS ?? 'direct,deep,indirect,tail,regions').split(',')) {
  const dir=join(ROOT,'node_modules/.cache/bgt/k32-fixture-'+pattern);
  const fixture=callsFixture(dir,pattern,Number(process.env.BGT_CALLS_COUNT ?? 5000));
  const {id,calls}=fixture;
  try {
   const manifest=buildGame(dir,{quiet:true}); buildGame(dir,{quiet:true,interpretOnly:true});
   const comparison=await oracle(id,300);
   expect(comparison.errors).toEqual({lifted:null,interpreted:null});
   expect(comparison.identical,JSON.stringify(comparison)).toBe(true);
   const samples=[];
   for(let run=0;run<6;run++) {
    let begin=0,end=0;
    const h=await loadHeadless(id,{suspension:process.env.BGT_ORACLE_SUSPENSION==='jspi'?'jspi':'asyncify',onLog:(m)=>{if(m==='guest: CALLS begin')begin=performance.now();if(m==='guest: CALLS end')end=performance.now();}});
    await h.stepAsync(300);
    expect(h.logs).toContain('guest: CALLS PASS'); expect(end).toBeGreaterThan(begin);
    const metrics=h.host.metrics() as unknown as Metrics;
    const ex=(h.host as unknown as {exports:WebAssembly.Exports}).exports;
    const nativeStats=ex.k32_stats ? Array.from(new BigUint64Array((ex.memory as WebAssembly.Memory).buffer,(ex.k32_stats as ()=>number)(),6),String) : null;
    expect(metrics.interp_insns).toBe(0); expect(metrics.stubs).toEqual([]); expect(metrics.exited).toBe(1); expect(metrics.cpu_profile.census_dropped).toBe(0);
    const dispatchExits=metrics.cpu_profile.exits.filter(e=>e.reason===5||e.reason===6).reduce((s,e)=>s+e.count,0);
    samples.push({warmup:run===0,ms:end-begin,ns_per_call_or_iteration:(end-begin)*1e6/calls,dispatchExits,nativeStats,metrics});
   }
   rows.push({...fixture,oracle:comparison,build:manifest.pipeline.metrics,wasm:manifest.wasm,samples});
   if(process.env.BGT_CALLS_KEEP)cpSync(join(ROOT,'web/public/games',id),join(process.env.BGT_CALLS_KEEP,id),{recursive:true});
  } finally {
   for(const suffix of ['', '-interp']) {
    rmSync(join(ROOT,'web/public/games',id+suffix),{recursive:true,force:true});
    rmSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id+suffix),{recursive:true,force:true});
   }
   rmSync(dir,{recursive:true,force:true});
  }
 }
 resources.end=resourceSnapshot();
 const report={at:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),instrumented:process.env.BGT_CALLS_STATS==='1',sourceDiff:execFileSync('git',['diff','--stat'],{cwd:ROOT,encoding:'utf8'}),mode:process.env.BGT_ORACLE_SUSPENSION??'asyncify',resources,rows};
 const file=process.env.BGT_CALLS_REPORT;
 if(file)writeFileSync(file,JSON.stringify(report,null,2)+'\n'); else console.log(JSON.stringify(report));
 if(process.env.BGT_CALLS_REFERENCE) {
  const before=JSON.parse(readFileSync(process.env.BGT_CALLS_REFERENCE,'utf8'));
  for(const row of rows) expect(row.oracle.hashes).toEqual(before.rows.find((r:{pattern:string})=>r.pattern===row.pattern).oracle.hashes);
 }
});
