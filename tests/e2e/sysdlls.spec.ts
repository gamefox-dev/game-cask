/* LANE-K1 */
import { test, expect, openGame, assertBackend, step, diagnostics, input, stateHash,
  readPixels, attachScreenshot, catches } from './fixtures';
import { hardwarePixels } from './fixtures';
test('system DLLs: real startup contracts and DirectInput input/pixel change', async ({page,backendParam,collector},info)=>{
  catches('missing offline DLLs, false-success contracts, COM snapshot or DirectInput/GDI disconnect');
  collector.allow(/guest:/);
  const logs:string[]=[];page.on('console',m=>logs.push(m.text()));
  expect(await openGame(page,backendParam,{game:'x64-sysdlls'})).toBe('ready');
  await assertBackend(page,backendParam,info);await step(page,4);
  expect(logs.some(s=>s.includes('sysdlls READY')),logs.join('\n')).toBe(true);
  expect(logs.some(s=>s.includes('sysdlls FAIL'))).toBe(false);
  const before=await stateHash(page), d=await diagnostics(page);
  const color=async()=>{
    const px=await readPixels(page),scale=d.letterbox.w/d.logical.width;
    const off=(Math.floor(d.letterbox.y+60*scale)*px.width+Math.floor(d.letterbox.x+60*scale))*4;
    return [...px.data.subarray(off,off+3)];
  };
  if(hardwarePixels())expect(await color()).toEqual([0,60,0]);
  await input(page,[{type:'key',code:'KeyK',down:true},{type:'pointer',x:100,y:90,buttons:1}]);
  await step(page,2);
  expect(await stateHash(page)).not.toBe(before);if(hardwarePixels())expect(await color()).toEqual([0,220,0]);
  expect(logs.some(s=>s.includes('key=128')&&s.includes('button=128'))).toBe(true);
  await attachScreenshot(page,info,'x64-sysdlls-held.png');
  await input(page,[{type:'key',code:'KeyK',down:false},{type:'pointer',x:107,y:86,buttons:0}]);
  await step(page,2);if(hardwarePixels())expect(await color()).toEqual([0,60,0]);
  expect(logs.some(s=>s.includes('key=0 mouse=7,-4 button=0'))).toBe(true);
  const after=await diagnostics(page);expect(after.errors).toEqual([]);expect(after.commandErrors.count).toBe(0);
  expect((after.metrics as any).interp_insns).toBe(0);expect((after.metrics as any).stubs).toEqual([]);
});
