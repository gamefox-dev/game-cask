// @bgt-examples: sample2d
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test,expect,openGame,step,diagnostics,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';

for(const suspension of ['asyncify','jspi']) for(const suspended of [false,true]) test('savestate services: '+suspension+' suspended='+suspended+' preserves entropy, clock, audio, storage, file positions and memory growth',async({page,backendParam,collector},info)=>{
  void collector;
  let bytes=Buffer.from(await compileC('tests/fixtures/c/savestate-game.c',suspended?['SUSPENDING']:[]));
  if(suspended && suspension==='asyncify') {
    const dir=mkdtempSync(join(tmpdir(),'bgt-savestate-yield-'));
    try {
      writeFileSync(join(dir,'in.wasm'),bytes);
      execFileSync(process.execPath,['node_modules/binaryen/bin/wasm-opt',join(dir,'in.wasm'),'--enable-bulk-memory','--enable-bulk-memory-opt','--enable-nontrapping-float-to-int','--enable-sign-ext','--enable-mutable-globals','-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield','-o',join(dir,'out.wasm')]);
      bytes=readFileSync(join(dir,'out.wasm'));
    } finally {rmSync(dir,{recursive:true,force:true});}
  }
  const asset=Buffer.from(Array.from({length:64},(_,i)=>(i*13)&255));
  await page.route('**/games/sample2d/manifest.json',async route=>{
    const response=await route.fetch(),m=await response.json();delete m.variants;
    m.wasm={url:'state.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    if(suspension==='jspi') m.suspension='jspi';
    m.assets=[{path:'state.bin',url:'state.bin',size:asset.length,sha256:createHash('sha256').update(asset).digest('hex')}];
    await route.fulfill({response,json:m});
  });
  await page.route('**/games/sample2d/state.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
  await page.route('**/games/sample2d/state.bin',r=>r.fulfill({body:asset}));
  expect(await openGame(page,backendParam,{deterministic:'1',suspension})).toBe('ready');
  await assertBackend(page,backendParam,info);expect((await diagnostics(page)).suspension).toBe(suspension);
  await step(page,3);
  expect((await diagnostics(page)).suspended).toBe(suspended);
  if(suspended && suspension==='jspi') {
    expect(await page.evaluate(async()=>{try{await (window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__.snapshot();return '';}catch(e){return String(e);}})).toContain('suspended JSPI');
    await step(page,12);expect((await diagnostics(page)).errors).toEqual([]);return;
  }
  const result=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    t.input([{type:'key',code:'KeyZ',down:true},{type:'pointer',x:2,y:3,buttons:2}]);
    const snap=await t.snapshot(),before=t.diagnostics().wasmMemoryBytes;
    const traces: {hash:string|null;pixels:string}[][]=[];
    for(let run=0;run<3;run++) {
      if(run) await t.restore(run===2?await t.importSnapshot(t.exportSnapshot(snap)):snap);
      if(t.diagnostics().wasmMemoryBytes!==before) throw new Error('Restored memory did not shrink');
      const trace=[];
      for(let i=0;i<12;i++) {
        if(i===1)t.input([{type:'key',code:'KeyZ',down:false}]);
        await t.step(1);const px=await t.readPixels();trace.push({hash:t.stateHash(),pixels:px!.base64});
      }
      traces.push(trace);
    }
    return {equal:traces.slice(1).map(xs=>xs.every((x,i)=>x.hash===traces[0][i].hash && x.pixels===traces[0][i].pixels)),
      changing:new Set(traces[0].map(x=>x.hash)).size,grew:t.diagnostics().wasmMemoryBytes>before,errors:t.diagnostics().errors};
  });
  expect(result.equal).toEqual([true,true]);expect(result.changing).toBe(12);expect(result.grew).toBe(true);expect(result.errors).toEqual([]);
});
