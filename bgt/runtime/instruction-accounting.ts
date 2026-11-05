// Scheduler-owned observations. Raw retirement strings preserve all 64 bits.
// A frame is ONLY a pair of consecutive native guest-present snapshots.
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;
function count(v: unknown): bigint | null {
  return typeof v === 'string' && /^[0-9]+$/.test(v) ? BigInt(v) : null;
}
const safe = (v: bigint | null): number | null => v !== null && v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
function retired(v: unknown, previous?: unknown) {
  const now=object(v),before=object(previous);
  const result:Record<string,string|null>={};
  for(const k of ['total','lifted','generic','interpreted']) {
    const n=count(now?.[k]),p=previous===undefined?0n:count(before?.[k]);
    result[k]=n!==null&&p!==null&&n>=p?(n-p).toString():null;
  }
  return result;
}
// Accept old safe numeric snapshots, but never promote an already-rounded
// legacy Number to an exact count. New counters/timestamps are decimal strings.
function integer(v: unknown): bigint | null {
  return count(v) ?? (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);
}
function difference(v: unknown, previous: unknown, missingIsZero=false) {
  const n=integer(v),p=previous===undefined&&missingIsZero?0n:integer(previous);
  return n!==null&&p!==null&&n>=p?safe(n-p):null;
}
function thread(now: Row, previous?: Row) {
  const r=retired(now.retired,previous?.retired),wall=object(now.wall_us),oldWall=object(previous?.wall_us);
  const virtual=object(now.virtual_ms),oldVirtual=object(previous?.virtual_ms);
  const delta=(rows:Row|null,old:Row|null)=>rows?Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,difference(v,old?.[k],previous===undefined)])):null;
  const wallUs=delta(wall,oldWall),active=numeric(wallUs?.running),instructions=safe(count(r.total));
  return {id:now.id,start_address:now.start_address,state:now.state,retired:r,instructions,
    active_wall_us:active,wall_us:wallUs,virtual_ms:delta(virtual,oldVirtual),
    switches_in:difference(now.switches_in,previous?.switches_in,true),
    sleep_requested_ms:difference(now.sleep_requested_ms,previous?.sleep_requested_ms,true),
    object_requested_ms:difference(now.object_requested_ms,previous?.object_requested_ms,true),
    infinite_waits:difference(now.infinite_waits,previous?.infinite_waits,true),
    parked_host_us:difference(now.parked_host_us,previous?.parked_host_us,true),
    executing_instructions_per_second:instructions!==null&&active!==null&&active>0?instructions*1e6/active:null};
}
function activeTotal(rows: ReturnType<typeof thread>[] | null): number | null {
  return rows?.reduce((sum,t)=>sum!==null&&t.active_wall_us!==null&&Number.isSafeInteger(sum+t.active_wall_us)?sum+t.active_wall_us:null,0 as number|null) ?? null;
}
function threads(now: unknown, previous?: unknown) {
  const before=new Map((Array.isArray(previous)?previous:[]).map(object).filter((r):r is Row=>!!r).map(r=>[r.id,r]));
  return Array.isArray(now)?now.map(object).filter((r):r is Row=>!!r).map(r=>thread(r,before.get(r.id))):null;
}
export function instructionSummary(metrics: Row) {
  const a=object(metrics.execution_accounting);
  if(a?.enabled!==1)return {status:'unavailable',instructions:null,instructions_per_guest_frame:null,threads:null,frames:null,executing_instructions_per_second:null};
  const r=retired(a.retired),instructions=safe(count(r.total)),current=threads(a.threads),ring=object(a.frames);
  const snapshots=(Array.isArray(ring?.snapshots)?ring.snapshots:[]).map(object).filter((r):r is Row=>!!r);
  const frames=[];
  for(let i=1;i<snapshots.length;i++) {
    const before=snapshots[i-1],now=snapshots[i];
    const ordinal=integer(now.present),previousOrdinal=integer(before.present);
    if(ordinal===null||previousOrdinal===null||ordinal!==previousOrdinal+1n)continue;
    const work=retired(now.retired,before.retired),n=safe(count(work.total)),rows=threads(now.threads,before.threads);
    const active=activeTotal(rows);
    frames.push({from_present:before.present,to_present:now.present,wall_us:difference(now.wall_us,before.wall_us),
      retired:work,instructions:n,threads:rows,active_wall_us:active,
      lifted_calls:difference(now.lifted_calls,before.lifted_calls),generic_insn_execs:difference(now.generic_insn_execs,before.generic_insn_execs),
      executing_instructions_per_second:n!==null&&active!==null&&active>0?n*1e6/active:null});
  }
  const exact=frames.reduce((sum,f)=>{const n=count(f.retired.total);return sum!==null&&n!==null?sum+n:null;},0n as bigint|null);
  const measured=safe(exact),active=activeTotal(current);
  return {status:instructions===null?'integer-range-exceeded':'available',retired:r,instructions,threads:current,
    timing:a.timing_enabled===1?'scheduler-active-host-wall':'unavailable',cpu_time_us:null,active_wall_us:a.timing_enabled===1?active:null,
    executing_instructions_per_second:a.timing_enabled===1&&instructions!==null&&active!==null&&active>0?instructions*1e6/active:null,
    instructions_per_guest_frame:frames.length&&measured!==null?measured/frames.length:null,
    frames:ring?{capacity:ring.capacity,dropped:ring.dropped,intervals_measured:frames.length,intervals:frames}:null};
}
