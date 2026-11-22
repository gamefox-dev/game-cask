// Engine-runtime path orchestration: exact-version detection -> official web runtime -> deployable static bundle.
// Engine-specific pack/shell semantics stay in adapters. The choice is the porter's, recorded in port/game.json
// (engineProfile.allowed + choice) and echoed into the build manifest and trial record.
import { readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, cpSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { inventory } from '../inspect/inspect.mjs';
import * as godot from './godot.mjs';
import { PRIVATE, hash, runtimeById, selectRuntime, verifyRuntime, runtimes } from './runtime.mjs';
import { generateShell } from './shell.mjs';
import { staticHeaders, headersFile } from './headers.mjs';

const sha256 = godot.sha256;
const godotAdapter = major => ({ engine: 'godot', major, parsePack: godot.parsePack, identifyRunner: godot.identifyRunner, analyzePack: godot.analyzePack, generateShell });
export const adapters = Object.freeze({ godot3: godotAdapter(3), godot4: godotAdapter(4) });
const SCHEMAS = ['game-cask/engine-profile/1', 'game-cask/engine-profile/2'];

export function validateConfig(cfg) {
  if (cfg.pipeline && cfg.engineProfile) throw new Error('pipeline and engineProfile are mutually exclusive');
  if (!cfg.engineProfile) throw new Error('engineProfile missing');
  if (cfg.engineProfile.allowed !== true) throw new Error('engineProfile is an explicit choice: set engineProfile.allowed: true (and record engineProfile.choice) in game.json');
  const p = cfg.engineProfile;
  if (!SCHEMAS.includes(p.schema) || !adapters[p.adapter]) throw new Error('unsupported engine profile schema/adapter');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(cfg.id) || typeof cfg.name !== 'string') throw new Error('invalid engine game id/name');
  if (p.choice !== undefined && (typeof p.choice !== 'string' || p.choice.length > 500)) throw new Error('engineProfile.choice must be a short string');
  if (p.allowUnverifiedRuntime !== undefined && typeof p.allowUnverifiedRuntime !== 'boolean') throw new Error('engineProfile.allowUnverifiedRuntime must be boolean');
  const runtime = runtimeById(p.runtime);
  if (runtime.adapter !== p.adapter) throw new Error('runtime adapter mismatch');
  if (p.version !== runtime.version || p.build !== runtime.build) throw new Error('profile/runtime exact version/build mismatch');
  if (p.threads !== runtime.requirements.threads) throw new Error(`threads=${p.threads} does not match runtime ${runtime.id} (threads=${runtime.requirements.threads}); pick the ${p.threads ? 'threads' : 'nothreads'} variant`);
  if (!(p.renderer === runtime.requirements.renderer || (p.adapter === 'godot3' && p.renderer === 'webgl'))) throw new Error('unsupported renderer ' + p.renderer);
  if (!p.pack || !['embedded-trailer', 'embedded-section', 'adjacent', 'explicit'].includes(p.pack.location) || !/^[a-f0-9]{64}$/.test(p.pack.sha256) || !/^[a-f0-9]{64}$/.test(p.runnerSha256)) throw new Error('pack and runner SHA-256 are required');
  for (const n of ['width', 'height']) if (p[n] !== undefined && (!Number.isInteger(p[n]) || p[n] < 1 || p[n] > 4096)) throw new Error('invalid shell ' + n);
  if (p.allowedErrors !== undefined) validateAllowedErrors(p.allowedErrors);
  if (p.engineArgs !== undefined) validateEngineArgs(p.adapter, p.engineArgs);
  if (p.engineArgs?.length && runtime.shell === 'godot-legacy') throw new Error('engineProfile.engineArgs need the Engine config API (Godot 3.3+/4.x); the 3.2 legacy shell passes no arguments');
  return { profile: p, runtime, adapter: adapters[p.adapter] };
}

