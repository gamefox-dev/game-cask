import { chromium, firefox, webkit, type BrowserType, type Page, type TestInfo } from '@playwright/test';
import { expect } from './fixtures';
import { webgpuArgs, webglArgs } from './browser-options';

/** The second backend of a cross-backend comparison, in a separate launch of the SAME browser engine and with the
 * project's page geometry (viewport and device pixel ratio), so both images have the same presented size.
 * Chromium: separate launch configs, because Metal WebGL lacks §13 indexed-blend/limits on some Chromium builds.
 * Use the same executable's SwiftShader for the WebGL cross image; WebGPU uses native Metal on macOS and Chromium's
 * platform backend elsewhere. WebKit/Firefox (opt-in projects, K69): the engine's own WebGL 2 and WebGPU, so a
 * WebKit run compares WebKit's two backends instead of mixing a DPR-2 WebKit image with a DPR-1 Chromium one.
 * openGame probes WebGPU on this launch and reports an availability skip (or required-hardware
 * failure) before guest startup. Callers still assert the actual selected backend/capabilities. */
export async function otherBackend<T>(backend: string, info: TestInfo, run: (page: Page) => Promise<T>): Promise<T> {
  const use = info.project.use as { browserName?: string; viewport?: { width: number; height: number } | null;
    deviceScaleFactor?: number; baseURL?: string };
  const engine = use.browserName ?? 'chromium';
  const types: Record<string, BrowserType> = { chromium, firefox, webkit };
  const type = types[engine];
  if (!type) throw new Error(`otherBackend: unknown browser ${engine}`);
  const browser = engine === 'chromium'
    ? await chromium.launch({ channel: 'chromium', args: backend === 'webgpu' ? webgpuArgs : webglArgs })
    : await type.launch();
  try {
    const context = await browser.newContext({ baseURL: use.baseURL,
      viewport: use.viewport ?? { width: 960, height: 540 }, deviceScaleFactor: use.deviceScaleFactor ?? 1 });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    const result = await run(page);
    expect(errors).toEqual([]);
    return result;
  } finally { await browser.close(); }
}
