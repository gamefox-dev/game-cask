import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, diffFraction } from './fixtures';
import { otherBackend } from './backend-page';
import { hardwarePixels } from './fixtures';
import { compareGpuImages } from '../support/gpu-image';
import type { Page } from '@playwright/test';

const probes = [
  { name:'indexed triangle/ordinary uniform/UBO', x:40,y:50, rgb:[128,138,131] },
  { name:'alpha mip quad', x:120,y:50, rgb:[42,54,61] },
  { name:'FBO texture sampling', x:200,y:50, rgb:[64,79,82] },
  { name:'indexed instances', x:280,y:50, rgb:[110,106,59] },
  { name:'array strip instances', x:40,y:150, rgb:[118,123,61] },
  { name:'base-vertex instances', x:120,y:150, rgb:[110,106,59] },
  { name:'stencil masked near green rejects farther red', x:180,y:150, rgb:[0,22,0] },
  { name:'stencil excludes right half', x:220,y:150, rgb:[13,26,38] },
];
// Regression for actual driver compilation, texture orientation, state, readback and update-only presentation.
for (const cross of [false, true])
  test(`x64-gl: ${cross ? 'cross-backend images agree @webgpu' : 'all seven real scenes have pixels'}`,
  async ({ page, backendParam, collector }, info) => {
    void collector;
    const capture = async (p: Page, backend: string) => {
      const status = await openGame(p,backend,{game:'x64-gl'});
      await assertBackend(p,backend,info);
      expect(status, JSON.stringify(await diagnostics(p))).toBe('ready');
      for (let i=0;i<100;i++) {
        await step(p,1); await p.waitForTimeout(10);
        if ((await diagnostics(p)).logs.some(l => l.message.includes('x64-gl PASS'))) break;
      }
      await step(p,3);
      const d = await diagnostics(p), m = d.metrics as Record<string,any>;
      expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
      expect(d.logs.some(l => l.message.includes('x64-gl PASS')),JSON.stringify(d.logs)).toBe(true);
      expect(d.logs.some(l => l.message.includes('readback=13,13'))).toBe(true);
      expect(d.logs.some(l => l.message.includes('colored=0,22,0')),JSON.stringify(d.logs)).toBe(true);
      expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]); expect(m.exited).toBe(0);
      expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]); expect(m.gl_pipelines).toBe(5);
      const px = await readPixels(p);
      if (hardwarePixels()) for (const probe of probes) {
        const x=Math.floor(d.letterbox.x+(probe.x+.5)*d.letterbox.w/320);
        const y=Math.floor(d.letterbox.y+(probe.y+.5)*d.letterbox.h/200), i=(y*px.width+x)*4;
        for (let c=0;c<3;c++) expect(Math.abs(px.data[i+c]-probe.rgb[c]),probe.name).toBeLessThanOrEqual(2);
      }
      if (hardwarePixels()) expect(diffFraction(px,await readPixels(p),0),'empty capture must retain the exact same image').toBe(0);
      await info.attach(`x64-gl-${backend}.png`,{body:await p.locator('canvas').screenshot(),contentType:'image/png'});
      return px;
    };
    const a=await capture(page,backendParam);
    if (!cross) return;
    const backend=backendParam==='webgpu'?'webgl2':'webgpu';
    const b=await otherBackend(backend,info,p=>capture(p,backend));
    const comparison=compareGpuImages(a,b); console.log('GL COMPARISON',comparison);
    expect(comparison.different).toBeLessThanOrEqual(0.015);
    expect(comparison.unmatched).toBeLessThanOrEqual(0.001);
  });
