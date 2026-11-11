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
// Install BEFORE navigation, then await capture.finish() before asserting errors.
// Pass the pinned runtime fileHashes (not a porter-authored expected digest).
// @ts-expect-error shared ESM collector
export { captureEngineErrors as collectEngineErrors } from '../../tools/engine/capture.mjs';
