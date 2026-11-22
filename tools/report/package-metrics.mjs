#!/usr/bin/env node
// K64 packaging and load metrics, reusable by ports.
//
//   npm run package:metrics -- --game ID                  artifact sizes (raw/gzip/brotli) of web/public/games/ID
//   npm run package:metrics -- --dir DIR                  same for any built game or bundle directory
//   npm run package:metrics -- --game ID --serve          + how a server delivers game.wasm (MIME, encoding)
//   npm run package:metrics -- --game ID --browser        + real-page load timing and memory attribution (Chromium)
//   options: --url BASE (check a deployed server instead of starting one; --browser needs its test API),
//            --backend webgl2|webgpu, --brotli Q (default 9; 11 = deploy quality), --gzip L (default 9),
//            --budget BYTES|768m|1.5g, --timeout MS, --out FILE (default reports/package-metrics-ID.json)
//
// Starts its own Vite server on $BGT_E2E_PORT (never 5173). Output is private by default (reports/).
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRECOMPRESSED = /\.(br|gz)$/;

export function kindOf(path) {
  const p = path.split(sep).join('/'), ext = extname(p).toLowerCase();
  if (ext === '.wasm') return 'wasm';
  if (ext === '.js' || ext === '.mjs') return 'js';
  if (p.includes('/chunks/') || p.startsWith('chunks/') || ['.pck', '.bin', '.dat', '.pak', '.data'].includes(ext)) return 'data';
  if (p.startsWith('assets/') || p.includes('/assets/')) return ['.html', '.css', '.json'].includes(ext) ? 'meta' : 'data';
  if (['.json', '.html', '.css', '.txt', '.svg', '.map'].includes(ext)) return 'meta';
  return 'data';
}

export function compressedSizes(bytes, { gzip = 9, brotli = 9 } = {}) {
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: gzip }).length,
    brotli: brotliCompressSync(bytes, { params: { [zc.BROTLI_PARAM_QUALITY]: brotli, [zc.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      [zc.BROTLI_PARAM_LGWIN]: 24 } }).length,
  };
}

export function walkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile() && !PRECOMPRESSED.test(e.name)) out.push(p);
  }
  return out.sort();
}

/** Sum per kind; ratios are compressed/raw. `files` lists the largest first. */
export function summarizeArtifacts(files) {
  const kinds = {};
  const total = { files: 0, raw: 0, gzip: 0, brotli: 0 };
  for (const f of files) {
    const k = kinds[f.kind] ??= { files: 0, raw: 0, gzip: 0, brotli: 0 };
    for (const t of [k, total]) { t.files++; t.raw += f.raw; t.gzip += f.gzip; t.brotli += f.brotli; }
  }
  const ratio = (t) => ({ ...t, gzipRatio: t.raw ? t.gzip / t.raw : null, brotliRatio: t.raw ? t.brotli / t.raw : null });
  return { total: ratio(total), kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, ratio(v)])),
    files: [...files].sort((a, b) => b.raw - a.raw || a.path.localeCompare(b.path)) };
}

/** A name for `dir` that never leaks a local path: repo-relative inside `root`, else the basename (vK64). */
export function displayPath(dir, root) {
  const rel = root ? relative(root, dir) : '';
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : basename(dir);
}

export function artifactSizes(dir, quality = {}, root = null) {
  const start = performance.now();
  const files = walkFiles(dir).map((p) => ({ path: relative(dir, p).split(sep).join('/'), kind: kindOf(relative(dir, p)),
    ...compressedSizes(readFileSync(p), quality) }));
  return { dir: displayPath(dir, root), quality: { gzip: quality.gzip ?? 9, brotli: quality.brotli ?? 9 }, ...summarizeArtifacts(files),
    elapsedMs: performance.now() - start };
}

