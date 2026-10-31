import type { Browser, Page, TestInfo } from '@playwright/test';
import { resolve } from 'node:path';

const available = new WeakSet<Page>();
// A comparison can create fresh pages/contexts after its first successful WebGPU capture.
// Keep that success for the test's browser, but never leak it to an independent test/launch.
const availableBrowsers = new WeakMap<TestInfo, WeakSet<Browser>>();
export const webGPUWasAvailable = (page: Page): boolean => available.has(page);

/** Probe the actual launch before starting a GPU guest: adapter, device, submission,
 * exact readback and survival across a task turn. Only initial probe failure can skip;
 * loss after a successful probe or guest/render failures always remain failures. */
export async function assertWebGPUAvailable(page: Page, info: TestInfo): Promise<void> {
  const browser = page.context().browser();
  const url = new URL('/__bgt_webgpu_probe__', info.project.use.baseURL).href;
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>WebGPU probe</title>' }));
  let reason: string | null;
  try {
    await page.goto(url);
    reason = await page.evaluate(async path => {
      const { webGPUProbeReason } = await import(/* @vite-ignore */ path);
      return webGPUProbeReason();
    }, `/@fs${resolve('bgt/renderers/webgpu/probe.ts')}`);
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
