import { Browser, Page } from '@playwright/test';
import { test, expect, openGame, assertBackend, step, readPixels, diffFraction, requireWebGPU, Pixels, attachScreenshot } from './fixtures';

interface Conf {
  done: boolean;
  backend: string;
  unavailable?: boolean;
  error?: string;
  width: number;
  height: number;
  scale: number;
  base64: string;
  probes: Array<{ name: string; x: number; y: number; expect: [number, number, number]; tol: number }>;
  decode: { status: number; errors: unknown[] };
  errors: string[];
}

async function conformance(page: Page, backend: string): Promise<Conf> {
  await page.goto(`/conformance.html?backend=${backend}`);
  await page.waitForFunction(() => (window as any).__CONF__?.done, null, { timeout: 30_000 });
  return page.evaluate(() => (window as any).__CONF__);
}

const toPixels = (c: Conf): Pixels => ({ width: c.width, height: c.height, data: Buffer.from(c.base64, 'base64') });

function checkProbes(c: Conf): string[] {
  const px = toPixels(c);
  const fails: string[] = [];
  for (const p of c.probes) {
    // sample the device pixel at the center of the logical pixel
    const x = Math.floor(p.x * c.scale + c.scale / 2), y = Math.floor(p.y * c.scale + c.scale / 2);
    const o = (y * px.width + x) * 4;
    const got = [px.data[o], px.data[o + 1], px.data[o + 2]];
    if (got.some((v, i) => Math.abs(v - p.expect[i]) > p.tol)) fails.push(`${p.name}: got ${got} expected ${p.expect} ±${p.tol}`);
  }
  return fails;
}

test('conformance scene: every v0.1 2D operation renders correctly on this backend', async ({ page, backendParam, collector }, testInfo) => {
  void collector;
  test.skip(backendParam === 'auto', 'covered by explicit backend projects');
  const c = await conformance(page, backendParam);
  if (c.unavailable) {
    if (backendParam === 'webgpu' && !requireWebGPU()) test.skip(true, 'WebGPU unavailable');
    throw new Error(`${backendParam} unavailable`);
  }
  expect(c.error).toBeUndefined();
  expect(c.backend).toBe(backendParam);
  expect(c.decode.status).toBe(0);
  expect(c.errors).toEqual([]);
  await testInfo.attach(`conformance-${backendParam}.json`, { body: JSON.stringify({ probes: c.probes, failures: checkProbes(c) }, null, 2), contentType: 'application/json' });
  await testInfo.attach(`conformance-${backendParam}.png`, { body: await page.locator('canvas').screenshot(), contentType: 'image/png' });
  expect(checkProbes(c)).toEqual([]);
});

async function renderTitle(browser: Browser, backend: string, launchArgs: { channel?: string }): Promise<{ px: Pixels; backend: string } | null> {
  void launchArgs;
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  try {
    if ((await openGame(page, backend)) !== 'ready') return null;
    const got = await page.evaluate(() => (window as any).__BGT_TEST__.backend());
    if (got !== backend) return null;
    await page.evaluate(() => (window as any).__BGT_TEST__.pause());
    await step(page, 3);
    return { px: await readPixels(page), backend: got };
  } finally {
    await ctx.close();
  }
}

test('WebGPU and WebGL 2 produce matching images (conformance scene and sample title)', async ({ browser, backendParam, page, collector }, testInfo) => {
  void collector;
  test.skip(backendParam !== 'webgpu', 'runs in the WebGPU project, which can create both backends');
  const gpu = await conformance(page, 'webgpu');
  if (gpu.unavailable) {
    test.skip(!requireWebGPU(), 'WebGPU unavailable');
    throw new Error('WebGPU unavailable');
  }
  const gl = await conformance(page, 'webgl2');
  const conf = diffFraction(toPixels(gpu), toPixels(gl), 8);
  const a = await renderTitle(browser, 'webgpu', {});
  const b = await renderTitle(browser, 'webgl2', {});
  expect(a && b).toBeTruthy();
  const title = diffFraction(a!.px, b!.px, 8);
  await testInfo.attach('cross-backend.json', { body: JSON.stringify({ conformanceDiff: conf, titleDiff: title }), contentType: 'application/json' });
  // Tolerances: linear filtering and edge rasterization may differ slightly
  // between GPU stacks; no other differences are expected.
  expect(conf).toBeLessThan(0.01);
  expect(title).toBeLessThan(0.005);
});

test('visual checkpoint: title screen is stable across frames and reloads', async ({ page, backendParam, collector }, testInfo) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, testInfo);
  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  await step(page, 60); // "PRESS START" blinks with a 60-frame period
  const a = await readPixels(page);
  await page.reload();
  await page.waitForFunction(() => (window as any).__BGT_TEST__?.ready());
  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  await step(page, 60);
  const b = await readPixels(page);
  expect(diffFraction(a, b, 0)).toBe(0); // same backend, same input: identical pixels
  await attachScreenshot(page, testInfo, `checkpoint-title-${backendParam}.png`);
});
