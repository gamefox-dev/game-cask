// Original CC0-1.0. Compact, reproducible compiler-source-attributed dynamic census.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=process.env.BGT_TRIAL_SCRATCH,variants=(process.env.BGT_K41_VARIANTS??'base,narrow,imul,shift').split(',');
const records=[];const excluded=/[.](?:op[.](?:block|loop)|address|entries|exits)/;
for(const revision of variants)for(const fixture of ['vm','flags','memory']){
 const path=join(root,'count-'+revision,fixture,'counts.json');if(!existsSync(path))continue;
 const d=JSON.parse(readFileSync(path)),forms={},groups={};
 for(const [key,value]of Object.entries(d.counts)){
  if(excluded.test(key)||!/[.](?:op|memory|call)[.]/.test(key))continue;
  const name=key.split('.')[0],n=Number(value);
  const table=['lifted','runtime','admission','boundary'].includes(name)?groups:forms;
  const row=table[name]??={total:0,operators:{}};row.total+=n;row.operators[key.slice(name.length+1)]=n;
 }
 const meta=JSON.parse(readFileSync(join(root,revision,fixture,'debug/attribution.json'))),c=readFileSync(join(root,revision,fixture,'debug/lifted.c'),'utf8').split(String.fromCharCode(10));
 const ranked=Object.entries(forms).map(([form,row])=>({form,...row})).sort((a,b)=>b.total-a.total);
 for(const row of ranked.slice(0,12)){
  const sample=Object.values(meta.meta).find(x=>x.form===row.form);if(!sample)continue;
  row.sample={address:sample.address,text:sample.text,c:meta.lines.filter(([,a])=>a===sample.address).map(([n])=>c[n-1]).join(String.fromCharCode(10))};
 }
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 records.push({revision,fixture,ranked,groups,before:d.before,after:d.metrics,inputSHA256:hash(join(root,revision,fixture,'debug/debug.wasm')),countsSHA256:hash(path)});
}
writeFileSync(join(root,'forms-summary.json'),JSON.stringify({method:'Original wasm executable operators; block/loop entry markers, synthetic function exits and overlapping address slices excluded. LLVM line/inline-caller attribution is compiler source attribution, not a unique causal cost; shared optimized work and boundary overhead remain explicit. IMUL helper bodies use dynamic caller context. Counters never timed. Exact accounting ON.',records},null,2));
for(const r of records)console.log(r.revision,r.fixture,r.ranked.slice(0,12).map(x=>x.form+':'+x.total).join(' '));
