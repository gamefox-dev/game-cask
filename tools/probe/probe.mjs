#!/usr/bin/env node
// Probe mode: run an exploration script against a game's test API in headless Chromium, without writing a spec.
//
//   npm run probe -- --game <id> [--backend webgl2|webgpu] --script <file.mjs> [--out reports/probe] [--params k=v,k=v] [--port N]
//
// Starts its own Vite server on a free port (never the developer's :5173) and serves what is already built in
// web/public/games/ (run `npm run build:port` first). The script default-exports `async function (p)`; see
// .claude/skills/browser-validation/SKILL.md for the API. Artifacts (PNGs, probe.json with the log, console and
// errors) go to --out (default reports/probe/, private). Never touches kit or port test results.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../build/toolchain.mjs';
import { startServer, stopServer, validatePort } from './server.mjs';

const WEBGPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'];

function parseArgs(argv) {
  const a = { backend: 'webgl2', out: 'reports/probe', params: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--game') { a.game = v; i++; }
    else if (k === '--backend') { a.backend = v; i++; }
    else if (k === '--script') { a.script = v; i++; }
    else if (k === '--out') { a.out = v; i++; }
    else if (k === '--port') { a.port = Number(v); i++; }
    else if (k === '--params') { for (const kv of v.split(',')) { const [x, y] = kv.split('='); if (x) a.params[x] = y ?? ''; } i++; }
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.game || !a.script) throw new Error('usage: npm run probe -- --game <id> [--backend webgl2|webgpu] --script <file.mjs> [--out DIR] [--params k=v,...] [--port N]');
  if (!['webgl2', 'webgpu'].includes(a.backend)) throw new Error('--backend must be webgl2 or webgpu');
  return a;
}

const portFree = (port) => new Promise((res) => {
  const s = createServer();
  s.once('error', () => res(false));
  s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
});
async function freePort(start) {
  if (!Number.isInteger(start) || start < 1 || start > 65535) throw new Error('invalid BGT_PROBE_PORT');
  for (let p = start; p <= Math.min(65535, start + 49); p++) if (p !== 5173 && (await portFree(p))) return p;
  throw new Error(`no free port in ${start}..${start + 49}`);
}

