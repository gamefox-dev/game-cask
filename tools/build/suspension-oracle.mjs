#!/usr/bin/env node
// Differential oracle for the original CC0 post-link stress fixture. Each owner
// runs with all locals live over a yield three direct calls below a table call.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function reference(frame,{functions,rounds,locals=32}) {
 let checksum=0;
 for(let j=0;j<35;j++){
  const i=(frame*35+j)%functions,v=Array.from({length:locals},(_,l)=>(i^(l+1+i))>>>0);
  for(let r=0;r<rounds;r++){const l=r%locals,next=(r+1)%locals;v[l]=(Math.imul(v[l]^(v[next]>>>13),1664525+i*2)+r*127+i*7919)>>>0;}
  checksum^=v.reduce((a,b)=>a^b,0);
 }return checksum>>>0;
}
export async function suspensionOracle(raw,asyncified,{functions,rounds,locals=32,frames=300,jspi=true}={}) {
 const expected=Array.from({length:frames},(_,f)=>reference(f,{functions,rounds,locals}));
 let syncYields=0;const plain=new WebAssembly.Instance(await WebAssembly.compile(raw),{bgt:{yield(){syncYields++;}}});
 const plainChecks=expected.map((v,f)=>{const got=plain.exports.run(f)>>>0;if(got!==v)throw new Error('raw/reference divergence at '+f+': '+got+' != '+v);return got;});
 let parked=0,instance;instance=new WebAssembly.Instance(await WebAssembly.compile(asyncified),{bgt:{yield(){
  const e=instance.exports;
  if(e.asyncify_get_state()===2)e.asyncify_stop_rewind();else{parked++;e.asyncify_start_unwind(1024);}
 }}});
 const e=instance.exports,mem=new DataView(e.memory.buffer);mem.setUint32(1024,1032,true);mem.setUint32(1028,131072,true);
 const asyncChecks=expected.map((v,f)=>{
  let got=e.run(f),n=0;
  while(e.asyncify_get_state()===1){if(++n>35)throw new Error('too many yields');e.asyncify_stop_unwind();e.asyncify_start_rewind(1024);got=e.run(f);}
  if(n!==35||got>>>0!==v)throw new Error('Asyncify/reference divergence at '+f+' yields='+n+' checksum='+got+' expected='+v);
  return got>>>0;
 });
 let jspiChecks=null,jspiYields=0;
 if(jspi){
  if(!WebAssembly.Suspending||!WebAssembly.promising)throw new Error('oracle requires real JSPI; run node --experimental-wasm-jspi');
  const h=new WebAssembly.Instance(await WebAssembly.compile(raw),{bgt:{yield:new WebAssembly.Suspending(async()=>{jspiYields++;})}});
  const run=WebAssembly.promising(h.exports.run);jspiChecks=[];
  for(let f=0;f<frames;f++){const got=(await run(f))>>>0;if(got!==expected[f])throw new Error('JSPI/reference divergence at '+f);jspiChecks.push(got);}
 }
 if(syncYields!==35*frames||parked!==35*frames||(jspi&&jspiYields!==35*frames))throw new Error('missing suspension boundaries');
 return {frames,ownersExecuted:Math.min(frames*35,functions),plainChecks,asyncChecks,jspiChecks,yields:{plain:syncYields,asyncify:parked,jspi:jspiYields}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [raw,asyncified,out,functions='10438',rounds='900']=process.argv.slice(2),start=performance.now();
 const result=await suspensionOracle(readFileSync(raw),readFileSync(asyncified),{functions:Number(functions),rounds:Number(rounds)});
 result.wallMs=performance.now()-start;writeFileSync(out,JSON.stringify(result)+'\n');console.log('oracle: '+result.frames+' frames, '+result.ownersExecuted+' owners, '+result.yields.asyncify+' parked yields, all checksums equal');
}
