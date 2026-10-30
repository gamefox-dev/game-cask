// Shared e2e fixtures: backend selection per project, collection of JS
// exceptions / console errors / failed requests / wasm traps / GPU errors,
// and pixel helpers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, Page, TestInfo } from '@playwright/test';
import type { BGTDiagnostics } from '../../bgt/runtime/runtime';

export interface Collector {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Substrings of console errors/failed requests this test expects. */
  allow(...patterns: RegExp[]): void;
}

export interface Pixels {
  width: number;
  height: number;
  data: Buffer;
}

type Fixtures = { backendParam: string; collector: Collector };

export const test = base.extend<Fixtures>({
  backendParam: ['webgl2', { option: true }],
  collector: async ({ page }, use, testInfo) => {
    const allowed: RegExp[] = [];
    const c: Collector = {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      failedRequests: [],
      allow: (...p) => allowed.push(...p),
    };
    page.on('console', (m) => {
      if (m.type() === 'error') c.consoleErrors.push(m.text());
      if (m.type() === 'warning') c.consoleWarnings.push(m.text());
    });
    page.on('pageerror', (e) => c.pageErrors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400) c.failedRequests.push(`${r.status()} ${r.url()}`);
    });
    await use(c);
    try {
      const coverage=await page.evaluate(()=>(window as any).__BGT_TEST__?.coverage?.());
      if(coverage){
        const dir=join('reports','coverage',testInfo.project.name);mkdirSync(dir,{recursive:true});
        writeFileSync(join(dir,testInfo.testId.replace(/[^a-z0-9-]/gi,'_')+'.json'),JSON.stringify(coverage,null,2)+'\n');
        await testInfo.attach('coverage.json',{body:JSON.stringify(coverage),contentType:'application/json'});
      }
    } catch { /* deliberate unavailable-runtime tests may have no API */ }
    const unexpected = (xs: string[]) => xs.filter((x) => !allowed.some((p) => p.test(x)));
    const problems = {
      pageErrors: unexpected(c.pageErrors),
      consoleErrors: unexpected(c.consoleErrors),
      failedRequests: unexpected(c.failedRequests),
    };
    await testInfo.attach('browser-log.json', { body: JSON.stringify({ ...c, allow: undefined }, null, 2), contentType: 'application/json' });
    expect(problems, 'unexpected JS exceptions, console errors, or failed requests').toEqual({ pageErrors: [], consoleErrors: [], failedRequests: [] });
  },
});

export { expect };

export const requireWebGPU = () => process.env.BGT_REQUIRE_WEBGPU === '1';

export async function openGame(
  page: Page,
  backend: string,
  params: Record<string, string> = {},
): Promise<'ready' | 'failed'> {
  const q = new URLSearchParams({ game: 'sample2d', backend, ephemeral: '1', paused: '1', ...params });
  await page.goto(`/?${q}`);
  await page.waitForFunction(() => {
    const t = (window as unknown as { __BGT_TEST__?: { ready(): boolean; failed(): boolean } }).__BGT_TEST__;
    return !!t && (t.ready() || t.failed());
  }, null, { timeout: 30_000 });
  return page.evaluate(() => ((window as any).__BGT_TEST__.ready() ? 'ready' : 'failed'));
}

/** Skip (or fail, when BGT_REQUIRE_WEBGPU=1) if this project wanted WebGPU and did not get it. */
export async function assertBackend(page: Page, backendParam: string, testInfo: TestInfo): Promise<string> {
  const d = await diagnostics(page);
  if (backendParam === 'webgpu' && d.backend !== 'webgpu') {
    if (requireWebGPU()) throw new Error(`WebGPU required but got ${d.backend}: ${d.backendNotes.join('; ')}`);
    testInfo.skip(true, `WebGPU unavailable here: ${d.backendNotes.join('; ') || d.errors.map((e) => e.message).join('; ')}`);
  }
  if (backendParam === 'webgl2') expect(d.backend).toBe('webgl2');
  return d.backend;
}

export const diagnostics = (page: Page): Promise<BGTDiagnostics> => page.evaluate(() => (window as any).__BGT_TEST__.diagnostics());

export const step = (page: Page, n: number) => page.evaluate((k) => (window as any).__BGT_TEST__.step(k), n);

export const input = (page: Page, events: unknown[]) => page.evaluate((e) => (window as any).__BGT_TEST__.input(e), events);

export const debugState = <T = any>(page: Page): Promise<T> => page.evaluate(() => (window as any).__BGT_TEST__.debugState());

export const stateHash = (page: Page): Promise<string | null> => page.evaluate(() => (window as any).__BGT_TEST__.stateHash());

export async function press(page: Page, button: string, frames = 1): Promise<void> {
  await input(page, [{ type: 'button', button, down: true }]);
  await step(page, frames);
  await input(page, [{ type: 'button', button, down: false }]);
}

export async function readPixels(page: Page): Promise<Pixels> {
  const r = await page.evaluate(() => (window as any).__BGT_TEST__.readPixels());
  if (!r) throw new Error('readPixels returned null');
  return { width: r.width, height: r.height, data: Buffer.from(r.base64, 'base64') };
}

export async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<Buffer> {
  const b64: string = await page.evaluate(async () => {
    const blob: Blob = await (window as any).__BGT_TEST__.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const png = Buffer.from(b64, 'base64');
  await testInfo.attach(name, { body: png, contentType: 'image/png' });
  return png;
}

/** Count pixels near `rgb` and their centroid (device pixels). */
export function findColor(px: Pixels, rgb: [number, number, number], tol = 8): { count: number; cx: number; cy: number } {
  let count = 0, sx = 0, sy = 0;
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      const o = (y * px.width + x) * 4;
      if (Math.abs(px.data[o] - rgb[0]) <= tol && Math.abs(px.data[o + 1] - rgb[1]) <= tol && Math.abs(px.data[o + 2] - rgb[2]) <= tol) {
        count++;
        sx += x;
        sy += y;
      }
    }
  }
  return { count, cx: count ? sx / count : -1, cy: count ? sy / count : -1 };
}

/** Fraction of pixels whose max channel delta exceeds `tol`. */
export function diffFraction(a: Pixels, b: Pixels, tol = 8): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let bad = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > tol) bad++;
  }
  return bad / (a.data.length / 4);
}

export const PLAYER_CYAN: [number, number, number] = [0, 220, 255];
export const WALL_BLUE: [number, number, number] = [58, 63, 107];
export const WIN_GOLD: [number, number, number] = [255, 215, 0];

// Test evidence helpers (port tests import them from here): state the breakage a test catches, assert changes,
// read guest memory read-only. See tests/support/evidence.ts and the browser-validation skill.
export { catches, expectChange, captureRegion, regionDiff, peekBytes } from '../support/evidence';
export type { Rect, Region } from '../support/evidence';