// K59 Q7: recorded official engine command-line options, per adapter. Godot 3.x/4.x parse these in main.cpp on every
// platform (the web runtime gets them through the Engine config `args`). Timing options only: --fixed-fps disables
// real-time synchronization (one fixed step per main-loop iteration), which makes scripted replays reproducible.
const int = (min, max) => v => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
const num = (min, max) => v => /^\d+(\.\d+)?$/.test(v) && Number(v) >= min && Number(v) <= max;
const GODOT_ARGS = { '--fixed-fps': int(1, 1000), '--time-scale': num(0.01, 100), '--frame-delay': int(0, 100), '--print-fps': null };
export const ENGINE_ARGS = Object.freeze({ godot3: GODOT_ARGS, godot4: GODOT_ARGS });
export function validateEngineArgs(adapter, args) {
  const allowed = ENGINE_ARGS[adapter];
  if (!allowed) throw new Error('no engine argument allowlist for adapter ' + adapter);
  if (!Array.isArray(args) || args.length > 16 || args.some(a => typeof a !== 'string')) throw new Error('engineProfile.engineArgs must be an array of at most 16 strings');
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!Object.hasOwn(allowed, name)) throw new Error(`engineProfile.engineArgs: ${JSON.stringify(name)} is not an allowlisted ${adapter} option (${Object.keys(allowed).join(', ')})`);
    if (seen.has(name)) throw new Error('engineProfile.engineArgs: duplicate ' + name);
    seen.add(name);
    const check = allowed[name];
    if (check) {
      const value = args[++i];
      if (value === undefined || !check(value)) throw new Error(`engineProfile.engineArgs: ${name} needs a valid value (got ${JSON.stringify(value)})`);
    }
  }
  return args;
}

// K59: engine ERROR lines proven to come from the game itself (e.g. a scene connecting one signal twice) may be
// recorded in engineProfile.allowedErrors. Only engine stderr lines with an ERROR prefix can match (never aborts,
// traps, page errors or context-free stderr), each entry matches whole lines, and over-broad patterns are refused.
const ERROR_LINE = /^(USER |SCRIPT )?ERROR: \S/;
const BROAD_SENTINELS = ['ERROR: x', 'ERROR: Condition "p_index < 0 || p_index >= size" is true.', 'ERROR: Index p_index = 3 is out of bounds (size() = 0).',
  'SCRIPT ERROR: Invalid call. Nonexistent function \'f\' in base \'Nil\'.', 'USER ERROR: x', 'ERROR: Aborted(RuntimeError: unreachable)',
  'ERROR: Failed loading resource: res://a.tscn.', 'ERROR: Signal \'x\' is already connected to given method \'y\' in that object.'];
