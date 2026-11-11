// @bgt-examples: sample2d
import {createHash} from 'node:crypto';
import {test,expect,openGame,step,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';
const variants=['', 'NO_CLEAR', 'INITIAL_STENCIL', 'CONSTANT_STENCIL', 'CONSTANT_DEPTH', ...[1,2,3,4,5,6].map(n=>'PROVENANCE_MUTATION='+n)];
for(const suspension of ['asyncify','jspi'])for(const variant of variants)test('savestate bounded GPU provenance '+suspension+' variant='+variant,async({page,backendParam,collector},info)=>{
  void collector;
  const bytes=Buffer.from(await compileC('tests/fixtures/c/savestate-gpu.c',variant?[variant]:[]));
  await page.route('**/games/sample2d/manifest.json',async route=>{
    const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension=suspension;
    m.wasm={url:'compact.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};m.assets=[];
    await route.fulfill({response,json:m});
  });
  await page.route('**/games/sample2d/compact.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
  expect(await openGame(page,backendParam,{deterministic:'1',suspension})).toBe('ready');await assertBackend(page,backendParam,info);
  await step(page,6);
  if(variant==='NO_CLEAR'||variant.startsWith('PROVENANCE_MUTATION')) {
    const result=await page.evaluate(async()=>{const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;let error='';try{await t.snapshot();}catch(e){error=String(e);}await t.step(2);return {error,errors:t.diagnostics().errors,commandErrors:t.diagnostics().commandErrors.count};});
    expect(result.error).toMatch(/provenance/);expect(result.errors).toEqual([]);expect(result.commandErrors).toBe(0);return;
  }
  const result=await page.evaluate(async()=>{
    const fileBytes=async(s:ReadableStream<Uint8Array>)=>{const r=s.getReader();let n=0;for(;;){const p=await r.read();if(p.done)return n;n+=p.value.length;}};
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    const small=await t.snapshot();await t.step(300);
    const snap=await t.snapshot(),traces:{hash:string|null;pixels:string}[][]=[],restoreMs=[];
    const unaligned=(stream:ReadableStream<Uint8Array>)=>{
      let pending:Uint8Array|undefined;
      return stream.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
        transform(chunk,controller){
          if(pending){
            controller.enqueue(pending.subarray(0,1));
            const joined=new Uint8Array(pending.length-1+chunk.length);joined.set(pending.subarray(1));joined.set(chunk,pending.length-1);controller.enqueue(joined);pending=undefined;return;
          }
          if(chunk.length===24&&new DataView(chunk.buffer,chunk.byteOffset,24).getUint32(0,true)===3){pending=chunk;return;}
          controller.enqueue(chunk);
        },flush(controller){if(pending)controller.enqueue(pending);}
      }));
    };
    for(let run=0;run<3;run++){
      if(run){const start=performance.now();await t.restore(run===2?await t.importSnapshot(unaligned(t.exportSnapshot(snap))):snap);restoreMs.push(performance.now()-start);}
      const trace=[];
      for(let i=0;i<8;i++){await t.step(1);trace.push({hash:t.stateHash(),pixels:(await t.readPixels())!.base64});}
      traces.push(trace);
    }
    const after=await t.snapshot();
    const shadow=(s:typeof snap)=>s.gpuBase!.surfaces.textures.find(x=>x.handle===1);
    return {metadataStable:JSON.stringify(shadow(after))===JSON.stringify(shadow(snap)),stats:snap.stats,bytes:await fileBytes(t.exportSnapshot(snap)),smallBytes:await fileBytes(t.exportSnapshot(small)),restoreMs,
      equal:traces.slice(1).map(trace=>trace.every((x,i)=>x.hash===traces[0][i].hash&&x.pixels===traces[0][i].pixels)),
      changing:new Set(traces[0].map(x=>x.pixels)).size,errors:t.diagnostics().errors,commandErrors:t.diagnostics().commandErrors.count};
  });
  await info.attach('savestate-measurement.json',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.equal).toEqual([true,true]);expect(result.changing).toBeGreaterThan(1);expect(result.metadataStable).toBe(true);
  expect(result.stats.residualUpdates).toBeLessThanOrEqual(2);expect(result.stats.residualCommands).toBeLessThanOrEqual(100000);
  expect(result.bytes).toBeLessThan(result.smallBytes*2);expect(result.errors).toEqual([]);expect(result.commandErrors).toBe(0);
});
