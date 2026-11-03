// Optional kit observation exports. No game/engine policy or wire-command changes.
export interface InterpreterEntry { address: number; owner: number | null; count: number; instructions: number }
export interface InterpreterCoverage { capacity: number; dropped: number; entries: InterpreterEntry[] }
const u64=(v:DataView,p:number)=>Number(v.getBigUint64(p,true));
const fits=(v:DataView,p:number,n:number)=>p>0 && p+n<=v.byteLength;
export function readInterpreterCoverage(memory:ArrayBuffer,ptr:number):InterpreterCoverage|null {
  const v=new DataView(memory);
  if(!fits(v,ptr,24))return null;
  const rows=v.getUint32(ptr,true),length=v.getUint32(ptr+4,true),capacity=v.getUint32(ptr+8,true);
  if(capacity>1048576 || length>capacity || (length && !fits(v,rows,length*24)))return null;
  const entries:InterpreterEntry[]=[];
  for(let i=0;i<length;i++){
    const p=rows+i*24,instructions=u64(v,p+16);if(!instructions)continue;
    const owner=v.getUint32(p+4,true);
    entries.push({address:v.getUint32(p,true),owner:owner===0xffffffff?null:owner,count:u64(v,p+8),instructions});
  }
  entries.sort((a,b)=>a.address-b.address);
  return {capacity,dropped:u64(v,ptr+16),entries};
}
export function interpreterSummary(metrics:Record<string,unknown>,coverage:InterpreterCoverage|null,updates:number,updateMs:number) {
  const owners=new Map<number|null,{owner:number|null;entries:number;instructions:number}>();
  for(const e of coverage?.entries ?? []){
    const row=owners.get(e.owner) ?? {owner:e.owner,entries:0,instructions:0};
    row.entries+=e.count;row.instructions+=e.instructions;owners.set(e.owner,row);
  }
  const instructions=typeof metrics.interp_insns==='number'?metrics.interp_insns:null;
  const enabled=metrics.interpreter_timing_enabled===1,samples=Number(metrics.interpreter_samples ?? 0);
  const ms=enabled?(samples?Number(metrics.interpreter_exclusive_estimated_us)/1000:instructions===0?0:null):null;
  const observed=coverage?.entries.reduce((n,e)=>n+e.instructions,0);
  const owned=[...owners.keys()].some(owner=>owner!==null);
  return {instructions,instructions_per_update:instructions!==null&&updates?instructions/updates:null,
    estimated_ms:ms,estimated_ms_per_update:ms!==null&&updates?ms/updates:null,
    estimated_share:ms!==null&&updateMs>0?ms/updateMs:null,samples,timing:'sampled-exclusive-dispatch' as const,
    coverage_dropped:coverage?.dropped ?? null,analyzed_code_interpreted:owned?true:coverage&&!coverage.dropped&&observed===instructions?false:null,
    top_owners:coverage?[...owners.values()].sort((a,b)=>b.instructions-a.instructions||(a.owner ?? -1)-(b.owner ?? -1)).slice(0,32):null};
}
export function readGuestPresentations(memory:ArrayBuffer,ptr:number,elapsedMs:number) {
  const v=new DataView(memory);if(!fits(v,ptr,40))return null;
  const count=u64(v,ptr),swaps=u64(v,ptr+8),gdi=u64(v,ptr+16),times=v.getUint32(ptr+24,true),length=v.getUint32(ptr+28,true),next=v.getUint32(ptr+32,true);
  if(length>10000 || next>=10000 || (length && !fits(v,times,80000)))return null;
  const timestamps:number[]=[];
  for(let i=0;i<length;i++)timestamps.push(v.getFloat64(times+8*(((length===10000?next:0)+i)%10000),true)/1000);
  const intervals=timestamps.slice(1).map((t,i)=>t-timestamps[i]).sort((a,b)=>a-b);
  return {count,swaps,gdi_presents:gdi,per_second:elapsedMs>0?count*1000/elapsedMs:null,
    frame_ms_avg:intervals.length?intervals.reduce((a,b)=>a+b,0)/intervals.length:null,
    frame_ms_p95:intervals.length?intervals[Math.min(intervals.length-1,Math.floor(intervals.length*.95))]:null,
    intervals_measured:intervals.length,timestamps_ms:timestamps,clock:'wall-between-guest-presents' as const};
}
