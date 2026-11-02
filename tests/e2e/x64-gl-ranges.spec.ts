import {test,expect,openGame,assertBackend,step,diagnostics,readPixels} from './fixtures';
import {otherBackend} from './backend-page';
import {compareGpuImages} from '../support/gpu-image';
import type {Page,TestInfo} from '@playwright/test';
async function capture(page:Page,backend:string,info:TestInfo){
  expect(await openGame(page,backend,{game:'x64-gl-ranges'})).toBe('ready');await assertBackend(page,backend,info);
  const logs=new Set<string>();let peak=0,commands=0;
  for(let i=0;i<180;i++){
    await step(page,1);const d=await diagnostics(page);d.logs.forEach(l=>logs.add(l.message));
    peak=Math.max(peak,d.lastFrame.continuationSubmits);commands=Math.max(commands,d.lastFrame.commandCount);
    expect(d.lastFrame.continuationByteLimit).toBe(67108864);expect(d.lastFrame.continuationCommandLimit).toBe(1048576);
    if([...logs].some(s=>s.includes('x64-gl-ranges PASS')))break;
  }
  const d=await diagnostics(page),text=[...logs].join('\n');
  console.info(backend,[...logs].find(s=>s.includes('x64-gl-ranges PASS')),`peak lists=${peak}, commands=${commands}`);
  expect(text).toMatch(/x64-gl-ranges PASS failures=0 checks=\d+/);expect(text).not.toContain('x64-gl-ranges FAIL');
  expect(text).toMatch(/GL undefined uniform block range zero-filled: program=\d+ block=0 name=Data binding=5 buffer=\d+ offset=0 size=80 required=192/);
  expect(peak).toBeGreaterThan(6000);expect(commands).toBeGreaterThan(30000);
  expect((d.metrics as Record<string,number>).gl_approximations).toBe(4);
  expect(d.commandErrors.count).toBe(0);expect(d.errors).toEqual([]);expect((d.metrics as Record<string,number>).gl_unimplemented).toBe(0);
  const image=await readPixels(page),x=Math.floor(d.letterbox.x+160*d.letterbox.w/320),y=Math.floor(d.letterbox.y+100*d.letterbox.h/200);
  expect([...image.data.slice((y*image.width+x)*4,(y*image.width+x)*4+3)]).toEqual([0,255,0]);
  const auditHash=/x64-gl-ranges audit_hash=([0-9a-f]{8})/.exec(text)?.[1];expect(auditHash).toBe('2a92a441');
  await page.screenshot({path:info.outputPath(`ranges-${backend}.png`)});return {image,auditHash};
}
test('GL sparse MRT, per-program std140 ranges, and 3000 ordered feedback draws',async({page,backendParam,collector},info)=>{void collector;await capture(page,backendParam,info);});
test('GL range and continuation cross-backend exact finish @webgpu',async({page,backendParam,collector},info)=>{
  void collector;const a=await capture(page,backendParam,info),other=backendParam==='webgpu'?'webgl2':'webgpu';
  const b=await otherBackend(other,info,p=>capture(p,other,info)),result=compareGpuImages(a.image,b.image);
  expect(a.auditHash).toBe(b.auditHash);
  expect(result.different).toBe(0);expect(result.unmatched).toBe(0);
});
