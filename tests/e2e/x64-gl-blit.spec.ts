import { test, expect } from './fixtures';
import { openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';
import { otherBackend } from './backend-page';
import { compareGpuImages } from '../support/gpu-image';
import type { Page, TestInfo } from '@playwright/test';

async function capture(page: Page, backendParam: string, info: TestInfo) {
  expect(await openGame(page, backendParam, { game: 'x64-gl-blit' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  const logs = new Set<string>();
  for (let i=0;i<120;i++) { await step(page,1); (await diagnostics(page)).logs.forEach(l=>logs.add(l.message));
    if ([...logs].some(x=>x.includes('x64-gl-blit PASS'))) break; }
  const d=await diagnostics(page), text=[...logs].join('\n');
  expect(text).toContain('x64-gl-blit PASS failures=0 checks=46');
  expect(text).not.toMatch(/x64-gl-blit FAIL/);
  expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
  expect((d.metrics as Record<string,number>).gl_unimplemented).toBe(0);
  const pixels=await readPixels(page);
  for(const [x,y,rgb] of [[40,150,[255,0,0]],[280,150,[0,255,0]],[40,25,[0,0,255]],[280,25,[255,255,255]]] as [number,number,number[]][]) {
    const px=Math.floor(d.letterbox.x+(x+.5)*d.letterbox.w/320), py=Math.floor(d.letterbox.y+(y+.5)*d.letterbox.h/200);
    expect([...pixels.data.slice((py*pixels.width+px)*4,(py*pixels.width+px)*4+3)]).toEqual(rgb);
  }
  return pixels;
}

test('x64-gl-blit: scaled/flipped/masked/default/depth/stencil transfers', async ({ page, backendParam, collector }, info) => {
  void collector; await capture(page, backendParam, info);
});
test('x64-gl-blit: cross-backend exact image @webgpu', async ({ page, backendParam, collector }, info) => {
  void collector;
  const a=await capture(page,backendParam,info), other=backendParam==='webgpu'?'webgl2':'webgpu';
  const b=await otherBackend(other,info,p=>capture(p,other,info)), comparison=compareGpuImages(a,b);
  console.log('K9b blit comparison',comparison);expect(comparison.different).toBe(0);expect(comparison.unmatched).toBe(0);
});
