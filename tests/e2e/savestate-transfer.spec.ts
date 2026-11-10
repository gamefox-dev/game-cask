// @bgt-examples: sample2d
import {test,expect,openGame,assertBackend,diagnostics,step} from './fixtures';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';
// A timing variant selected from Asyncify checkpoint branches becomes a complete from-boot JSPI route.
test('savestate route search transfers to a deterministic JSPI from-boot replay',async({page,backendParam,collector},info)=>{
  void collector;
  expect(await openGame(page,backendParam,{deterministic:'1',suspension:'asyncify'})).toBe('ready');
  await assertBackend(page,backendParam,info);
  await step(page,2);
  const found=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    const snap=await t.snapshot(); const variants=[];
    for(const delay of [0,2,4]) {
      await t.restore(snap);const trace=[];
      for(let i=0;i<10;i++) {
        t.input([{type:'key',code:'Enter',down:i===0},{type:'key',code:'ArrowRight',down:i>=delay}]);
        await t.step(1);trace.push({hash:t.stateHash(),pixels:(await t.readPixels())!.base64});
      }
      const state=t.debugState() as {player:{x:number}};
      variants.push({delay,score:state.player.x,trace});
    }
    variants.sort((a,b)=>b.score-a.score);
    if(variants[0].score===variants[2].score)throw new Error('Search variants did not affect position');
    return variants[0];
  });
  expect(await openGame(page,backendParam,{deterministic:'1',suspension:'jspi'})).toBe('ready');
  expect((await diagnostics(page)).suspension).toBe('jspi');
  await step(page,2);
  const replay=await page.evaluate(async(delay)=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__,trace=[];
    for(let i=0;i<10;i++) {
      t.input([{type:'key',code:'Enter',down:i===0},{type:'key',code:'ArrowRight',down:i>=delay}]);
      await t.step(1);trace.push({hash:t.stateHash(),pixels:(await t.readPixels())!.base64});
    }
    return trace;
  },found.delay);
  expect(replay).toEqual(found.trace);
});
