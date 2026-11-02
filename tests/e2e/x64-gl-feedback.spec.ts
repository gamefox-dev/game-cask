import {test,expect,openGame,assertBackend,step,diagnostics,readPixels} from './fixtures';
import {otherBackend} from './backend-page';
import {compareGpuImages} from '../support/gpu-image';
import type {Page,TestInfo} from '@playwright/test';
async function capture(page:Page,backend:string,info:TestInfo){
  expect(await openGame(page,backend,{game:'x64-gl-feedback'})).toBe('ready');await assertBackend(page,backend,info);
  const logs=new Set<string>();
  for(let i=0;i<180;i++){await step(page,1);(await diagnostics(page)).logs.forEach(l=>logs.add(l.message));if([...logs].some(s=>s.includes('x64-gl-feedback PASS')))break;}
  const d=await diagnostics(page),text=[...logs].join('\n');
  expect(text).toContain('x64-gl-feedback PASS failures=0 checks=100');expect(text).not.toContain('x64-gl-feedback FAIL');
  expect(d.commandErrors.count).toBe(0);expect(d.errors).toEqual([]);expect((d.metrics as Record<string,number>).gl_unimplemented).toBe(0);
  const image=await readPixels(page);
  for(const [x,y,rgb] of [[160,100,[255,0,0]],[8,8,[0,0,0]]] as [number,number,number[]][]){
    const px=Math.floor(d.letterbox.x+(x+.5)*d.letterbox.w/320),py=Math.floor(d.letterbox.y+(y+.5)*d.letterbox.h/200);
    expect([...image.data.slice((py*image.width+px)*4,(py*image.width+px)*4+3)]).toEqual(rgb);
  }
  await page.screenshot({path:info.outputPath(`feedback-${backend}.png`)});
  return image;
}
test('x64-gl-feedback: exact captured bytes, GL errors, queries and draw from GPU output',async({page,backendParam,collector},info)=>{void collector;await capture(page,backendParam,info);});
test('x64-gl-feedback: cross-backend pixels @webgpu',async({page,backendParam,collector},info)=>{
  void collector;const a=await capture(page,backendParam,info),other=backendParam==='webgpu'?'webgl2':'webgpu';
  const b=await otherBackend(other,info,p=>capture(p,other,info)),result=compareGpuImages(a,b);
  expect(result.different).toBe(0);expect(result.unmatched).toBe(0);
});
