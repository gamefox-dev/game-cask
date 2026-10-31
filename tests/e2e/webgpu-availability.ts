import type { Browser, Page, TestInfo } from '@playwright/test';

const available = new WeakSet<Page>();
// A comparison can create fresh pages/contexts after its first successful WebGPU capture.
// Keep that success for the test's browser, but never leak it to an independent test/launch.
const availableBrowsers = new WeakMap<TestInfo, WeakSet<Browser>>();
export const webGPUWasAvailable = (page: Page): boolean => available.has(page);

/** Probe on the actual launch/page before starting a GPU guest (which could abort on fallback).
 * Only adapter acquisition can skip. Device creation, guest execution and rendering errors
 * after a successful adapter probe remain failures, never availability skips. */
export async function assertWebGPUAvailable(page: Page, info: TestInfo): Promise<void> {
  const browser = page.context().browser();
  const url = new URL('/__bgt_webgpu_probe__', info.project.use.baseURL).href;
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>WebGPU probe</title>' }));
  let reason: string | null;
  try {
    await page.goto(url);
    reason = await page.evaluate(async () => {
      if (!navigator.gpu) return 'navigator.gpu is absent';
      try {
        return await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }) ? null : 'requestAdapter returned null';
      } catch (e) {
        // Dawn can reject instead of returning null when its external Instance is unavailable.
        if (e instanceof DOMException && e.name === 'OperationError') return `requestAdapter: ${e.name}: ${e.message}`;
        throw e;
      }
    });
  } finally { await page.unroute(url); }
  if (reason) {
    const message = `WebGPU unavailable: ${reason}`;
    if (available.has(page) || (browser && availableBrowsers.get(info)?.has(browser)))
      throw new Error(`WebGPU adapter lost after a successful probe: ${reason}`);
    if (process.env.BGT_REQUIRE_WEBGPU === '1') throw new Error(`WebGPU required but ${message}`);
    info.skip(true, message);
  } else {
    available.add(page);
    if (browser) {
      let browsers = availableBrowsers.get(info);
      if (!browsers) availableBrowsers.set(info, browsers = new WeakSet<Browser>());
      browsers.add(browser);
    }
  }
}
