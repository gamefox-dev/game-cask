#!/usr/bin/env node
// K71 (Q131 part 2): real process memory of the browser processes one session owns, measured beside the runtime's
// own estimate (diagnostics().memory, K64). macOS `footprint` reports phys_footprint per process (dirty + compressed +
// IOKit/GPU-owned memory: what jetsam counts on iOS), which ps RSS does not (it misses compressed pages).
//
// Ownership is exact, not name or pid-window based: the browser is launched with BGT_FOOTPRINT_TAG=<nonce> in its
// environment and __XPC_BGT_FOOTPRINT_TAG=<nonce> (launchd passes __XPC_-prefixed variables to XPC services, so
// WebKit's WebContent/GPU/Networking services carry it too). A process is ours iff its environment holds the nonce,
// so browsers of other sessions on the same machine are never counted.
//
//   npm run bench:footprint -- --game ID [--engine chromium|webkit] [--backend webgl2|webgpu] [--suspension asyncify|jspi]
//                        [--frames N] [--until TEXT] [--query 'k=v&k=v'] [--port P] [--out FILE]
//   npm run bench:footprint -- --sweep ID,ID,... [same options]      # footprint per MB of wasm (linear fit)
//   npm run bench:footprint -- --parse FILE                          # summarize a saved `footprint` text or JSON output
//
// Ports call `launchTagged()` + `footprintSnapshot()` from their own probe scripts. Desktop footprint is evidence for
// the trend, not the iPhone number: real-device memory remains a hardware gate.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const FOOTPRINT_TAG_ENV = 'BGT_FOOTPRINT_TAG';
const MB = 1024 * 1024;

/** Environment that marks every process of one browser launch (including WebKit XPC services) with `tag`. */
export function ownershipEnv(tag) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(tag)) throw new Error('footprint tag must be 8..64 characters of [A-Za-z0-9_-]');
  return { [FOOTPRINT_TAG_ENV]: tag, [`__XPC_${FOOTPRINT_TAG_ENV}`]: tag };
}

const UNITS = { B: 1, KB: 1024, MB: MB, GB: 1024 * MB, TB: 1024 * 1024 * MB };
/** `footprint` formatted sizes: "848 B", "1296 KB", "2.4 GB" (binary units). */
export function parseSize(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\s*$/.exec(text);
  if (!m) throw new Error(`unparsable footprint size: ${JSON.stringify(text)}`);
  return Math.round(Number(m[1]) * UNITS[m[2]]);
}

/** Parse `footprint -p PID ...` formatted (default) or `-f bytes` text output. */
export function parseFootprintText(text) {
  const processes = [];
  let cur = null, inTable = false;
  for (const line of text.split('\n')) {
    const head = /^(.+?) \[(\d+)\]: (?:\d+-bit\s+)?Footprint: (.+?) \(\d+ bytes per page\)\s*$/.exec(line);
    if (head) {
      cur = { pid: Number(head[2]), name: head[1].trim(), footprintBytes: parseSize(head[3]), physFootprintBytes: null,
        physFootprintPeakBytes: null, categories: [] };
      processes.push(cur); inTable = false; continue;
    }
    if (!cur) continue;
    if (/^\s+Dirty\s+Clean\s+Reclaimable\s+Regions\s+Category/.test(line)) { inTable = true; continue; }
    const aux = /^\s+(phys_footprint(?:_peak)?): (.+)$/.exec(line);
    if (aux) { cur[aux[1] === 'phys_footprint' ? 'physFootprintBytes' : 'physFootprintPeakBytes'] = parseSize(aux[2]); continue; }
    if (!inTable) continue;
    const sz = String.raw`(-?\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB))`;
    const row = new RegExp(String.raw`^\s*${sz}\s+${sz}\s+${sz}\s+(\d+)\s+(.+?)\s*$`).exec(line);
    if (row && row[5] !== 'TOTAL') cur.categories.push({ name: row[5], dirty: parseSize(row[1]), clean: parseSize(row[2]),
      reclaimable: parseSize(row[3]), swapped: null, regions: Number(row[4]) });
    else if (row) inTable = false;
  }
  for (const p of processes) p.categories.sort((a, b) => b.dirty - a.dirty);
  return processes;
}

