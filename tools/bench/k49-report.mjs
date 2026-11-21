/* Original CC0-1.0. Aggregate measured timings and CDP self-time locations. */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2];
const pairs=JSON.parse(readFileSync(join(root,'pairs.json'),'utf8'));
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
function profile(file){
 const captures=JSON.parse(readFileSync(file,'utf8'));
 const categories={},self={};
 for(const p of Array.isArray(captures)?captures:[captures]){
 const nodes=new Map(p.nodes.map(n=>[n.id,n]));
 let timestamp=p.startTime;
 for(let i=0;i<p.samples.length;i++){
  timestamp+=p.timeDeltas?.[i]??0;
  if(p.window && (timestamp<p.window.beginUs || timestamp>p.window.endUs))continue;
  const f=nodes.get(p.samples[i]).callFrame,n=f.functionName||'(anonymous)',us=p.timeDeltas?.[i]??0;
  // Same exhaustive location split as r24b, not inferred guest/helper cycles.
  let c=/^(?:N|R|F)_[0-9a-f]+/.test(n)?'lifted_guest_leaf':
   /(?:asyncify|jspi|start_unwind|stop_unwind|start_rewind|stop_rewind)/i.test(n)?'named_suspension_bridge_leaf':
   /^(?:x86_|x64_|xl_|xs_|xa_|w32_|w64_)/.test(n)?'runtime_helper_leaf':
   /(?:WebGL|gl[A-Z]|texImage|drawArrays|drawElements)/.test(n)?'GL_JS_boundary':
   f.url?.startsWith('wasm:')?'native_unknown':'other_JS_host';
  categories[c]??={samples:0,wall_sample_us:0};categories[c].samples++;categories[c].wall_sample_us+=us;
  self[n]??={samples:0,wall_sample_us:0};self[n].samples++;self[n].wall_sample_us+=us;
 }
 }
 const total=Object.values(categories).reduce((a,b)=>a+b.wall_sample_us,0);
 for(const v of Object.values(categories))v.percent=100*v.wall_sample_us/total;
 return {categories,topSelf:Object.entries(self).sort((a,b)=>b[1].wall_sample_us-a[1].wall_sample_us).slice(0,30)};
}
const rows=pairs.rows.map(row=>{
 const a=row.samples.filter(s=>!s.warmup&&s.label==='before'),b=row.samples.filter(s=>!s.warmup&&s.label==='after');
 const ins=s=>Number(BigInt(s.metrics.execution_accounting.retired.total));
 return {mode:row.mode,pattern:row.pattern,beforeMs:median(a.map(s=>s.ms)),afterMs:median(b.map(s=>s.ms)),
  pairedDeltaMs:median(b.map((s,i)=>s.ms-a[i].ms)),pairedRange:b.map((s,i)=>s.ms-a[i].ms),
  // Whole update wall / whole update retirement (including startup and host idle).
  // ms columns above retain marker-delimited guest work for independent comparison.
  beforeNsPerRetired:median(a.map(s=>s.totalMs*1e6/ins(s))),afterNsPerRetired:median(b.map(s=>s.totalMs*1e6/ins(s))),
  countersBefore:a[0].metrics.native_dispatch,countersAfter:b[0].metrics.native_dispatch,
  profiles:row.profiles.map(f=>profile(join(root,f)))};
});
writeFileSync(join(root,'summary.json'),JSON.stringify({method:pairs.method,rows},null,2));
console.log(JSON.stringify(rows.map(({mode,pattern,beforeMs,afterMs,pairedDeltaMs,beforeNsPerRetired,afterNsPerRetired})=>({mode,pattern,beforeMs,afterMs,pairedDeltaMs,beforeNsPerRetired,afterNsPerRetired})),null,2));
