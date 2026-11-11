// @bgt-examples: sample2d
// CC0 scale fixture: real native GPU resources plus >1 GiB nonzero-page wasm memory.
import {createHash} from 'node:crypto';
import {test,expect,openGame,step,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';
test('savestate real 400 MiB GPU and 1 GiB memory scale',async({page,backendParam,collector},info)=>{
 void collector;test.setTimeout(240000);
 const bytes=Buffer.from(await compileC('tests/fixtures/c/savestate-scale.c'));
 await page.route('**/games/sample2d/manifest.json',async route=>{
  const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension='asyncify';
  m.wasm={url:'scale.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};m.assets=[];m.gpu={budgetBytes:512*1024*1024};
  await route.fulfill({response,json:m});
 });
 await page.route('**/games/sample2d/scale.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
 expect(await openGame(page,backendParam,{deterministic:'1',suspension:'asyncify'})).toBe('ready');await assertBackend(page,backendParam,info);
 await step(page,101);
 const result=await page.evaluate(async()=>{
  const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
  const started=performance.now(),snap=await t.snapshot(),snapshotMs=performance.now()-started;
  const digest=async(s:typeof snap)=>{
   const blobs=s.gpuBase!.frame.items.filter(x=>x.kind==='gpu'&&x.data instanceof Uint8Array).map(x=>x.data as Uint8Array<ArrayBuffer>);
   const hashes=[];for(const b of blobs)hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).join(','));return hashes;
  };
  const memory=snap.host.wasm.memory;
  // Predicted native suffix: only three little-endian words change in these buffers.
  const expected=structuredClone(snap.gpuBase!.frame.items.filter(x=>x.kind==='gpu'&&x.data instanceof Uint8Array));
  for(let tick=102;tick<=104;tick++){const item=expected.find(x=>(x.words as number[])[0]===tick%100+1)!;const b=item.data as Uint8Array;new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32((tick*4096)%(4*1024*1024-4),Math.imul(tick,0x1234567),true);}
  const hashes=[];for(const x of expected)hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',x.data as Uint8Array<ArrayBuffer>))).join(','));
  let fileBytes=0;const start=performance.now(),reader=t.exportSnapshot(snap).getReader();
  for(;;){const p=await reader.read();if(p.done)break;if(p.value.length>1024*1024)throw new Error('Oversized export chunk');fileBytes+=p.value.length;}
  const exportMs=performance.now()-start;
  const trace=[];for(let i=0;i<3;i++){await t.step(1);trace.push({hash:t.stateHash(),pixels:(await t.readPixels())!.base64});}
  const restoring=performance.now();await t.restore(snap);const restoreMs=performance.now()-restoring;
  const replay=[];for(let i=0;i<3;i++){await t.step(1);replay.push({hash:t.stateHash(),pixels:(await t.readPixels())!.base64});}
  const again=await t.snapshot();
  return {snapshotMs,restoreMs,exportMs,fileBytes,stats:snap.stats,memoryBytes:memory.byteLength,pages:memory.pages.size,
   equal:JSON.stringify(trace)===JSON.stringify(replay),nativeEqual:JSON.stringify(hashes)===JSON.stringify(await digest(again)),
   errors:t.diagnostics().errors,commands:t.diagnostics().commandErrors.count};
 });
 await info.attach('scale-measurement.json',{body:JSON.stringify(result),contentType:'application/json'});
 expect(result.stats.nativeBytes).toBeGreaterThanOrEqual(400*1024*1024);expect(result.memoryBytes).toBeGreaterThan(1024**3);
 expect(result.pages).toBeGreaterThanOrEqual(16384);expect(result.fileBytes).toBeGreaterThan(1024**3);
 expect(result.equal).toBe(true);expect(result.nativeEqual).toBe(true);expect(result.errors).toEqual([]);expect(result.commands).toBe(0);
});
