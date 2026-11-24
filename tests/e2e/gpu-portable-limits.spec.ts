// SPDX-License-Identifier: CC0-1.0. Original fixtures only (x64-gl-raster, x64-gl-limits), never game assets.
// K73 (Q135): guest-visible GL limits are the same on every backend by default (portable table, ABI §13.6).
// Catches: (1) a guest told the device's GL_MAX_UNIFORM_BLOCK_SIZE (ANGLE Metal 16384 vs SwiftShader/WebGPU 65536) or
// MAX_VARYING_COMPONENTS (84 / 87 / 102), which made the MMX8 timeline (and its recorded input routes) differ per
// backend from update 50 (r30); (2) any other GL 3.3 value of the 58-entry table differing between backends;
// (3) guest-visible results (guest checks, presents, guest time, state hash) differing between backends at the same
// update; (4) a `gpu.limits: "device"` opt-out that does not report the device values.
import { chromium, type Browser, type Page, type TestInfo } from '@playwright/test';
import { test, expect, openGame, assertBackend, diagnostics } from './fixtures';
import { noWebGPU, webglArgs, webglGpuArgs, webgpuArgs } from './browser-options';
import { checkGl33Limits } from '../support/gl33-limits';

test.beforeEach(async ({ collector }) => { void collector; });

// The backend-dependent GL values (w32_gl_query.h) and their portable values: GL_MAX_UNIFORM_BLOCK_SIZE (16384) and
// what derives from it (uniform components = /4, combined = 2x), GL_MAX_VARYING_COMPONENTS (84), outputs/inputs (+4).
const PORTABLE: Record<number, string> = {
  0x8a30: '16384', 0x8b4a: '4096', 0x8b49: '4096', 0x8a31: '32768', 0x8a33: '32768',
  0x8b4b: '84', 0x9122: '88', 0x9125: '88',
};

interface GuestRun { limits: Record<string, string>; summary: string | null; lines: string[]; frame: number;
  swaps: number | null; virtualUs: string | null; hash: string | null; device: any }

/** Step x64-gl-raster (in the page) until its PASS summary, then 3 more updates; collect what the guest observed. */
async function runRaster(page: Page): Promise<GuestRun> {
  await page.evaluate(async () => {
    const api = (window as any).__BGT_TEST__;
    for (let i = 0; i < 400; i++) {
      await api.step(1);
      if (api.diagnostics().logs.some((l: { message: string }) => /x64-gl-raster PASS failures=/.test(l.message))) break;
      if (api.failed()) throw new Error('guest failed');
    }
    await api.step(3);
  });
  const d = await diagnostics(page), m = d.metrics as any, logs = d.logs.map(l => l.message);
  expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
  const limits: Record<string, string> = {};
  for (const l of logs) { const r = /x64-gl-raster limit 0x([0-9a-f]{4}) (.*)$/.exec(l); if (r) limits[r[1]] = r[2]; }
  return { limits, summary: logs.find(l => /x64-gl-raster PASS failures=/.test(l)) ?? null,
    lines: logs.filter(l => l.includes('x64-gl-raster ')), frame: d.frame,
    swaps: m.execution_summary?.guest_frames?.swaps ?? null, virtualUs: m.guest_time?.virtual_us == null ? null : String(m.guest_time.virtual_us),
    hash: await page.evaluate(() => (window as any).__BGT_TEST__.stateHash()), device: d.gpuDevice };
}

