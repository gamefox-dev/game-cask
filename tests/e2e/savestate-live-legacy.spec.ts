// @bgt-examples: sample2d
// SPDX-License-Identifier: CC0-1.0
import {createHash} from 'node:crypto';
import {test,expect,openGame,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';
import type {Page} from '@playwright/test';

async function useFixture(page:Page,name:string) {
  const suspension=process.env.BGT_E2E_SUSPENSION==='jspi'?'jspi':'asyncify';
  const bytes=Buffer.from(await compileC(`tests/fixtures/c/${name}.c`));
  await page.route('**/games/sample2d/manifest.json',async route=>{
    const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension=suspension;
    m.wasm={url:'live-legacy.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};m.assets=[];
    await route.fulfill({response,json:m});
  });
  await page.route('**/games/sample2d/live-legacy.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
  return suspension;
}

test('live savestate recovery restores static and GPU-written legacy pixels',async({page,backendParam,collector},info)=>{
  void collector;
  const suspension=await useFixture(page,'savestate-live-legacy');
  expect(await openGame(page,backendParam,{deterministic:'1',suspension})).toBe('ready');
  await assertBackend(page,backendParam,info);
  const result=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    await t.step(260);
    const blocked=t.journalStats();
    await t.step(4); // delete just the unreadable texture, leaving both legacy names live
    const recovered=t.journalStats();
    if(recovered.error)return {blocked,recovered};
    const snap=await t.snapshot();
    const expected=(await t.readPixels())!.base64;
    await t.step(1);
    await t.restore(await t.importSnapshot(t.exportSnapshot(snap)));
    const restored=(await t.readPixels())!.base64;
    const updates=snap.gpuBase!.frame.items.filter(i=>i.kind==='texUpdate').map(i=>[i.handle,[...(i.data as Uint8Array)]]);
    return {blocked,recovered,updates,pixelsMatch:restored===expected,hash:t.stateHash(),
      errors:t.diagnostics().errors,commandErrors:t.diagnostics().commandErrors.count};
  });
  expect(result.blocked).toMatchObject({frames:0,error:expect.stringMatching(/bounded history.*non-finite/)});
  expect(result.recovered).toMatchObject({error:null,compactions:1});
  expect(result.updates).toEqual([[1,[0,0,255,255]],[2,[255,0,0,255,255,0,0,255,0,255,0,255,0,255,0,255]]]);
  expect(result.pixelsMatch).toBe(true);expect(result.hash).toBe('00000108');
  expect(result.errors).toEqual([]);expect(result.commandErrors).toBe(0);
});

test('legacy-only live cuts save pixels after the browser presents the canvas',async({page,backendParam,collector},info)=>{
  void collector;
  const suspension=await useFixture(page,'savestate-legacy-presentation');
  expect(await openGame(page,backendParam,{deterministic:'1',suspension})).toBe('ready');
  await assertBackend(page,backendParam,info);
  const result=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    const presented=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const sample=async()=>{
      const {surfaces:{physical:{width,data},letterbox:lb,retained}}=(await t.snapshot()).gpuBase!;
      const at=(x:number,y:number)=>{
        const i=(Math.floor(lb.y+y*lb.h)*width+Math.floor(lb.x+x*lb.w))*4;
        return [...data.subarray(i,i+4)];
      };
      return {left:at(.25,.5),right:at(.75,.5),retained};
    };
    await t.step(1);
    await presented(); // cross the presentation boundary; don't rerender via readPixels()
    const blue=await sample();
    await t.step(1);
    await presented();
    return {blue,replaced:await sample(),errors:t.diagnostics().errors,commands:t.diagnostics().commandErrors.count};
  });
  expect(result.blue).toMatchObject({left:[0,0,255,255],right:[0,0,255,255]});
  // The checkpoint copy must not feed legacy drawing: only the red half was drawn.
  expect(result.replaced).toMatchObject({left:[255,0,0,255],right:[0,0,0,255],retained:false});
  expect(result.errors).toEqual([]);expect(result.commands).toBe(0);
});
