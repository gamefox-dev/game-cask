// Original CC0-1.0. Dynamic operators are not CPU time or physical register spills.
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.BGT_TRIAL_SCRATCH,summary=[];
for(const kind of ['calls','vm','memory']){
 const {counts,before,metrics}=JSON.parse(readFileSync(join(root,'count',kind,'counts.json')));
 const retired=BigInt(metrics.execution_accounting.retired.total)-BigInt(before.execution_accounting.retired.total);
 const groups=['x86_coverage_entry','x86_native_enter','x86_native_resume','x86_find_lifted'];
 const rows=groups.map(g=>{const entries=Number(counts['function.'+g+'.entries']??0);const operators=Object.entries(counts).filter(([k])=>k.startsWith(g+'.')&&!['entries','exits','op.block','op.loop'].includes(k.slice(g.length+1))&&!k.includes('.address.')).reduce((n,[,v])=>n+Number(v),0);return {function:g,entries,operators,operatorsPerEntry:operators/entries};});
 const allOps=Object.entries(counts).filter(([k])=>!k.startsWith('hot.')&&!k.startsWith('function.')&&!k.startsWith('target.')&&!k.startsWith('site.')&&!k.includes('.address.')&&!['entries','exits','op.block','op.loop'].some(s=>k.endsWith('.'+s))).reduce((n,[,v])=>n+Number(v),0);
 const events=metrics.coverage_events-before.coverage_events,hits=metrics.coverage_cache_hits-before.coverage_cache_hits;
 summary.push({kind,retired:String(retired),allOps,admissionShare:rows.reduce((n,r)=>n+r.operators,0)/allOps,coverage:{events,hits,hitRatio:hits/events},rows});
}
writeFileSync(join(root,'operator-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
