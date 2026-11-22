// K59: engine-runtime test tooling on CC0 fixtures: pack delivery evidence (Q2), GPU switch + perf helpers (Q3),
// recorded engine error allowlist (Q5) and a WebKit boot probe. Real-runtime cases skip only when the pinned
// runtime is not cached (npm run engine -- fetch godot-3.5.3-nothreads).
import { test, expect, chromium, webkit } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error shared request evidence collector
import { captureEngineErrors } from '../../tools/engine/capture.mjs';
// @ts-expect-error runtime cache
import { isProvisioned, verifyRuntime, ENGINE_ROOT } from '../../tools/engine/runtime.mjs';
// @ts-expect-error CC0 fixture build
import { buildFixture } from '../../tools/engine/fixture.mjs';
// @ts-expect-error isolated server
import { serveEngine } from '../../tools/engine/server.mjs';
// @ts-expect-error perf helpers
import { chromiumLaunch } from '../../tools/engine/perf.mjs';
// @ts-expect-error CC0 fixture writer
import { DUPLICATE_SIGNAL_ERROR } from '../fixtures/engine/godot3-fixture.mjs';
import { openEngineProfile, engineKey, observeEngineFrames, engineDiagnostics, engineAllowlisted, installEnginePerf, measureEngine } from '../support/engine-profile';
import { webgl2Gpu } from '../e2e/browser-options';
import { installEngineFramePacer, engineInputAt, engineFrameHash, engineFrame } from '../support/engine-profile';
import type { Browser } from '@playwright/test';

const ID = 'godot-3.5.3-nothreads';
const PORT = Number(process.env.BGT_E2E_PORT ?? 5189);
const needRuntime = () => test.skip(!isProvisioned(ID), `official runtime ${ID} not cached; run npm run engine -- fetch ${ID}`);
const manifestOf = (build: string) => JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
const allowEntry = { message: DUPLICATE_SIGNAL_ERROR, justification: 'The CC0 fixture main.gd connects tree_entered to _noop twice in _ready (see main.gd in the pack).', evidence: 'evidence.txt' };
const allowFixture = () => buildFixture(ID, { duplicateSignal: true, suffix: 'allow', files: { 'evidence.txt': 'CC0 fixture: main.gd lines 6-7 connect tree_entered twice\n' }, profile: { allowedErrors: [allowEntry] } });
const probe = (args: string[]) => execFileSync(process.execPath, ['tools/engine/probe.mjs', ...args], { cwd: ENGINE_ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 90000 });
const scratch = () => mkdtempSync(join(process.env.BGT_TRIAL_SCRATCH ?? tmpdir(), 'k59-probe-'));

