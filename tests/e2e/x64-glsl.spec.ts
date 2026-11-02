import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, diffFraction, hardwarePixels } from './fixtures';
import { otherBackend } from './backend-page';
import { compareGpuImages } from '../support/gpu-image';
import type { Page } from '@playwright/test';

// Eight 80x100 tiles of examples/x64-glsl. Expected colours follow from the shader sources' own arithmetic:
// tile 0 lights*gain*swap*2 -> (0.75,0.5,0.25); tile 1 std140 block with scalar array, struct, bool and mat2;
// tile 2 interpolation qualifiers around the tile midline; tile 3 two sampler-array elements bound to units 3 and 5;
// tile 4 attributes bound with glBindAttribLocation; tiles 5/6 multi-string #define variants; tile 7 out/inout.
const tiles = [
  { name: 'structure array, scalar array, bool, mat3, macros', x: 40, y: 50, rgb: [191, 128, 64] },
  { name: 'std140 block: vec4, float[3], struct, bool, mat2', x: 40, y: 50, ox: 80, rgb: [83, 89, 77] },
  { name: 'interpolation qualifiers (left of midline)', x: 20, y: 50, ox: 160, rgb: [0, 255, 65] },
  { name: 'interpolation qualifiers (right of midline)', x: 60, y: 50, ox: 160, rgb: [255, 0, 193] },
  { name: 'sampler array elements on units 3 and 5', x: 40, y: 50, ox: 240, rgb: [200, 50, 0] },
  { name: 'glBindAttribLocation / glBindFragDataLocation', x: 20, y: 75, oy: 100, rgb: [65, 64, 31] },
  { name: 'variant 2 via prepended #define', x: 40, y: 50, ox: 80, oy: 100, rgb: [255, 255, 0] },
  { name: 'variant 1 via prepended #define', x: 40, y: 50, ox: 160, oy: 100, rgb: [0, 0, 255] },
  { name: 'out/inout parameters, const array sizes, length()', x: 40, y: 50, ox: 240, oy: 100, rgb: [191, 128, 128] },
];
for (const cross of [false, true])
  test(`x64-glsl: ${cross ? 'cross-backend images agree @webgpu' : 'all eight shader tiles have exact pixels'}`,
  async ({ page, backendParam, collector }, info) => {
    void collector;
    // 256 real-compiler cycles plus 2048 deferred FILE reads are part of this test, not a cold build.
    test.setTimeout(360_000);
    const capture = async (p: Page, backend: string) => {
      const status = await openGame(p, backend, { game: 'x64-glsl' });
      await assertBackend(p, backend, info);
      expect(status, JSON.stringify(await diagnostics(p))).toBe('ready');
      for (let i = 0; i < 12000; i++) {
        await step(p, 1); await p.waitForTimeout(10);
        if ((await diagnostics(p)).logs.some(l => l.message.includes('x64-glsl PASS'))) break;
      }
      await step(p, 3);
      const d = await diagnostics(p), m = d.metrics as Record<string, any>;
      expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
      for (const text of ['x64-glsl shared host stress PASS files=2048 parents=8 bytes=302', 'x64-glsl frontend stress PASS cycles=256 retained=80', 'x64-glsl diagnostics ok', 'x64-glsl reflection ok', 'x64-glsl PASS tiles=8'])
        expect(d.logs.some(l => l.message.includes(text)), JSON.stringify({logs:d.logs,metrics:m})).toBe(true);
      expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]); expect(m.exited).toBe(0);
      expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]); expect(m.gl_pipelines).toBe(8);
      // Parsing tables are transient; retaining every compiled frontend used >10 MiB here.
      expect(m.gl_frontend_bytes).toBeGreaterThan(0); expect(m.gl_frontend_bytes).toBeLessThan(2 * 1024 ** 2);
      expect(m.gl_frontend_peak).toBeGreaterThan(m.gl_frontend_bytes);
      expect(m.gl_frontend_reserved).toBeGreaterThanOrEqual(m.gl_frontend_peak);
      expect(m.gl_frontend_reserved).toBeLessThan(24 * 1024 ** 2); expect(m.gl_frontend_oom).toBe(0);
      expect(m.gl_frontend_allocations).toBeGreaterThan(m.gl_frontend_frees);
      expect(m.host_limit).toBe(64 * 1024 ** 2);
      expect(m.host_bytes).toBeLessThanOrEqual(m.host_peak);
      expect(m.host_peak).toBeLessThanOrEqual(m.host_reserved);
      expect(m.host_reserved).toBeLessThan(m.host_limit);
      expect(m.host_consumers.file).toMatchObject({used: 0, oom: 0, shared_limit: true, limit: m.host_limit});
      expect(m.host_consumers.file.allocations).toBeGreaterThanOrEqual(2056);
      expect(m.host_consumers.file.frees).toBe(m.host_consumers.file.allocations);
      expect(m.host_consumers.file.peak).toBeGreaterThanOrEqual(9 * 16384);
      let charged = 0;
      for (const name of ['runtime', 'gl', 'crt', 'file']) {
        const c = m.host_consumers[name]; charged += c.used;
        expect(c.limit).toBe(m.host_limit); expect(c.oom).toBe(0); expect(c.peak).toBeGreaterThanOrEqual(c.used);
      }
      expect(charged).toBe(m.host_bytes);
      expect(d.logs.some(l => l.message.includes("glCompileShader: ") && l.message.includes("#error"))).toBe(true);
      expect(d.logs.some(l => l.message.includes("glLinkProgram: ") && l.message.includes("types differ"))).toBe(true);
      const px = await readPixels(p);
      if (hardwarePixels()) for (const probe of tiles) {
        const x = Math.floor(d.letterbox.x + (probe.x + (probe.ox ?? 0) + .5) * d.letterbox.w / 320);
        const y = Math.floor(d.letterbox.y + (probe.y + (probe.oy ?? 0) + .5) * d.letterbox.h / 200), i = (y * px.width + x) * 4;
        for (let c = 0; c < 3; c++) expect(Math.abs(px.data[i + c] - probe.rgb[c]), `${probe.name} channel ${c}`).toBeLessThanOrEqual(3);
      }
      if (hardwarePixels()) expect(diffFraction(px, await readPixels(p), 0), 'repeat capture').toBe(0);
      await info.attach(`x64-glsl-${backend}.png`, { body: await p.locator('canvas').screenshot(), contentType: 'image/png' });
      return px;
    };
    const a = await capture(page, backendParam);
    if (!cross) return;
    const backend = backendParam === 'webgpu' ? 'webgl2' : 'webgpu';
    const b = await otherBackend(backend, info, p => capture(p, backend));
    const comparison = compareGpuImages(a, b); console.log('GLSL COMPARISON', comparison);
    expect(comparison.different).toBeLessThanOrEqual(0.015);
    expect(comparison.unmatched).toBeLessThanOrEqual(0.001);
  });
