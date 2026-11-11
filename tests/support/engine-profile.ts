// Engine-runtime browser adapter. Shared BGT evidence helpers work after openEngineProfile.
// Actual keyboard/pointer input is dispatched through Playwright DOM events.
import type { Page } from '@playwright/test';
export async function openEngineProfile(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => {
    const t = (window as any).__BGT_TEST__;
    return t && (t.ready() || t.failed());
  }, null, { timeout: 60000 });
  const d = await engineDiagnostics(page);
  if (d.errors.length) throw new Error(JSON.stringify(d.errors));
}
export const engineDiagnostics = (page: Page): Promise<any> => page.evaluate(() => (window as any).__BGT_TEST__.diagnostics());
export async function engineKey(page: Page, code: string, frames = 3): Promise<void> {
  await page.locator('canvas').focus(); await page.keyboard.down(code);
  await observeEngineFrames(page, frames); await page.keyboard.up(code);
  await observeEngineFrames(page, frames);
}
/** Wait for browser RAFs, NOT deterministic game updates. */
export const observeEngineFrames = (page: Page, n: number): Promise<void> => page.evaluate(k => (window as any).__BGT_TEST__.waitFrames(k), n);
export const engineTiming = (page: Page): Promise<{ source: string; samples: number; avgMs: number | null; p95Ms: number | null }> => page.evaluate(() => (window as any).__BGT_TEST__.timing());
export function collectEngineErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push('page: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  page.on('requestfailed', r => errors.push('request: ' + r.url() + ' ' + r.failure()?.errorText));
  return errors;
}
