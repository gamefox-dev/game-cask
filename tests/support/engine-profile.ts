// Engine-runtime browser adapter. Shared BGT evidence helpers work after openEngineProfile.
// Actual keyboard/pointer input is dispatched through Playwright DOM events.
import type { Page } from '@playwright/test';
export async function openEngineProfile(page: Page, url: string): Promise<void> {
  await page.goto(url);
  // Interval polling, not Playwright's default rAF polling: the K59 frame pacer virtualizes the page's rAF.
  await page.waitForFunction(() => {
    const t = (window as any).__BGT_TEST__;
    return t && (t.ready() || t.failed());
  }, null, { timeout: 60000, polling: 50 });
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
// K59: pack/wasm delivery evidence from the build manifest: collectEngineErrors(page, files, { build: BUILD_DIR }).
// @ts-expect-error shared ESM collector
export { buildAssets } from '../../tools/engine/capture.mjs';
// K59 performance evidence. installEnginePerf BEFORE navigation (wasm memory + audio observation), then
// measureEngine(page, { ms }) -> game-cask/engine-perf/1 summary: renderer/software, RAF window, main-thread CPU per
// frame (CDP), JS heap / wasm / process memory, audio output presence. engineRenderer(page) alone gives the renderer.
// @ts-expect-error shared ESM perf helpers
export { installEnginePerf, measureEngine, engineRenderer, softwareRenderer } from '../../tools/engine/perf.mjs';
/** K59: engineProfile.allowedErrors occurrence counts ({ id, message|pattern, justification, evidence, count, continuations }). */
export const engineAllowlisted = (page: Page): Promise<any[]> => page.evaluate(() => (window as any).__BGT_TEST__.diagnostics().allowlisted ?? []);
// K59 Q7: test-only frame pacer. installEngineFramePacer(page) BEFORE navigation; then engine frames run only on
// engineAdvance(page, n) (= __BGT_TEST__.step(n)), engineInputAt(page, frame, events) keys inputs to engine frames and
// engineFrameHash(page, n) advances n frames and hashes the canvas read in the same task. Pair it with the recorded
// engineProfile.engineArgs ["--fixed-fps", "60"] so Godot steps by a fixed delta.
// @ts-expect-error shared ESM pacer
export { installEngineFramePacer, engineFrame, engineAdvance, engineInputAt, engineFrameHash } from '../../tools/engine/pacer.mjs';
