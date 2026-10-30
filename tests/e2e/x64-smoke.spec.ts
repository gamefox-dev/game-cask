import { test, expect, openGame, assertBackend, step, diagnostics, input, readPixels, diffFraction } from './fixtures';
import { compareGpuImages } from '../support/gpu-image';
import { otherBackend } from './backend-page';
import type { Page } from '@playwright/test';

test('x64-smoke: 600 GL frames, worker/file/audio threads and XInput on both renderers',
  async ({ page, backendParam, collector }, info) => {
    void collector;
    const run = async (p: Page, backend: string) => {
      await openGame(p, backend, { game: 'x64-smoke' }); await assertBackend(p, backend, info);
      await p.locator('canvas').click(); await p.keyboard.press('Space');
      for (let i=0;i<100;i++) {
        await step(p,1); await p.waitForTimeout(10);
        if ((await diagnostics(p)).logs.some(l => l.message.includes('x64-gl PASS'))) break;
      }
      const images = [], hashes: string[] = [];
      const advance = async (n: number) => hashes.push(...await p.evaluate(async count => {
        const t=(window as any).__BGT_TEST__, out: string[]=[];
        for(let i=0;i<count;i++) { await t.step(1); out.push(t.stateHash()); } return out;
      },n));
      for (const held of [false,true,false]) {
        await input(p,[{type:'gamepad',index:0,connected:held,buttons:held?1:0,axes:[0,0,0,0],triggers:[0,0]}]);
        await advance(100); images.push(await readPixels(p));
      }
      expect(diffFraction(images[0],images[1],2)).toBeGreaterThan(0.1);
      expect(diffFraction(images[0],images[2],2)).toBe(0);
      await advance(310);
      const d = await diagnostics(p), m = d.metrics as Record<string, any>;

      expect(d.logs.some(l => /x64-smoke PASS frames=600 worker=8599ce32 files=2 pad=100 buttons=100 audio=joined/.test(l.message)),
        JSON.stringify(d.logs)).toBe(true);
      expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]); expect(m.gl_unimplemented).toBe(0);
      expect(m.gl_draws).toBe(6000); expect(m.exited).toBe(0);
      expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
      expect(d.audio.playedFrames).toBeGreaterThan(0);
      const end = await readPixels(p); expect(diffFraction(images[0],end,0)).toBe(0);
      return { images, end, hashes, result: d.logs.find(l => l.message.includes('x64-smoke PASS'))?.message };
    };
    const a = await run(page,backendParam), other = backendParam === 'webgpu' ? 'webgl2' : 'webgpu';
    const b = await otherBackend(other,info,p => run(p,other));
    expect(a.result).toBe(b.result);
    expect(a.hashes,'per-frame API oracle across real backends').toEqual(b.hashes);
    for (const [x,y] of [...a.images.map((x,i) => [x,b.images[i]]),[a.end,b.end]]) {
      const comparison = compareGpuImages(x,y); console.log('SMOKE COMPARISON',comparison);
      expect(comparison.different).toBeLessThanOrEqual(0.015);
      expect(comparison.unmatched).toBeLessThanOrEqual(0.001);
    }
  });