test('x64-gl-raster: the portable GL limits by default, the device limits with gpu.limits "device"', async ({ page, backendParam }, info) => {
  test.setTimeout(180_000);
  expect(await openGame(page, backendParam, { game: 'x64-gl-raster' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  const portable = await runRaster(page);
  expect(portable.summary).toMatch(/PASS failures=0 checks=105 glerrors=0/);
  expect(Object.keys(portable.limits)).toHaveLength(58);
  for (const [k, v] of Object.entries(PORTABLE)) expect(portable.limits[(+k).toString(16).padStart(4, '0')], `0x${(+k).toString(16)}`).toBe(v);
  expect(checkGl33Limits(new Map(Object.entries(portable.limits).map(([k, v]) => [parseInt(k, 16), v])), { varyings: 84, uniformBlock: 16384 })).toEqual([]);
  const lim = portable.device.limits;
  expect(lim).toMatchObject({ mode: 'portable', source: 'default', maxUniformRange: 16384, maxVaryingComponents: 84 });
  expect(lim.maxTextureDimension).toBe(Math.min(8192, lim.deviceMaxTextureDimension));
  // The opt-out: the device's own values (K51/K62 behaviour).
  expect(await openGame(page, backendParam, { game: 'x64-gl-raster', gpulimits: 'device' })).toBe('ready');
  const device = await runRaster(page);
  expect(device.summary).toMatch(/PASS failures=0 checks=105 glerrors=0/);
  const dl = device.device.limits;
  expect(dl).toMatchObject({ mode: 'device', source: 'url' });
  expect(dl.maxUniformRange).toBe(dl.deviceMaxUniformRange); expect(dl.maxVaryingComponents).toBe(dl.deviceMaxVaryingComponents);
  expect(device.limits['8a30']).toBe(String(dl.deviceMaxUniformRange));
  expect(device.limits['8b4b']).toBe(String(dl.deviceMaxVaryingComponents));
  await info.attach(`limits-${backendParam}.json`, { contentType: 'application/json',
    body: JSON.stringify({ portable: { limits: portable.limits, device: portable.device }, device: { limits: device.limits, device: device.device } }, null, 1) });
});

/** One Chromium configuration of the cross-backend comparison (separate launches: the WebGL implementation is a
 * launch flag). ANGLE Metal needs macOS and a GPU; WebGPU needs an adapter (openGame skips/fails as configured). */
const configs: { name: string; backend: 'webgl2' | 'webgpu'; args: string[] }[] = [
  { name: 'webgl2-swiftshader', backend: 'webgl2', args: webglArgs },
  ...(process.platform === 'darwin' && !noWebGPU ? [{ name: 'webgl2-angle-metal', backend: 'webgl2' as const, args: webglGpuArgs }] : []),
  ...(!noWebGPU ? [{ name: 'webgpu', backend: 'webgpu' as const, args: webgpuArgs }] : []),
];
async function inBrowser<T>(args: string[], info: TestInfo, run: (page: Page) => Promise<T>): Promise<T> {
  const use = info.project.use as { baseURL?: string };
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chromium', args });
    const page = await (await browser.newContext({ baseURL: use.baseURL, viewport: { width: 960, height: 540 } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const result = await run(page);
    expect(errors).toEqual([]);
    return result;
  } finally { await browser?.close(); }
}

test('x64-gl-raster: SwiftShader, ANGLE Metal and WebGPU report identical limits and identical guest results @webgpu', async ({ backendParam }, info) => {
  test.skip(backendParam !== 'webgpu', 'one cross-backend run, in the WebGPU (hardware) project');
  test.setTimeout(600_000);
  const runs: Record<string, GuestRun> = {}, deviceRuns: Record<string, GuestRun> = {};
  for (const c of configs) {
    runs[c.name] = await inBrowser(c.args, info, async (page) => {
      expect(await openGame(page, c.backend, { game: 'x64-gl-raster' })).toBe('ready');
      return runRaster(page);
    });
    deviceRuns[c.name] = await inBrowser(c.args, info, async (page) => {
      expect(await openGame(page, c.backend, { game: 'x64-gl-raster', gpulimits: 'device' })).toBe('ready');
      return runRaster(page);
    });
  }
  const renderers = Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.device?.renderer]));
  await info.attach('cross-backend.json', { contentType: 'application/json', body: JSON.stringify({ renderers,
    portable: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, { ...r, lines: undefined }])),
    device: Object.fromEntries(Object.entries(deviceRuns).map(([k, r]) => [k, { limits: r.limits, device: r.device }])) }, null, 1) });
  console.log('K73 cross-backend', JSON.stringify({ renderers,
    portable: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, { frame: r.frame, swaps: r.swaps, virtualUs: r.virtualUs, hash: r.hash,
      uniform: r.limits['8a30'], varyings: r.limits['8b4b'] }])),
    device: Object.fromEntries(Object.entries(deviceRuns).map(([k, r]) => [k, { uniform: r.limits['8a30'], varyings: r.limits['8b4b'], hash: r.hash }])) }));
  const names = Object.keys(runs);
  expect(names.length, 'at least two backends to compare').toBeGreaterThanOrEqual(2);
  if (process.platform === 'darwin' && process.env.BGT_REQUIRE_WEBGPU === '1') {
    expect(names).toEqual(['webgl2-swiftshader', 'webgl2-angle-metal', 'webgpu']);
    expect(runs['webgl2-angle-metal'].device.software, renderers['webgl2-angle-metal']).toBe(false);
  }
  const ref = runs[names[0]];
  expect(ref.summary).toMatch(/PASS failures=0 checks=105 glerrors=0/);
  for (const n of names.slice(1)) {
    const r = runs[n];
    // Every reported limit, every guest line (checks, pixels it read, the limit dump), and the guest timeline.
    expect(r.limits, `${n} vs ${names[0]} limits`).toEqual(ref.limits);
    expect(r.lines, `${n} vs ${names[0]} guest lines`).toEqual(ref.lines);
    expect({ frame: r.frame, swaps: r.swaps, virtualUs: r.virtualUs, hash: r.hash }, `${n} vs ${names[0]} timeline`)
      .toEqual({ frame: ref.frame, swaps: ref.swaps, virtualUs: ref.virtualUs, hash: ref.hash });
  }
  // Negative control: the device mode reports what each device has, so where the devices differ the guest sees it.
  const dv = Object.values(deviceRuns).map(r => `${r.limits['8a30']}/${r.limits['8b4b']}`);
  if (names.includes('webgl2-angle-metal')) expect(new Set(dv).size, dv.join(' ')).toBeGreaterThan(1);
});
