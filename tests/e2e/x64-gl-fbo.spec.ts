import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, hardwarePixels } from './fixtures';
import { otherBackend } from './backend-page';
import { compareGpuImages } from '../support/gpu-image';
import type { Page } from '@playwright/test';

// Tile (col,row) is 80x100 in the 320x200 logical screen; probes are in logical top-left coordinates.
const probes = [
  { name: 'depth texture, nearer half (depth 0.25)', x: 20, y: 50, rgb: [64, 0, 0], tolerance: 3 },
  { name: 'depth texture, farther half (depth 0.75)', x: 60, y: 50, rgb: [191, 0, 0], tolerance: 3 },
  { name: 'depth-stencil renderbuffer: stencil-marked half', x: 100, y: 50, rgb: [0, 255, 0], tolerance: 2 },
  { name: 'depth-stencil renderbuffer: unmarked half', x: 140, y: 50, rgb: [0, 0, 153], tolerance: 2 },
  { name: 'float wrap parameter: repeat 1', x: 170, y: 50, rgb: [255, 0, 0], tolerance: 2 },
  { name: 'float wrap parameter: repeat 2', x: 190, y: 50, rgb: [0, 0, 255], tolerance: 2 },
  { name: 'float wrap parameter: repeat 3', x: 210, y: 50, rgb: [255, 0, 0], tolerance: 2 },
  { name: 'float wrap parameter: repeat 4', x: 230, y: 50, rgb: [0, 0, 255], tolerance: 2 },
  { name: '3D texture slice 1 voxel (0,1)', x: 250, y: 25, rgb: [60, 0, 200], tolerance: 2 },
  { name: '3D texture slice 1 voxel (1,1)', x: 270, y: 25, rgb: [60, 200, 200], tolerance: 2 },
  { name: '3D texture slice 1 voxel (0,0)', x: 250, y: 75, rgb: [60, 0, 0], tolerance: 2 },
  { name: '3D texture slice 1 voxel (1,0)', x: 270, y: 75, rgb: [60, 200, 0], tolerance: 2 },
  { name: '3D texture slice 2 after TexSubImage3D', x: 300, y: 25, rgb: [255, 255, 255], tolerance: 2 },
  { name: '2D array layer 0', x: 20, y: 150, rgb: [255, 0, 0], tolerance: 2 },
  { name: '2D array layer 1', x: 60, y: 150, rgb: [0, 255, 0], tolerance: 2 },
  { name: 'explicit mip level 1 selected by textureLod', x: 100, y: 150, rgb: [0, 255, 0], tolerance: 2 },
  { name: 'RGB10_A2 packed upload', x: 170, y: 150, rgb: [255, 128, 0], tolerance: 2 },
  { name: 'RGBA16F target above one, modulated', x: 230, y: 150, rgb: [191, 32, 0], tolerance: 3 },
  { name: 'colour attachment 0', x: 260, y: 150, rgb: [255, 0, 0], tolerance: 2 },
  { name: 'colour attachment 1', x: 300, y: 150, rgb: [0, 255, 0], tolerance: 2 },
];
for (const cross of [false, true])
  test(`x64-gl-fbo: ${cross ? 'cross-backend images agree @webgpu' : 'GL contracts, completeness and pixels'}`,
    async ({ page, backendParam, collector }, info) => {
      void collector;
      const capture = async (p: Page, backend: string) => {
        const status = await openGame(p, backend, { game: 'x64-gl-fbo' });
        await assertBackend(p, backend, info);
        expect(status, JSON.stringify(await diagnostics(p))).toBe('ready');
        for (let i = 0; i < 100; i++) {
          await step(p, 1); await p.waitForTimeout(10);
          if ((await diagnostics(p)).logs.some(l => /x64-gl-fbo (PASS|FAIL)/.test(l.message))) break;
        }
        await step(p, 3);
        const d = await diagnostics(p), m = d.metrics as Record<string, any>;
        expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
        const failures = d.logs.filter(l => l.message.includes('x64-gl-fbo FAIL')).map(l => l.message);
        expect(failures).toEqual([]);
        expect(d.logs.some(l => l.message.includes('x64-gl-fbo PASS failures=0')), JSON.stringify(d.logs)).toBe(true);
        expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]); expect(m.exited).toBe(0);
        expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
        expect(m.gl_approximations).toBe(2);
        const px = await readPixels(p);
        if (hardwarePixels()) for (const probe of probes) {
          const x = Math.floor(d.letterbox.x + (probe.x + .5) * d.letterbox.w / 320);
          const y = Math.floor(d.letterbox.y + (probe.y + .5) * d.letterbox.h / 200), i = (y * px.width + x) * 4;
          for (let c = 0; c < 3; c++) {
            expect(Math.abs(px.data[i + c] - probe.rgb[c]), `${probe.name} channel ${c}: ${px.data[i + c]}`)
              .toBeLessThanOrEqual(probe.tolerance);
          }
        }
        await info.attach(`x64-gl-fbo-${backend}.png`, { body: await p.locator('canvas').screenshot(), contentType: 'image/png' });
        return px;
      };
      const a = await capture(page, backendParam);
      if (!cross) return;
      const backend = backendParam === 'webgpu' ? 'webgl2' : 'webgpu';
      const b = await otherBackend(backend, info, p => capture(p, backend));
      // Documented tolerance: edge texels and 16-bit float rounding may differ; see docs/handoff/K6a.md.
      const comparison = compareGpuImages(a, b); console.log('GL FBO COMPARISON', comparison);
      expect(comparison.different).toBeLessThanOrEqual(0.015);
      expect(comparison.unmatched).toBeLessThanOrEqual(0.001);
    });
