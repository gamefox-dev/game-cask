import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error original CC0 fixture writer
import { embeddedFixture, makePack, makeRunner, fixtureFiles } from '../fixtures/engine/godot3-fixture.mjs';
// @ts-expect-error plain ESM engine adapter
import { parsePack, unsupportedFeatures, identifyRunner, sha256 } from '../../tools/engine/godot3.mjs';
// @ts-expect-error plain ESM orchestration
import { detectProfile, validateConfig, buildEngine, requireOperatorAuthorization } from '../../tools/engine/framework.mjs';
// @ts-expect-error offline runtime provisioning
import { provision, verifyRuntime, runtimeById } from '../../tools/engine/runtime.mjs';
// @ts-expect-error serving
import { serveEngine } from '../../tools/engine/server.mjs';
// @ts-expect-error static inspect inventory
import { inventory } from '../../tools/inspect/inspect.mjs';
// @ts-expect-error leak tooling
import { leakcheck } from '../../tools/report/leakcheck.mjs';
const temp = () => mkdtempSync(join(tmpdir(), 'k45-engine-'));
const authorization = (cfg: any) => {
  const outside = temp(), policyFile = join(outside, 'operator.json');
  writeFileSync(policyFile, JSON.stringify({ schema: 'game-cask/engine-authorization/1', game: cfg.id, allowEngineProfile: true }));
  return { policyFile, briefFile: join(outside, 'no-brief') };
};
function config() {
  const runtime = runtimeById('godot-3.5.3');
  return { id: 'cc0-engine', name: 'CC0 engine', private: true, engineProfile: {
    schema: 'game-cask/engine-profile/1', allowed: true, adapter: 'godot3', runtime: runtime.id, version: runtime.version, build: runtime.build,
    renderer: 'webgl2', threads: false, inputRoot: '.', runner: 'runner.exe', runnerSha256: sha256(embeddedFixture()),
    pack: { location: 'embedded-trailer', sha256: sha256(makePack()) } } };
}

describe('Godot 3 static pack adapter', () => {
  it('standalone pack is unchanged; embedded normalization changes only offsets', () => {
    const standalone = makePack(), embedded = embeddedFixture(), p = parsePack(embedded);
    expect(parsePack(standalone).pack.equals(standalone)).toBe(true);
    expect(p.location).toBe('embedded-trailer'); expect(p.version).toBe('3.5.3'); expect(p.rebasedOffsets).toBe(true);
    expect(p.pack.equals(standalone)).toBe(true);
    expect(p.entries.map((e: any) => e.name)).toEqual(['project.binary', 'main.tscn', 'main.gd']);
    const changed = new Set<number>(p.entries.flatMap((e: any) => Array.from({ length: 8 }, (_, i) => e.offsetWord + i)));
    for (let i = 0; i < p.pack.length; i++) if (!changed.has(i)) expect(p.pack[i]).toBe(embedded[p.start + i]);
    for (const e of p.entries) expect(p.pack.subarray(e.offset, e.offset + e.size)).toEqual(fixtureFiles()[e.name]);
  });
  it('accepts a relative-offset embedded pack without rewriting its bytes', () => {
    const pack = makePack(), trailer = Buffer.alloc(12); trailer.writeBigUInt64LE(BigInt(pack.length)); trailer.write('GDPC', 8);
    const p = parsePack(Buffer.concat([makeRunner(), pack, trailer]));
    expect(p.rebasedOffsets).toBe(false); expect(p.pack).toEqual(pack);
  });
  it.each(['trailer', 'payload', 'directory', 'offset', 'size', 'reserved', 'format', 'count', 'unsafe64'])('rejects %s corruption', kind => {
    const b = Buffer.from(embeddedFixture()), start = 512, parsed = parsePack(b);
    if (kind === 'trailer') b.writeBigUInt64LE(0xffffffffffffffffn, b.length - 12);
    if (kind === 'payload') b[b.length - 13] ^= 1;
    if (kind === 'directory') b.writeUInt32LE(0xffffffff, start + 88);
    if (kind === 'offset') b.writeBigUInt64LE(1n, start + parsed.entries[0].offsetWord);
    if (kind === 'size') b.writeBigUInt64LE(BigInt(b.length), start + parsed.entries[0].offsetWord + 8);
    if (kind === 'reserved') b[start + 20] = 1;
    if (kind === 'format') b.writeUInt32LE(2, start + 4);
    if (kind === 'count') b.writeUInt32LE(0xffffffff, start + 84);
    if (kind === 'unsafe64') b.writeBigUInt64LE(0xffffffffffffffffn, start + parsed.entries[0].offsetWord);
    expect(() => parsePack(b)).toThrow();
  });
  it('rejects traversal, duplicates, malformed UTF-8 and overlapping payloads', () => {
    for (const files of [{ '../bad': Buffer.from('x') }, { 'x': Buffer.from('a'), 'X': Buffer.from('b') }]) expect(() => parsePack(makePack({ files }))).toThrow();
    const b = makePack(), p = parsePack(b); b[92] = 0xff; expect(() => parsePack(b)).toThrow();
    const overlap = makePack(); overlap.writeBigUInt64LE(BigInt(p.entries[0].offset), p.entries[1].offsetWord); expect(() => parsePack(overlap)).toThrow();
  });
  it('does not scan incidental GDPC signatures', () => {
    expect(() => parsePack(Buffer.from('MZsomeGDPCbytes-not-a-pack'))).toThrow();
    for (let n = 0; n < 88; n++) expect(() => parsePack(makePack().subarray(0, n))).toThrow();
  });
  it('flags native, Mono, encrypted and thread features explicitly', () => {
    const files = { ...fixtureFiles(), 'secret.gde': Buffer.from('GDEC'), 'x.gd': Buffer.from('var t = Thread.new()') };
    const flags = unsupportedFeatures(parsePack(makePack({ files })), [{ path: 'native.dll' }, { path: 'scripts/a.cs' }, { path: 'x.worker.js' }]);
    expect(flags).toEqual(expect.arrayContaining(['native-extension/GDNative', 'Mono/C#', 'encrypted-content', 'encrypted-script', 'threads-build', 'threads/platform-code']));
  });
  it('requires exact runner version/build signatures and flags Mono/threads', () => {
    const r = runtimeById('godot-3.5.3');
    expect(identifyRunner(makeRunner(), r).blockers).toEqual([]);
    expect(identifyRunner(Buffer.from('Godot 3.5.2'), r).blockers).toContain('runner-exact-version/build-unverified');
    expect(identifyRunner(makeRunner('GodotSharp PThread'), r).blockers).toEqual(['Mono/C#-runner', 'threads-runner']);
  });
});

