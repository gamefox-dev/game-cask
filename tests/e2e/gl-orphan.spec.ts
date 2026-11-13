// SPDX-License-Identifier: CC0-1.0. Original fixture, never game assets.
import {test,expect,openGame,step,diagnostics,readPixels} from './fixtures';
const counter=(d:Awaited<ReturnType<typeof diagnostics>>,key:string)=>(d.metrics as Record<string,number>)[key];
for(const debug of ['0','1'])test('GL BufferData equal-size reuse, exact varying sizes and explicit query policy debug='+debug,async({page,backendParam})=>{
  expect(await openGame(page,backendParam,{game:'x64-gl-orphan',debug})).toBe('ready');
  for(let i=0;i<100;i++){
    await step(page,1);if((await diagnostics(page)).lastFrame.drawCalls===40)break;
    await page.waitForTimeout(10);
  }
  await step(page,2);
  const before=await diagnostics(page);await step(page,1);const same=await diagnostics(page);
  expect(counter(same,'gl_buffer_respec_reused')-counter(before,'gl_buffer_respec_reused')).toBe(80);
  expect(same.lastFrame.submits).toBe(163);expect(same.commandErrors.count).toBe(0);expect(same.errors).toEqual([]);
  expect(same.nativeQueryPolicy).toBe(backendParam==='webgl2'?(debug==='1'?'strict':'production'):null);
  if(backendParam==='webgl2'){
    expect(same.lastFrame.nativeSyncQueries?.checkFramebufferStatus).toBe(debug==='1'?40:0);
    if(debug==='0')expect(same.lastFrame.nativeSyncQueries?.getError).toBe(1);
    else expect(same.lastFrame.nativeSyncQueries?.getError).toBeGreaterThan(500);
  }
  await page.evaluate(()=>(window as any).__BGT_TEST__.input([{type:'key',code:'F9',down:true}]));
  await step(page,2);const varyingBefore=await diagnostics(page);await step(page,1);const varying=await diagnostics(page);
  expect(counter(varying,'gl_buffer_respec_resized')-counter(varyingBefore,'gl_buffer_respec_resized')).toBe(80);
  expect(counter(varying,'gl_buffer_respec_grew')-counter(varyingBefore,'gl_buffer_respec_grew')).toBe(40);
  expect(counter(varying,'gl_buffer_respec_shrank')-counter(varyingBefore,'gl_buffer_respec_shrank')).toBe(40);
  expect(counter(varying,'gl_buffer_respec_reused')-counter(varyingBefore,'gl_buffer_respec_reused')).toBe(0);
  expect(varying.lastFrame.submits).toBe(243);expect(varying.commandErrors.count).toBe(0);expect(varying.errors).toEqual([]);
  const pixels=await readPixels(page),b=varying.letterbox;
  const at=(Math.floor(b.y+b.h/2)*pixels.width+Math.floor(b.x+b.w/2))*4;
  expect([...pixels.data.slice(at,at+4)]).toEqual([255,0,0,255]);
});
