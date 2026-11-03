// Private evidence is tied to exact module hashes/bases, never to an engine name.
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const address=a=>Number.isInteger(a)&&a>=0&&a<=0xffffffff;
export function coveragePlan(files,gameDir) {
  const code=new Set(),ranges=[],modules=[],recordings=[],interpreter=[];
  for(const file of [...new Set(files.map(f=>resolve(gameDir,f)))].sort()) {
    const bytes=readFileSync(file),c=JSON.parse(bytes);
    if(c.schema!=='game-cask/coverage/1'||!Array.isArray(c.code)||!Array.isArray(c.files)||!Array.isArray(c.modules))throw new Error('invalid coverage snapshot');
    if(c.metrics?.code_entries_dropped>0 || c.interpreter?.dropped>0)throw new Error('coverage overflowed; cannot package an incomplete recording');
    if(c.metrics?.errors>0)throw new Error('coverage has runtime errors; record a successful workload');
    const execution=c.metrics?.execution;
    recordings.push({file:relative(gameDir,file).split('\\').join('/'),sha256:hash(bytes),game:c.game ?? null,
      interp_insns:execution?.interp_insns ?? null,interp_code_entries:execution?.interp_code_entries ?? null,
      interp_functions:execution?.interp_functions ?? null,interp_unowned_entries:execution?.interp_unowned_entries ?? null});
    for(const m of c.modules) {
      const old=modules.find((x)=>x.name===m.name);
      if(old&&(old.sha256!==m.sha256||old.base!==m.base))throw new Error('coverage module identities disagree');
      if(!old)modules.push(m);
    }
    for(const e of c.code) {if(!address(e.address))throw new Error('invalid code coverage address');code.add(e.address);}
    for(const e of c.interpreter?.entries ?? []) {
      if(!address(e.address)||(e.owner!==null&&!address(e.owner))||!Number.isSafeInteger(e.count)||e.count<0||!Number.isSafeInteger(e.instructions)||e.instructions<1)throw new Error('invalid interpreter coverage entry');
      // Interior entries are selection roots too; never reduce evidence to owner starts.
      code.add(e.address);interpreter.push(e);
    }
    for(const r of c.files) {if(typeof r.path!=='string'||!Number.isSafeInteger(r.offset)||r.offset<0||!Number.isSafeInteger(r.length)||r.length<0)throw new Error('invalid file range');ranges.push(r);}
  }
  return {code:new Set([...code].sort((a,b)=>a-b)),ranges,modules,recordings,interpreter};
}

/** Default evidence inbox, outside source control. No recursive scan of arbitrary reports. */
export function automaticCoverageFiles(root,game) {
  if(!/^[a-z0-9][a-z0-9-]*$/.test(game))throw new Error('invalid coverage game id');
  const dir=join(root,'reports/coverage-inbox',game);
  const files=existsSync(dir)?readdirSync(dir).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).sort().map(f=>join(dir,f)):[];
  const latest=join(root,'reports/probe/coverage.json');
  if(existsSync(latest) && JSON.parse(readFileSync(latest,'utf8')).game===game)files.push(latest);
  return files;
}
export function publishCoverage(root,snapshot) {
  const game=snapshot.game;
  if(!/^[a-z0-9][a-z0-9-]*$/.test(game))throw new Error('invalid coverage game id');
  // Failed/overflowed runs remain diagnostic artifacts, never automatic build evidence.
  if(snapshot.metrics?.errors>0 || snapshot.metrics?.outsideSlice>0 || snapshot.metrics?.code_entries_dropped>0 || snapshot.interpreter?.dropped>0)return null;
  const bytes=JSON.stringify(snapshot)+'\n',dir=join(root,'reports/coverage-inbox',game);
  mkdirSync(dir,{recursive:true});
  const file=join(dir,hash(bytes)+'.json'),tmp=file+'.'+process.pid+'.tmp';
  writeFileSync(tmp,bytes);renameSync(tmp,file);return file;
}

// Disjoint owning intervals: .pdata takes precedence over speculative seeds; otherwise
// the nearest enclosing start wins. Half-open ends keep neighbour continuations separate.
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
export function selectionMode(p,slice) {
  const mode=p.selection ?? 'coverage';
  if(!['coverage','all'].includes(mode))throw new Error('pipeline.selection must be coverage or all');
  if(slice && mode==='all')throw new Error('pipeline.selection all cannot broaden a strict slice');
  return mode;
}
export function selectionProvenance(analysis,plan,mode) {
  const ranges=owningRanges(analysis),fns=new Set(analysis.functions.map(f=>f.addr));
  const owner=a=>rangeOwner(ranges,a) ?? (fns.has(a)?a:undefined);
  const recorded=new Set([...(plan?.code ?? [])].map(owner).filter(a=>a!==undefined));
  const interpreted=new Set((plan?.interpreter ?? []).map(e=>owner(e.address)).filter(a=>a!==undefined));
  const selected=mode==='all'||!plan?[...fns].sort((a,b)=>a-b):staticClosure(analysis,plan.code);
  return {mode:mode==='all'?'all':plan?'coverage':'all-no-recordings',analyzed_functions:fns.size,selected_functions:selected.length,
    owners:selected,recorded_owners:[...recorded].sort((a,b)=>a-b),interpreter_owners:[...interpreted].sort((a,b)=>a-b),
    static_closure_owners:plan&&mode==='coverage'?selected.filter(a=>!recorded.has(a)):[]};
}
