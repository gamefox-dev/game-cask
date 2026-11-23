#!/usr/bin/env node
// Same scripted probe facade, official engine runtime instead of the BGT host.
//
//   npm run engine:probe -- BUILD_DIR [SCRIPT.mjs] [OUT_DIR] [--out DIR] [--software] [--browser chromium|webkit] [--measure MS] [--pace FPS [--virtual-time]]
//
// K59: Chromium renders on the native GPU by default (ANGLE Metal on macOS), like `npm run probe` since K51; a probe
// that lands on a software rasterizer fails unless --software asked for SwiftShader. probe.json records `device`,
// `software`, `measurements` (p.measure() / --measure: RAF windows, main-thread CPU per frame, memory, audio) and
// `allowlisted` (engineProfile.allowedErrors occurrence counts). --browser webkit: boot (+ optional script) on
// Playwright WebKit; reports renderer and errors (no CDP figures). --pace FPS (K59 Q7): the test-only frame pacer;
// p.step(n) then runs n engine frames, p.inputAt(frame, events) keys inputs to engine frames, p.frameHash(n) hashes
// the canvas after n frames. Use with engineProfile.engineArgs ["--fixed-fps", "<FPS>"] for reproducible replays.
// --virtual-time (K59 Q8, needs --pace): performance.now/Date.now/rAF timestamps held constant within each engine frame.
// K68 Q12: probe.json `firstFrameMs` (navigation start -> first non-clear canvas frame, real clock) and `firstFrame`.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { makeProbe } from '../probe/probe.mjs';
import { serveEngine } from './server.mjs';
import { captureEngineErrors } from './capture.mjs';
import { verifyRuntime } from './runtime.mjs';
import { chromiumLaunch, engineRenderer, installEnginePerf, measureEngine } from './perf.mjs';
import { installEngineFramePacer } from './pacer.mjs';

