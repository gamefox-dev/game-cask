// @bgt-examples: sample2d
// vK42 P1: an expected, consumed shader failure is state, not a restore exception.
import {createHash} from 'node:crypto';
import {test,expect,openGame,step,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';
for(const suspension of ['asyncify','jspi'])test('savestate preserves live and deleted failed shaders '+suspension,async({page,backendParam,collector},info)=>{
  void collector;
  const bytes=Buffer.from(await compileC('tests/fixtures/c/savestate-bad-shader.c'));
  await page.route('**/games/sample2d/manifest.json',async route=>{
    const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension=suspension;
    m.wasm={url:'bad.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};m.assets=[];
    await route.fulfill({response,json:m});
  });
  await page.route('**/games/sample2d/bad.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
  expect(await openGame(page,backendParam,{deterministic:'1',suspension})).toBe('ready');await assertBackend(page,backendParam,info);
  await step(page,3);
  const result=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    const live=await t.snapshot(),traces: (string|null)[][][]=[];
    for(let run=0;run<3;run++){
      if(run)await t.restore(run===2?t.importSnapshot(t.exportSnapshot(live)):live);
      const trace=[];
      for(let i=0;i<7;i++){await t.step(1);trace.push([t.stateHash(),(await t.readPixels())!.base64]);}
      traces.push(trace);
    }
    const deleted=await t.snapshot();await t.restore(deleted);
    return {same:traces.slice(1).map(x=>JSON.stringify(x)===JSON.stringify(traces[0])),
      deletedShaders:deleted.gpuBase?.frame.items.filter(x=>x.kind==='gpu' && x.op===0x48).length,
      errors:t.diagnostics().errors};
  });
  expect(result.same).toEqual([true,true]);expect(result.deletedShaders).toBe(0);expect(result.errors).toEqual([]);
});