/** Parse `footprint --json FILE -f bytes` output. */
export function parseFootprintJson(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  const scale = d['bytes per unit'] ?? 1;
  return (d.processes ?? []).map((p) => ({
    pid: p.pid, name: p.name, footprintBytes: p.footprint * scale,
    physFootprintBytes: p.auxiliary?.phys_footprint != null ? p.auxiliary.phys_footprint * scale : null,
    physFootprintPeakBytes: p.auxiliary?.phys_footprint_peak != null ? p.auxiliary.phys_footprint_peak * scale : null,
    categories: Object.entries(p.categories ?? {}).map(([name, c]) => ({ name, dirty: c.dirty * scale, clean: c.clean * scale,
      reclaimable: c.reclaimable * scale, swapped: c.swapped != null ? c.swapped * scale : null, regions: c.regions }))
      .sort((a, b) => b.dirty - a.dirty),
  }));
}

/** Rows of `ps -axo pid=,ppid=,command=`. */
export function parsePs(text) {
  return text.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
}

/** Which browser process this is. Roles: browser (UI), renderer (Chromium page process / WebKit WebContent),
 * gpu (Chromium GPU process / WebKit GPU process), network, utility, launcher (wrapper scripts), other. */
export function classifyProcess(command) {
  const c = command;
  if (/com\.apple\.WebKit\.WebContent/.test(c)) return { engine: 'webkit', role: 'renderer' };
  if (/com\.apple\.WebKit\.GPU/.test(c)) return { engine: 'webkit', role: 'gpu' };
  if (/com\.apple\.WebKit\.Networking/.test(c)) return { engine: 'webkit', role: 'network' };
  if (/\/Playwright\.app\/|\/Playwright(\s|$)|MiniBrowser/.test(c)) return { engine: 'webkit', role: 'browser' };
  if (/pw_run\.sh/.test(c)) return { engine: 'webkit', role: 'launcher' };
  if (/Chrom(e|ium)|chrome-headless-shell/i.test(c)) {
    if (/crashpad/.test(c)) return { engine: 'chromium', role: 'other' };
    const type = /--type=([\w-]+)/.exec(c)?.[1];
    if (!type) return { engine: 'chromium', role: 'browser' };
    if (type === 'renderer') return { engine: 'chromium', role: 'renderer' };
    if (type === 'gpu-process') return { engine: 'chromium', role: 'gpu' };
    if (type === 'utility') return { engine: 'chromium', role: /NetworkService/.test(c) ? 'network' : 'utility' };
    return { engine: 'chromium', role: 'other' };
  }
  return { engine: null, role: 'other' };
}

/** Pids whose environment (as printed by `ps -E -ww -o pid=,command=`) carries the tag. */
export function taggedPids(envText, tag) {
  const pids = [];
  for (const line of envText.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && new RegExp(`(^|\\s)${FOOTPRINT_TAG_ENV}=${tag}(\\s|$)`).test(m[2])) pids.push(Number(m[1]));
  }
  return pids;
}

/** Per-role totals of phys_footprint (falls back to the footprint figure); `renderer` is the largest renderer
 * (the page's process; a spare/prewarmed renderer is small and listed separately in `processes`). */
export function summarizeFootprint(processes, rows = []) {
  const commands = new Map(rows.map((r) => [r.pid, r.command]));
  const list = processes.map((p) => {
    const k = classifyProcess(commands.get(p.pid) ?? p.name);
    return { pid: p.pid, name: p.name, engine: k.engine, role: k.role, bytes: p.physFootprintBytes ?? p.footprintBytes,
      peakBytes: p.physFootprintPeakBytes, top: p.categories.slice(0, 6).map((c) => ({ name: c.name, dirty: c.dirty })) };
  }).sort((a, b) => b.bytes - a.bytes);
  const byRole = {};
  for (const p of list) byRole[p.role] = (byRole[p.role] ?? 0) + p.bytes;
  const renderers = list.filter((p) => p.role === 'renderer');
  return { totalBytes: list.reduce((n, p) => n + p.bytes, 0), byRole, pageRendererBytes: renderers[0]?.bytes ?? null,
    gpuProcessBytes: byRole.gpu ?? null, processes: list };
}

/** Least-squares line y = slope * x + intercept, with r². Needs two distinct x values. */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) throw new Error('a fit needs at least two points');
  const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
  if (sxx === 0) throw new Error('a fit needs at least two distinct x values');
  const slope = sxy / sxx, intercept = my - slope * mx;
  return { slope, intercept, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy), n };
}

