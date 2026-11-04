#!/usr/bin/env node
// Bound npm Binaryen's wasm32 IR heap by transforming function-body batches.
// Omitted bodies are *only analysis inputs*: they call the real yield import then
// trap, so the shard call graph overapproximates suspension (including table calls).
// Every original body is transformed exactly once; no substitute body is published.
import { execFileSync } from './exec.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './toolchain.mjs';
import { reader, sections, encodeSections, codeBodies, codeSection, uleb } from './wasm-sections.mjs';
import { functionNames, encodeFunctionNames } from './wasm-names.mjs';
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
export function transform(input,output,args=[],{partitionBytes=PARTITION_BYTES,wholeLimit=WHOLE_LIMIT,run=execFileSync}={}) {
 if(!Number.isInteger(partitionBytes)||partitionBytes<1024||partitionBytes>16*1048576)throw new Error('Asyncify partition bytes must be 1024..16777216');
 const raw=readFileSync(input),list=sections(raw),code=list.find(s=>s.id===10);
 const runner=join(ROOT,'tools/build/binaryen-runner.mjs');
 if(!code||code.data.length<=wholeLimit){run(process.execPath,[runner,input,...args,'-o',output],{stdio:'inherit',phase:'Asyncify whole-module'});return {mode:'whole-O2',partitions:1};}
 const allowed=a=>['-O2','--asyncify','--print-function-map','--pass-arg=asyncify-imports@bgt.yield'].includes(a)||/^--enable-[a-z0-9-]+$/.test(a)||a.startsWith('--pass-arg=asyncify-removelist@');
 if(args.some(a=>!allowed(a)))throw new Error('unsupported partitioned Asyncify option; only fixed function-local passes, features and exact native removelists are safe');
 if(!args.includes('--asyncify')||!args.includes('--pass-arg=asyncify-imports@bgt.yield'))throw new Error('partitioned transform requires Asyncify with bgt.yield as its suspending import');
 const bodies=codeBodies(code.data),{yieldFn,imports}=yieldIndex(list);
 const originalNames=new Map(functionNames(raw).map(n=>[n.index,n.name]));
 const identities=Array.from({length:imports+bodies.length},(_,index)=>({index,name:'p'+index.toString(36)}));
 const nameSection=sections(Buffer.concat([raw.subarray(0,8),encodeFunctionNames(identities)]))[0];
 const inputSections=[...list.filter(s=>s.id!==0||!isNames(s)),nameSection];
 if(yieldFn===null)throw new Error('partitioned Asyncify requires the bgt.yield import; use a non-suspending build instead');
 if(bodies.some(b=>b.length>16*1048576))throw new Error('Asyncify function body exceeds the 16 MiB per-function safety limit; split the generated function or use a JSPI-only build');
 const ranges=[];let start=0,size=0;
 for(let i=0;i<bodies.length;i++){if(size&&size+bodies[i].length>partitionBytes){ranges.push([start,i]);start=i;size=0;}size+=bodies[i].length;}ranges.push([start,bodies.length]);
 const stub=Buffer.concat([Buffer.from([0,0x10]),uleb(yieldFn),Buffer.from([0,11])]);
 const work=mkdtempSync(join(tmpdir(),'bgt-asyncify-'));
 let skeleton,map,base,baked;const merged=Array(bodies.length),seen=new Set();
 try {
  for(let part=0;part<ranges.length;part++){
   const [lo,hi]=ranges[part],src=join(work,'input.wasm'),out=join(work,'output.wasm');
   writeFileSync(src,encodeSections(inputSections.map(s=>s.id===10?{id:10,data:codeSection(bodies.map((b,i)=>i>=lo&&i<hi?b:stub))}:s)));
   // No interprocedural O2 on substituted graphs: inlining, DCE or constant
   // propagation across a placeholder would be unsound. These passes are local.
   const localArgs=args.filter(a=>a!=='-O2'&&a!=='--print-function-map').map(a=>{
    const prefix='--pass-arg=asyncify-removelist@';if(!a.startsWith(prefix))return a;
    const remove=new Set(a.slice(prefix.length).split(','));
    const selected=identities.filter(n=>remove.has(originalNames.get(n.index))).map(n=>n.name);
    return prefix+selected.join(',');
   });
   // Binaryen's writer otherwise orders types by shard-local usage frequency,
   // even without reorder-types. Keep original type indices identical so bodies
   // containing call_indirect/block signatures can be assembled without rewriting.
   const names=run(process.execPath,[runner,src,...LOCAL_PASSES,...localArgs,...LOCAL_PASSES,'--preserve-type-order','--print-function-map','-o',out],{encoding:'utf8',stdio:['ignore','pipe','inherit'],maxBuffer:64*1048576,phase:'Asyncify partition '+(part+1)+'/'+ranges.length});
   const result=sections(readFileSync(out)),sig=signature(result),body=codeBodies(result.find(s=>s.id===10).data);
   if(!base){
    base=result;skeleton=sig;map=names;
    const finalNames=new Map(names.trim().split('\n').map(l=>{const m=/^(\d+):(.*)$/.exec(l);if(!m)throw new Error('invalid Binaryen function map');return [Number(m[1]),m[2]];}));
    // Binaryen 132 preserves function order without module passes; fail closed if it stops doing so.
    for(const n of identities.filter(n=>n.index>=imports))if(finalNames.get(n.index)!==n.name)throw new Error('Binaryen reordered/renamed function '+n.index+': '+JSON.stringify(n.name)+' -> '+JSON.stringify(finalNames.get(n.index)));
    if(body.length!==bodies.length+5)throw new Error('unexpected Asyncify helper layout');
    baked=body.slice(bodies.length).map(b=>Buffer.from(b));
   }else{
    if(names!==map||sig.length!==skeleton.length||sig.some((s,i)=>s.id!==skeleton[i].id||!s.data.equals(skeleton[i].data))||body.length!==bodies.length+5||baked.some((b,i)=>!b.equals(body[bodies.length+i])))throw new Error('partitioned Asyncify index-space/helper mismatch; refusing to publish');
   }
   for(let i=lo;i<hi;i++){if(seen.has(i))throw new Error('duplicate transformed body');merged[i]=Buffer.from(body[i]);seen.add(i);}
   console.error('Asyncify partition '+(part+1)+'/'+ranges.length+': functions '+lo+'..'+hi);
  }
  if(seen.size!==bodies.length)throw new Error('missing transformed body');
  const bytes=encodeSections(base.map(s=>s.id===10?{id:10,data:codeSection([...merged,...baked])}:s));
  if(!WebAssembly.validate(bytes))throw new Error('assembled Asyncify module failed WebAssembly validation; refusing to publish');
  writeFileSync(output,bytes);
  if(args.includes('--print-function-map'))process.stdout.write(map.split('\n').map(line=>{const m=/^(\d+):(.*)$/.exec(line);return m&&originalNames.has(Number(m[1]))?m[1]+':'+originalNames.get(Number(m[1])):line;}).join('\n'));
  return {mode:'partitioned-local',partitions:ranges.length};
 }finally{rmSync(work,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),input=args.shift(),oi=args.indexOf('-o');if(!input||oi<0)throw new Error('usage: asyncify.mjs INPUT [wasm-opt args] -o OUTPUT');
  const output=args.splice(oi,2)[1],pi=args.findIndex(a=>a.startsWith('--bgt-partition-bytes='));
  const options=pi<0?{}:{partitionBytes:Number(args.splice(pi,1)[0].split('=')[1]),wholeLimit:0};
  transform(input,output,args,options);
 }catch(e){console.error('Asyncify build failed: '+e.message+'; no artifact published. JSPI-only: BGT_SUSPENSION_BUILD=jspi (requires JSPI at runtime).');process.exitCode=1;}
}