/** The object handed to the script. Coordinates are logical pixels. */
export function makeProbe(page, { game, backend, out, params, log }) {
  const api = (fn, ...args) => page.evaluate(([f, a]) => window.__BGT_TEST__[f](...a), [fn, args]);
  const save = (name, b64) => {
    const file = join(out, name.endsWith('.png') ? name : `${name}.png`);
    writeFileSync(file, Buffer.from(b64, 'base64'));
    log.artifacts.push(file);
    return file;
  };
  const p = {
    page,
    game,
    backend,
    async start(extra = {}) {
      const q = new URLSearchParams({ game, backend, paused: '1', ephemeral: '1', ...params, ...extra });
      await page.goto(`/?${q}`);
      await page.waitForFunction(() => { const t = window.__BGT_TEST__; return !!t && (t.ready() || t.failed()); }, null, { timeout: 30_000 });
      const d = await api('diagnostics');
      if (d.backend !== backend) log.notes.push(`requested ${backend}, got ${d.backend}: ${d.backendNotes.join('; ')}`);
      return d;
    },
    step: (n = 1) => api('step', n),
    input: (events) => api('input', events),
    async click(x, y, { buttons = 1, frames = 2 } = {}) {
      await api('input', [{ type: 'pointer', x, y, buttons }]);
      await api('step', 1);
      await api('input', [{ type: 'pointer', x, y, buttons: 0 }]);
      await api('step', frames);
    },
    async key(code, { frames = 2 } = {}) {
      await api('input', [{ type: 'key', code, down: true }]);
      await api('step', 1);
      await api('input', [{ type: 'key', code, down: false }]);
      await api('step', frames);
    },
    diagnostics: () => api('diagnostics'),
    metrics: async () => (await api('diagnostics')).metrics,
    debugState: () => api('debugState'),
    stateHash: () => api('stateHash'),
    readPixels: () => api('readPixels'),
    /** read-only guest memory as a Buffer (null if unmapped) */
    async peek(addr, len) {
      const { peekBytes } = await import(pathToFileURL(join(ROOT, 'tests/support/evidence.ts')).href);
      return peekBytes(page, addr, len);
    },
    /** [r, g, b, a] of the presented logical pixel (x, y) */
    async pixel(x, y) {
      return page.evaluate(async ([lx, ly]) => {
        const t = window.__BGT_TEST__, d = t.diagnostics(), px = await t.readPixels();
        const s = d.letterbox.w / d.logical.width;
        const o = (Math.floor(d.letterbox.y + (ly + 0.5) * s) * px.width + Math.floor(d.letterbox.x + (lx + 0.5) * s)) * 4;
        const bin = atob(px.base64);
        return [0, 1, 2, 3].map((k) => bin.charCodeAt(o + k));
      }, [x, y]);
    },
    async screenshot(name) {
      const b64 = await page.evaluate(async () => {
        const blob = await window.__BGT_TEST__.screenshot();
        const u = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(s);
      });
      return save(name, b64);
    },
    /** nearest-neighbour zoom of a logical rectangle */
    async crop(name, rect, zoom = 8) {
      const b64 = await page.evaluate(async ([r, z]) => {
        const t = window.__BGT_TEST__, d = t.diagnostics(), px = await t.readPixels();
        const s = d.letterbox.w / d.logical.width, bin = atob(px.base64);
        const cv = document.createElement('canvas');
        cv.width = r.w * z; cv.height = r.h * z;
        const c2 = cv.getContext('2d');
        for (let y = 0; y < r.h; y++)
          for (let x = 0; x < r.w; x++) {
            const o = (Math.floor(d.letterbox.y + (r.y + y + 0.5) * s) * px.width + Math.floor(d.letterbox.x + (r.x + x + 0.5) * s)) * 4;
            c2.fillStyle = `rgb(${bin.charCodeAt(o)},${bin.charCodeAt(o + 1)},${bin.charCodeAt(o + 2)})`;
            c2.fillRect(x * z, y * z, z, z);
          }
        return cv.toDataURL('image/png').split(',')[1];
      }, [rect, zoom]);
      return save(name, b64);
    },
    async tour(opts = {}) {
      const { runTour } = await import(pathToFileURL(join(ROOT, 'tests/support/tour.ts')).href);
      const index = await runTour(page, { game, backend, outDir: join(out, 'tour'), params, ...opts });
      log.artifacts.push(join(opts.outDir ?? join(out, 'tour'), 'index.json'));
      return index;
    },
    log(...args) {
      const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      log.lines.push(line);
      console.log(`probe: ${line}`);
    },
  };
  return p;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let server, browser, code = 0;
  const log = { lines: [], console: [], errors: [], artifacts: [], notes: [] };
  let a;
  try {
    a = parseArgs(process.argv.slice(2));
    const out = resolve(ROOT, a.out);
    mkdirSync(out, { recursive: true });
    const script = await import(pathToFileURL(resolve(a.script)).href);
    if (typeof script.default !== 'function') throw new Error(`${a.script} must default-export async function (p)`);
    const port = a.port ?? (await freePort(Number(process.env.BGT_PROBE_PORT ?? 5189)));
    validatePort(port);
    server = await startServer(port, a.game);
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch(a.backend === 'webgpu' ? { channel: 'chromium', args: WEBGPU_ARGS } : {});
    const ctx = await browser.newContext({ baseURL: server.url, viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    page.on('console', (m) => log.console.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => log.errors.push(e.message));
    const p = makeProbe(page, { game: a.game, backend: a.backend, out, params: a.params, log });
    await p.start();
    await script.default(p);
    const coverage=await page.evaluate(() => window.__BGT_TEST__?.coverage?.());
    if(coverage){const file=join(out,'coverage.json');writeFileSync(file,JSON.stringify(coverage,null,2)+'\n');log.artifacts.push(file);}
    const d = await p.diagnostics().catch(() => null);
    if (d?.errors?.length) log.errors.push(...d.errors.map((e) => `${e.kind}: ${e.message}`));
  } catch (e) {
    log.errors.push(`probe: ${e.message}`);
    console.error(`probe: ${e.message}`);
    code = 1;
  } finally {
    await browser?.close().catch(() => {});
    await stopServer(server?.child);
  }
  if (a) {
    const out = resolve(ROOT, a.out);
    writeFileSync(join(out, 'probe.json'), JSON.stringify({ schema: 'game-cask/probe/1', game: a.game, backend: a.backend, script: a.script, when: new Date().toISOString(), ...log }, null, 2) + '\n');
    console.log(`probe: ${log.artifacts.length} artifact(s), ${log.errors.length} error(s) -> ${join(a.out, 'probe.json')}`);
  }
  process.exit(code);
}
