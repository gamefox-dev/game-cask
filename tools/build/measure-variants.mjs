#!/usr/bin/env node
// Original kit fixtures only; JSPI/Asyncify use identical modules/assets/input and host contracts.
// BGT_E2E_PORT=5257 node tools/build/measure-variants.mjs REPORT.json ID ...
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadavg, totalmem } from 'node:os';
import { chromium } from '@playwright/test';
import { ROOT } from './toolchain.mjs';
const port=Number(process.env.BGT_E2E_PORT),output=process.argv[2],ids=process.argv.slice(3);
if (!port || port===5173 || !output || !ids.length) throw new Error('dedicated BGT_E2E_PORT, report path and fixture ids required');
const base='http://127.0.0.1:'+port;
const snapshot=()=>({at:new Date().toISOString(),load:loadavg(),totalmem:totalmem(),physical_headroom:execFileSync('python3',['-I','-c',
  'import runpy;print(runpy.run_path('+JSON.stringify(join(ROOT,'tools/harness/pi/shim/memory.py'))+')["available"]())'],{encoding:'utf8'}).trim()});
const report={schema:'game-cask/suspension-benchmark/1',revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),before:snapshot(),fixtures:[],
 method:'five fresh headless GameHost instances per variant in Chromium; 300 frames including range I/O, render/decode/consume; modules compiled before instance timing; no rasterization; zero input; same per-frame trace digest required; shared machine, not quiescent'};
const server=spawn(process.execPath,[join(ROOT,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:ROOT,stdio:['ignore','ignore','inherit']});
let browser;
try {
 for(let n=0;;n++){if(server.exitCode!==null)throw new Error('server exited');try{if((await fetch(base+'/games/index.json')).ok)break;}catch{}if(n>200)throw new Error('server timeout');await new Promise(r=>setTimeout(r,50));}
 browser=await chromium.launch({channel:'chromium',headless:true});
 const page=await browser.newPage();await page.goto(base+'/');
 for(const id of ids){
  const result=await page.evaluate(async({id,root})=>{
   const {GameHost,emptyInput}=await import(root+'/runtime/host.ts');const {Vfs}=await import(root+'/runtime/vfs.ts');
   const {RangeFiles}=await import(root+'/runtime/range-files.ts');const A=await import(root+'/runtime/abi.ts');
   const {compileVerifiedWasm}=await import(root+'/runtime/wasm-loader.ts');
   const path='/games/'+id+'/',manifest=await(await fetch(path+'manifest.json')).json();
   const assets=await Promise.all(manifest.assets.map(async a=>({path:a.path,bytes:new Uint8Array(await(await fetch(path+a.url)).arrayBuffer())})));
   const variants=[];
   for(const mode of ['asyncify','jspi']){
    const artifact=mode==='jspi'?manifest.variants?.jspi:manifest.wasm;if(!artifact)throw new Error('missing JSPI artifact '+id);
    const loadStart=performance.now(),loaded=await compileVerifiedWasm(await fetch(path+artifact.url),artifact),loadMs=performance.now()-loadStart;
    const bytes=await(await fetch(path+artifact.url)).arrayBuffer(),compileStart=performance.now();
    const module=await WebAssembly.compile(bytes),compileMs=performance.now()-compileStart,samples=[];
    for(let sample=0;sample<5;sample++){
     const vfs=new Vfs(),ranges=new RangeFiles(path);for(const a of assets)vfs.add(a.path,a.bytes);
     for(const s of manifest.streams??[]){ranges.add(s);vfs.addStream(s.path,s.size,s.chunks);}
     const store=new Map();let cursor=0;const logs=[];
     const host=await GameHost.create(module,{vfs,now:()=>performance.now(),log:(_l,m)=>logs.push(m),storage:{persistent:true,read:k=>store.get(k)??null,write:(k,v)=>(store.set(k,v),0)},
       rangeRead:(p,o,n,a)=>ranges.read(p,o,n,a),entropy:b=>{for(let i=0;i<b.length;i++)b[i]=((cursor++*73+41)^(cursor>>>8))&255;}},
       {backend:3,caps:A.CAP_STORAGE|A.CAP_LINEAR_FILTER|A.CAP_SCISSOR|A.CAP_TRIANGLES|A.CAP_DIRECT_DRAW|A.CAP_RENDER_TARGETS,seed:1,displayWidth:640,displayHeight:360,arg0:0,arg1:0,suspensionMode:mode});
     host.init();const input=emptyInput(),hashes=[],t=performance.now();
     for(let f=0;f<300;f++){await host.settleRequests();host.writeInput(input);await host.update();host.render();host.consume();hashes.push(host.stateHash());}
     const elapsedMs=performance.now()-t,metrics=host.metrics();
     if(host.commandErrorCount||metrics.interp_insns||metrics.stubs.length)throw new Error(JSON.stringify({id,mode,metrics,commandErrors:host.commandErrors}));
     const digest=await crypto.subtle.digest('SHA-256',new globalThis.TextEncoder().encode(JSON.stringify(hashes)));
     samples.push({elapsedMs,instantiateMs:host.instantiateMs,yields:host.yields,hashesSha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),last:hashes.at(-1),logs});
    }
    const times=samples.map(s=>s.elapsedMs).sort((a,b)=>a-b);variants.push({mode,bytes:bytes.byteLength,loadMs,downloadCompileVerifyMs:loaded.downloadCompileVerifyMs,streaming:loaded.streaming,compileMs,medianMs:times[2],samples});
   }
   const traces=variants.flatMap(v=>v.samples.map(s=>s.hashesSha256));if(new Set(traces).size!==1)throw new Error('cross-variant trace differs '+id);
   return {id,variants};
  },{id,root:'/@fs'+resolve(ROOT,'bgt')});
  report.fixtures.push(result);report.after=snapshot();writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(id+' '+result.variants.map(v=>v.mode+': '+v.bytes+' B / '+v.medianMs.toFixed(2)+' ms').join('; '));
 }
}finally{await browser?.close();server.kill();}
