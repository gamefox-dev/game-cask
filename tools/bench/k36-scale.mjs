// Original CC0-1.0. Serial large-fixture cost probe; no production policy edits.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGame, WASM_OPT_FEATURES } from '../build/build.mjs';
import { execFileSync } from '../build/exec.mjs';
import { ROOT } from '../build/toolchain.mjs';
const root=process.env.BGT_K36_OUT;
const rows=[];mkdirSync(root,{recursive:true});
for(const id of (process.env.BGT_K36_SCALE_FIXTURES??'x64-scale,x64-cpprt').split(',')){
 const dest=join(root,id);mkdirSync(dest,{recursive:true});
 const start=performance.now();let manifest;
 try{manifest=buildGame('examples/'+id,{quiet:false,outRoot:root});}
 catch(e){rows.push({id,error:String(e),ms:performance.now()-start});writeFileSync(join(root,'results.json'),JSON.stringify(rows,null,2));continue;}
 const metrics=manifest.pipeline.metrics;writeFileSync(join(dest,'baseline-metrics.json'),JSON.stringify(metrics,null,2));
 for(const mode of ['jspi','asyncify'])for(const [name,flags] of [['o2',['-O2']],['o3',['-O3']],['o4',['-O4']],['converge',['-O3','--converge']],['inline',['-O3','--inlining-optimizing']],['local',['--optimize-instructions','--precompute','--simplify-locals','--merge-blocks','--vacuum']]]){
  const input=join(dest,mode==='jspi'?'game.jspi.wasm':'game.wasm'),output=join(dest,mode+'-'+name+'.wasm'),time=join(dest,mode+'-'+name+'.time');const t=performance.now();let error=null;
  try{execFileSync('/usr/bin/time',['-l','-o',time,process.execPath,join(ROOT,'tools/build/binaryen-runner.mjs'),input,...WASM_OPT_FEATURES,...flags,'-o',output],{timeout:1200000,stdio:'inherit'});}catch(e){error=String(e);}
  const row={id,mode,name,flags,error,ms:performance.now()-t,inputBytes:readFileSync(input).length,outputBytes:error?null:readFileSync(output).length,time:readFileSync(time,'utf8'),baseline:metrics};rows.push(row);writeFileSync(join(root,'results.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(row));
 }
}
