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
  { name: '3D sampler unit 3: updated slice lower row', x: 300, y: 75, rgb: [255, 255, 255], tolerance: 2 },
  { name: '2D array layer 0', x: 20, y: 150, rgb: [255, 0, 0], tolerance: 2 },
  { name: '2D array layer 1', x: 60, y: 150, rgb: [0, 255, 0], tolerance: 2 },
  { name: '3D texture() bias selects generated mip 2', x: 316, y: 50, rgb: [124, 139, 139], tolerance: 3 },
  { name: 'array texture() bias selects explicit mip 1 layer 1', x: 76, y: 150, rgb: [255, 255, 0], tolerance: 2 },
  { name: 'explicit mip level 1 selected by textureLod', x: 100, y: 150, rgb: [0, 255, 0], tolerance: 2 },
  { name: 'MAX_LEVEL clamps explicit LOD to level 1', x: 120, y: 150, rgb: [0, 255, 0], tolerance: 2 },
  { name: 'BASE_LEVEL 1 with non-mip min filter', x: 147, y: 150, rgb: [0, 255, 0], tolerance: 2 },
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
          if ((await diagnostics(p)).logs.some(l => /x64-gl-fbo (PASS|FAIL) failures=/.test(l.message))) break;
        }
        await step(p, 3);
        const d = await diagnostics(p), m = d.metrics as Record<string, any>;
        expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
        const failures = d.logs.filter(l => l.message.includes('x64-gl-fbo FAIL')).map(l => l.message);
        expect(failures, JSON.stringify(d.logs)).toEqual([]);
        expect(d.logs.filter(l => l.message.includes('x64-gl-fbo unexpected GL error'))).toEqual([]);
        expect(d.logs.some(l => l.message.includes('x64-gl-fbo PASS failures=0')), JSON.stringify(d.logs)).toBe(true);
        // Integration regression: success must include actual typed reflection and nonzero-unit binding,
        // not merely a shader that happened to sample texture unit zero. The probes below rasterize both.
        for (const contract of ['sampler3D reflection', 'sampler2DArray reflection', 'sampler3D unit 3', 'sampler2DArray unit 5'])
          expect(d.logs.some(l => l.message.includes(`x64-gl-fbo ok ${contract}`)), contract).toBe(true);
        expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]); expect(m.exited).toBe(0);
        expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
        expect(m.gl_approximations).toBe(2);
        expect(m.gl_approximation_kinds).toEqual(['GL_CLAMP_TO_BORDER treated as CLAMP_TO_EDGE', 'GL_TEXTURE_LOD_BIAS ignored']);
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