test.describe('Q2: pack delivery evidence', () => {
  for (const mode of ['valid', 'cancel-before-EOF', 'hash-mismatch', 'length-mismatch', 'no-content-length', 'never-fetched']) {
    test('pack evidence distinguishes ' + mode, async ({ page }, info) => {
      info.annotations.push({ type: 'catches', description: 'The pack gets the wasm delivery rule: only a complete HTTP 200 body with the manifest hash AND length can classify a Chromium cancellation; partial, wrong-hash, wrong-length, unsized and missing pack bodies fail.' });
      const bytes = Buffer.alloc(4 * 1024 * 1024 + 123, 42), hash = createHash('sha256').update(bytes).digest('hex');
      const server = createServer((req, res) => {
        if (req.url === '/') {
          res.setHeader('Content-Type', 'text/html');
          res.end('<script>window.done=false; const c=new AbortController(); ' + (mode === 'never-fetched' ? 'window.done=true;' :
            'fetch("/game.pck",{signal:c.signal}).then(async r=>{const reader=r.body.getReader(); for(;;){const x=await reader.read(); if(x.done)break; if(' + JSON.stringify(mode === 'cancel-before-EOF') + ')c.abort();}}).catch(e=>window.loadError=String(e)).finally(()=>window.done=true);') + '</script>');
        } else if (req.url === '/game.pck') {
          if (mode === 'no-content-length') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(bytes); return; }
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
          if (mode === 'cancel-before-EOF') { res.write(bytes.subarray(0, 65536)); setTimeout(() => res.destroy(), 200); }
          else res.end(mode === 'hash-mismatch' ? Buffer.alloc(bytes.length, 43) : bytes);
        } else { res.writeHead(204); res.end(); }
      });
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
      try {
        const capture = await captureEngineErrors(page, {}, { assets: { 'game.pck': { sha256: hash, bytes: bytes.length + (mode === 'length-mismatch' ? 1 : 0) } } });
        await page.goto('http://127.0.0.1:' + PORT + '/'); await page.waitForFunction(() => (window as any).done);
        const network = await capture.finish();
        await info.attach('pack-evidence.json', { body: JSON.stringify(network), contentType: 'application/json' });
        if (mode === 'valid') { expect(network.errors).toEqual([]); expect(network.bodies[0]).toMatchObject({ done: true, received: bytes.length, sha256: hash }); }
        else {
          expect(network.errors.length).toBeGreaterThan(0);
          expect(network.requests.every((r: any) => r.classification !== 'canceled-after-complete')).toBe(true);
          if (mode === 'never-fetched') expect(network.errors).toContain('missing runtime body evidence: game.pck');
          else expect(network.errors.some((e: string) => /runtime body integrity: .*game\.pck|request: .*game\.pck/.test(e))).toBe(true);
        }
      } finally { await page.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
    });
  }

  test('real runtime: the pack and wasm bodies match the build manifest; a wrong pack pin fails', async ({ browser }, info) => {
    info.annotations.push({ type: 'catches', description: 'The served pack must be observed through the official loader and checked against the manifest hash/length; a mismatching pin must not pass.' });
    needRuntime();
    const build = buildFixture(ID), manifest = manifestOf(build), server = await serveEngine(build);
    try {
      const page = await browser.newPage();
      const capture = await captureEngineErrors(page, verifyRuntime(ID).files, { build });
      await openEngineProfile(page, server.url); await observeEngineFrames(page, 10);
      const network = await capture.finish();
      await info.attach('network.json', { body: JSON.stringify(network), contentType: 'application/json' });
      expect(network.errors).toEqual([]);
      const pack = network.bodies.find((b: any) => new URL(b.url).pathname === '/game.pck');
      expect(pack).toMatchObject({ status: 200, done: true, sha256: manifest.files['game.pck'], received: manifest.metrics.files['game.pck'].bytes });
      await page.close();
      const wrong = await browser.newPage();
      const bad = await captureEngineErrors(wrong, verifyRuntime(ID).files, { assets: { 'game.pck': { sha256: '0'.repeat(64), bytes: manifest.metrics.files['game.pck'].bytes } } });
      await openEngineProfile(wrong, server.url); await observeEngineFrames(wrong, 5);
      expect((await bad.finish()).errors.some((e: string) => e.startsWith('runtime body integrity: ') && e.endsWith('/game.pck'))).toBe(true);
      await wrong.close();
    } finally { await server.close(); }
  });
});

