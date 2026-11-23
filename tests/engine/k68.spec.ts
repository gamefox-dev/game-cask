// K68: one engineProfile -> several bundles (Q11), delivery metrics + first frame (Q12), precompressed serving, on the
// CC0 Godot 3 fixture. Real-runtime cases skip only when the pinned runtime is not cached
// (npm run engine -- fetch godot-3.5.3-nothreads).
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error runtime cache
import { isProvisioned, verifyRuntime, ENGINE_ROOT } from '../../tools/engine/runtime.mjs';
// @ts-expect-error CC0 fixture build
import { buildFixture, fixtureDir } from '../../tools/engine/fixture.mjs';
// @ts-expect-error isolated server
import { serveEngine } from '../../tools/engine/server.mjs';
// @ts-expect-error CC0 fixture writer
import { DUPLICATE_SIGNAL_ERROR } from '../fixtures/engine/godot3-fixture.mjs';
import { openEngineProfile, engineKey, engineDiagnostics, collectEngineErrors, installEnginePerf } from '../support/engine-profile';
import { readPixels } from '../e2e/fixtures';

const ID = 'godot-3.5.3-nothreads';
const needRuntime = () => test.skip(!isProvisioned(ID), `official runtime ${ID} not cached; run npm run engine -- fetch ${ID}`);
const manifestOf = (build: string) => JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
const scratch = () => mkdtempSync(join(process.env.BGT_TRIAL_SCRATCH ?? tmpdir(), 'k68-'));
const FIXED = ['--fixed-fps', '60'];
const allowEntry = { message: DUPLICATE_SIGNAL_ERROR, justification: 'The CC0 fixture main.gd connects tree_entered to _noop twice in _ready (see main.gd in the pack).', evidence: 'evidence.txt' };
// One game.json: the base profile is the reproducible replay build (--fixed-fps), "deploy" is real time + precompressed.
const variantFixture = (variants?: string) => buildFixture(ID, { duplicateSignal: true, suffix: 'k68', files: { 'evidence.txt': 'CC0 fixture: main.gd connects tree_entered twice\n' },
  profile: { engineArgs: FIXED, allowedErrors: [allowEntry], variants: { deploy: { engineArgs: [], precompress: true, note: 'real-time deploy bundle' } } }, variants });
const identityArgs = (build: string) => JSON.parse(readFileSync(join(build, 'index.html'), 'utf8').match(/installEngineTestAdapter\(canvas, (\{.*?\})\);\n/)![1]).engineArgs;

test.describe.configure({ mode: 'serial' });

test('Q11: one game.json yields the base and the deploy bundle (build.mjs --variant all), sharing identity and evidence', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  info.annotations.push({ type: 'catches', description: 'A deploy bundle needed a second game.json whose allowlist evidence could not reach ../reports; variants must build both bundles from one profile with the same pack, runtime and evidence hashes and only the overridden engine args.' });
  needRuntime();
  const base = variantFixture(), deployDir = base + '-deploy';
  const out = execFileSync(process.execPath, ['tools/build/build.mjs', fixtureDir(base), '--variant', 'all'], { cwd: ENGINE_ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 300000 });
  await info.attach('build.log', { body: out, contentType: 'text/plain' });
  expect(out).toContain('(variant deploy of cc0-engine-dupsignal-k68)');
  const b = manifestOf(base), d = manifestOf(deployDir);
  expect(b.id).toBe('cc0-engine-dupsignal-k68'); expect(d.id).toBe('cc0-engine-dupsignal-k68-deploy');
  expect(b.variant).toBeNull(); expect(d.variant).toMatchObject({ name: 'deploy', of: b.id, overrides: { engineArgs: [], precompress: true }, note: 'real-time deploy bundle' });
  expect(b.variants).toEqual(['deploy']); expect(d.variants).toEqual(['deploy']);
  expect(b.engineProfile.engineArgs).toEqual(FIXED); expect(d.engineProfile.engineArgs).toEqual([]);
  expect(identityArgs(base)).toEqual(FIXED); expect(identityArgs(deployDir)).toEqual([]);
  for (const k of ['packSha256', 'runnerSha256']) expect(d.engineProfile[k]).toBe(b.engineProfile[k]);
  expect(d.engineProfile.runtime.id).toBe(b.engineProfile.runtime.id);
  expect(d.files['game.pck']).toBe(b.files['game.pck']); expect(d.files['godot.wasm']).toBe(b.files['godot.wasm']);
  expect(d.engineProfile.allowedErrors).toEqual(b.engineProfile.allowedErrors);
  expect(b.engineProfile.allowedErrors[0].evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  // Q12: brotli next to raw and gzip, per file and for the download; precompressed siblings only on the deploy variant.
  for (const m of [b.metrics, d.metrics]) {
    expect(m.schema).toBe('game-cask/engine-bundle-metrics/2');
    expect(m.downloadBrotliBytes).toBeGreaterThan(0); expect(m.downloadBrotliBytes).toBeLessThan(m.downloadGzipBytes); expect(m.downloadGzipBytes).toBeLessThan(m.downloadBytes);
    expect(m.files['godot.wasm'].brotliBytes).toBeLessThan(m.files['godot.wasm'].gzipBytes);
  }
  expect(b.precompressed).toBeUndefined(); expect(existsSync(join(base, 'godot.wasm.br'))).toBe(false);
  expect(d.precompressed['godot.wasm'].br.bytes).toBe(d.metrics.files['godot.wasm'].brotliBytes);
  expect(readFileSync(join(deployDir, 'godot.wasm.br')).length).toBe(d.precompressed['godot.wasm'].br.bytes);
  await info.attach('metrics.json', { body: JSON.stringify({ base: { ...b.metrics, files: undefined }, deploy: { ...d.metrics, files: undefined }, precompressed: d.precompressed }), contentType: 'application/json' });
});

