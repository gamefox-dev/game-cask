#!/usr/bin/env node
// Cold-process browser measurement, no network outside the owned loopback Vite server.
// node tools/build/measure-browser.mjs REPORT.json [ID[:buffered] ...]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { ROOT } from './toolchain.mjs';
import { join } from 'node:path';
const port=Number(process.env.BGT_E2E_PORT);
if(!port || port===5173)throw new Error('set a dedicated BGT_E2E_PORT');
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(ROOT,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:ROOT,stdio:['ignore','ignore','inherit']});
try {
  for(let n=0;;n++) {
    if(server.exitCode!==null)throw new Error('test server failed to bind');
    try {if((await fetch(base+'/games/index.json')).ok)break;}catch{}
    if(n>200)throw new Error('server readiness timeout');await new Promise((r)=>setTimeout(r,50));
  }
  const results={};
  for(const item of process.argv.slice(3)) {
    const [id,mode]=item.split(':'),samples=[];
    for(let sample=0;sample<3;sample++) {
      const launch=()=>chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-webgpu']});
      let browser=await launch();
      let page=await browser.newPage();await page.goto(base+'/');
      const compile=await page.evaluate(async(id)=>{
        const path=`/games/${id}/`,manifest=await(await fetch(path+'manifest.json')).json();
        const bytes=await(await fetch(path+manifest.wasm.url)).arrayBuffer();
        const t=performance.now(),module=await WebAssembly.compile(bytes),compile_ms=performance.now()-t;
        const bgt={};for(const imp of WebAssembly.Module.imports(module))bgt[imp.name]=()=>{throw new Error('unexpected import during instantiation');};
        const start=performance.now();await WebAssembly.instantiate(module,{bgt});
        return {compile_ms,instantiate_ms:performance.now()-start,bytes:bytes.byteLength};
      },id);
      await browser.close();browser=await launch();page=await browser.newPage();
      try {
        if(mode==='buffered')await page.route('**/game.wasm?*',async(route)=>{
          const res=await route.fetch();await route.fulfill({response:res,headers:{...res.headers(),'content-type':'application/octet-stream'}});
        });
        await page.goto(base+`/?game=${id}&backend=webgl2&paused=1&ephemeral=1`);
        await page.waitForFunction(()=>window.__BGT_TEST__?.ready() || window.__BGT_TEST__?.failed());
        const runtime=await page.evaluate(async()=>{
          const t=window.__BGT_TEST__;if(t.failed())throw new Error(JSON.stringify(t.diagnostics()));
          await t.step(1);const d=t.diagnostics(),coverage=t.coverage();
          await t.step(299);const final=t.diagnostics();
          if(final.errors.length || final.metrics.interp_insns || !final.logs.some((l)=>l.message.includes('scale checksum 31c9ceb2 functions 12000')))throw new Error(JSON.stringify(final));
          return {timing:d.timing,performance:coverage.metrics,frames:final.frame,checksum:true};
        });
        samples.push({...compile,runtime});
      } finally {await browser.close();}
    }
    results[item]=samples;
  }
  writeFileSync(process.argv[2],JSON.stringify({schema:'game-cask/browser-scale/1',samples:results,
    method:'three fresh Chromium processes per raw compile and per runtime sample; loopback WebGL2 SwiftShader; byte compile excludes fetch; runtime includes assets/SHA verification; buffered uses MIME fallback on same runtime, not an old-runtime checkout'},null,2)+'\n');
} finally {server.kill();}