const USAGE = 'usage: npm run engine:probe -- BUILD_DIR [SCRIPT.mjs] [OUT_DIR] [--out DIR] [--software] [--browser chromium|webkit] [--measure MS] [--pace FPS [--virtual-time]]';
export function parseEngineProbeArgs(argv) {
  const a = { positional: [], software: false, browser: 'chromium', measure: null, out: null, pace: null, virtualTime: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--software') a.software = true;
    else if (k === '--browser') a.browser = argv[++i];
    else if (k === '--measure') a.measure = Number(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--pace') a.pace = Number(argv[++i]);
    else if (k === '--virtual-time') a.virtualTime = true;
    else if (k.startsWith('--')) throw new Error('unknown argument ' + k + '\n' + USAGE);
    else a.positional.push(k);
  }
  const [build, script, positionalOut] = a.positional;
  if (!build || a.positional.length > 3 || (a.out && positionalOut)) throw new Error(USAGE);
  if (script && !/\.(mjs|js)$/.test(script)) throw new Error('SCRIPT must be a .mjs/.js module (use --out DIR for a boot-only output directory)\n' + USAGE);
  const out = a.out ?? positionalOut ?? 'reports/engine-probe';
  if (!['chromium', 'webkit'].includes(a.browser)) throw new Error('--browser must be chromium or webkit');
  if (a.software && a.browser !== 'chromium') throw new Error('--software applies to Chromium only');
  if (!script && a.browser === 'chromium') throw new Error('a SCRIPT is required on Chromium (WebKit runs boot-only without one)\n' + USAGE);
  if (a.measure !== null && !(Number.isFinite(a.measure) && a.measure >= 100 && a.measure <= 120000)) throw new Error('--measure must be 100..120000 ms');
  if (a.pace !== null && !(Number.isInteger(a.pace) && a.pace >= 1 && a.pace <= 1000)) throw new Error('--pace must be an integer FPS 1..1000');
  if (a.virtualTime && a.pace === null) throw new Error('--virtual-time needs --pace FPS');
  return { build, script, out, software: a.software, browser: a.browser, measure: a.measure, pace: a.pace, virtualTime: a.virtualTime };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let server, browser, out = resolve('reports/engine-probe');
  const log = { schema: 'game-cask/engine-probe/2', path: 'engineProfile', lines: [], console: [], errors: [], artifacts: [], notes: [], measurements: [] };
  try {
    const a = parseEngineProbeArgs(process.argv.slice(2));
    out = resolve(a.out); mkdirSync(out, { recursive: true });
    Object.assign(log, { browser: a.browser, requestedSoftware: a.software });
    const build = JSON.parse(readFileSync(join(a.build, 'manifest.json')));
    log.engineProfile = build.engineProfile;
    server = await serveEngine(a.build);
    if (a.browser === 'webkit') {
      try { browser = await webkit.launch(); } catch (e) { throw new Error('Playwright WebKit is not installed or failed to launch: ' + e.message.split('\n')[0]); }
    } else browser = await chromium.launch(chromiumLaunch({ software: a.software }));
    const page = await browser.newPage({ baseURL: server.url, viewport: { width: 960, height: 540 } });
    page.on('console', m => log.console.push(m.type() + ': ' + m.text()));
    await installEnginePerf(page);
    if (a.pace) {
      await installEngineFramePacer(page, { fps: a.pace, virtualTime: a.virtualTime });
      const args = build.engineProfile.engineArgs ?? [], fixed = args.indexOf('--fixed-fps');
      if (fixed < 0) log.notes.push('--pace without engineProfile.engineArgs --fixed-fps: Godot still advances physics by wall time, so replays are not reproducible');
      else if (Number(args[fixed + 1]) !== a.pace) log.notes.push(`--pace ${a.pace} differs from --fixed-fps ${args[fixed + 1]}`);
    }
    const capture = await captureEngineErrors(page, verifyRuntime(build.engineProfile.runtime.id).files, { build });
    const p = makeProbe(page, { game: build.id, backend: build.engineProfile.requirements.renderer, out, params: {}, log, engineUrl: server.url, software: true });
    p.inputAt = (frame, events) => page.evaluate(([f, e]) => window.__BGT_TEST__.inputAt(f, e), [frame, events]);
    p.frameHash = (n = 0) => page.evaluate(n => window.__BGT_TEST__.frameHash(n), n);
    p.engineFrame = () => page.evaluate(() => window.__BGT_TEST__.engineFrame());
    p.measure = async (options = {}) => { const m = await measureEngine(page, options); log.measurements.push(m); return m; };
    const t0 = Date.now();
    await p.start(); log.bootMs = Date.now() - t0;
    log.device = await engineRenderer(page); log.software = log.device.software;
    console.log(`engine:probe: ${a.browser} renderer "${log.device.renderer}"${log.software ? ' (SOFTWARE)' : ''}; boot ${log.bootMs} ms`);
    // K51 convention: a native-GPU probe that silently lands on a software rasterizer gives invalid performance numbers.
    // vK59: fail closed when the renderer cannot be read (engineRenderer reports software: true, rendererUnknown: true).
    if (log.device.rendererUnknown && !a.software) throw new Error('requested the native GPU but the WebGL renderer could not be read; pass --software to accept an unverified renderer');
    if (log.software !== false && !a.software) throw new Error(`requested the native GPU but got software renderer "${log.device.renderer}"; pass --software to accept it`);
    if (a.script) {
      const script = await import(pathToFileURL(resolve(a.script)).href);
      if (typeof script.default !== 'function') throw new Error(a.script + ' must default-export async function (p)');
      await script.default(p);
    }
    if (a.measure) await p.measure({ ms: a.measure, label: '--measure' });
    log.network = await capture.finish(); log.errors.push(...log.network.errors);
    log.diagnostics = await p.diagnostics(); log.errors.push(...log.diagnostics.errors.map(e => e.kind + ': ' + e.message));
    log.allowlisted = log.diagnostics.allowlisted ?? [];
    log.engineArgs = build.engineProfile.engineArgs ?? []; log.pacer = log.diagnostics.pacer ?? null;
    // K68 Q12: first non-clear canvas frame since navigation start (BGT load_to_first_frame_ms counts from load start).
    log.firstFrameMs = log.diagnostics.firstFrameMs ?? null; log.firstFrame = log.diagnostics.firstFrame ?? null;
    if (log.firstFrameMs === null) log.notes.push('no non-clear canvas frame observed (firstFrameMs null)');
    else console.log(`engine:probe: first frame ${log.firstFrameMs.toFixed(1)} ms after navigation start (${log.firstFrame.sinceLoadStartMs?.toFixed(1) ?? 'n/a'} ms after the runtime wasm request; first draw ${log.firstFrame.firstDrawMs?.toFixed(1)} ms)`);
    log.variant = build.variant ?? null;
    for (const e of log.allowlisted) console.log(`engine:probe: allowlisted ${e.id} x${e.count} (+${e.continuations} continuation lines): ${e.message ?? e.pattern} [${e.evidence}]`);
    for (const m of log.measurements) console.log(`engine:probe: ${m.label ?? 'window'} ${m.window.fps} fps p95 ${m.window.p95Ms} ms; main thread ${m.cpu?.mainThreadMsPerFrame ?? 'n/a'} ms/frame; wasm ${m.memory.wasmBytes ?? 'n/a'} B; audio ${m.audio ? (m.audio.present ? 'present' : 'silent') : 'n/a'}`);
    if (log.errors.length) process.exitCode = 1;
  } catch (e) { log.errors.push(e.message); console.error('engine:probe: ' + e.message); process.exitCode = 1; }
  finally { await browser?.close(); await server?.close(); mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'probe.json'), JSON.stringify(log, null, 2) + '\n'); }
}
