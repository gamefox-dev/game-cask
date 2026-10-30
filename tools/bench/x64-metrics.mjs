#!/usr/bin/env node
// Task 1 fixture metrics; reads only kit-built examples, never game inputs. No downloads/dependencies.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from '../build/toolchain.mjs';
import {buildGame} from '../build/build.mjs';
const names=['x64-basics','x64-cpp','x64-tls','x64-gui'];
const rows=[];
for(const id of names){
 const m=buildGame(`examples/${id}`,{quiet:true});
 const r=JSON.parse(readFileSync(join(ROOT,'reports',`oracle-${id}.json`),'utf8'));
 rows.push({id,functions:m.pipeline.modules.reduce((n,x)=>n+x.functions,0),instructions:m.pipeline.metrics.lifted_insns,
   wasm_bytes:m.wasm.size,wasm_bytes_per_insn:m.pipeline.metrics.wasm_bytes_per_insn,build_ms:m.pipeline.metrics.build_ms,
   objects_compiled:m.pipeline.metrics.objects_compiled,objects_cached:m.pipeline.metrics.objects_cached,asyncify_cached:m.pipeline.metrics.asyncify_cached,
   peak_child_rss_bytes:m.pipeline.metrics.peak_child_rss_bytes,
   oracle:{frames:r.frames,identical:r.identical,errors:r.errors,interp_insns:r.metrics.lifted.interp_insns}});
}
const report={schema:'game-cask/x64-fixture-metrics/1',generated:new Date().toISOString(),scope:'total module including profile/asyncify; build timings report cache state explicitly',fixtures:rows};
mkdirSync(join(ROOT,'reports'),{recursive:true});writeFileSync(join(ROOT,'reports/x64-fixtures.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