test('Q12: engine:probe records firstFrameMs (navigation start -> first non-clear frame) in probe.json and diagnostics', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium'); // the spec runner; the probe launches its own Chromium
  info.annotations.push({ type: 'catches', description: 'No load-to-first-frame figure on the engine path (BGT has load_to_first_frame_ms); the probe must record when the first non-clear canvas frame (the fixture\'s red screen) appeared.' });
  needRuntime();
  const deploy = variantFixture('deploy') + '-deploy';
  const out = scratch();
  writeFileSync(join(out, 'explore.mjs'), 'export default async p => { await p.key("Enter"); };\n');
  execFileSync(process.execPath, ['tools/engine/probe.mjs', deploy, join(out, 'explore.mjs'), out, '--software'], { cwd: ENGINE_ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 90000 });
  const report = JSON.parse(readFileSync(join(out, 'probe.json'), 'utf8'));
  await info.attach('probe.json', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.errors).toEqual([]);
  expect(report.variant.name).toBe('deploy');
  expect(report.firstFrameMs).toBeGreaterThan(0);
  expect(report.firstFrameMs).toBe(report.diagnostics.firstFrameMs);
  expect(report.firstFrame.schema).toBe('game-cask/engine-first-frame/1');
  // The first non-clear frame is the fixture's red full-screen rectangle (not Godot's grey clear), after the wasm request.
  expect(report.firstFrame.sample.firstPixel.slice(0, 3)).toEqual([255, 0, 0]);
  expect(report.firstFrame.loadStartMs).toBeGreaterThan(0); expect(report.firstFrame.loadStartMs).toBeLessThan(report.firstFrameMs);
  expect(report.firstFrame.sinceLoadStartMs).toBeCloseTo(report.firstFrameMs - report.firstFrame.loadStartMs, 3);
  expect(report.firstFrame.firstDrawMs).toBeLessThanOrEqual(report.firstFrameMs);
  // vK68: the observer reports its own cost; the fixture shows content on its first drawing frame (nothing skipped).
  expect(report.firstFrame.skippedDrawFrames).toBe(0); expect(report.firstFrame.overhead.sampleMs).toBeGreaterThan(0);
  expect(report.firstFrame.overhead.wrappedDrawCalls).toBe(report.firstFrame.drawCalls);
  expect(report.allowlisted[0].count).toBe(1);
});

test('precompressed deploy bundle: served by Accept-Encoding (wasm stays application/wasm), boots with intact bodies; identity by default', async ({ page }, info) => {
  info.annotations.push({ type: 'catches', description: 'Precompressed siblings with a wrong Content-Type would lose wasm streaming compilation, wrong bytes would corrupt the runtime, and the delivery evidence must still check the DECODED bodies against the manifest.' });
  needRuntime();
  const deploy = variantFixture('deploy') + '-deploy';
  const plain = await serveEngine(deploy);
  try {
    const r = await fetch(plain.url + 'godot.wasm', { headers: { 'Accept-Encoding': 'br' } });
    expect(r.headers.get('content-encoding')).toBeNull(); expect(r.headers.get('vary')).toBeNull();
    expect(Number(r.headers.get('content-length'))).toBe(manifestOf(deploy).metrics.files['godot.wasm'].bytes);
  } finally { await plain.close(); }
  const server = await serveEngine(deploy, { precompressed: true });
  try {
    expect(server.precompressed).toContain('godot.wasm');
    const responses: Record<string, Record<string, string>> = {};
    page.on('response', r => { const name = new URL(r.url()).pathname.slice(1); if (name) responses[name] = r.headers(); });
    const capture = await collectEngineErrors(page, verifyRuntime(ID).files, { build: deploy });
    await installEnginePerf(page);
    await openEngineProfile(page, server.url);
    await engineKey(page, 'Enter');
    const after = await readPixels(page);
    expect(after.data[0]).toBeLessThan(50); expect(after.data[1]).toBeGreaterThan(200); // cyan after Enter: the runtime works
    const network = await capture.finish(), d = await engineDiagnostics(page);
    await info.attach('precompressed.json', { body: JSON.stringify({ responses, bodies: network.bodies }), contentType: 'application/json' });
    expect(network.errors).toEqual([]); expect(d.errors).toEqual([]);
    // Chromium sends Accept-Encoding with br (and gzip) to localhost; the server prefers br.
    expect(responses['godot.wasm']['content-encoding']).toBe('br'); expect(responses['godot.wasm']['content-type']).toBe('application/wasm');
    expect(responses['godot.wasm'].vary).toBe('Accept-Encoding'); expect(responses['godot.js']['content-encoding']).toBe('br');
    const m = manifestOf(deploy);
    // The pack gets a sibling only when it shrinks by >= 5% (files >= 1 KiB); its decoded body is checked like the wasm.
    expect(responses['game.pck']['content-encoding']).toBe(m.precompressed['game.pck'] ? 'br' : undefined);
    expect(network.bodies.find((x: any) => x.url.endsWith('/game.pck'))).toMatchObject({ received: m.metrics.files['game.pck'].bytes, sha256: m.files['game.pck'] });
    const wasm = network.bodies.find((x: any) => x.url.endsWith('/godot.wasm'));
    expect(wasm).toMatchObject({ encoding: 'br', received: manifestOf(deploy).metrics.files['godot.wasm'].bytes, sha256: manifestOf(deploy).files['godot.wasm'] });
    expect(d.firstFrameMs).toBeGreaterThan(0);
  } finally { await server.close(); }
});
