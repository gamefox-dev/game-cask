// Engine detection for the normal inspect flow (`npm run inspect`). Read-only, never executes, never throws:
// problems become blockers/errors in the report. A detected, supported engine recommends the engine-runtime
// path (official web runtime of the exact version); everything else falls back to systematic lifting.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { identifyRunner, probePack } from './godot.mjs';
import { detectProfile, publicDetection } from './framework.mjs';
import { isProvisioned, runtimes } from './runtime.mjs';

const EXEC = new Set(['pe', 'elf', 'mach-o', 'mach-o-fat', 'mz']);
const MAX = 2 * 1024 ** 3;
function headTail(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size, head = Buffer.alloc(Math.min(4, size)), tail = Buffer.alloc(Math.min(12, size));
    readSync(fd, head, 0, head.length, 0); readSync(fd, tail, 0, tail.length, size - tail.length);
    return { size, head, tail };
  } finally { closeSync(fd); }
}
const dirOf = p => (dirname(p) === '.' ? '' : dirname(p));
const stem = p => basename(p).replace(/\.(exe|x86_64|x86_32|x86|arm64|64|32|pck|app)$/i, '');

/** Known engines without an adapter: reported so the porter (and kit developer) see them; lifting is the fallback. */
function otherEngines(files) {
  const has = re => files.filter(f => re.test(f.path)).map(f => f.path);
  const out = [];
  const add = (engine, evidence, note) => { if (evidence.length) out.push({ engine, adapter: null, evidence: evidence.slice(0, 5), note }); };
  add('unity', has(/(^|\/)(UnityPlayer\.(dll|so|dylib)|globalgamemanagers|data\.unity3d|UnityEngine(\.CoreModule)?\.dll)$/i), 'Unity: no engine adapter (Unity has no public per-version web runtime for desktop builds); lifting fallback');
  add('unreal', has(/\.(pak|utoc|ucas)$|(^|\/)Engine\/Binaries\//i), 'Unreal Engine: no adapter; lifting fallback');
  add('gamemaker', files.filter(f => /(^|\/)(data\.win|game\.unx|game\.ios)$/i.test(f.path) && f.format !== 'pe').map(f => f.path), 'GameMaker: no adapter; lifting fallback');
  add('rpgmaker-mv/mz', has(/(^|\/)js\/(rpg_core|rmmz_core)\.js$/i), 'RPG Maker MV/MZ: already an HTML5 game (www/ or js/); can be served directly - no adapter yet');
  add('renpy', has(/(^|\/)renpy\/|\.rpa$|\.rpyc$/i), "Ren'Py: no adapter (renpyweb exists upstream); lifting fallback");
  return out;
}

export function detectEngines(inv, root) {
  const report = { schema: 'game-cask/engine-detection-summary/1', engines: [], otherEngines: [], errors: [], recommendation: null };
  try {
    const files = inv.files ?? [];
    const packs = [], runners = [];
    for (const f of files) {
      if (f.size > MAX || f.size < 16) continue;
      const path = join(root, f.path);
      let probe = null, bytes = null;
      try {
        if (EXEC.has(f.format)) { bytes = readFileSync(path); probe = probePack(bytes); }
        else {
          const { head, tail } = headTail(path);
          if (head.toString('latin1') === 'GDPC' || tail.subarray(-4).toString('latin1') === 'GDPC') probe = probePack(readFileSync(path));
        }
      } catch (e) { report.errors.push(f.path + ': ' + e.message); continue; }
      if (probe?.location === 'standalone') packs.push({ file: f, probe });
      if (bytes) {
        const embedded = probe && probe.location !== 'standalone' ? probe : null;
        // Only the runner's own bytes: an appended pack's scripts must not supply version signatures.
        const identity = identifyRunner(embedded ? bytes.subarray(0, embedded.start) : bytes, null, { knownBuilds: runtimes().map(r => r.build) });
        if (identity.signatures.length) runners.push({ file: f, identity, embedded });
        else if (embedded) runners.push({ file: f, identity, embedded });
      }
    }
    const pairs = [];
    for (const r of runners.filter(r => r.embedded)) pairs.push({ runner: r.file.path, pack: r.file.path });
    for (const p of packs) {
      const near = runners.filter(r => dirOf(r.file.path) === dirOf(p.file.path));
      const runner = near.find(r => stem(r.file.path) === stem(p.file.path)) ?? (near.length === 1 ? near[0] : runners.length === 1 ? runners[0] : null);
      pairs.push({ runner: runner?.file.path ?? null, pack: p.file.path });
    }
    for (const r of runners) if (!pairs.some(p => p.runner === r.file.path)) pairs.push({ runner: r.file.path, pack: null });
    for (const pair of pairs) report.engines.push(describe(inv, root, pair, runners));
  } catch (e) { report.errors.push(e.message); }
  report.otherEngines = otherEngines(inv.files ?? []);
  const ok = report.engines.filter(e => e.recommendation === 'engineProfile');
  report.recommendation = ok.length
    ? { path: 'engineProfile', reason: `known engine ${ok[0].engine} ${ok[0].version} with an official web runtime (${ok[0].runtime.id}): run it on that runtime (fast path); systematic lifting stays the fallback`, profile: ok[0].suggestedProfile }
    : report.engines.length
      ? { path: 'pipeline', reason: 'engine detected but blocked (' + [...new Set(report.engines.flatMap(e => e.blockers))].join(', ') + '): use systematic lifting, or file an engine iteration request' }
      : { path: 'pipeline', reason: report.otherEngines.length ? 'engine without adapter (' + report.otherEngines.map(e => e.engine).join(', ') + '): systematic lifting (or file an engine iteration request)' : 'no known engine detected: systematic lifting' };
  return report;
}

function describe(inv, root, { runner, pack }, runners) {
  const base = { engine: 'godot', adapter: null, runner, pack, version: null, build: null, blockers: [], warnings: [], requirements: null, runtime: null, recommendation: 'pipeline' };
  const runnerInfo = runners.find(r => r.file.path === runner)?.identity;
  if (!pack) return { ...base, version: runnerInfo?.version ?? null, build: runnerInfo?.build ?? null, blockers: ['pack-not-found'], warnings: ['Godot runner without a detectable PCK (separate .pck missing, or an unsupported embedding)'] };
  try {
    const d = publicDetection(detectProfile(inv, { root, runner: runner ?? pack, pack, packOnly: !runner }));
    const runtime = d.runtimeId ? runtimes().find(r => r.id === d.runtimeId) : null;
    let provisioned = false; try { provisioned = runtime ? isProvisioned(runtime.id) : false; } catch { provisioned = 'corrupt'; }
    const entry = { ...base, adapter: d.adapter, version: d.version, build: d.build, packVersion: d.packVersion, packFormat: d.packFormat,
      packLocation: d.location, packSha256: d.packSha256, runnerSha256: runner ? d.runnerSha256 : null, files: d.files,
      blockers: d.blockers, warnings: d.warnings, requirements: d.requirements, settings: d.settings,
      runtime: runtime ? { id: runtime.id, variant: runtime.variant, threads: runtime.requirements.threads, crossOriginIsolation: runtime.requirements.isolation,
        verification: runtime.member.sha256 ? 'pinned-member-sha256' : runtime.archive.sha512 ? 'published-archive-sha512' : 'UNVERIFIED: no published checksum (--allow-unpublished + allowUnverifiedRuntime)', provisioned,
        alternatives: d.runtimeCandidates } : null };
    if (!d.blockers.length && runtime) {
      entry.recommendation = 'engineProfile';
      const s = d.settings ?? {};
      entry.suggestedProfile = { schema: 'game-cask/engine-profile/2', allowed: true, choice: 'engine runtime recommended by npm run inspect',
        adapter: d.adapter, runtime: runtime.id, version: runtime.version, build: runtime.build, inputRoot: '../original',
        runner, runnerSha256: d.runnerSha256, pack: { location: d.location === 'standalone' ? (dirOf(pack) === dirOf(runner) ? 'adjacent' : 'explicit') : d.location, ...(pack !== runner ? { from: pack } : {}), sha256: d.packSha256 },
        renderer: d.requirements.renderer, threads: runtime.requirements.threads,
        width: s['display/window/size/viewport_width'] ?? s['display/window/size/width'] ?? 640, height: s['display/window/size/viewport_height'] ?? s['display/window/size/height'] ?? 360 };
      const weak = !runtime.member.sha256 && !runtime.archive.sha512;
      if (weak) entry.warnings.push('runtime-unverified: this release publishes no checksum; fetch with --allow-unpublished and record engineProfile.allowUnverifiedRuntime: true');
      if (!provisioned) entry.next = `npm run engine -- fetch ${runtime.id}${weak ? ' --allow-unpublished' : ''}`;
    }
    return entry;
  } catch (e) {
    return { ...base, version: runnerInfo?.version ?? null, build: runnerInfo?.build ?? null, blockers: ['pack-invalid'], warnings: [e.message] };
  }
}