test.describe('Q5: recorded engine error allowlist', () => {
  test('adapter: only matching ERROR lines (and their at: continuations) are allowed and counted', async ({ page }, info) => {
    info.annotations.push({ type: 'catches', description: 'An allowlist must never hide unmatched errors, aborts/traps (even if listed) or continuation lines of an unmatched error; counts must be exact.' });
    const adapter = readFileSync(new URL('../../tools/engine/browser-adapter.js', import.meta.url));
    const identity = { renderer: 'webgl2', allowedErrors: [
      { id: 'E1', message: 'ERROR: game line A.', justification: 'j', evidence: 'e' },
      { id: 'E2', pattern: 'ERROR: enemy_[0-9]+ has no path to the player node\\.', justification: 'j', evidence: 'e' },
      // Bypasses build validation on purpose: the adapter itself only ever matches ERROR-prefixed lines.
      { id: 'E3', message: 'Aborted(RuntimeError: unreachable)', justification: 'j', evidence: 'e' },
      { id: 'E4', message: 'ERROR: never printed.', justification: 'j', evidence: 'e' } ] };
    const server = createServer((req, res) => {
      if (req.url === '/browser-adapter.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(adapter); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<canvas id="c"></canvas><script type="module">import { installEngineTestAdapter } from "./browser-adapter.js"; window.t = installEngineTestAdapter(document.getElementById("c"), ' + JSON.stringify(identity) + ');</script>');
    });
    await new Promise<void>(resolve => server.listen(PORT, '127.0.0.1', resolve));
    try {
      await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForFunction(() => (window as any).t);
      const lines: [string, string][] = [
        ['ERROR: game line A.', 'allowed'], ['   at: f (a.cpp:1)', 'allowed'],
        ['ERROR: game line A. trailing', 'error'], ['   at: g (b.cpp:2)', 'error'],
        ['ERROR: game line A.', 'allowed'], ['Aborted(RuntimeError: unreachable)', 'error'],
        ['ERROR: enemy_12 has no path to the player node.', 'allowed'], ['ERROR: enemy_x has no path to the player node.', 'error'],
        ['SCRIPT ERROR: game line A.', 'error'], ['WARNING: w', 'warning'], ['   at: h (c.cpp:3)', 'warning'],
      ];
      const r = await page.evaluate(lines => {
        const t = (window as any).t, s = lines.map(([x]) => t.engineStderr(x));
        return { s, failed: (window as any).__BGT_TEST__.failed(), d: (window as any).__BGT_TEST__.diagnostics() };
      }, lines);
      expect(r.s).toEqual(lines.map(([, sev]) => sev));
      expect(r.failed).toBe(true);
      expect(r.d.errors.map((e: any) => e.message)).toEqual(['ERROR: game line A. trailing', '   at: g (b.cpp:2)', 'Aborted(RuntimeError: unreachable)',
        'ERROR: enemy_x has no path to the player node.', 'SCRIPT ERROR: game line A.']);
      expect(r.d.allowlisted.map((e: any) => [e.id, e.count, e.continuations])).toEqual([['E1', 2, 1], ['E2', 1, 0], ['E3', 0, 0], ['E4', 0, 0]]);
      await info.attach('allowlist.json', { body: JSON.stringify(r.d.allowlisted), contentType: 'application/json' });
    } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
  });

  test('real runtime: a game-originated duplicate-signal ERROR fails without, and is counted with, a recorded allowlist entry', async ({ browser }, info) => {
    info.annotations.push({ type: 'catches', description: 'Engine ERROR lines fail boots by default; a recorded entry (justification + evidence) lets exactly that line pass and reports its count in diagnostics, network capture and probe.json.' });
    needRuntime();
    const plain = buildFixture(ID, { duplicateSignal: true }), plainServer = await serveEngine(plain);
    try {
      const page = await browser.newPage();
      await expect(openEngineProfile(page, plainServer.url)).rejects.toThrow(/already connected to given method '_noop'/);
      await page.close();
    } finally { await plainServer.close(); }
    const build = allowFixture(), manifest = manifestOf(build), server = await serveEngine(build);
    expect(manifest.engineProfile.allowedErrors).toEqual([{ id: 'E1', ...allowEntry, evidenceSha256: createHash('sha256').update('CC0 fixture: main.gd lines 6-7 connect tree_entered twice\n').digest('hex') }]);
    try {
      const page = await browser.newPage();
      const capture = await captureEngineErrors(page, verifyRuntime(ID).files, { build });
      await openEngineProfile(page, server.url);
      await engineKey(page, 'Enter');
      const d = await engineDiagnostics(page), network = await capture.finish();
      expect(d.errors).toEqual([]); expect(network.errors).toEqual([]);
      expect(await engineAllowlisted(page)).toEqual([{ id: 'E1', ...allowEntry, evidenceSha256: manifest.engineProfile.allowedErrors[0].evidenceSha256, count: 1, continuations: 1 }]);
      await page.close();
    } finally { await server.close(); }
    const out = scratch();
    writeFileSync(join(out, 'explore.mjs'), 'export default async p => { await p.step(10); await p.key("Enter"); };\n');
    probe([build, join(out, 'explore.mjs'), '--out', out, ...(webgl2Gpu ? [] : ['--software'])]);
    const report = JSON.parse(readFileSync(join(out, 'probe.json'), 'utf8'));
    await info.attach('probe.json', { body: JSON.stringify(report), contentType: 'application/json' });
    expect(report.errors).toEqual([]);
    expect(report.allowlisted.map((e: any) => [e.id, e.count, e.continuations, e.evidence])).toEqual([['E1', 1, 1, 'evidence.txt']]);
  });
});

