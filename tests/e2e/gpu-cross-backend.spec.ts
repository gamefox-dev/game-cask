import { test, expect, openGame, assertBackend, step, diagnostics, debugState, readPixels } from './fixtures';
import { compareGpuImages } from '../support/gpu-image';
import { otherBackend } from './backend-page';
import type { Page } from '@playwright/test';

// One common GLSL330/ES300 scene stream, with the original native-WGSL/lifetime cases retained as arg1=2/3.
// RGB delta <=2, <=1.5% displaced raster/filter pixels; symmetric one-device-pixel match required.
for (const scene of [0,1,2,3,4,5,6,7,8,9]) test(`GPU shared scene ${scene}: cross-backend pixels`,
  async ({ page, backendParam, collector }, info) => {
    void collector;
    const capture = async (target: Page, backend: string) => {
      await target.setViewportSize({width:160,height:128});
      await openGame(target, backend, { game: 'gpu-scenes', arg0: String(scene) });
      await assertBackend(target, backend, info);
      for (let i=0; i<40; i++) {
        await step(target, 1); await target.waitForTimeout(10);
        if ((await debugState(target)).read) break;
      }
      const s = await debugState(target), d = await diagnostics(target);
      expect(s.phase, JSON.stringify({s,d})).toBe(1); expect(s.compiled).toBe(12); expect(s.read).toBe(1);
      expect(s.error).toBe(0); expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
      // Pin animation by guest frame, not asynchronous driver-compilation wall time.
      if (scene === 5) await step(target, 30-s.frame);
      return readPixels(target);
    };
    const a = await capture(page, backendParam), backend = backendParam === 'webgpu' ? 'webgl2' : 'webgpu';
    const b = await otherBackend(backend, info, p => capture(p, backend));
    const comparison = compareGpuImages(a,b); console.log('COMPARISON',scene,comparison);
    expect(comparison.different).toBeLessThanOrEqual(0.015);
    expect(comparison.unmatched).toBeLessThanOrEqual(0.001);
  });