/** Classify a server's response headers for game.wasm. */
export function classifyServing(headers, requested = 'br, gzip') {
  const get = (k) => headers[k] ?? headers[k.toLowerCase()] ?? null;
  const type = get('content-type'), encoding = get('content-encoding');
  const mime = type?.split(';')[0].trim().toLowerCase() ?? null;
  const enc = encoding?.trim().toLowerCase() ?? null;
  return {
    contentType: type, contentEncoding: encoding, contentLength: get('content-length') === null ? null : Number(get('content-length')),
    requestedEncoding: requested,
    streamingCompile: mime === 'application/wasm',
    compressed: !!enc && enc !== 'identity',
    crossOriginIsolated: get('cross-origin-opener-policy') === 'same-origin' && /require-corp|credentialless/.test(get('cross-origin-embedder-policy') ?? ''),
    advice: [
      ...(mime === 'application/wasm' ? [] : [`serve .wasm as application/wasm (got ${type ?? 'none'}): without it the runtime cannot compile while downloading`]),
      ...(enc && enc !== 'identity' ? [] : ['enable brotli/gzip for .wasm, .js and data (or serve the bundle\'s precompressed .br/.gz files)']),
    ],
  };
}

/** Write .br/.gz beside each compressible file (wasm, js, data, meta >= 1 KiB) when it saves >= 5%.
 * Static hosts with precompressed serving (nginx brotli_static/gzip_static, Caddy precompressed, ...) then send
 * them with Content-Encoding; hosts that compress on the fly ignore them. Returns what was written. */
export function precompress(dir, { brotli = 11, gzip = 9, minBytes = 1024 } = {}) {
  const written = [];
  for (const p of walkFiles(dir)) {
    const bytes = readFileSync(p);
    if (bytes.length < minBytes || /\.(png|jpe?g|webp|gif|mp3|ogg|opus|m4a|zip|br|gz)$/i.test(p)) continue;
    const outputs = [['.br', brotliCompressSync(bytes, { params: { [zc.BROTLI_PARAM_QUALITY]: brotli,
      [zc.BROTLI_PARAM_SIZE_HINT]: bytes.length, [zc.BROTLI_PARAM_LGWIN]: 24 } })], ['.gz', gzipSync(bytes, { level: gzip })]];
    for (const [ext, data] of outputs) {
      if (data.length > bytes.length * 0.95) continue;
      writeFileSync(p + ext, data);
      written.push({ path: relative(dir, p + ext).split(sep).join('/'), raw: bytes.length, bytes: data.length });
    }
  }
  return written;
}

export async function checkServing(base, path) {
  const url = new URL(path, base).href;
  const r = await fetch(url, { headers: { 'Accept-Encoding': 'br, gzip' } });
  const headers = Object.fromEntries(r.headers.entries());
  await r.body?.cancel();
  return { url, status: r.status, ...classifyServing(headers) };
}

function parseArgs(argv) {
  const a = { backend: 'webgl2', brotli: 9, gzip: 9, timeout: 120000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--game') a.game = v(); else if (k === '--dir') a.dir = v(); else if (k === '--url') a.url = v();
    else if (k === '--serve') a.serve = true; else if (k === '--browser') a.browser = true;
    else if (k === '--backend') a.backend = v(); else if (k === '--brotli') a.brotli = Number(v()); else if (k === '--gzip') a.gzip = Number(v());
    else if (k === '--budget') a.budget = v(); else if (k === '--timeout') a.timeout = Number(v()); else if (k === '--out') a.out = v();
    else if (k === '--port') a.port = Number(v());
    else throw new Error(`unknown option ${k}`);
  }
  if (!a.game && !a.dir) throw new Error('usage: package-metrics.mjs --game ID | --dir DIR [--serve] [--browser] [--url BASE]');
  if (!(a.brotli >= 0 && a.brotli <= 11) || !(a.gzip >= 1 && a.gzip <= 9)) throw new Error('invalid --brotli/--gzip quality');
  return a;
}