test.describe('Q3: GPU switch and performance helpers', () => {
  test('measureEngine: renderer, RAF window, main-thread CPU, memory and audio presence (tone vs silent fixture)', async ({ browser }, info) => {
    info.annotations.push({ type: 'catches', description: 'Perf summary fields must be real measurements: a silent game must not report audio, a tone must; wasm memory, JS heap, CPU per frame and the renderer (software iff the project runs SwiftShader) must be present.' });
    needRuntime();
    const results: Record<string, any> = {};
    for (const tone of [false, true]) {
      const build = buildFixture(ID, { tone }), server = await serveEngine(build);
      try {
        const page = await browser.newPage();
        await installEnginePerf(page);
        await openEngineProfile(page, server.url); await engineKey(page, 'Enter');
        results[tone ? 'tone' : 'silent'] = await measureEngine(page, { ms: 1000, label: tone ? 'tone' : 'silent' });
        await page.close();
      } finally { await server.close(); }
    }
    await info.attach('perf.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
    for (const m of Object.values(results)) {
      expect(m.schema).toBe('game-cask/engine-perf/1'); expect(m.browser).toBe('chromium');
      expect(m.software).toBe(!webgl2Gpu); expect(m.renderer.renderer).toBeTruthy();
      expect(m.window.frames).toBeGreaterThanOrEqual(10); expect(m.window.fps).toBeGreaterThan(5); expect(m.window.p95Ms).toBeGreaterThan(0);
      expect(m.cpu.mainThreadMsPerFrame).toBeGreaterThan(0); expect(m.cpu.mainThreadBusy).toBeGreaterThan(0); expect(m.cpu.mainThreadBusy).toBeLessThanOrEqual(1.5);
      expect(m.memory.wasmBytes).toBeGreaterThanOrEqual(16 * 1024 * 1024); expect(m.memory.jsHeap.usedBytes).toBeGreaterThan(0);
      expect(m.memory.processes.some((p: any) => p.type === 'renderer')).toBe(true);
      expect(m.audio.running).toBe(true); expect(m.audio.destinationSources).toBeGreaterThan(0);
    }
    expect(results.silent.audio.present).toBe(false); expect(results.silent.audio.peak).toBe(0);
    expect(results.tone.audio.present).toBe(true); expect(results.tone.audio.peak).toBeGreaterThan(0.3);
  });

  test('engine:probe defaults to the native GPU (macOS) and records software/device/measurements; --software gives SwiftShader', async ({ browserName }, info) => {
    expect(browserName).toBe('chromium');
    info.annotations.push({ type: 'catches', description: 'Probe performance numbers from SwiftShader were mistaken for real ones (26 s vs 2.3 s boot); the default must be the GPU, --software must be recorded, and the summary must carry the window.' });
    needRuntime();
    test.skip(process.platform !== 'darwin', 'native-GPU default verified on macOS (ANGLE Metal); other hosts may have no GPU');
    const build = buildFixture(ID), out = scratch(), soft = join(out, 'soft');
    writeFileSync(join(out, 'explore.mjs'), 'export default async p => { await p.key("Enter"); await p.measure({ ms: 500, label: "after-enter" }); };\n');
    probe([build, join(out, 'explore.mjs'), out, '--measure', '300']);
    probe([build, join(out, 'explore.mjs'), soft, '--software']);
    const gpu = JSON.parse(readFileSync(join(out, 'probe.json'), 'utf8')), sw = JSON.parse(readFileSync(join(soft, 'probe.json'), 'utf8'));
    await info.attach('probes.json', { body: JSON.stringify({ gpu, sw }), contentType: 'application/json' });
    expect(gpu.errors).toEqual([]); expect(sw.errors).toEqual([]);
    expect(gpu.software).toBe(false); expect(gpu.device.renderer).toMatch(/Metal/);
    expect(sw.software).toBe(true); expect(sw.device.renderer).toMatch(/SwiftShader/); expect(sw.requestedSoftware).toBe(true);
    expect(gpu.measurements.map((m: any) => m.label)).toEqual(['after-enter', '--measure']);
    expect(gpu.bootMs).toBeGreaterThan(0); expect(gpu.measurements[0].window.frames).toBeGreaterThan(0);
    // The Playwright-side launch helper is the same one.
    const b = await chromium.launch(chromiumLaunch());
    try { const p = await b.newPage(); await p.goto('about:blank'); expect(await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))).toBe(true); } finally { await b.close(); }
  });
});

