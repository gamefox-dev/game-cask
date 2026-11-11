import { test, expect } from '@playwright/test';
// @ts-expect-error shared engine request evidence
import { captureEngineErrors } from '../../tools/engine/capture.mjs';
// @ts-expect-error pinned runtime manifest
import { runtimeById } from '../../tools/engine/runtime.mjs';
// @ts-expect-error offline runtime verification
import { verifyRuntime } from '../../tools/engine/runtime.mjs';
// @ts-expect-error CC0 fixture build
import { buildFixture } from '../../tools/engine/fixture.mjs';
// @ts-expect-error isolated server
import { serveEngine } from '../../tools/engine/server.mjs';
import { openEngineProfile, engineKey, engineTiming, observeEngineFrames, engineDiagnostics } from '../support/engine-profile';
import { attachScreenshot, readPixels, diffFraction } from '../e2e/fixtures';
import { expectChange } from '../support/evidence';

test('Godot 3 CC0 pack boots, draws and changes screen on a DOM key; reports RAF timing', async ({ page }, info) => {
  info.annotations.push({ type: 'catches', description: 'Rejects invalid fixture/runtime pairing, missing assets, nonfunctional DOM input, unchanged rendered pixels or unavailable timing.' });
  let available = false;
  try { verifyRuntime('godot-3.5.3'); available = true; } catch (e) {
    if (!(e as Error).message.includes('not provisioned')) throw e;
  }
  test.skip(!available, 'Official godot-3.5.3 runtime not provisioned; run npm run engine:provision -- godot-3.5.3 <offline.zip>');
  const build = buildFixture(), server = await serveEngine(build);
  try {
    const capture = await captureEngineErrors(page, runtimeById('godot-3.5.3').fileHashes); await openEngineProfile(page, server.url); await observeEngineFrames(page, 20);
    const before = await readPixels(page);
    await attachScreenshot(page, info, 'engine-before.png');
    expect(before.data.some((x, i) => i % 4 === 0 && x > 200)).toBe(true);
    await expectChange(page, () => engineKey(page, 'Enter'), { region: { x: 0, y: 0, w: 320, h: 180 }, minFraction: .8 });
    const after = await readPixels(page); await attachScreenshot(page, info, 'engine-after.png');
    expect(diffFraction(before, after)).toBeGreaterThan(.8);
    await observeEngineFrames(page, 60); const timing = await engineTiming(page);
    expect(timing.samples).toBeGreaterThanOrEqual(60); expect(timing.avgMs).toBeGreaterThan(0); expect(timing.p95Ms).toBeGreaterThan(0);
    expect(timing.source).toContain('NOT engine');
    const d = await engineDiagnostics(page); expect(d.path).toBe('engineProfile'); expect(d.capabilities.deterministic).toBe(false);
    await expect(page.evaluate(() => (window as any).__BGT_TEST__.snapshot())).rejects.toThrow(/does not support/);
    const network = await capture.finish();
    await info.attach('engine-network.json', { body: JSON.stringify(network), contentType: 'application/json' });
    expect(d.errors).toEqual([]); expect(network.errors).toEqual([]);
    await info.attach('engine-profile.json', { body: JSON.stringify({ diagnostics: d, timing }), contentType: 'application/json' });
  } finally { await server.close(); }
});
