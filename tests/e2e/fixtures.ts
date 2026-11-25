// Shared e2e fixtures: backend selection per project, collection of JS
// exceptions / console errors / failed requests / wasm traps / GPU errors,
// and pixel helpers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, Page, Route, TestInfo, type Request, type Response } from '@playwright/test';
import type { BGTDiagnostics } from '../../bgt/runtime/runtime';
import { assertWebGPUAvailable, webGPUWasAvailable } from './webgpu-availability';
import { suspensionCapabilities } from '../../bgt/runtime/jspi';
import { jspiUnavailableReason } from '../support/suspension-modes';
import { isCancellation, unexpected, validateAllow, type AllowEntry } from '../support/browser-collector';

export interface Collector {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** K73: network-level request failures (`requestfailed`: aborted, DNS, refused, ...), `${errorText} ${method} ${url}`. */
  requestFailures: string[];
  /** K73: requests cancelled because the page navigated away (logged, never failures). */
  navigationAborts: string[];
  /** Page errors, console errors and HTTP >= 400 this test expects: a RegExp, or (K73) `{ pattern, max }` to allow at
   * most `max` matches in the whole test (bound an authentic repeated guest error). Never covers request failures. */
  allow(...patterns: AllowEntry[]): void;
  /** K73: the explicit allowlist for intentional network-level request failures (same entry forms). */
  allowRequestFailure(...patterns: AllowEntry[]): void;
  /** Navigate to a new HTTP document, intentionally abandoning this exact in-flight request (K76). */
  navigateAway(url: string, request: Request): Promise<Response | null>;
}

export interface Pixels {
  width: number;
  height: number;
  data: Buffer;
}

type Fixtures = { backendParam: string; collector: Collector };

export const test = base.extend<Fixtures>({
  // Run the unchanged browser assertions against either loader artifact. Explicit test-only opt-in.
  page: async ({ page }, use) => {
    if (process.env.BGT_E2E_SUSPENSION === 'jspi') await page.addInitScript(() => {
      const url = new URL(location.href);
      if (!url.searchParams.has('suspension')) url.searchParams.set('suspension', 'jspi');
      history.replaceState(null, '', url);
    });
    await use(page);
  },
  backendParam: ['webgl2', { option: true }],
  collector: async ({ page }, use, testInfo) => {
    const allowed: AllowEntry[] = [], allowedFailures: AllowEntry[] = [];
    type Departure = { committed: boolean; cancellation?: string };
    const inFlight = new WeakSet<Request>();
    const departures = new WeakMap<Request, Departure>();
    let leaving: Departure | undefined;
    const c: Collector = {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      failedRequests: [],
      requestFailures: [],
      navigationAborts: [],
      allow: (...p) => { validateAllow(p); allowed.push(...p); },
      allowRequestFailure: (...p) => { validateAllow(p); allowedFailures.push(...p); },
      navigateAway: async (url, request) => {
        if (leaving || !inFlight.has(request) || request.isNavigationRequest() || departures.has(request))
          throw new Error('navigateAway requires one in-flight subresource request not already abandoned');
        const attempt: Departure = { committed: false };
        leaving = attempt;
        departures.set(request, attempt);
        try {
          const response = await page.goto(url, { waitUntil: 'commit' });
          attempt.committed = response !== null; // same-document navigation has no response
          return response;
        } finally {
          leaving = undefined;
          if (!attempt.committed) departures.delete(request);
          if (attempt.cancellation)
            (attempt.committed ? c.navigationAborts : c.requestFailures).push(attempt.cancellation);
        }
      },
    };
    page.on('console', (m) => {
      if (m.type() === 'error') c.consoleErrors.push(m.text());
      if (m.type() === 'warning') c.consoleWarnings.push(m.text());
    });
    page.on('pageerror', (e) => c.pageErrors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400) c.failedRequests.push(`${r.status()} ${r.url()}`);
    });
    page.on('request', r => inFlight.add(r));
    page.on('requestfinished', r => { inFlight.delete(r); departures.delete(r); });
    page.on('requestfailed', (r) => {
      inFlight.delete(r);
      const attempt = departures.get(r);
      departures.delete(r);
      const error = r.failure()?.errorText ?? 'unknown', line = `${error} ${r.method()} ${r.url()}`;
      // The events don't establish causality: WebKit reports 'cancelled' before the next navigation request,
      // AbortController gives the same text, and framenavigated includes history/hash changes. Don't infer
      // abandonment from event order; an explicitly registered request may report before or after commit.
      if (!attempt || !isCancellation(error)) c.requestFailures.push(line);
      else if (attempt.committed) c.navigationAborts.push(line);
      else attempt.cancellation = line;
    });
    await use(c);
    try {
      const coverage=await page.evaluate(()=>(window as any).__BGT_TEST__?.coverage?.());
      if(coverage){
        const dir=join('reports','coverage',testInfo.project.name);mkdirSync(dir,{recursive:true});
        writeFileSync(join(dir,testInfo.testId.replace(/[^a-z0-9-]/gi,'_')+'.json'),JSON.stringify(coverage,null,2)+'\n');
        await testInfo.attach('coverage.json',{body:JSON.stringify(coverage),contentType:'application/json'});
        // Final-outcome reporter publishes only after ALL fixture teardowns pass.
      }
    } catch { /* deliberate unavailable-runtime tests may have no API */ }
    const problems = unexpected(c, allowed, allowedFailures);
    if (leaving?.cancellation) problems.requestFailures.push(leaving.cancellation);
    await testInfo.attach('browser-log.json', { body: JSON.stringify({ ...c, allow: undefined, allowRequestFailure: undefined }, null, 2), contentType: 'application/json' });
    expect(problems, 'unexpected JS exceptions, console errors, failed requests (HTTP >= 400) or network request failures')
      .toEqual({ pageErrors: [], consoleErrors: [], failedRequests: [], requestFailures: [] });
  },
});

