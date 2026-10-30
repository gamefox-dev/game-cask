import { chromium, type Page, type TestInfo } from '@playwright/test';
import { expect } from './fixtures';

/** Separate launch configs: Metal WebGL lacks §13 indexed-blend/limits on some Chromium builds.
 * Use the same executable's SwiftShader for the WebGL cross image; WebGPU uses native Metal.
 * Every requested backend/capability is asserted by callers; no availability skip. */
export async function otherBackend<T>(backend: string, info: TestInfo, run: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ channel: 'chromium', args: backend === 'webgpu' ?
    ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] :
    ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL,
      viewport: { width: 960, height: 540 } });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    const result = await run(page);
    expect(errors).toEqual([]);
    return result;
  } finally { await browser.close(); }
}
