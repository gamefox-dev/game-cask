#!/usr/bin/env node
// Bound npm Binaryen's wasm32 IR heap by transforming function-body batches.
// Omitted bodies are *only analysis inputs* (yield-then-trap for functions that can suspend,
// trap otherwise). Every original body is transformed exactly once; no substitute body is published.
// K65 (default, BGT_ASYNCIFY_ANALYSIS=precise): the suspension set is computed once from the whole
// linked module (wasm-callgraph.mjs: direct calls + call_indirect matched by signature against
// every table-reachable function, removelisted generated steps as cut points) and passed to every
// Binaryen run as an exact onlylist; the published artifact is then re-analysed and refused unless
// every function that can reach bgt.yield is instrumented. `binaryen` keeps the pre-K65 analysis.
import { execFileSync } from './exec.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './toolchain.mjs';
import { reader, sections, encodeSections, codeBodies, codeSection, uleb } from './wasm-sections.mjs';
import { functionNames, encodeFunctionNames } from './wasm-names.mjs';
import { analyzeModule, suspendingSet, verifyAsyncify } from './wasm-callgraph.mjs';
export const PARTITION_BYTES = 8 * 1048576;
export const WHOLE_LIMIT = 32 * 1048576;
const LOCAL_PASSES = ['--optimize-instructions','--precompute','--simplify-locals','--vacuum'];
function yieldIndex(list) {
 const r=reader(list.find(s=>s.id===2)?.data??Buffer.from([0]));let index=0,found=null;
 const str=()=>r.take(r.uint()).toString('utf8');
 const limits=()=>{const f=r.uint();if(f&~3)throw new Error('partitioned Asyncify requires wasm32 limits');r.uint();if(f&1)r.uint();};
 for(let n=r.uint();n;n--){const module=str(),name=str(),kind=r.byte();
  if(kind===0){r.uint();if(module==='bgt'&&name==='yield')found=index;index++;}
  else if(kind===1){r.byte();limits();}else if(kind===2)limits();else if(kind===3){r.byte();r.byte();}
  else throw new Error('unsupported import kind in partitioned Asyncify');
 }return {yieldFn:found,imports:index};
}
function isNames(s) {const r=reader(s.data);return r.take(r.uint()).toString()==='name';}
function signature(list) {
 // Name metadata is intentionally not shipped by wasm-opt without -g. All other
 // sections must be identical, proving the function/type/global/table index spaces.
 return list.filter(s=>s.id!==10&&!(s.id===0&&isNames(s)));
}
const REMOVE='--pass-arg=asyncify-removelist@';
const unreachableStub=Buffer.from([0,0,11]);
// K65: exact suspension set computed from the linked wasm itself (direct calls + signature-
// matched call_indirect over every table-reachable function), passed to Binaryen as an
// onlylist. Removelisted names stay cut points (kit invariant: generated native steps).
function precisePlan(bytes,cutNames) {
 const info=analyzeModule(bytes),imports=info.importedFunctions,nameOf=new Map(info.names.map(n=>[n.index,n.name]));
 const cut=new Set([...nameOf].filter(([i,n])=>i>=imports&&cutNames.has(n)).map(([i])=>i));
 const {set}=suspendingSet(info,{cut});
 const only=[...set].filter(i=>i>=imports).sort((a,b)=>a-b);
 const names=()=>only.map(i=>{const n=nameOf.get(i);if(n===undefined)throw new Error('suspending function '+i+' has no name for the Asyncify onlylist');return n;});
 return {only,names,cut:cut.size,functions:info.functions.length-imports};
}
// K65: x86_rt.c's artifact marker; only the Asyncify artifact says "ASYN" (the guard faults there).
const MARKER=Buffer.from('BGT-K65-SUSPJSPI');
export function markAsyncifyArtifact(bytes) {
 let found=0;const out=Buffer.from(bytes);
 for(let p=8;p<out.length;){const id=out[p++];let n=0,shift=0,b;do{b=out[p++];n+=(b&127)*2**shift;shift+=7;}while(b&128);
  if(id===11)for(let i=out.indexOf(MARKER,p);i>=0&&i<p+n;i=out.indexOf(MARKER,i+1)){out.write('ASYN',i+12,'latin1');found++;}
  p+=n;}
 if(found>1)throw new Error('Asyncify artifact marker occurs '+found+' times; refusing to publish');
 return {bytes:out,marked:found===1};
}
function namedOutput(bytes,map,originalNames,identities) {
 // Always ship standard function names (profiles show names, not wasm-function[N]).
 const back=new Map(identities.map(n=>[n.name,originalNames.get(n.index)]));
 const names=[];
 for(const line of map.trim().split('\n')){const m=/^(\d+):(.*)$/.exec(line);if(!m)throw new Error('invalid Binaryen function map');const orig=back.has(m[2])?back.get(m[2]):m[2];if(orig!==undefined)names.push({index:Number(m[1]),name:orig});}
 const list=sections(bytes).filter(s=>!(s.id===0&&isNames(s)));
 return {bytes:Buffer.concat([encodeSections(list),encodeFunctionNames(names)]),names};
}
export function transform(input,output,args=[],{partitionBytes=PARTITION_BYTES,wholeLimit=WHOLE_LIMIT,run=execFileSync,analysis=process.env.BGT_ASYNCIFY_ANALYSIS||'precise'}={}) {
 if(!Number.isInteger(partitionBytes)||partitionBytes<1024||partitionBytes>16*1048576)throw new Error('Asyncify partition bytes must be 1024..16777216');
 if(!['precise','binaryen'].includes(analysis))throw new Error('Asyncify analysis must be precise or binaryen');
 const raw=readFileSync(input),list=sections(raw),code=list.find(s=>s.id===10);
 const runner=join(ROOT,'tools/build/binaryen-runner.mjs');
 const whole=!code||code.data.length<=wholeLimit;
 // K70 (Q127): without --asyncify this is the JSPI artifact's plain bounded optimization (same -O2 / local
 // partitions, same name section and index-space checks, no instrumentation, no Asyncify artifact marker).
 const async=args.includes('--asyncify');
 if(!whole){
  const allowed=a=>['-O2','--asyncify','--print-function-map','--pass-arg=asyncify-imports@bgt.yield'].includes(a)||/^--enable-[a-z0-9-]+$/.test(a)||(async&&a.startsWith(REMOVE));
  if(args.some(a=>!allowed(a)))throw new Error('unsupported partitioned Asyncify option; only fixed function-local passes, features and exact native removelists are safe');
  if(async&&!args.includes('--pass-arg=asyncify-imports@bgt.yield'))throw new Error('partitioned transform requires Asyncify with bgt.yield as its suspending import');
 }
 const precise=analysis==='precise'&&args.includes('--asyncify')&&args.includes('--pass-arg=asyncify-imports@bgt.yield');
 const bodies=code?codeBodies(code.data):[],{yieldFn,imports}=yieldIndex(list);
 const originalNames=new Map(functionNames(raw).map(n=>[n.index,n.name]));
 const identities=Array.from({length:imports+bodies.length},(_,index)=>({index,name:'p'+index.toString(36)}));
 const nameSection=sections(Buffer.concat([raw.subarray(0,8),encodeFunctionNames(identities)]))[0];
 const inputSections=[...list.filter(s=>s.id!==0||!isNames(s)),nameSection];
 if(!whole&&async&&yieldFn===null)throw new Error('partitioned Asyncify requires the bgt.yield import; use a non-suspending build instead');
 if(!whole&&bodies.some(b=>b.length>16*1048576))throw new Error('Asyncify function body exceeds the 16 MiB per-function safety limit; split the generated function or use a JSPI-only build');
 // A list is either inline or a response file (`...removelist@@FILE`, Binaryen's form): name lists can
 // exceed Linux MAX_ARG_STRLEN (128 KiB per argv string), so the build always passes files.
 const listNames=v=>(v.startsWith('@')?readFileSync(v.slice(1),'utf8'):v).split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
 const cutNames=new Set(args.filter(a=>a.startsWith(REMOVE)).flatMap(a=>listNames(a.slice(REMOVE.length))));
 const exact=precise&&yieldFn!==null;
 // Partitions keep the original index space: one plan from the raw module. Whole-module mode plans
 // after -O2 (below), because inlining a cut native step moves its calls into its caller.
 let plan=exact&&!whole?precisePlan(raw,cutNames):null;
 const work=mkdtempSync(join(tmpdir(),'bgt-asyncify-'));
 // Removelist names -> canonical identities; or, precisely, one onlylist response file.
 const onlyFile=join(work,'onlylist.txt');
 const listArgs=a=>a.flatMap(x=>{
  if(!x.startsWith(REMOVE))return [x];
  if(exact)return [];
  const file=join(work,'removelist.txt');
  writeFileSync(file,identities.filter(n=>cutNames.has(originalNames.get(n.index))).map(n=>n.name).join('\n')+'\n');
  return [REMOVE+'@'+file];
 });
 const onlyArgs=exact?['--pass-arg=asyncify-onlylist@@'+onlyFile]:[];
 // An empty onlylist means "no list" to Binaryen; a never-matching identity keeps it exact.
 const writeOnly=names=>writeFileSync(onlyFile,(names.length?names:['p-none']).join('\n')+'\n');
 const finish=(bytes,map,extra)=>{
  // Only the Asyncify artifact is marked: the JSPI artifact keeps "SUSPJSPI" (x86_rt.c's guard counts there).
  const named=namedOutput(bytes,map,originalNames,identities),marked=async?markAsyncifyArtifact(named.bytes):{bytes:named.bytes,marked:false};named.bytes=marked.bytes;
  if(!WebAssembly.validate(named.bytes))throw new Error('assembled Asyncify module failed WebAssembly validation; refusing to publish');
  const verified=yieldFn===null||!async?null:verifyAsyncify(named.bytes,{cutNames});
  writeFileSync(output,named.bytes);
  if(args.includes('--print-function-map'))process.stdout.write(named.names.map(n=>n.index+':'+n.name).join('\n')+'\n');
  const stats={...extra,analysis:plan?'precise':'binaryen',functions:plan?.functions??bodies.length,onlylist:plan?plan.only.length:null,cut:plan?plan.cut:cutNames.size,
   suspending:verified?.suspending??0,instrumented:verified?.instrumented??0,marked:marked.marked,bytes:named.bytes.length};
  process.stdout.write('#bgt-asyncify '+JSON.stringify(stats)+'\n');
  return stats;
 };
 try {
  if(plan)writeOnly(plan.only.map(i=>identities[i].name));
  if(whole){
   const src=join(work,'input.wasm'),out=join(work,'output.wasm');
   writeFileSync(src,encodeSections(inputSections));
   const options={encoding:'utf8',stdio:['ignore','pipe','inherit'],maxBuffer:256*1048576,phase:(async?'Asyncify':'Optimize')+' whole-module'};
   let input=src,rest=args.filter(a=>a!=='--print-function-map');
   if(exact){
    // -O2 first (names kept as identities), then the exact list of THAT module, then Asyncify at
    // the same optimize level without re-running the O2 pipeline (--optimize-level only sets it).
    const optimize=rest.includes('-O2');rest=rest.filter(a=>a!=='-O2'&&!a.startsWith(REMOVE));
    if(optimize){
     input=join(work,'optimized.wasm');
     run(process.execPath,[runner,src,...rest.filter(a=>a.startsWith('--enable-')),'-O2','-g','-o',input],{...options,phase:'Asyncify whole-module O2'});
     rest=['--optimize-level=2',...rest];
    }
    const cutIds=new Set(identities.filter(n=>cutNames.has(originalNames.get(n.index))).map(n=>n.name));
    plan=precisePlan(readFileSync(input),cutIds);writeOnly(plan.names());
   }
   const map=run(process.execPath,[runner,input,...listArgs(rest),...onlyArgs,'--print-function-map','-o',out],options);
   return finish(readFileSync(out),map,{mode:'whole-O2',partitions:1});
  }
  const ranges=[];let start=0,size=0;
  for(let i=0;i<bodies.length;i++){if(size&&size+bodies[i].length>partitionBytes){ranges.push([start,i]);start=i;size=0;}size+=bodies[i].length;}ranges.push([start,bodies.length]);
  const stub=async?Buffer.concat([Buffer.from([0,0x10]),uleb(yieldFn),Buffer.from([0,11])]):unreachableStub;
  // Precise: only functions in the suspension set keep a yielding placeholder; the onlylist
  // (not the placeholder) decides instrumentation, the placeholder only keeps bodies honest.
  const suspends=plan?new Set(plan.only):null;
  const stubFor=i=>async&&(!suspends||suspends.has(imports+i))?stub:unreachableStub;
  // Asyncify appends its five runtime helpers (start/stop unwind/rewind, get_state); a plain run appends none.
  const helpers=async?5:0;
  let skeleton,map,base,baked;const merged=Array(bodies.length),seen=new Set();
  for(let part=0;part<ranges.length;part++){
   const [lo,hi]=ranges[part],src=join(work,'input.wasm'),out=join(work,'output.wasm');
   writeFileSync(src,encodeSections(inputSections.map(s=>s.id===10?{id:10,data:codeSection(bodies.map((b,i)=>i>=lo&&i<hi?b:stubFor(i)))}:s)));
   // No interprocedural O2 on substituted graphs: inlining, DCE or constant
   // propagation across a placeholder would be unsound. These passes are local.
   const localArgs=listArgs(args.filter(a=>a!=='-O2'&&a!=='--print-function-map'));
   // Binaryen's writer otherwise orders types by shard-local usage frequency,
   // even without reorder-types. Keep original type indices identical so bodies
   // containing call_indirect/block signatures can be assembled without rewriting.
   const names=run(process.execPath,[runner,src,...LOCAL_PASSES,...localArgs,...onlyArgs,...LOCAL_PASSES,'--preserve-type-order','--print-function-map','-o',out],{encoding:'utf8',stdio:['ignore','pipe','inherit'],maxBuffer:256*1048576,phase:(async?'Asyncify':'Optimize')+' partition '+(part+1)+'/'+ranges.length});
   const result=sections(readFileSync(out)),sig=signature(result),body=codeBodies(result.find(s=>s.id===10).data);
   if(!base){
    base=result;skeleton=sig;map=names;
    const finalNames=new Map(names.trim().split('\n').map(l=>{const m=/^(\d+):(.*)$/.exec(l);if(!m)throw new Error('invalid Binaryen function map');return [Number(m[1]),m[2]];}));
    // Binaryen 132 preserves function order without module passes; fail closed if it stops doing so.
    for(const n of identities.filter(n=>n.index>=imports))if(finalNames.get(n.index)!==n.name)throw new Error('Binaryen reordered/renamed function '+n.index+': '+JSON.stringify(n.name)+' -> '+JSON.stringify(finalNames.get(n.index)));
    if(body.length!==bodies.length+helpers)throw new Error('unexpected Asyncify helper layout');
    baked=body.slice(bodies.length).map(b=>Buffer.from(b));
   }else{
    if(names!==map||sig.length!==skeleton.length||sig.some((s,i)=>s.id!==skeleton[i].id||!s.data.equals(skeleton[i].data))||body.length!==bodies.length+helpers||baked.some((b,i)=>!b.equals(body[bodies.length+i])))throw new Error('partitioned Asyncify index-space/helper mismatch; refusing to publish');
   }
   for(let i=lo;i<hi;i++){if(seen.has(i))throw new Error('duplicate transformed body');merged[i]=Buffer.from(body[i]);seen.add(i);}
   console.error((async?'Asyncify':'Optimize')+' partition '+(part+1)+'/'+ranges.length+': functions '+lo+'..'+hi);
  }
  if(seen.size!==bodies.length)throw new Error('missing transformed body');
  const bytes=encodeSections(base.map(s=>s.id===10?{id:10,data:codeSection([...merged,...baked])}:s));
  return finish(bytes,map,{mode:'partitioned-local',partitions:ranges.length});
 }finally{rmSync(work,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),input=args.shift(),oi=args.indexOf('-o');if(!input||oi<0)throw new Error('usage: asyncify.mjs INPUT [wasm-opt args] -o OUTPUT');
  const output=args.splice(oi,2)[1],pi=args.findIndex(a=>a.startsWith('--bgt-partition-bytes='));
  const options=pi<0?{}:{partitionBytes:Number(args.splice(pi,1)[0].split('=')[1]),wholeLimit:0};
  const ai=args.findIndex(a=>a.startsWith('--bgt-analysis='));if(ai>=0)options.analysis=args.splice(ai,1)[0].split('=')[1];
  transform(input,output,args,options);
 }catch(e){console.error('Asyncify build failed: '+e.message+'; no artifact published. JSPI-only: BGT_SUSPENSION_BUILD=jspi (requires JSPI at runtime).');process.exitCode=1;}
}