/** Owned processes of the browser launched with `tag` (macOS / BSD ps). */
export async function ownedProcesses(tag) {
  const rows = parsePs((await run('ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 64 * MB })).stdout);
  const candidates = rows.filter((r) => classifyProcess(r.command).engine && r.pid !== process.pid);
  if (!candidates.length) return { rows, pids: [] };
  const env = await run('ps', ['-E', '-ww', '-o', 'pid=,command=', '-p', candidates.map((r) => r.pid).join(',')], { maxBuffer: 256 * MB })
    .then((r) => r.stdout, (e) => e.stdout ?? '');
  const owned = new Set(taggedPids(env, tag));
  return { rows, pids: candidates.filter((r) => owned.has(r.pid) && classifyProcess(r.command).role !== 'launcher').map((r) => r.pid) };
}

/** `footprint` for the given pids; { available: false } off macOS or when the tool fails. */
export async function measureFootprint(pids) {
  if (process.platform !== 'darwin') return { available: false, reason: `footprint is macOS-only (platform ${process.platform})`, processes: [] };
  if (!pids.length) return { available: false, reason: 'no owned browser processes found', processes: [] };
  const dir = mkdtempSync(join(tmpdir(), 'bgt-footprint-')), file = join(dir, 'footprint.json');
  try {
    await run('footprint', ['-f', 'bytes', '--json', file, ...pids.flatMap((p) => ['-p', String(p)])], { maxBuffer: 64 * MB, timeout: 120000 });
    const json = JSON.parse(readFileSync(file, 'utf8'));
    return { available: true, processes: parseFootprintJson(json), errors: json.errors ?? [] };
  } catch (e) {
    return { available: false, reason: `footprint failed: ${String(e.message ?? e).slice(0, 300)}`, processes: [] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** One labelled sample: the page's K64 estimate and the owned processes' real footprint at the same moment. */
export async function footprintSnapshot(page, tag, label) {
  const memory = await page.evaluate(() => window.__BGT_TEST__?.memory?.() ?? null);
  const { rows, pids } = await ownedProcesses(tag);
  const fp = await measureFootprint(pids);
  const summary = fp.available ? summarizeFootprint(fp.processes, rows) : null;
  const estimate = memory?.estimate?.totalBytes ?? null;
  // K74 (Q137): the GPU process against what the runtime attributes to it: native objects + canvas estimate
  // (gpuNative), the modeled overhead (gpuOverhead) and the browser's own base (reported by the model, never counted).
  const o = memory?.gpu?.overhead ?? null, c = memory?.estimate?.components ?? null;
  const gpuAttributed = c ? c.gpuNative + (c.gpuOverhead ?? 0) + (o?.browserBaseBytes ?? 0) : null;
  return { label, at: new Date().toISOString(), estimate: memory ? { totalBytes: estimate, components: memory.estimate.components,
    wasmModuleBytes: memory.wasm.moduleBytes, wasmLinearBytes: memory.wasm.linearBytes,
    gpuTextures: memory.gpu?.native?.textures ?? null, recoveryShadowBytes: memory.js.gpuRecoveryShadowBytes,
    jsHeldBytes: memory.js.heldBytes, gpuOverhead: o } : null,
  gpuProcess: summary && gpuAttributed !== null ? { measuredBytes: summary.gpuProcessBytes, attributedBytes: gpuAttributed,
    unattributedBytes: summary.gpuProcessBytes === null ? null : summary.gpuProcessBytes - gpuAttributed } : null,
  footprint: fp.available ? summary : { unavailable: fp.reason },
  // What the estimate cannot see: compiled code, engine/driver overhead, JS engine heap beyond held copies.
  unattributedBytes: summary && estimate !== null ? (summary.pageRendererBytes ?? 0) + (summary.gpuProcessBytes ?? 0) - estimate : null };
}

export const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'];
/** Launch Chromium (real GPU, as the porter's r29 runs) or WebKit with the ownership tag; returns { browser, tag }. */
export async function launchTagged(engine = 'chromium', tag = randomUUID().replace(/-/g, '')) {
  const pw = await import('@playwright/test');
  const env = { ...process.env, ...ownershipEnv(tag) };
  const browser = engine === 'webkit' ? await pw.webkit.launch({ env, timeout: 120000 })
    : await pw.chromium.launch({ channel: 'chromium', args: GPU_ARGS, env, timeout: 120000 });
  return { browser, tag };
}

async function measureGame(base, game, a) {
  const { browser, tag } = await launchTagged(a.engine);
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const q = new URLSearchParams({ game, backend: a.backend, paused: '1', ephemeral: '1', ...(a.suspension ? { suspension: a.suspension } : {}),
      ...Object.fromEntries(new URLSearchParams(a.query ?? '')) });
    await page.goto(new URL(`?${q}`, base).href);
    await page.waitForFunction(() => window.__BGT_TEST__ && (window.__BGT_TEST__.ready() || window.__BGT_TEST__.failed()), null, { timeout: a.timeout });
    const d0 = await page.evaluate(() => { const d = window.__BGT_TEST__.diagnostics(); return { failed: d.failed, backend: d.backend, suspension: d.suspension }; });
    if (d0.failed) throw new Error(`${game}: runtime failed to start`);
    const snapshots = [await footprintSnapshot(page, tag, 'ready')];
    let reached = !a.until;
    for (let done = 0; done < a.frames; done += 10) {
      await page.evaluate((n) => window.__BGT_TEST__.step(n), Math.min(10, a.frames - done));
      if (!reached) reached = await page.evaluate((t) => window.__BGT_TEST__.diagnostics().logs.some((l) => l.message.includes(t)), a.until);
      if (reached && a.until) break;
    }
    if (!reached) throw new Error(`${game}: "${a.until}" not logged within ${a.frames} frames`);
    snapshots.push(await footprintSnapshot(page, tag, 'run'));
    const errors = await page.evaluate(() => window.__BGT_TEST__.diagnostics().errors);
    return { game, engine: a.engine, ...d0, query: a.query ?? '', frames: a.frames, until: a.until ?? null, errors, snapshots };
  } finally { await browser.close(); }
}

/** Footprint per MB of wasm: fit owned renderer (+GPU) footprint and its unattributed part against module size. */
export function sweepFit(results, label = 'run') {
  const pts = results.map((r) => ({ r, s: r.snapshots.find((x) => x.label === label) })).filter(({ s }) => s?.footprint?.pageRendererBytes != null);
  const at = (f) => pts.map(({ s }) => ({ x: s.estimate.wasmModuleBytes / MB, y: f(s) / MB }));
  const fits = {};
  for (const [k, f] of Object.entries({ renderer: (s) => s.footprint.pageRendererBytes,
    rendererPlusGpu: (s) => s.footprint.pageRendererBytes + (s.footprint.gpuProcessBytes ?? 0),
    unattributed: (s) => s.unattributedBytes })) {
    try { fits[k] = { ...linearFit(at(f)), unit: 'MB footprint per MB wasm' }; } catch (e) { fits[k] = { error: e.message }; }
  }
  // Per-segment slopes between consecutive sizes: the fit's r² alone hides curvature (e.g. lazy compilation).
  const sorted = [...pts].sort((p, q) => p.s.estimate.wasmModuleBytes - q.s.estimate.wasmModuleBytes);
  const segments = sorted.slice(1).map(({ r, s }, i) => {
    const p = sorted[i].s, dx = (s.estimate.wasmModuleBytes - p.estimate.wasmModuleBytes) / MB;
    return { from: sorted[i].r.game, to: r.game, wasmMB: dx, renderer: (s.footprint.pageRendererBytes - p.footprint.pageRendererBytes) / MB / dx,
      unattributed: (s.unattributedBytes - p.unattributedBytes) / MB / dx };
  });
  return { label, segments, points: pts.map(({ r, s }) => ({ game: r.game, wasmMB: s.estimate.wasmModuleBytes / MB,
    rendererMB: s.footprint.pageRendererBytes / MB, gpuMB: (s.footprint.gpuProcessBytes ?? 0) / MB,
    estimateMB: s.estimate.totalBytes / MB, unattributedMB: s.unattributedBytes / MB })), fits };
}

function parseArgs(argv) {
  const a = { engine: 'chromium', backend: 'webgl2', frames: 60, timeout: 300000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--game') a.game = v(); else if (k === '--sweep') a.sweep = v().split(',').filter(Boolean);
    else if (k === '--engine') a.engine = v(); else if (k === '--backend') a.backend = v(); else if (k === '--suspension') a.suspension = v();
    else if (k === '--frames') a.frames = Number(v()); else if (k === '--until') a.until = v(); else if (k === '--port') a.port = Number(v());
    else if (k === '--out') a.out = v(); else if (k === '--parse') a.parse = v(); else if (k === '--timeout') a.timeout = Number(v());
    else if (k === '--query') a.query = v();
    else throw new Error(`unknown option ${k}`);
  }
  if (!a.parse && !a.game && !a.sweep) throw new Error('usage: footprint.mjs --game ID | --sweep ID,ID,... | --parse FILE [--engine chromium|webkit] [--backend webgl2|webgpu] [--frames N] [--until TEXT]');
  if (!['chromium', 'webkit'].includes(a.engine)) throw new Error('--engine must be chromium or webkit');
  if (!['webgl2', 'webgpu'].includes(a.backend)) throw new Error('--backend must be webgl2 or webgpu');
  if (!(Number.isInteger(a.frames) && a.frames >= 0)) throw new Error('--frames must be a non-negative integer');
  return a;
}

const mb = (b) => b === null || b === undefined ? 'n/a' : `${(b / MB).toFixed(1)} MB`;
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.parse) {
    const text = readFileSync(a.parse, 'utf8');
    const processes = text.trimStart().startsWith('{') ? parseFootprintJson(text) : parseFootprintText(text);
    console.log(JSON.stringify(summarizeFootprint(processes), null, 2));
    return;
  }
  const { ROOT } = await import('../build/toolchain.mjs');
  const { startServer, stopServer } = await import('../probe/server.mjs');
  const games = a.sweep ?? [a.game];
  const server = await startServer(a.port ?? Number(process.env.BGT_E2E_PORT ?? 5199), games[0]);
  const results = [];
  try {
    for (const game of games) {
      const r = await measureGame(server.url, game, a);
      results.push(r);
      for (const s of r.snapshots) console.log(`${game} ${r.engine}/${r.backend}/${r.suspension} ${s.label}: estimate ${mb(s.estimate?.totalBytes)}, ` +
        (s.footprint.unavailable ? `footprint unavailable (${s.footprint.unavailable})` :
          `page renderer ${mb(s.footprint.pageRendererBytes)}, GPU process ${mb(s.footprint.gpuProcessBytes)}, all owned ${mb(s.footprint.totalBytes)}, ` +
          `unattributed ${mb(s.unattributedBytes)}`) + ` (wasm ${mb(s.estimate?.wasmModuleBytes)})` +
          (s.gpuProcess ? `; GPU process attributed ${mb(s.gpuProcess.attributedBytes)} vs measured ${mb(s.gpuProcess.measuredBytes)}` : '') +
          (s.estimate ? `; JS held ${mb(s.estimate.jsHeldBytes)}` : ''));
    }
  } finally { await stopServer(server.child); }
  const report = { schema: 'game-cask/footprint/1', generated: new Date().toISOString(), host: { platform: process.platform, arch: process.arch },
    engine: a.engine, backend: a.backend, results, ...(results.length > 1 ? { sweep: sweepFit(results) } : {}) };
  if (report.sweep) for (const [k, f] of Object.entries(report.sweep.fits)) console.log(f.error ? `fit ${k}: ${f.error}` :
    `fit ${k}: ${f.slope.toFixed(3)} MB per MB wasm + ${f.intercept.toFixed(1)} MB (r² ${f.r2.toFixed(3)}, n ${f.n})`);
  if (report.sweep) for (const g of report.sweep.segments) console.log(`segment ${g.from} -> ${g.to} (+${g.wasmMB.toFixed(1)} MB wasm): ` +
    `renderer ${g.renderer.toFixed(2)} MB/MB, unattributed ${g.unattributed.toFixed(2)} MB/MB`);
  const out = resolve(a.out ?? join(ROOT, 'reports', `footprint-${a.sweep ? 'sweep' : a.game}-${a.engine}-${a.backend}.json`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${out.startsWith(ROOT) ? out.slice(ROOT.length + 1) : out.split('/').pop()}`);
  if (results.some((r) => r.errors.length)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
