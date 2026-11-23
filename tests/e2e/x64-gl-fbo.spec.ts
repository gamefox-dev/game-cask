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
  { name: '3D texture() bias selects generated mip 2', x: 316, y: 50, rgb: [124, 139, 139], tolerance: 3 }, // rgb: box filter; checked against the guest's level-2 readback
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
      const mip2s: Record<string, { mip2: number[]; lb: { x: number; y: number; w: number; h: number } }> = {};
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
        // GL leaves glGenerateMipmap's filter implementation-defined (box: 124,139,139; ANGLE Metal: 53,110,110 -- see
        // the fixture's 3D mip check). The bias probe proves mip 2 is *selected*, so it expects the guest's own
        // GetTexImage of generated level 2, not a fixed box-filter value.
        const mip2Log = d.logs.map(l => /x64-gl-fbo 3D mip level 2 = (\d+),(\d+),(\d+),/.exec(l.message)).find(Boolean);
        expect(mip2Log, 'guest logs generated 3D mip level 2').toBeTruthy();
        const mip2 = mip2Log!.slice(1, 4).map(Number); mip2s[backend] = { mip2, lb: d.letterbox };
        if (hardwarePixels()) for (const probe of probes) {
          const x = Math.floor(d.letterbox.x + (probe.x + .5) * d.letterbox.w / 320);
          const y = Math.floor(d.letterbox.y + (probe.y + .5) * d.letterbox.h / 200), i = (y * px.width + x) * 4;
          for (let c = 0; c < 3; c++) {
            const want = probe.name === '3D texture() bias selects generated mip 2' ? mip2 : probe.rgb;
            expect(Math.abs(px.data[i + c] - want[c]), `${probe.name} channel ${c}: ${px.data[i + c]}`)
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
      // K69: glGenerateMipmap's filter is implementation-defined (fixture comment; ANGLE Metal, i.e. WebKit's WebGL 2,
      // weights 3D slices ~7/8:1/8, WebGPU/SwiftShader box-filter). Each capture above already checked its bias quad against
      // its own guest-read level 2. Only when those reads differ is that quad (tile 3, logical x 312..320, y 0..100, +1
      // device pixel) left out of the cross image comparison; Chromium's backends agree, so nothing is masked there.
      const own = mip2s[backendParam], other = mip2s[backend];
      if (own.mip2.some((v, c) => Math.abs(v - other.mip2[c]) > 3)) {
        info.annotations.push({ type: 'masked', description: `generated 3D mip 2 differs (${own.mip2} vs ${other.mip2}): bias quad excluded` });
        const lb = own.lb, x0 = Math.floor(lb.x + 312 * lb.w / 320) - 1, y1 = Math.ceil(lb.y + 100 * lb.h / 200) + 1;
        for (const img of [a, b]) for (let y = Math.max(0, lb.y - 1); y < Math.min(img.height, y1); y++)
          img.data.fill(0, (y * img.width + x0) * 4, (y * img.width + Math.min(img.width, lb.x + lb.w + 1)) * 4);
      }
      // Documented tolerance: edge texels and 16-bit float rounding may differ; see docs/handoff/K6a.md.
      const comparison = compareGpuImages(a, b); console.log('GL FBO COMPARISON', comparison);
      expect(comparison.different).toBeLessThanOrEqual(0.015);
      expect(comparison.unmatched).toBeLessThanOrEqual(0.001);
    });
