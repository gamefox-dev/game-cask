// Original CC0-1.0. Compact, reproducible artifact/evidence audit; never time instrumented wasm.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=process.env.BGT_TRIAL_SCRATCH;
const hash=b=>createHash('sha256').update(b).digest('hex'),json=p=>JSON.parse(readFileSync(p));
const manifest=p=>({path:p,bytes:readFileSync(p).length,sha256:hash(readFileSync(p))});
const artifacts=[],records=[],pairs=[],operatorAudit=[];
for(const fixture of ['calls','vm','memory']){
 const base=json(join(root,'base',fixture,'evidence.json'));
 for(const revision of ['base','lookup','cover','ways','final']){
  const dir=join(root,revision,fixture),e=json(join(dir,'evidence.json'));
  const checks=e.evidence.map((m,i)=>{
   const a=m.rows[0],b=m.rows[1],reference=base.evidence[i].rows[0];
   assert.deepEqual(a.hashes,b.hashes);assert.deepEqual(a.hashes,reference.hashes);assert.deepEqual(a.coverage,reference.coverage);
   assert.equal(a.metrics.execution_accounting.enabled,1);assert.equal(a.metrics.execution_accounting.retired.total,b.metrics.execution_accounting.retired.total);
   const threads=r=>r.metrics.execution_accounting.threads.map(t=>({id:t.id,total:t.retired.total}));assert.deepEqual(threads(a),threads(b));
   for(const row of [a,b]){const ac=row.metrics.execution_accounting;assert.equal(BigInt(ac.retired.total),BigInt(ac.retired.lifted)+BigInt(ac.retired.generic)+BigInt(ac.retired.interpreted));assert.equal(BigInt(ac.retired.total),ac.threads.reduce((n,t)=>n+BigInt(t.retired.total),0n));}
   return {mode:m.mode,updates:a.hashes.length,traceSha256:hash(JSON.stringify(a.hashes)),retired:a.metrics.execution_accounting.retired,threads:threads(a),coverageSha256:hash(JSON.stringify(a.coverage)),interp:a.metrics.interp_insns,stubs:a.metrics.stubs};
  });
  artifacts.push({fixture,revision,wasm:['game.wasm','game.jspi.wasm'].map(f=>manifest(join(dir,'game',f))),checks});
 }
 for(const names of ['base-lookup-cover','cover-ways','base-final'])pairs.push({fixture,...json(join(root,'pair-'+fixture+'-'+names+'.json'))});
 for(const mode of ['asyncify','jspi']){
  const files=['base','final'].map(r=>join(root,'record-'+fixture+'-'+mode+'-'+r+'.json'));
  assert.deepEqual(readFileSync(files[0]),readFileSync(files[1]));
  const record=json(files[0]);
  const builds=['base','final'].map(r=>{const d=join(root,'record-build',r,fixture,'game');return {revision:r,wasm:['game.wasm','game.jspi.wasm'].map(f=>manifest(join(d,f))),modules:json(join(d,'manifest.json')).pipeline.modules.map(m=>({name:m.name,base:m.base,sha256:m.sha256})),assets:json(join(d,'manifest.json')).assets.map(a=>manifest(join(d,'assets',a.path)))};});
  assert.deepEqual(builds[0].modules,builds[1].modules);assert.deepEqual(builds[0].assets.map(a=>a.sha256),builds[1].assets.map(a=>a.sha256));
  records.push({fixture,mode,files:files.map(manifest),modules:record.modules.map(m=>({name:m.name,base:m.base,sha256:m.sha256})),coverageEvents:record.metrics.execution.coverage_events,cacheHits:record.metrics.execution.coverage_cache_hits,crossings:record.metrics.execution.coverage_crossings,dropped:record.metrics.code_entries_dropped,builds});
  const original=join(root,'base',fixture,'game',mode==='jspi'?'game.jspi.wasm':'game.wasm');
  const wat=execFileSync(process.execPath,['node_modules/binaryen/bin/wasm-dis',original],{encoding:'utf8',maxBuffer:64*1024*1024});
  const fn=wat.slice(wat.indexOf(' (func $x86_find_lifted ')).split(/\n \(func /)[0];
  assert.equal((fn.match(/\(return(?:\s|\))/g)??[]).length,1,'one explicit registry cache-hit return');
  operatorAudit.push({fixture,mode,original:manifest(original),counted:manifest(join(root,'count-both',fixture,mode,'game',mode==='jspi'?'game.jspi.wasm':'game.wasm')),labels:manifest(join(root,'count-both',fixture,mode,'labels.json')),counts:manifest(join(root,'count-both',fixture,mode,'counts.json')),profile:manifest(join(root,'profile-'+fixture+'-'+mode+'.json')),registryHitReturnCount:1});
 }
}
const output={method:'All accounting ON/profile OFF. Fresh instances:30 warm +300 timed host updates, one discarded +9 alternating-order pairs. Operator counters not timed. Deterministic recordings use newly fixed-PE builds and common module metadata/full serializer, fixed host+headless runtime clocks; no deleted evidence fields. Trace hash is API evidence, not full CPU/RAM equality.',artifacts,records,pairs,operators:json(join(root,'operator-both-summary.json')),operatorAudit,sources:['platforms/x86/x86_rt.c','platforms/x86/x86_coverage.h','tools/bench/k40.test.ts','tools/bench/k40-wasm-count.mjs','tools/bench/k40-count.mjs','tools/bench/k40-count-unit.test.mjs','tools/bench/k40-report.mjs'].filter(existsSync).map(manifest)};
writeFileSync(join(root,'final-measurements.json'),JSON.stringify(output));console.log('Audited',artifacts.length,'artifact families,',records.length,'byte-identical recording pairs,',operatorAudit.length,'original-wasm registry return rules.');