test('WebKit (Playwright) boot probe reports renderer and errors', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium'); // the spec runner; the probe launches WebKit itself
  info.annotations.push({ type: 'catches', description: 'Safari-engine regressions (loader, WebGL 2, input wiring) of an engine bundle; the boot-only WebKit probe must report its renderer and fail on errors.' });
  needRuntime();
  test.skip(!existsSync(webkit.executablePath()), 'Playwright WebKit not installed');
  const out = scratch();
  probe([allowFixture(), '--browser', 'webkit', '--out', out, '--measure', '300']);
  const report = JSON.parse(readFileSync(join(out, 'probe.json'), 'utf8'));
  await info.attach('webkit-probe.json', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.browser).toBe('webkit'); expect(report.errors).toEqual([]);
  expect(report.device.renderer).toBeTruthy(); expect(report.device.context).toBe('webgl2');
  expect(report.allowlisted[0].count).toBe(1);
  expect(report.measurements[0].cpu).toBeNull(); expect(report.measurements[0].memory.wasmBytes).toBeGreaterThan(0);
  expect(report.network.bodies.map((b: any) => new URL(b.url).pathname).sort()).toEqual(['/game.pck', '/godot.wasm']);
});

test.describe('Q7: recorded engine options + frame pacer', () => {
  const FIXED = ['--fixed-fps', '60'];
  const fixedBuild = () => buildFixture(ID, { physics: true, suffix: 'fixed', profile: { engineArgs: FIXED } });
  async function replay(browser: Browser, url: string, { jumps = [30, 100], jitter = false } = {}) {
    const page = await browser.newPage();
    try {
      const capture = await captureEngineErrors(page, verifyRuntime(ID).files);
      await installEngineFramePacer(page);
      await openEngineProfile(page, url);
      expect(await engineFrame(page)).toBe(0);
      for (const at of jumps) {
        await engineInputAt(page, at, [{ type: 'key', code: 'Enter', down: true }]);
        await engineInputAt(page, at + 2, [{ type: 'key', code: 'Enter', down: false }]);
      }
      const hashes: string[] = [];
      for (let i = 0; i < 4; i++) {
        // Wall time between engine frames must not matter once the engine steps by a fixed delta.
        if (jitter) await page.waitForTimeout(150 * i);
        hashes.push((await engineFrameHash(page, 50)).sha256);
      }
      const d = await engineDiagnostics(page);
      expect(d.pacer).toMatchObject({ fps: 60, frame: 200 });
      expect(d.errors).toEqual([]); expect((await capture.finish()).errors).toEqual([]);
      const states = d.logs.filter((l: string) => l.startsWith('state '));
      return { hashes, states, lastPhysicsFrame: Number(states[states.length - 1].split(' ')[1]) };
    } finally { await page.close(); }
  }

  test('physics fixture: --fixed-fps + frame-keyed inputs replay identically; without it wall time drifts', async ({ browser }, info) => {
    info.annotations.push({ type: 'catches', description: 'Engine replays drifting with wall time (Godot physics by elapsed time), engine args not reaching the runtime, inputs not keyed to engine frames, or a pacer that lets the engine run between steps.' });
    needRuntime();
    const build = fixedBuild(), manifest = manifestOf(build);
    expect(manifest.engineProfile.engineArgs).toEqual(FIXED);
    expect(readFileSync(join(build, 'index.html'), 'utf8')).toContain('"args":["--fixed-fps","60"]');
    const server = await serveEngine(build);
    let a, b, c;
    try {
      a = await replay(browser, server.url);
      b = await replay(browser, server.url, { jitter: true });
      c = await replay(browser, server.url, { jumps: [31, 100] });
    } finally { await server.close(); }
    const freeServer = await serveEngine(buildFixture(ID, { physics: true, suffix: 'free' }));
    let free;
    try { free = await replay(browser, freeServer.url, { jitter: true }); } finally { await freeServer.close(); }
    await info.attach('replays.json', { body: JSON.stringify({ a, b, c, free: { hashes: free.hashes, lastPhysicsFrame: free.lastPhysicsFrame } }, null, 2), contentType: 'application/json' });
    // One fixed physics step per engine frame: frame-indexed state and screens are identical across runs.
    expect(a.lastPhysicsFrame).toBe(200);
    expect(b.states).toEqual(a.states); expect(b.hashes).toEqual(a.hashes);
    expect(new Set(a.hashes).size).toBe(4); // the scene moves: equal hashes are not a frozen canvas
    // The input frame matters (a jump one frame later is a different trajectory).
    expect(c.hashes).not.toEqual(a.hashes);
    // Negative control: no --fixed-fps -> Godot integrates wall time, so jittered pacing runs extra physics steps.
    expect(free.lastPhysicsFrame).toBeGreaterThan(200); expect(free.hashes).not.toEqual(a.hashes);
  });

  test('the pacer freezes the engine between steps (physics state does not advance on wall time)', async ({ browser }, info) => {
    info.annotations.push({ type: 'catches', description: 'A pacer that lets the engine main loop run on real rAF between steps would make frame-keyed inputs meaningless.' });
    needRuntime();
    const server = await serveEngine(fixedBuild());
    try {
      const page = await browser.newPage();
      await installEngineFramePacer(page); await openEngineProfile(page, server.url);
      const states = async () => (await engineDiagnostics(page)).logs.filter((l: string) => l.startsWith('state ')).length;
      await engineFrameHash(page, 10); const before = await states();
      await page.waitForTimeout(700);
      expect(await states()).toBe(before);
      await engineFrameHash(page, 5); expect(await states()).toBe(before + 5);
      await info.attach('frozen.json', { body: JSON.stringify({ before }), contentType: 'application/json' });
      await page.close();
    } finally { await server.close(); }
  });

  for (const id of ['godot-4.3-nothreads', 'godot-4.3-threads', 'godot-4.4.1-nothreads']) {
    test(`${id}: the pacer drives the Godot 4 main loop; frame-keyed input replays identically`, async ({ browser }, info) => {
      info.annotations.push({ type: 'catches', description: 'Godot 4 schedules its main loop through rAF differently from 3.x; the pacer must drive it and key inputs to its frames.' });
      test.skip(!isProvisioned(id), `official runtime ${id} not cached`);
      const server = await serveEngine(buildFixture(id));
      try {
        const run = async () => {
          const page = await browser.newPage();
          try {
            await installEngineFramePacer(page); await openEngineProfile(page, server.url);
            await engineInputAt(page, 12, [{ type: 'key', code: 'Enter', down: true }]);
            await engineInputAt(page, 14, [{ type: 'key', code: 'Enter', down: false }]);
            const hashes = [(await engineFrameHash(page, 10)).sha256, (await engineFrameHash(page, 10)).sha256];
            expect((await engineDiagnostics(page)).errors).toEqual([]);
            return hashes;
          } finally { await page.close(); }
        };
        const first = await run(), second = await run();
        await info.attach('hashes.json', { body: JSON.stringify({ first, second }), contentType: 'application/json' });
        expect(first[1]).not.toBe(first[0]); // red -> cyan only because the paced frames ran the input
        expect(second).toEqual(first);
      } finally { await server.close(); }
    });
  }

  test('build report shows engine args; engine:probe --pace replays identically and records pacer/engineArgs', async ({ browserName }, info) => {
    expect(browserName).toBe('chromium');
    info.annotations.push({ type: 'catches', description: 'Recorded engine options must be visible in the build report and probe.json; probe scripts must be able to key inputs to engine frames reproducibly.' });
    needRuntime();
    const build = fixedBuild();
    const report = execFileSync(process.execPath, ['tools/engine/cli.mjs', 'build', join(build, '..', '..', 'cc0-fixtures', 'cc0-engine-physics-fixed')], { cwd: ENGINE_ROOT, encoding: 'utf8' });
    expect(report).toContain('engine args: --fixed-fps 60');
    const out = scratch();
    writeFileSync(join(out, 'replay.mjs'), 'export default async p => { await p.inputAt(20, [{ type: "key", code: "Enter", down: true }]); await p.inputAt(22, [{ type: "key", code: "Enter", down: false }]);' +
      ' const h = []; for (let i = 0; i < 3; i++) h.push((await p.frameHash(40)).sha256); p.log(JSON.stringify(h)); };\n');
    const runs = [join(out, 'r1'), join(out, 'r2')].map(dir => {
      probe([build, join(out, 'replay.mjs'), dir, '--pace', '60', ...(webgl2Gpu ? [] : ['--software'])]);
      return JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8'));
    });
    await info.attach('paced-probes.json', { body: JSON.stringify(runs.map(r => ({ lines: r.lines, pacer: r.pacer, notes: r.notes }))), contentType: 'application/json' });
    for (const r of runs) { expect(r.errors).toEqual([]); expect(r.engineArgs).toEqual(FIXED); expect(r.pacer).toMatchObject({ fps: 60, frame: 120 }); expect(r.notes).toEqual([]); }
    expect(runs[1].lines).toEqual(runs[0].lines);
    expect(new Set(JSON.parse(runs[0].lines[0])).size).toBe(3);
  });
});
