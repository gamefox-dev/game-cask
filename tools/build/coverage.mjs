// Coverage snapshots are private evidence, tied to exact module hashes/bases, never to an engine name.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function coveragePlan(files,gameDir) {
  const code=new Set(),ranges=[],modules=[],recordings=[];
  for(const file of files) {
    const c=JSON.parse(readFileSync(resolve(gameDir,file),'utf8'));
    if(c.schema!=='game-cask/coverage/1'||!Array.isArray(c.code)||!Array.isArray(c.files)||!Array.isArray(c.modules))throw new Error('invalid coverage snapshot');
    if(c.metrics?.code_entries_dropped>0)throw new Error('coverage overflowed; cannot package an incomplete recording');
    const execution=c.metrics?.execution;
    recordings.push({interp_insns:execution?.interp_insns ?? null,interp_code_entries:execution?.interp_code_entries ?? null,
      interp_functions:execution?.interp_functions ?? null,interp_unowned_entries:execution?.interp_unowned_entries ?? null});
    for(const m of c.modules) {
      const old=modules.find((x)=>x.name===m.name);
      if(old&&(old.sha256!==m.sha256||old.base!==m.base))throw new Error('coverage module identities disagree');
      if(!old)modules.push(m);
    }
    for(const e of c.code) {if(!Number.isInteger(e.address)||e.address<0||e.address>0xffffffff)throw new Error('invalid code coverage address');code.add(e.address);}
    for(const r of c.files) {if(typeof r.path!=='string'||!Number.isSafeInteger(r.offset)||r.offset<0||!Number.isSafeInteger(r.length)||r.length<0)throw new Error('invalid file range');ranges.push(r);}
  }
  return {code,ranges,modules,recordings};
}
// Disjoint owning intervals: .pdata takes precedence over speculative seeds; otherwise
// the nearest enclosing start wins. A sweep + priority heap avoids code-address × function scans.
// Half-open ends are important: a continuation at a neighbour's start belongs to that neighbour.
export function owningRanges(analysis) {
  const events=[];
  for(const f of analysis.functions)if(f.end>f.addr) {
    events.push({at:f.addr,start:f},{at:f.end});
  }
  events.sort((a,b)=>a.at-b.at);
  const heap=[],out=[];
  const above=(a,b)=>Number(!!a.unwindRange)-Number(!!b.unwindRange)||a.addr-b.addr;
  const push=(f)=>{
    let i=heap.length;heap.push(f);
    while(i){const p=(i-1)>>1;if(above(heap[p],f)>=0)break;heap[i]=heap[p];i=p;}heap[i]=f;
  };
  const pop=()=>{
    const last=heap.pop();if(!heap.length)return;
    let i=0;
    while(2*i+1<heap.length){let c=2*i+1;if(c+1<heap.length&&above(heap[c+1],heap[c])>0)c++;
      if(above(last,heap[c])>=0)break;heap[i]=heap[c];i=c;}heap[i]=last;
  };
  for(let i=0;i<events.length;) {
    const at=events[i].at;
    while(i<events.length&&events[i].at===at){if(events[i].start)push(events[i].start);i++;}
    while(heap.length&&heap[0].end<=at)pop();
    const end=events[i]?.at;
    if(heap.length&&end>at){const owner=heap[0].addr,prev=out.at(-1);
      if(prev&&prev.end===at&&prev.owner===owner)prev.end=end;
      else out.push({addr:at,end,owner});}
  }
  return out;
}
export function rangeOwner(ranges,addr) {
  let lo=0,hi=ranges.length;
  while(lo<hi){const m=(lo+hi)>>>1;if(ranges[m].addr<=addr)lo=m+1;else hi=m;}
  const r=ranges[lo-1];return r&&addr<r.end?r.owner:undefined;
}
export function staticClosure(analysis,recorded) {
  const fns=new Map(analysis.functions.map((f)=>[f.addr,f])),ranges=owningRanges(analysis),selected=new Set();
  for(const addr of recorded){const owner=rangeOwner(ranges,addr) ?? (fns.has(addr)?addr:undefined);if(owner!==undefined)selected.add(owner);}
  const pending=[...selected];
  while(pending.length)for(const call of fns.get(pending.pop()).calls){
    const owner=rangeOwner(ranges,call) ?? (fns.has(call)?call:undefined);
    if(owner!==undefined&&!selected.has(owner)){selected.add(owner);pending.push(owner);}
  }
  return [...selected].sort((a,b)=>a-b);
}