export { expect };

export const requireWebGPU = () => process.env.BGT_REQUIRE_WEBGPU === '1';

/** Software rasterizers are best effort, not a pixel/performance support gate.
 * Guard only hardware-sensitive assertions; keep guest execution/logic checks running.
 * Explicit opt-in: never infer this from OS/CI and weaken a real-GPU run. */
export function hardwarePixels(): boolean {
  if (process.env.BGT_SOFTWARE_RENDERER !== '1') return true;
  const info = test.info(), description = 'software renderer: untested environment';
  if (!info.annotations.some(a => a.type === 'pixel-assertions-skipped' && a.description === description))
    info.annotations.push({ type: 'pixel-assertions-skipped', description });
  return false;
}

const faviconRoute = (route: Route) => route.fulfill({ status: 204, body: '' });

export async function openGame(
  page: Page,
  backend: string,
  params: Record<string, string> = {},
  options: { allowSuspensionFallback?: boolean } = {},
): Promise<'ready' | 'failed'> {
  if (backend === 'webgpu') await assertWebGPUAvailable(page, test.info());
  let preflightRoute = false;
  const q = new URLSearchParams({ game: 'sample2d', backend, ephemeral: '1', paused: '1',
    ...(process.env.BGT_E2E_SUSPENSION === 'jspi' ? {suspension:'jspi'} : {}), ...params });
  if (q.get('suspension') === 'jspi' && !options.allowSuspensionFallback) {
    // Use the browser's routed manifest (including synthetic JSPI-only fixtures),
    // not disk or APIRequestContext, which would bypass Playwright routes.
    // A JSON document runs init scripts but never boots the runtime/fallback.
    // A JSON document has no <link rel=icon>, so full Chromium requests /favicon.ico, which the dev server
    // 404s; that harness-made console error is not the game's. Answer it without touching real requests.
    // Scoped to the preflight: removed once the game document replaces the JSON one (page.route disables the
    // HTTP cache while active); web/index.html declares a data: icon, so the game page never asks for it.
    await page.route('**/favicon.ico', faviconRoute);
    preflightRoute = true;
    // 'commit': never let a non-JSON answer (the dev server's SPA index.html for an unknown game) boot the app here.
    const response = await page.goto('/games/'+encodeURIComponent(q.get('game')!)+'/manifest.json', { waitUntil: 'commit' });
    const json = /\bjson\b/i.test(response?.headers()['content-type'] ?? '');
    // A game with no manifest (404, or the SPA HTML fallback) has no artifact whose JSPI capability could be checked:
    // let the test reach the runtime's own "game not found" path and assert that. Any other HTTP failure stays fatal,
    // and a real manifest always gets the capability check (plus the suspension assertion after boot below).
    const missing = !!response && (response.status() === 404 || (response.ok() && !json));
    if (!missing) {
      if (!response?.ok()) throw new Error('Cannot inspect JSPI artifact manifest: HTTP '+response?.status());
      const manifest = await response.json();
      const supported = await page.evaluate(() => {
        const wasm = WebAssembly as typeof WebAssembly & { Suspending?: unknown; promising?: unknown };
        return typeof wasm.Suspending === 'function' && typeof wasm.promising === 'function';
      });
      const reason = jspiUnavailableReason(suspensionCapabilities(manifest, 'jspi', supported));
      if (reason) test.info().skip(true, q.get('game')+': '+reason);
    }
  }
  await page.goto(`/?${q}`);
  if (preflightRoute) await page.unroute('**/favicon.ico', faviconRoute);
  await page.waitForFunction(() => {
    const t = (window as unknown as { __BGT_TEST__?: { ready(): boolean; failed(): boolean } }).__BGT_TEST__;
    return !!t && (t.ready() || t.failed());
  }, null, { timeout: 30_000 });
  const status = await page.evaluate(() => ((window as any).__BGT_TEST__.ready() ? 'ready' : 'failed')) as 'ready' | 'failed';
  if (status === 'ready' && q.get('suspension') === 'jspi' && !options.allowSuspensionFallback)
    expect((await diagnostics(page)).suspension, 'JSPI-mode test must execute the JSPI artifact').toBe('jspi');
  return status;
}

/** Skip (or fail, when BGT_REQUIRE_WEBGPU=1) if this project wanted WebGPU and did not get it. */
export async function assertBackend(page: Page, backendParam: string, testInfo: TestInfo): Promise<string> {
  const d = await diagnostics(page);
  if (backendParam === 'webgpu' && d.backend !== 'webgpu') {
    if (requireWebGPU() || webGPUWasAvailable(page))
      throw new Error(`WebGPU required/adapter present but got ${d.backend}: ${d.backendNotes.join('; ')}`);
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
