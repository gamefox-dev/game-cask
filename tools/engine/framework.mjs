// Generic profile orchestration. Engine-specific pack/shell semantics stay in adapters.
import { readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, cpSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { inventory } from '../inspect/inspect.mjs';
import { parsePack, identifyRunner, unsupportedFeatures, featureWarnings, sha256 } from './godot3.mjs';
import { PRIVATE, ENGINE_ROOT, runtimeById, verifyRuntime } from './runtime.mjs';
import { generateShell } from './shell.mjs';

export const adapters = Object.freeze({ godot3: { engine: 'godot', parsePack, identifyRunner, unsupportedFeatures, featureWarnings, generateShell } });
export function validateConfig(cfg) {
  if (cfg.pipeline && cfg.engineProfile) throw new Error('pipeline and engineProfile are mutually exclusive');
  if (!cfg.engineProfile) throw new Error('engineProfile missing');
  if (cfg.engineProfile.allowed !== true) throw new Error('engineProfile is default-off: game.json/trial must explicitly allow it (engineProfile.allowed: true)');
  const p = cfg.engineProfile;
  if (p.schema !== 'game-cask/engine-profile/1' || !adapters[p.adapter]) throw new Error('unsupported engine profile schema/adapter');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(cfg.id) || typeof cfg.name !== 'string') throw new Error('invalid engine game id/name');
  const runtime = runtimeById(p.runtime);
  if (runtime.adapter !== p.adapter) throw new Error('runtime adapter mismatch');
  if (p.version !== runtime.version || p.build !== runtime.build) throw new Error('profile/runtime exact version/build mismatch');
  if (p.threads !== false || p.renderer !== runtime.requirements.renderer) throw new Error('unsupported renderer/threads requirements');
  if (!p.pack || !['embedded-trailer', 'adjacent', 'explicit'].includes(p.pack.location) || !/^[a-f0-9]{64}$/.test(p.pack.sha256) || !/^[a-f0-9]{64}$/.test(p.runnerSha256)) throw new Error('pack and runner SHA-256 are required');
  for (const n of ['width', 'height']) if (p[n] !== undefined && (!Number.isInteger(p[n]) || p[n] < 1 || p[n] > 4096)) throw new Error('invalid shell ' + n);
  return { profile: p, runtime, adapter: adapters[p.adapter] };
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
/** Interface consumes inspect inventory; hashes bind those observations to current bytes. */
export function detectProfile(inspectOutput, { root, runner, pack = runner, runtimeId = 'godot-3.5.3' }) {
  if (inspectOutput?.schema !== 'game-cask/inventory/1') throw new Error('engine detection requires inspect inventory/1');
  const runtime = runtimeById(runtimeId), adapter = adapters[runtime.adapter];
  // inspect has bounded depth/count. Do not treat silently omitted paths as a complete
  // native/Mono inventory, without changing the lifting pipeline's inspect behavior.
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
  const r = load(runner), pk = pack === runner ? r : load(pack), parsed = adapter.parsePack(pk.bytes);
  const identity = adapter.identifyRunner(r.bytes, runtime);
  const blockers = [...identity.blockers, ...adapter.unsupportedFeatures(parsed, inspectOutput.files)];
  if (!['pe', 'elf', 'mach-o', 'mach-o-fat', 'mz'].includes(r.record.format)) blockers.push('runner-format-unrecognized');
  if (parsed.version !== runtime.version) blockers.push('runtime-version-mismatch');
  if (inspectOutput.skipped?.length) blockers.push('uninspected-files');
  if (inspectOutput.files.filter(f => /\.pck$/i.test(f.path) && f.path !== pack).length) blockers.push('additional-packs');
  return { schema: 'game-cask/engine-detection/1', adapter: runtime.adapter, engine: runtime.engine,
    version: parsed.version, build: identity.build, runtimeId, identity, blockers: [...new Set(blockers)].sort(),
    warnings: adapter.featureWarnings(parsed),
    runnerSha256: sha256(r.bytes), sourceSha256: parsed.sourceSha256, packSha256: parsed.packSha256,
    location: parsed.location, rebasedOffsets: parsed.rebasedOffsets, files: parsed.entries.length,
    _parsed: parsed };
}
export function publicDetection(d) { const { _parsed, ...report } = d; return report; }
export function requireOperatorAuthorization(gameDir, cfg, { briefFile = join(ENGINE_ROOT, 'reports', 'brief.md'), policyFile = join(PRIVATE, 'authorizations', cfg.id + '.json') } = {}) {
  const outsidePort = file => {
    const real = realpathSync(file), dir = realpathSync(gameDir);
    return !real.startsWith(dir + sep) && real !== dir && !lstatSync(file).isSymbolicLink();
  };
  const runnerSha256 = cfg.engineProfile?.runnerSha256;
  if (!/^[a-f0-9]{64}$/.test(runnerSha256)) throw new Error('operator authorization requires a runner SHA-256');
  const marker = `<!-- engine-profile: allowed game=${cfg.id} runnerSha256=${runnerSha256} -->`;
  if (existsSync(briefFile) && outsidePort(briefFile) && readFileSync(briefFile, 'utf8').split(/\r?\n/).includes(marker))
    return { kind: 'trial-brief', game: cfg.id, runnerSha256, sha256: sha256(readFileSync(briefFile)) };
  if (existsSync(policyFile) && outsidePort(policyFile)) {
    const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
    if (policy.schema === 'game-cask/engine-authorization/1' && policy.allowEngineProfile === true && policy.game === cfg.id && policy.runnerSha256 === runnerSha256)
      return { kind: 'operator-policy', game: cfg.id, runnerSha256, sha256: sha256(readFileSync(policyFile)) };
  }
  throw new Error('engineProfile requires operator authorization outside port/ matching game id and runner SHA-256 (stale/cross-game authorization refused): trial:brief --allow-engine-profile or .engine-private/authorizations/<id>.json');
}
export function buildEngine(gameDir, cfg, { outRoot = join(PRIVATE, 'builds'), store, check = false, quiet = false, authorization = {} } = {}) {
  const { profile: p, runtime, adapter } = validateConfig(cfg);
  const approved = requireOperatorAuthorization(gameDir, cfg, authorization);
  const root = resolve(gameDir, p.inputRoot ?? '../original');
  // Inspect fresh every build: directory/extension inventory is part of refusal policy.
  const inv = inventory(root), detection = detectProfile(inv, { root, runner: p.runner, pack: p.pack.from ?? p.runner, runtimeId: runtime.id });
  if (detection.blockers.length) throw new Error('engine profile unsupported: ' + detection.blockers.join(', '));
  if (detection.packSha256 !== p.pack.sha256 || detection.runnerSha256 !== p.runnerSha256) throw new Error('engine pack/runner SHA-256 mismatch');
  if (p.pack.location === 'embedded-trailer' && detection.location !== 'embedded-trailer') throw new Error('expected embedded pack');
  if (p.pack.location !== 'embedded-trailer' && detection.location !== 'standalone') throw new Error('expected standalone side pack');
  if (p.pack.location === 'adjacent' && dirname(resolve(root, p.pack.from)) !== dirname(resolve(root, p.runner))) throw new Error('adjacent pack must be beside runner');
  const provisioned = verifyRuntime(runtime.id, { store });
  const parent = resolve(outRoot); mkdirSync(parent, { recursive: true });
  const out = join(parent, cfg.id), staging = mkdtempSync(join(parent, '.engine-build-'));
  const result = { schema: 'game-cask/engine-build/1', id: cfg.id, name: cfg.name, private: true, path: 'engineProfile',
    engineProfile: { ...publicDetection(detection), authorization: approved, runtime: { id: runtime.id, sha256: runtime.sha256, files: provisioned.receipt.files },
      requirements: runtime.requirements, notices: runtime.notices, scan: 'Known unsupported patterns only; not a complete platform feature proof.' },
    files: {} };
  try {
    for (const name of [...runtime.files, ...runtime.notices.map(n => n.file)]) cpSync(join(provisioned.target, name), join(staging, name), { errorOnExist: true });
    writeFileSync(join(staging, 'game.pck'), detection._parsed.pack);
    cpSync(new URL('browser-adapter.js', import.meta.url), join(staging, 'browser-adapter.js'));
    writeFileSync(join(staging, 'index.html'), adapter.generateShell({ id: cfg.id, name: cfg.name, runtime, packSize: detection._parsed.pack.length,
      wasmSize: readFileSync(join(staging, 'godot.wasm')).length, width: p.width, height: p.height, packSha256: detection.packSha256 }));
    for (const name of [...runtime.files, ...runtime.notices.map(n => n.file), 'game.pck', 'browser-adapter.js', 'index.html']) result.files[name] = sha256(readFileSync(join(staging, name)));
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
  if (!quiet) console.log('engineProfile: ' + cfg.id + ' -> ' + out + ' (runtime ' + runtime.id + ', pack ' + detection.packSha256 + ')');
  return result;
}
