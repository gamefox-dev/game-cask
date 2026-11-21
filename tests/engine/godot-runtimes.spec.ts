// CC0 fixture packs booted on REAL official Godot web runtimes (3.x and 4.x, threaded and non-threaded).
// Each case skips only when that runtime is not in the local cache (npm run engine -- fetch ID); a corrupted
// cached runtime fails. Non-threaded and threaded runtimes differ in serving: threads need COOP/COEP.
import { test, expect } from '@playwright/test';
// @ts-expect-error shared engine request evidence
import { captureEngineErrors } from '../../tools/engine/capture.mjs';
// @ts-expect-error runtime cache
import { isProvisioned, verifyRuntime } from '../../tools/engine/runtime.mjs';
// @ts-expect-error CC0 fixture build
import { buildFixture } from '../../tools/engine/fixture.mjs';
// @ts-expect-error isolated server
import { serveEngine } from '../../tools/engine/server.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openEngineProfile, engineKey, engineTiming, observeEngineFrames, engineDiagnostics } from '../support/engine-profile';
import { attachScreenshot, readPixels, diffFraction } from '../e2e/fixtures';
import { expectChange } from '../support/evidence';

const IDS = (process.env.BGT_ENGINE_RUNTIMES ?? 'godot-3.5.3-nothreads,godot-3.5.3-threads,godot-4.3-nothreads,godot-4.3-threads').split(',');
for (const id of IDS) {
  test(`${id}: CC0 pack boots on the official runtime, draws, reacts to Enter; headers match threading`, async ({ page }, info) => {
    info.annotations.push({ type: 'catches', description: 'Wrong PCK format/normalization for the engine version, wrong shell API, missing COOP/COEP for threaded builds (no SharedArrayBuffer), missing runtime files, dead DOM input or unchanged pixels.' });
    test.skip(!isProvisioned(id), `official runtime ${id} not cached; run npm run engine -- fetch ${id}`);
    const runtime = verifyRuntime(id), build = buildFixture(id), server = await serveEngine(build);
    const manifest = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
    try {
      const capture = await captureEngineErrors(page, runtime.files);
      const response = await page.goto(server.url);
      const threads = runtime.runtime.requirements.threads;
      expect(response!.headers()['cross-origin-embedder-policy']).toBe(threads ? 'require-corp' : undefined);
      expect(response!.headers()['cross-origin-opener-policy']).toBe(threads ? 'same-origin' : undefined);
      await openEngineProfile(page, server.url);
      expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(threads);
      await observeEngineFrames(page, 30);
      const before = await readPixels(page);
      await attachScreenshot(page, info, 'before.png');
      // Red fill from the CC0 scene; the default clear colour is grey, so this proves the pack's script ran.
      const red = (px: { data: Uint8Array | number[] }) => { let n = 0; for (let i = 0; i < px.data.length; i += 4) if (px.data[i] > 200 && px.data[i + 1] < 60 && px.data[i + 2] < 60) n++; return n / (px.data.length / 4); };
      expect(red(before)).toBeGreaterThan(0.8);
      await expectChange(page, () => engineKey(page, 'Enter'), { region: { x: 0, y: 0, w: 320, h: 180 }, minFraction: .8 });
      const after = await readPixels(page); await attachScreenshot(page, info, 'after.png');
      expect(diffFraction(before, after)).toBeGreaterThan(.8);
      expect(red(after)).toBeLessThan(0.05);
      await observeEngineFrames(page, 60); const timing = await engineTiming(page);
      expect(timing.samples).toBeGreaterThanOrEqual(60);
      const d = await engineDiagnostics(page); expect(d.path).toBe('engineProfile'); expect(d.runtimeId).toBe(id);
      const network = await capture.finish();
      await info.attach('network.json', { body: JSON.stringify(network), contentType: 'application/json' });
      await info.attach('bundle-metrics.json', { body: JSON.stringify(manifest.metrics), contentType: 'application/json' });
      expect(d.errors).toEqual([]); expect(network.errors).toEqual([]);
    } finally { await server.close(); }
  });
}

// Negative control: the same threaded bundle served WITHOUT COOP/COEP must not boot (proves the headers matter).
test('threaded runtime without cross-origin isolation headers fails loudly', async ({ page }, info) => {
  info.annotations.push({ type: 'catches', description: 'A deploy that drops COOP/COEP would silently hang or crash a threaded Godot build; the shell must report it.' });
  const id = IDS.find(x => x.endsWith('-threads') && isProvisioned(x));
  test.skip(!id, 'no threaded runtime cached');
  const build = buildFixture(id), m = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const name = (req.url === '/' ? '/index.html' : req.url!.split('?')[0]).slice(1);
    if (!m.files[name]) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.html') ? 'text/html' : name.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' });
    res.end(readFileSync(join(build, name)));
  });
  const port = Number(process.env.BGT_E2E_PORT ?? 5189);
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => (window as any).__BGT_TEST__?.failed(), null, { timeout: 30000 });
    const d = await engineDiagnostics(page);
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(false);
    expect(JSON.stringify(d.errors)).toMatch(/cross-origin isolation/);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});

test('engine stderr: Godot warnings are recorded as warnings, errors and unprefixed lines still fail', async ({ page }, info) => {
  info.annotations.push({ type: 'catches', description: 'Severity classification must never hide an engine ERROR (or context-free stderr) as a warning.' });
  const { createServer } = await import('node:http');
  const adapter = readFileSync(new URL('../../tools/engine/browser-adapter.js', import.meta.url));
  const server = createServer((req, res) => {
    if (req.url === '/browser-adapter.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(adapter); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<canvas id="c"></canvas><script type="module">import { installEngineTestAdapter } from "./browser-adapter.js"; window.t = installEngineTestAdapter(document.getElementById("c"), { renderer: "webgl2" });</script>');
  });
  const port = Number(process.env.BGT_E2E_PORT ?? 5189);
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).t);
    const result = await page.evaluate(() => {
      const t = (window as any).t;
      const s = ['USER WARNING: Invalid mix rate of 0', 'Defaulting mix rate to value 44100.', '   at: _get_configured_mix_rate (servers/audio_server.cpp:125)',
        'Blocking on the main thread is very dangerous, see https://emscripten.org/docs/porting/pthreads.html', 'ERROR: Condition "x" is true.', '   at: f (a.cpp:1)', 'unprefixed after error']
        .map(x => t.engineStderr(x));
      t.log('stdout resets context'); s.push(t.engineStderr('context-free stderr'));
      return { s, d: (window as any).__BGT_TEST__.diagnostics() };
    });
    expect(result.s).toEqual(['warning', 'warning', 'warning', 'warning', 'error', 'error', 'error', 'error']);
    expect(result.d.warnings).toHaveLength(4); expect(result.d.errors).toHaveLength(4);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});
