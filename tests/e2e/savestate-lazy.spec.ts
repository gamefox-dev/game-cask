// @bgt-examples: sample2d
// SPDX-License-Identifier: CC0-1.0
import {createHash} from 'node:crypto';
import {test,expect,openGame,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';

test('savestate rejection does not materialize lazy textures; a valid checkpoint restores deferred clear values',async({page,backendParam,collector},info)=>{
  void collector;
  const bytes=Buffer.from(await compileC('tests/fixtures/c/savestate-lazy.c'));
  await page.route('**/games/sample2d/manifest.json',async route=>{
    const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension='asyncify';
    m.wasm={url:'lazy.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};m.assets=[];
    await route.fulfill({response,json:m});
  });
  await page.route('**/games/sample2d/lazy.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
  expect(await openGame(page,backendParam,{deterministic:'1',suspension:'asyncify'})).toBe('ready');
  await assertBackend(page,backendParam,info);
  const result=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    const lazy=()=>t.memory()?.gpu?.native?.textures.lazy?.count;
    await t.step(1);
    const before=lazy();let rejection='';
    try{await t.snapshot();}catch(e){rejection=String(e);}
    const after=lazy();
    await t.step(1);
    const s=await t.snapshot(), afterCapture=lazy();
    const read=async()=>{for(let i=0;i<10&&t.stateHash()==='00000000';i++)await t.step(1);return [t.stateHash(), lazy()];};
    const original=await read();
    await t.restore(await t.importSnapshot(t.exportSnapshot(s)));
    const restored=lazy(), replay=await read();
    return {before,rejection,after,afterCapture,original,restored,replay,errors:t.diagnostics().errors,commands:t.diagnostics().commandErrors.count};
  });
  expect([result.before,result.after,result.afterCapture,result.restored], JSON.stringify(result)).toEqual([1,1,1,1]);
  expect(result.rejection).toMatch(/non-finite GPU texture checkpoint/);
  expect(result.original).toEqual(['ff0000ff',0]);
  expect(result.replay).toEqual(result.original);
  expect(result.errors).toEqual([]);expect(result.commands).toBe(0);
});