async function browserLoad(base, game, backend, budget, timeout) {
  const { chromium } = await import('@playwright/test');
  const args = backend === 'webgpu' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] : [];
  const browser = await chromium.launch(backend === 'webgpu' ? { channel: 'chromium', args } : { args });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    // Free-running (no ?paused=1): the page's own loop produces the first update and frame.
    const q = new URLSearchParams({ game, backend, ephemeral: '1', ...(budget ? { memorybudget: budget } : {}) });
    const started = Date.now();
    await page.goto(new URL(`?${q}`, base).href);
    await page.waitForFunction(() => {
      const t = window.__BGT_TEST__; if (!t) return false;
      if (t.failed()) return true;
      const l = t.loadMetrics(); return l.marks.firstUpdateMs !== null && l.marks.firstFrameMs !== null && l.wasm.transfer !== null;
    }, null, { timeout, polling: 100 });
    const result = await page.evaluate(() => { const t = window.__BGT_TEST__;
      const d = t.diagnostics();
      return { failed: t.failed(), backend: t.backend(), suspension: d.suspension, load: d.load, memory: d.memory, errors: d.errors }; });
    return { ...result, wallMs: Date.now() - started };
  } finally { await browser.close(); }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const { ROOT } = await import('../build/toolchain.mjs');
  const dir = resolve(a.dir ?? join(ROOT, 'web', 'public', 'games', a.game));
  const id = a.game ?? dir.split(sep).pop();
  const report = { schema: 'game-cask/package-metrics/1', game: id, generated: new Date().toISOString(),
    artifacts: artifactSizes(dir, { gzip: a.gzip, brotli: a.brotli }, ROOT) };
  console.log(`artifacts ${report.artifacts.dir}: ${report.artifacts.total.files} files, raw ${report.artifacts.total.raw} B, gzip ${report.artifacts.total.gzip} B, brotli(q${a.brotli}) ${report.artifacts.total.brotli} B`);
  for (const [k, v] of Object.entries(report.artifacts.kinds)) console.log(`  ${k}: raw ${v.raw} gzip ${v.gzip} brotli ${v.brotli} (${(v.brotliRatio * 100).toFixed(1)}%)`);
  let server = null, base = a.url ?? null;
  try {
    if ((a.serve || a.browser) && !base) {
      if (!a.game) throw new Error('--serve/--browser without --url need --game (served from web/public/games)');
      const { startServer } = await import('../probe/server.mjs');
      server = await startServer(a.port ?? Number(process.env.BGT_E2E_PORT ?? 5199), a.game);
      base = server.url;
      report.server = { kind: 'vite-dev', url: base };
    } else if (base) report.server = { kind: 'external', url: base };
    if (a.serve || a.browser) {
      const manifest = await (await fetch(new URL(`games/${id}/manifest.json`, base))).json();
      report.serving = { wasm: await checkServing(base, `games/${id}/${manifest.wasm.url}`),
        ...(manifest.variants?.jspi ? { jspi: await checkServing(base, `games/${id}/${manifest.variants.jspi.url}`) } : {}) };
      console.log(`serving game.wasm: ${report.serving.wasm.contentType}, encoding ${report.serving.wasm.contentEncoding ?? 'none'}, streaming compile ${report.serving.wasm.streamingCompile}`);
      for (const advice of report.serving.wasm.advice) console.log(`  advice: ${advice}`);
    }
    if (a.browser) {
      report.browser = await browserLoad(base, id, a.backend, a.budget, a.timeout);
      const l = report.browser.load, m = report.browser.memory;
      console.log(`load (${report.browser.backend}, ${report.browser.suspension}): manifest ${l.marks.manifestMs?.toFixed(1)} ms, wasm ${l.wasm.downloadCompileVerifyMs.toFixed(1)} ms (streaming ${l.wasm.streaming}/${l.wasm.streamingReason}), instantiate ${l.wasm.instantiateMs.toFixed(1)} ms, ready ${l.marks.readyMs?.toFixed(1)} ms, first frame ${l.timeToFirstFrameMs?.toFixed(1)} ms, first update ${l.timeToFirstInteractiveUpdateMs?.toFixed(1)} ms`);
      console.log(`memory estimate ${m.estimate.totalBytes} B (wasm linear ${m.estimate.components.wasmLinear}, module ${m.estimate.components.wasmModule}, GPU native ${m.estimate.components.gpuNative}, JS held ${m.estimate.components.jsHeld}) vs budget ${m.estimate.budgetBytes} B: ${m.estimate.status}`);
    }
  } finally {
    if (server) { const { stopServer } = await import('../probe/server.mjs'); await stopServer(server.child); }
  }
  const out = resolve(a.out ?? join(ROOT, 'reports', `package-metrics-${id}.json`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${displayPath(out, ROOT)}`);
  if (report.browser?.failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
