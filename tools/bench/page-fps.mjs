#!/usr/bin/env node
// K51 real-page frame rate: the page's own requestAnimationFrame loop drives the game (no step()).
// For each backend x suspension mode: load the built game, warm up, measure a fixed wall window and
// write one JSON summary (presents/s, frame-time mean/p95, updates per present, guest presents/s,
// the native renderer/adapter string and whether it is a software rasterizer).
//
//   npm run bench:page -- --game ID [--backends webgl2,webgpu] [--modes asyncify,jspi] [--window-ms 5000]
//       [--warmup-ms 1500] [--headed] [--software] [--out reports/page-fps] [--port N] [--params k=v,...]
//
// Starts its own Vite server (never :5173). Default launch is the native GPU (ANGLE Metal on macOS) for BOTH
// backends; --software forces SwiftShader for WebGL2 A/B. Headless Chromium's rAF cadence is not a display
// vsync: raf_per_second is reported so the ceiling is visible. Use --headed for display-paced numbers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';
import { startServer, stopServer } from '../probe/server.mjs';
import { resourceSnapshot } from '../probe/resources.mjs';

const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--ignore-gpu-blocklist'];
const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export function parsePageFpsArgs(argv) {
  const a = { backends: ['webgl2', 'webgpu'], modes: ['asyncify', 'jspi'], windowMs: 5000, warmupMs: 1500, headed: false, software: false,
    out: 'reports/page-fps', port: Number(process.env.BGT_PROBE_PORT ?? 5310), params: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--game') { a.game = v; i++; } else if (k === '--backends') { a.backends = v.split(','); i++; }
    else if (k === '--modes') { a.modes = v.split(','); i++; } else if (k === '--window-ms') { a.windowMs = Number(v); i++; }
    else if (k === '--warmup-ms') { a.warmupMs = Number(v); i++; } else if (k === '--out') { a.out = v; i++; }
    else if (k === '--port') { a.port = Number(v); i++; } else if (k === '--headed') a.headed = true; else if (k === '--software') a.software = true;
    else if (k === '--params') { for (const kv of v.split(',')) { const [x, y] = kv.split('='); if (x) a.params[x] = y ?? ''; } i++; }
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.game) throw new Error('usage: npm run bench:page -- --game ID [--backends webgl2,webgpu] [--modes asyncify,jspi] [--window-ms N] [--warmup-ms N] [--headed] [--software]');
  if (!a.backends.every(b => b === 'webgl2' || b === 'webgpu')) throw new Error('--backends: webgl2 and/or webgpu');
  if (!a.modes.every(m => m === 'asyncify' || m === 'jspi')) throw new Error('--modes: asyncify and/or jspi');
  if (!(a.windowMs >= 100 && a.windowMs <= 600000) || !(a.warmupMs >= 0 && a.warmupMs <= 600000)) throw new Error('invalid --window-ms/--warmup-ms');
  return a;
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const a = parsePageFpsArgs(process.argv.slice(2)), out = resolve(ROOT, a.out);
  mkdirSync(out, { recursive: true });
  const resources = { start: resourceSnapshot() };
  let server, browser; const runs = [];
  try {
    server = await startServer(a.port, a.game);
    for (const backend of a.backends) {
      const args = backend === 'webgl2' && a.software ? SOFTWARE_ARGS : GPU_ARGS;
      browser = await chromium.launch({ channel: 'chromium', headless: !a.headed, args });
      for (const mode of a.modes) {
        const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        const q = new URLSearchParams({ game: a.game, backend, paused: '1', ephemeral: '1', suspension: mode, ...a.params });
        await page.goto(new URL(`/?${q}`, server.url).href);
        await page.waitForFunction(() => { const t = window.__BGT_TEST__; return !!t && (t.ready() || t.failed()); }, null, { timeout: 60000 });
        const d0 = await page.evaluate(() => window.__BGT_TEST__.diagnostics());
        const row = { backend, requestedSuspension: mode, actualBackend: d0.backend, suspension: d0.suspension, device: d0.gpuDevice,
          backendNotes: d0.backendNotes, failed: d0.failed, errors };
        if (d0.failed || d0.backend !== backend || d0.suspension !== mode || (d0.gpuDevice?.software && !a.software)) {
          row.skipped = d0.failed ? 'runtime failed' : d0.gpuDevice?.software && !a.software ? `software renderer ${d0.gpuDevice.renderer} (pass --software)`
            : `got ${d0.backend}/${d0.suspension}`; runs.push(row); await page.close(); continue;
        }
        row.summary = await page.evaluate(([w, u]) => window.__BGT_TEST__.measurePage(w, u), [a.windowMs, a.warmupMs]);
        const d1 = await page.evaluate(() => window.__BGT_TEST__.diagnostics());
        row.frame = d1.frame; row.runtimeErrors = d1.errors; row.lastFrame = d1.lastFrame;
        runs.push(row); await page.close();
        const s = row.summary;
        console.log(`${a.game} ${backend}/${mode} [${d0.gpuDevice?.renderer ?? d0.backend}]: ${s.presents_per_second?.toFixed(2)} presents/s, ` +
          `frame ${s.frame_ms.mean?.toFixed(2)} ms mean / ${s.frame_ms.p95?.toFixed(2)} p95, ${s.updates_per_present?.toFixed(2)} updates/present, ` +
          `guest ${s.guest_presents_per_second?.toFixed(2) ?? 'n/a'} presents/s, rAF ${s.raf_per_second?.toFixed(1)}/s (busy ${s.busy_ticks})`);
      }
      await browser.close(); browser = undefined;
    }
  } finally { await browser?.close(); await stopServer(server?.child); }
  resources.end = resourceSnapshot();
  const file = join(out, `${a.game}.json`);
  writeFileSync(file, JSON.stringify({ schema: 'game-cask/page-fps-run/1', generated: new Date().toISOString(), game: a.game,
    headed: a.headed, software: a.software, windowMs: a.windowMs, warmupMs: a.warmupMs, launch: { gpu: GPU_ARGS, software: SOFTWARE_ARGS },
    resources, runs }, null, 2) + '\n');
  console.log('wrote ' + file);
  if (runs.some(r => r.skipped || r.errors.length || r.runtimeErrors?.length)) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
