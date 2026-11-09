// Original CC0-1.0. Dynamic operators and sampled self times are not cycles or spills.
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.BGT_TRIAL_SCRATCH,summary=[];
for(const kind of ['calls','vm','memory'])for(const mode of ['asyncify','jspi']){
 const {counts,before,metrics}=JSON.parse(readFileSync(join(root,'count-both',kind,mode,'counts.json')));
 const retired=BigInt(metrics.execution_accounting.retired.total)-BigInt(before.execution_accounting.retired.total);
 const groups=['x86_coverage_entry','x86_native_enter','x86_native_resume','x86_find_lifted'];
 const profile=JSON.parse(readFileSync(join(root,'profile-'+kind+'-'+mode+'.json'))).profile;
 const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame.functionName]));const self={};
 for(let i=0;i<profile.samples.length;i++){const n=nodes.get(profile.samples[i]);self[n]=(self[n]??0)+profile.timeDeltas[i];}
 const rows=groups.map(g=>{const entries=Number(counts['function.'+g+'.entries']??0);const operators=Object.entries(counts).filter(([k])=>k.startsWith(g+'.')&&!['entries','exits','op.block','op.loop'].includes(k.slice(g.length+1))&&!k.includes('.address.')).reduce((n,[,v])=>n+Number(v),0);const sampledUs=Object.entries(self).filter(([n])=>n===g||n===g+' (inlined)').reduce((n,[,v])=>n+v,0);return {function:g,entries,operators,operatorsPerEntry:operators/entries,sampledSelfUs:sampledUs,estimatedSelfNsPerEntry:sampledUs?sampledUs*1000/entries:null};});
 const allOps=Object.entries(counts).filter(([k])=>!['hot.','function.','target.','site.','reuse.'].some(p=>k.startsWith(p))&&!k.includes('.address.')&&!['entries','exits','op.block','op.loop'].some(s=>k.endsWith('.'+s))).reduce((n,[,v])=>n+Number(v),0);
 const events=metrics.coverage_events-before.coverage_events,hits=metrics.coverage_cache_hits-before.coverage_cache_hits;
 const lookups=Number(counts['function.x86_find_lifted.entries']),cacheHits=Number(counts['x86_find_lifted.op.return']??0);
 summary.push({kind,mode,retired:String(retired),allOps,admissionShare:rows.reduce((n,r)=>n+r.operators,0)/allOps,coverage:{events,hits,hitRatio:hits/events},registry:{lookups,cacheHits,hitRatio:cacheHits/lookups,samePreviousPC:Number(counts['reuse.same_previous_pc']??0),registrationCalls:Number(counts['function.x86_register_lifted.entries']??0),hitRule:'Baseline find_lifted has exactly one explicit return: the immutable exact-PC hit. Miss/force paths fall through; audit original WAT, not valid for transformed registry experiments.'},rows,profile:{samplingIntervalUs:100,totalSampleUs:profile.timeDeltas.reduce((n,v)=>n+v,0),samples:profile.samples.length,method:'Separate uninstrumented baseline, 30 warm +300 updates. Coarse sampled SELF time / exact count from deterministic counted window; not isolated latency, additive elapsed time, or optimization attribution.'}});
}
writeFileSync(join(root,'operator-both-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