describe('engine framework policy and integrity', () => {
  it('requires explicit opt-in, exclusive selection, exact runtime and features', () => {
    const cfg = config(); expect(() => validateConfig(cfg)).not.toThrow();
    for (const patch of [{ allowed: false }, { version: '3.5.2' }, { runtime: 'unknown' }, { threads: true }, { renderer: 'webgpu' }, { runnerSha256: '' }]) expect(() => validateConfig({ ...cfg, engineProfile: { ...cfg.engineProfile, ...patch } })).toThrow();
    expect(() => validateConfig({ ...cfg, pipeline: {} })).toThrow(/mutually exclusive/);
  });
  it('binds detection to inspect hashes; accepts side packs and reports version mismatch', () => {
    const root = temp(); writeFileSync(join(root, 'runner.exe'), makeRunner()); writeFileSync(join(root, 'game.pck'), makePack());
    const inv = inventory(root), d = detectProfile(inv, { root, runner: 'runner.exe', pack: 'game.pck' });
    expect(d.blockers).toEqual([]); expect(d.location).toBe('standalone');
    writeFileSync(join(root, 'game.pck'), makePack({ version: [3, 5, 2] }));
    expect(() => detectProfile(inv, { root, runner: 'runner.exe', pack: 'game.pck' })).toThrow(/stale/);
    expect(detectProfile(inventory(root), { root, runner: 'runner.exe', pack: 'game.pck' }).blockers).toContain('runtime-version-mismatch');
  });
  it('rejects symlinks, escaping paths and unavailable runtime before producing output', () => {
    const root = temp(); writeFileSync(join(root, 'runner.exe'), embeddedFixture());
    symlinkSync(join(root, 'runner.exe'), join(root, 'link.exe'));
    const inv = inventory(root);
    expect(() => detectProfile(inv, { root, runner: '../runner.exe' })).toThrow();
    expect(() => detectProfile(inv, { root, runner: 'link.exe' })).toThrow();
    const cfg = config();
    expect(() => buildEngine(root, cfg, { store: join(root, 'missing'), outRoot: join(root, 'out'), quiet: true, authorization: authorization(cfg) })).toThrow(/uninspected/);
  });
  it('rejects source hash mismatch before provisioning or writing a build', () => {
    const root = temp(); writeFileSync(join(root, 'runner.exe'), embeddedFixture()); const cfg = config(); cfg.engineProfile.runnerSha256 = '0'.repeat(64);
    expect(() => buildEngine(root, cfg, { outRoot: join(root, 'out'), quiet: true, authorization: authorization(cfg) })).toThrow(/SHA-256/);
  });
  it('game.json cannot grant its own authorization; operator brief or outside policy is required', () => {
    const root = temp(), cfg = config(), inside = join(root, 'policy.json');
    writeFileSync(inside, JSON.stringify({ schema: 'game-cask/engine-authorization/1', game: cfg.id, allowEngineProfile: true }));
    const noBrief = join(root, 'absent');
    expect(() => requireOperatorAuthorization(root, cfg, { policyFile: inside, briefFile: noBrief })).toThrow(/operator authorization/);
    const approved = authorization(cfg);
    expect(requireOperatorAuthorization(root, cfg, approved).kind).toBe('operator-policy');
    writeFileSync(approved.policyFile, JSON.stringify({ schema: 'game-cask/engine-authorization/1', game: 'wrong', allowEngineProfile: true }));
    expect(() => requireOperatorAuthorization(root, cfg, approved)).toThrow(/operator authorization/);
    const briefFile = join(temp(), 'brief.md'); writeFileSync(briefFile, '<!-- engine-profile: allowed -->\n');
    expect(requireOperatorAuthorization(root, cfg, { policyFile: noBrief, briefFile }).kind).toBe('trial-brief');
    writeFileSync(briefFile, 'No engine authorization');
    expect(() => requireOperatorAuthorization(root, cfg, { policyFile: noBrief, briefFile })).toThrow(/operator authorization/);
  });
  it('rejects unknown runtime, incorrect archive and missing provision cleanly', () => {
    const root = temp(), zip = join(root, 'untrusted.zip'); writeFileSync(zip, 'not an archive');
    expect(() => provision('unknown', zip)).toThrow(/allowlisted/);
    expect(() => provision('godot-3.5.3', zip, { store: root })).toThrow(/SHA-256/);
    expect(() => verifyRuntime('godot-3.5.3', { store: root })).toThrow(/not provisioned/);
  });
  it('leakcheck blocks local runtimes and packs even if staged/renamed into normal trees', () => {
    const root = temp(); mkdirSync(join(root, '.engine-private')); writeFileSync(join(root, '.engine-private', 'tiny.js'), 'runtime');
    writeFileSync(join(root, 'game.pck'), 'private pack'); writeFileSync(join(root, 'godot.js'), 'runtime');
    const problems = leakcheck({ root }).problems;
    expect(problems.some((p: any) => p.path === '.engine-private/tiny.js')).toBe(true);
    expect(problems.some((p: any) => p.path === 'game.pck')).toBe(true);
    expect(problems.some((p: any) => p.path === 'godot.js')).toBe(true);
  });
  it('serves only integrity-checked allowlisted bytes, MIME and optional isolation headers', async () => {
    const root = temp(); const html = '<html>CC0</html>'; writeFileSync(join(root, 'index.html'), html); writeFileSync(join(root, 'secret'), 'private');
    const m = { schema: 'game-cask/engine-build/1', path: 'engineProfile', engineProfile: { requirements: { isolation: true } }, files: { 'index.html': sha256(Buffer.from(html)) } };
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(m));
    const s = await serveEngine(root, { port: Number(process.env.BGT_E2E_PORT ?? 5189) });
    try {
      const response = await fetch(s.url); expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp'); expect(await response.text()).toBe(html);
      for (const path of ['secret', '%2e%2e%2fsecret', '%zz']) expect((await fetch(s.url + path)).status).toBeGreaterThanOrEqual(400);
    } finally { await s.close(); }
    writeFileSync(join(root, 'index.html'), html + 'tamper');
    await expect(serveEngine(root, { port: Number(process.env.BGT_E2E_PORT ?? 5189) })).rejects.toThrow(/integrity/);
    expect(readFileSync(join(root, 'secret'), 'utf8')).toBe('private');
  });
});
