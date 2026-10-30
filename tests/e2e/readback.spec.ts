import { test, expect, openGame, assertBackend, step, stateHash, diagnostics, readPixels } from './fixtures';

test('ABI v0.3: batched target/screen readbacks retain command order and complete after yield', async ({page,backendParam},info)=>{
  expect(await openGame(page,backendParam,{game:'gpu-readback'})).toBe('ready');
  await assertBackend(page,backendParam,info);
  for(let i=0;i<10 && await stateHash(page)!=='0000001f';i++) await step(page,1);
  expect(await stateHash(page)).toBe('0000001f');
  const d=await diagnostics(page); expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
  const p=await readPixels(page), x=Math.floor(d.letterbox.x+d.letterbox.w/2),y=Math.floor(d.letterbox.y+d.letterbox.h/2);
  expect([...p.data.subarray((y*p.width+x)*4,(y*p.width+x)*4+3)]).toEqual([30,220,80]);
});