export function allowedErrorMatcher(entry) {
  if (typeof entry.message === 'string') return line => line === entry.message;
  const re = new RegExp('^(?:' + entry.pattern + ')$', 'u');
  return line => re.test(line);
}
export function validateAllowedErrors(list) {
  if (!Array.isArray(list) || list.length > 32) throw new Error('engineProfile.allowedErrors must be an array of at most 32 entries');
  list.forEach((e, i) => {
    const where = `engineProfile.allowedErrors[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(where + ' must be an object');
    const extra = Object.keys(e).filter(k => !['message', 'pattern', 'justification', 'evidence'].includes(k));
    if (extra.length) throw new Error(where + ': unknown field ' + extra.join(', '));
    if ((e.message === undefined) === (e.pattern === undefined)) throw new Error(where + ' needs exactly one of message (exact line) or pattern (whole-line regex)');
    const text = e.message ?? e.pattern;
    if (typeof text !== 'string' || !text || text.length > 500) throw new Error(where + ': message/pattern must be a non-empty string of at most 500 characters');
    if (e.message !== undefined && !ERROR_LINE.test(e.message)) throw new Error(where + ': only engine ERROR lines ("ERROR: …", "USER ERROR: …", "SCRIPT ERROR: …") can be allowlisted');
    if (e.pattern !== undefined) {
      let match;
      try { match = allowedErrorMatcher(e); } catch (err) { throw new Error(where + ': invalid pattern: ' + err.message); }
      if (match('') || BROAD_SENTINELS.some(line => match(line))) throw new Error(where + ': pattern is too broad (matches generic engine errors); allowlist the exact message');
      if (!/^\^?(USER |SCRIPT )?ERROR: /.test(e.pattern)) throw new Error(where + ': pattern must start with a literal ERROR prefix');
      if (e.pattern.replace(/\\./g, '').replace(/[.*+?^${}()|[\]\\]/g, '').length < 24) throw new Error(where + ': pattern needs at least 24 literal characters');
    }
    if (typeof e.justification !== 'string' || e.justification.trim().length < 20 || e.justification.length > 1000) throw new Error(where + ': justification (20..1000 characters: why the game itself produces this line) is required');
    if (typeof e.evidence !== 'string' || !e.evidence || isAbsolute(e.evidence) || e.evidence.length > 300) throw new Error(where + ': evidence must be a relative path (from the game.json directory) to the recorded proof');
  });
  return list;
}
function safeInput(root, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name)) throw new Error('input path must be relative to inputRoot');
  const path = resolve(root, name), rel = relative(root, path);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('input path escapes inputRoot');
  const realRoot = realpathSync(root), real = realpathSync(path);
  if (!real.startsWith(realRoot + sep) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('input symlink/outside root/non-file');
  if (lstatSync(path).size > 2 * 1024 ** 3) throw new Error('engine input exceeds 2 GiB limit');
  return path;
}
/**
 * Exact detection bound to the inspect inventory (hash-checked). Runtime: runtimeId if given (checked), else the
 * official runtime of the runner's exact version (pack version without a runner), threaded if the game needs it.
 */
export function detectProfile(inspectOutput, { root, runner, pack = runner, runtimeId, threads, packOnly = false }) {
  if (inspectOutput?.schema !== 'game-cask/inventory/1') throw new Error('engine detection requires inspect inventory/1');
  // inspect has bounded depth/count. Do not treat silently omitted paths as a complete native/Mono inventory.
  const known = new Set(inspectOutput.files.map(f => f.path));
  const audit = (dir, prefix = '', depth = 0) => {
    if (depth > 12) throw new Error('engine input inventory incomplete: directory depth limit');
    for (const name of readdirSync(dir)) {
      if (name === '.gitkeep' || name === '.DS_Store') continue;
      const file = join(dir, name), path = prefix + name, st = lstatSync(file);
      if (st.isSymbolicLink() || !st.isFile() && !st.isDirectory()) throw new Error('engine input has uninspected file/symlink: ' + path);
      if (st.isDirectory()) audit(file, path + '/', depth + 1);
      else if (!known.has(path)) throw new Error('engine input inventory incomplete: ' + path);
    }
  };
  audit(root);
  const load = name => {
    const record = inspectOutput.files.find(f => f.path === name);
    if (!record) throw new Error('input missing from inspect inventory: ' + name);
    const bytes = readFileSync(safeInput(root, name));
    if (record.sha256 !== sha256(bytes) || record.size !== bytes.length) throw new Error('stale inspect inventory: ' + name);
    return { record, bytes };
  };
  const pk = load(pack), r = packOnly ? null : pack === runner ? pk : load(runner), parsed = godot.parsePack(pk.bytes);
  const major = parsed.versionTriple[0], adapterId = 'godot' + major, adapter = adapters[adapterId];
  const runnerBytes = r ? (pack === runner && parsed.location !== 'standalone' ? r.bytes.subarray(0, parsed.start) : r.bytes) : null;
  const knownBuilds = runtimes().map(x => x.build);
  const loose = runnerBytes ? adapter.identifyRunner(runnerBytes, null, { knownBuilds }) : null;
  const analysis = adapter.analyzePack(parsed, inspectOutput.files, loose);
  const blockers = [...analysis.blockers];
  const wantThreads = threads ?? (analysis.requirements.threads === 'required' ? true : undefined);
  const engineVersion = loose?.version ?? parsed.version;
  let runtime = null, candidates = [];
  if (runtimeId) {
    runtime = runtimeById(runtimeId); candidates = [runtime.id];
    if (runtime.version !== engineVersion) blockers.push('runtime-version-mismatch');
  } else {
    const s = selectRuntime({ version: engineVersion, threads: wantThreads });
    runtime = s.runtime; candidates = s.candidates; blockers.push(...s.blockers);
  }
  if (runtime && runtime.adapter !== adapterId) blockers.push('runtime-version-mismatch');
  // Pack header = exporting editor version; Godot loads packs of the same major.minor (patch ignored).
  if (runtime && parsed.versionTriple.slice(0, 2).join('.') !== runtime.version.split('.').slice(0, 2).join('.')) blockers.push('runtime-version-mismatch');
  if (major === 3 && runtime && parsed.version !== runtime.version) blockers.push('runtime-version-mismatch');
  const identity = runnerBytes && runtime ? adapter.identifyRunner(runnerBytes, runtime) : loose;
  if (identity) blockers.push(...identity.blockers);
  else blockers.push('runner-not-found');
  if (r && !['pe', 'elf', 'mach-o', 'mach-o-fat', 'mz'].includes(r.record.format)) blockers.push('runner-format-unrecognized');
  if (analysis.requirements.threads === 'required' && runtime && !runtime.requirements.threads) blockers.push('threads-required');
  if (inspectOutput.skipped?.length) blockers.push('uninspected-files');
  if (inspectOutput.files.filter(f => /\.pck$/i.test(f.path) && f.path !== pack).length) blockers.push('additional-packs');
  return { schema: 'game-cask/engine-detection/2', adapter: adapterId, engine: 'godot', version: runtime?.version ?? engineVersion, packVersion: parsed.version,
    packFormat: parsed.format, build: identity?.build ?? null, runtimeId: runtime?.id ?? null, runtimeCandidates: candidates,
    identity, blockers: [...new Set(blockers)].sort(), warnings: analysis.warnings, requirements: { ...analysis.requirements,
      runtimeThreads: runtime?.requirements.threads ?? null, crossOriginIsolation: runtime?.requirements.isolation ?? null }, settings: analysis.settings,
    runnerSha256: r ? sha256(r.bytes) : null, sourceSha256: parsed.sourceSha256, packSha256: parsed.packSha256,
    location: parsed.location, rebasedOffsets: parsed.rebasedOffsets, files: parsed.entries.length, _parsed: parsed };
}
export function publicDetection(d) { const { _parsed, ...report } = d; return report; }

/** Copy once, from bytes hashed right here against the verified runtime hash (no check-then-copy race). */
export function copyVerified(fromDir, toDir, name, expected) {
  const data = readFileSync(join(fromDir, name));
  if (!expected || hash(data) !== expected) throw new Error('runtime file changed after verification: ' + name);
  writeFileSync(join(toDir, name), data, { flag: 'wx' });
}
/** manifest-crc32 runtimes (no published checksum) need a recorded opt-in in game.json, at build AND serve time. */
export function requireVerifiedOrOptIn(profile, verification) {
  if (verification === 'manifest-crc32' && profile?.allowUnverifiedRuntime !== true)
    throw new Error(`runtime ${profile?.runtime} is UNVERIFIED (manifest-crc32: its release publishes no checksum); record engineProfile.allowUnverifiedRuntime: true in game.json to use it`);
}

/** Files of the official template a page actually loads (no HTML templates, service workers, PWA files). */
export const bundledRuntimeFiles = names => names.filter(n => /\.(js|wasm)$/.test(n) && !/service\.worker\.js$/.test(n));

export function buildEngine(gameDir, cfg, { outRoot = join(PRIVATE, 'builds'), store, check = false, quiet = false } = {}) {
  const { profile: p, runtime, adapter } = validateConfig(cfg);
  const root = resolve(gameDir, p.inputRoot ?? '../original');
  // Inspect fresh every build: directory/extension inventory is part of refusal policy.
  const inv = inventory(root), detection = detectProfile(inv, { root, runner: p.runner, pack: p.pack.from ?? p.runner, runtimeId: runtime.id });
  if (detection.blockers.length) throw new Error('engine profile unsupported: ' + detection.blockers.join(', '));
  if (detection.packSha256 !== p.pack.sha256 || detection.runnerSha256 !== p.runnerSha256) throw new Error('engine pack/runner SHA-256 mismatch');
  if (p.pack.location.startsWith('embedded') && detection.location !== p.pack.location) throw new Error('expected ' + p.pack.location + ' pack, found ' + detection.location);
  if (!p.pack.location.startsWith('embedded') && detection.location !== 'standalone') throw new Error('expected standalone side pack');
  if (p.pack.location === 'adjacent' && dirname(resolve(root, p.pack.from)) !== dirname(resolve(root, p.runner))) throw new Error('adjacent pack must be beside runner');
  // K59: every allowlisted error points at recorded evidence; its hash goes into the manifest.
  const allowedErrors = (p.allowedErrors ?? []).map((e, i) => {
    const file = resolve(gameDir, e.evidence);
    if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error(`engineProfile.allowedErrors[${i}].evidence not found (or not a regular file): ${e.evidence}`);
    return { id: 'E' + (i + 1), ...e, evidenceSha256: sha256(readFileSync(file)) };
  });
  const engineArgs = p.engineArgs ?? [];
  const provisioned = verifyRuntime(runtime.id, { store });
  requireVerifiedOrOptIn(p, provisioned.verification);
  const parent = resolve(outRoot); mkdirSync(parent, { recursive: true });
  const out = join(parent, cfg.id), staging = mkdtempSync(join(parent, '.engine-build-'));
  const runtimeFiles = bundledRuntimeFiles(provisioned.runtimeFiles), notices = runtime.notices.map(n => n.file);
  const headers = staticHeaders({ isolation: runtime.requirements.isolation });
  const result = { schema: 'game-cask/engine-build/2', id: cfg.id, name: cfg.name, private: true, path: 'engineProfile',
    engineProfile: { ...publicDetection(detection), choice: { by: 'game.json engineProfile.allowed', reason: p.choice ?? null },
      runtime: { id: runtime.id, variant: runtime.variant, version: runtime.version, build: runtime.build, sha256: provisioned.receipt.archiveSha256,
        verification: provisioned.verification, verified: provisioned.verified, archive: runtime.archive, files: provisioned.files },
      allowUnverifiedRuntime: p.allowUnverifiedRuntime === true, allowedErrors, engineArgs,
      requirements: runtime.requirements, notices: runtime.notices, scan: 'Known unsupported patterns only; not a complete platform feature proof.' },
    headers, files: {}, metrics: null };
  try {
    for (const name of [...runtimeFiles, ...notices]) copyVerified(provisioned.target, staging, name, provisioned.files[name]);
    writeFileSync(join(staging, 'game.pck'), detection._parsed.pack);
    cpSync(new URL('browser-adapter.js', import.meta.url), join(staging, 'browser-adapter.js'));
    const wasm = runtimeFiles.find(n => n.endsWith('.wasm'));
    // K59 Q7: an option must be one this exact official build parses (its literal is in the runtime wasm).
    const wasmBytes = readFileSync(join(staging, wasm));
    for (const name of engineArgs.filter(a => a.startsWith('--'))) if (!wasmBytes.includes(Buffer.from(name + '\0'))) throw new Error(`engineProfile.engineArgs: ${runtime.id} does not parse ${name}`);
    writeFileSync(join(staging, 'index.html'), adapter.generateShell({ id: cfg.id, name: cfg.name, runtime, packSize: detection._parsed.pack.length,
      wasmSize: readFileSync(join(staging, wasm)).length, width: p.width, height: p.height, packSha256: detection.packSha256, threads: runtime.requirements.threads, allowedErrors, engineArgs }));
    writeFileSync(join(staging, '_headers'), headersFile(headers));
    writeFileSync(join(staging, 'headers.json'), JSON.stringify(headers, null, 2) + '\n');
    const served = [...runtimeFiles, ...notices, 'game.pck', 'browser-adapter.js', 'index.html', '_headers', 'headers.json'];
    const sizes = {};
    for (const name of served) {
      const data = readFileSync(join(staging, name));
      result.files[name] = sha256(data);
      sizes[name] = { bytes: data.length, gzipBytes: gzipSync(data, { level: 9 }).length };
    }
    const boot = [...runtimeFiles, 'game.pck', 'browser-adapter.js', 'index.html'], sum = (names, k) => names.reduce((n, x) => n + sizes[x][k], 0);
    result.metrics = { schema: 'game-cask/engine-bundle-metrics/1', packBytes: sizes['game.pck'].bytes, runtimeBytes: sum(runtimeFiles, 'bytes'),
      wasmBytes: sizes[wasm].bytes, downloadBytes: sum(boot, 'bytes'), downloadGzipBytes: sum(boot, 'gzipBytes'), bundleBytes: sum(served, 'bytes'),
      fileCount: served.length + 1, files: sizes,
      note: 'downloadBytes: every file the page may fetch (runtime JS/wasm/worklets/workers, pack, shell); gzip estimated at level 9' };
    for (const name of [...runtimeFiles, ...notices]) if (result.files[name] !== provisioned.files[name]) throw new Error('bundled runtime file differs from the verified runtime: ' + name);
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(result, null, 2) + '\n');
    if (!check) {
      // Refuse unrelated output/symlinks. A previous engine build can be replaced.
      if (existsSync(out)) {
        if (lstatSync(out).isSymbolicLink() || JSON.parse(readFileSync(join(out, 'manifest.json'))).path !== 'engineProfile') throw new Error('refusing to replace non-engine output');
        rmSync(out, { recursive: true });
      }
      renameSync(staging, out);
    }
  } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
  if (!quiet) {
    const m = result.metrics, mb = n => (n / 1048576).toFixed(2) + ' MiB';
    console.log(`engineProfile: ${cfg.id} -> ${out}`);
    console.log(`  runtime ${runtime.id} (${provisioned.verified ? provisioned.verification : 'UNVERIFIED: ' + provisioned.verification + ', no published checksum; allowUnverifiedRuntime recorded'})${runtime.requirements.isolation ? ', threads: COOP/COEP headers in _headers/headers.json' : ''}`);
    if (engineArgs.length) console.log(`  engine args: ${engineArgs.join(' ')} (official command-line options via the runtime's Engine config args)`);
    if (allowedErrors.length) console.log(`  allowlisted engine errors: ${allowedErrors.length} (${allowedErrors.map(e => e.id + ' ' + e.evidence).join(', ')})`);
    console.log(`  download ${mb(m.downloadBytes)} (gzip ~${mb(m.downloadGzipBytes)}): pack ${mb(m.packBytes)}, runtime ${mb(m.runtimeBytes)} (wasm ${mb(m.wasmBytes)}); bundle ${m.fileCount} files`);
  }
  return result;
}
