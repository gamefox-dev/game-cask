// @bgt-examples: sample2d
// CC0 synthetic GL-heavy recording cost; no timing assertion tied to one machine.
import {createHash} from 'node:crypto';
import {test,expect,openGame,step,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';
test('savestate GL-heavy per-update profile',async({page,backendParam,collector},info)=>{
  void collector;test.setTimeout(240000);
  const bytes=Buffer.from(await compileC('tests/fixtures/c/savestate-gpu.c',['STRESS_DRAWS=64']));
  await page.route('**/games/sample2d/manifest.json',async route=>{
    const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension='asyncify';
    m.wasm={url:'profile.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};m.assets=[];
    await route.fulfill({response,json:m});
  });
  await page.route('**/games/sample2d/profile.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
  const measurements=[];let growth=null;
  for(const deterministic of ['0','1','0','1']) {
    expect(await openGame(page,backendParam,{deterministic,suspension:'asyncify'})).toBe('ready');await assertBackend(page,backendParam,info);
    await step(page,6);
    measurements.push(await page.evaluate(async(deterministic)=>{
      const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__,start=performance.now();
      await t.step(240);return {deterministic,ms:performance.now()-start,errors:t.diagnostics().errors,commands:t.diagnostics().commandErrors.count};
    },deterministic));
  }
  growth=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__,before=t.journalStats();await t.step(1000);const after=t.journalStats(),hash=t.stateHash();
    const start=performance.now();await t.compactJournal();return {before,after,compacted:t.journalStats(),compactionMs:performance.now()-start,hashUnchanged:hash===t.stateHash(),
      bytesPer1000:after.bytes-before.bytes,projected25000:(after.bytes-before.bytes)*25};
  });
  expect(growth.hashUnchanged).toBe(true);expect(growth.compacted.bytes).toBeLessThan(growth.after.bytes);
  await info.attach('journal-growth.json',{body:JSON.stringify(growth),contentType:'application/json'});
  await info.attach('journal-profile.json',{body:JSON.stringify(measurements),contentType:'application/json'});
  for(const m of measurements){expect(m.errors).toEqual([]);expect(m.commands).toBe(0);}
});
