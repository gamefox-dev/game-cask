// K55: engine-runtime path as a first-class port path. CC0 synthetic packs/archives only; no network.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { crc32, deflateRawSync } from 'node:zlib';
// @ts-expect-error CC0 Godot 4 writer
import * as g4 from '../fixtures/engine/godot4-fixture.mjs';
// @ts-expect-error CC0 Godot 3 writer
import * as g3 from '../fixtures/engine/godot3-fixture.mjs';
// @ts-expect-error adapter
import { parsePack, analyzePack, projectSettings, identifyRunner, locatePack } from '../../tools/engine/godot.mjs';
// @ts-expect-error orchestration
import { detectProfile, validateConfig, bundledRuntimeFiles } from '../../tools/engine/framework.mjs';
// @ts-expect-error detection
import { detectEngines } from '../../tools/engine/detect.mjs';
// @ts-expect-error runtimes
import { selectRuntime, runtimes, runtimeById, fetchRuntime, verifyRuntime, godotVersion } from '../../tools/engine/runtime.mjs';
// @ts-expect-error generator rules
import { variantsFromMembers, shellFlavor } from '../../tools/engine/godot-releases.mjs';
// @ts-expect-error headers
import { staticHeaders, headersFile, headersFor } from '../../tools/engine/headers.mjs';
// @ts-expect-error shell
import { generateShell } from '../../tools/engine/shell.mjs';
// @ts-expect-error server
import { serveEngine } from '../../tools/engine/server.mjs';
// @ts-expect-error inventory
import { inventory } from '../../tools/inspect/inspect.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'k55-engine-'));
const sha = (b: Buffer, alg = 'sha256') => createHash(alg).update(b).digest('hex');
const B43 = '77dcf97d82cbfe4e4615475fa52ca03da645dbd8';

describe('Godot 4 PCK format 2', () => {
  it('standalone pack parses unchanged; 4.4 paths without res:// are equivalent', () => {
    for (const version of ['4.3', '4.4.1']) {
      const pack = g4.makePack({ version }), p = parsePack(pack);
      expect(p.format).toBe(2); expect(p.version).toBe(version); expect(p.location).toBe('standalone');
      expect(p.pack.equals(pack)).toBe(true); expect(p.rebasedOffsets).toBe(false);
      expect(p.entries.map((e: any) => e.name)).toEqual(['project.binary', '.godot/global_script_class_cache.cfg', 'main.tscn', 'main.gd']);
      expect(pack.toString('latin1', 104, 110) === 'res://').toBe(version === '4.3'); // first directory path
    }
  });
  it('relative-file-base embedded pack (4.3+) is extracted byte-identical', () => {
    const exe = g4.embeddedFixture({ version: '4.3' }), p = parsePack(exe);
    expect(p.location).toBe('embedded-trailer'); expect(p.flags & 2).toBe(2);
    expect(p.pack.equals(exe.subarray(p.start, p.end))).toBe(true); expect(p.rebasedOffsets).toBe(false);
  });
  it('absolute-file-base embedded pack (4.0-4.2) changes ONLY the file-base word', () => {
    const exe = g4.embeddedFixture({ version: '4.2.2', relative: false }), p = parsePack(exe), raw = exe.subarray(p.start, p.end);
    expect(p.rebasedOffsets).toBe(true);
    for (let i = 0; i < raw.length; i++) if (i < 24 || i >= 32) expect(p.pack[i]).toBe(raw[i]);
    expect(Number(p.pack.readBigUInt64LE(24))).toBe(Number(raw.readBigUInt64LE(24)) - p.start);
    // Re-parsing the normalized pack standalone yields the same contents.
    const again = parsePack(p.pack);
    for (const e of again.entries) expect(again.pack.subarray(e.offset, e.offset + e.size)).toEqual(g4.fixtureFiles('4.2.2')[e.name]);
  });
  it.each(['md5', 'flags', 'reserved', 'format3', 'major', 'trailer'])('rejects %s corruption', kind => {
    const b = Buffer.from(g4.makePack()), p = parsePack(b);
    if (kind === 'md5') b[p.entries[3].offset] ^= 1;
    if (kind === 'flags') b.writeUInt32LE(0x80, 20);
    if (kind === 'reserved') b[40] = 1;
    if (kind === 'format3') b.writeUInt32LE(3, 4);
    if (kind === 'major') b.writeUInt32LE(3, 8);
    const input = kind === 'trailer' ? Buffer.concat([g4.makeRunner(), b, Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]), Buffer.from('GDPC')]) : b;
    expect(() => parsePack(input)).toThrow(/godot:/);
  });
  it('encrypted directory/files and patch removals are reported, never decrypted', () => {
    const enc = parsePack(g4.makePack({ flags: 1 }));
    expect(enc.encryptedDirectory).toBe(true); expect(enc.pack).toBeNull();
    expect(analyzePack(enc).blockers).toContain('encrypted-pack');
    const files = { ...g4.fixtureFiles(), 'secret.gd': Buffer.from('ciphertext') };
    const fileEnc = parsePack(g4.makePack({ files, fileFlags: { 'secret.gd': 1 } }));
    expect(analyzePack(fileEnc).blockers).toContain('encrypted-content');
    const patch = parsePack(g4.makePack({ files: { ...g4.fixtureFiles(), 'gone.gd': Buffer.alloc(0) }, fileFlags: { 'gone.gd': 2 } }));
    expect(analyzePack(patch).blockers).toContain('patch-pack');
  });
  it('finds a pack in a PE "pck" section (Godot 4 Windows embedding) without a trailer', () => {
    const pack = g4.makePack({ flags: 2 }), exe = Buffer.alloc(1024 + pack.length + 16);
    exe.write('MZ'); exe.writeUInt32LE(64, 60); exe.write('PE\0\0', 64); exe.writeUInt16LE(1, 70); exe.writeUInt16LE(0, 84);
    const sec = 64 + 24; exe.write('pck', sec); exe.writeUInt32LE(pack.length, sec + 16); exe.writeUInt32LE(1024 + 3, sec + 20);
    pack.copy(exe, 1024 + 3);
    expect(locatePack(exe)).toMatchObject({ location: 'embedded-section', start: 1027 });
    expect(parsePack(exe).pack.equals(pack)).toBe(true);
  });
});

describe('project settings and web requirements', () => {
  it('reads project.binary of both majors', () => {
    expect(projectSettings(g3.projectBinary(), 3)).toMatchObject({ 'application/run/main_scene': 'res://main.tscn', 'display/window/size/width': 320, 'rendering/quality/driver/driver_name': 'GLES3' });
    expect(projectSettings(g4.projectBinary({ version: '4.3' }), 4)).toMatchObject({ 'application/config/features': ['4.3', 'GL Compatibility'], 'display/window/size/viewport_height': 180 });
    expect(projectSettings(Buffer.from('nope'), 4)).toBeNull();
  });
  it('C#, GDExtension, OS.execute block; Thread.new requires threads; renderer differences warn', () => {
    const with4 = (files: Record<string, Buffer>, settings = {}) => analyzePack(parsePack(g4.makePack({ files: { ...g4.fixtureFiles(), 'project.binary': g4.projectBinary({ settings }), ...files } })));
    expect(with4({}).blockers).toEqual([]);
    expect(with4({}).requirements.threads).toBe('not-detected');
    expect(with4({}, { 'application/config/features': ['4.3', 'C#'] }).blockers).toContain('Mono/C#');
    expect(with4({ 'bin/x.gdextension': Buffer.from('[configuration]') }).blockers).toContain('native-extension/GDExtension');
    expect(with4({ 'a.gd': Buffer.from('func f():\n\tOS.execute("ls", [])') }).blockers).toContain('platform-code/OS.execute');
    expect(with4({ 'a.gd': Buffer.from('var t = Thread.new()') }).requirements.threads).toBe('required');
    expect(with4({}, { 'rendering/renderer/rendering_method': 'forward_plus' }).warnings.join(' ')).toMatch(/forward_plus.*gl_compatibility/);
  });
});

describe('runner identity', () => {
  it('reads x.y / x.y.z signatures and the release commit; flags custom, prerelease and Mono builds', () => {
    const known = { knownBuilds: [B43] };
    const ok = identifyRunner(g4.makeRunner({ version: '4.3' }), null, known);
    expect(ok).toMatchObject({ version: '4.3', status: 'stable', flavor: 'official', build: B43, blockers: [] });
    expect(identifyRunner(Buffer.from('xx 4.3.stable.custom_build yy'), null, known).blockers).toEqual(expect.arrayContaining(['runner-custom-build']));
    expect(identifyRunner(Buffer.from('4.4.rc2.official ' + B43), null, known).blockers).toContain('runner-prerelease-build');
    expect(identifyRunner(Buffer.from('4.3.stable.mono.official ' + B43), null, known).blockers).toContain('Mono/C#-runner');
    expect(identifyRunner(Buffer.from('no godot here'), null, known).blockers).toEqual(['runner-version-unknown']);
    // The compile-time banner literal carries a "v" prefix; a longer number is not a version.
    expect(identifyRunner(Buffer.from('Godot Engine v4.3.stable.official - https://godotengine.org ' + B43), null, known)).toMatchObject({ version: '4.3', blockers: [] });
    expect(identifyRunner(Buffer.from('14.3.stable.official'), null, known).signatures).toEqual([]);
    expect(identifyRunner(g4.makeRunner({ version: '4.3' }), runtimeById('godot-4.3-nothreads')).blockers).toEqual([]);
    expect(identifyRunner(g4.makeRunner({ version: '4.3', build: '1'.repeat(40) }), runtimeById('godot-4.3-nothreads')).blockers).toEqual(['runner-exact-version/build-unverified']);
  });
});

describe('official runtime manifest and exact-version selection', () => {
  const versions = [...new Set(runtimes().map((r: any) => r.version))] as string[];
  it('covers every stable Godot 3.2-3.6 and 4.0-4.4 release, pinned from the official release host', () => {
    for (const v of ['3.2', '3.2.3', '3.3', '3.4.5', '3.5', '3.5.3', '3.6', '3.6.1', '4.0', '4.0.4', '4.1', '4.1.4', '4.2', '4.2.2', '4.3', '4.4', '4.4.1']) expect(versions).toContain(v);
    expect(versions.every(v => /^(3\.[2-6]|4\.[0-4])(\.\d+)?$/.test(v))).toBe(true);
    for (const r of runtimes()) {
      expect(r.build).toMatch(/^[a-f0-9]{40}$/);
      expect(r.archive.url).toBe(`https://github.com/godotengine/godot-builds/releases/download/${r.version}-stable/Godot_v${r.version}-stable_export_templates.tpz`);
      expect(r.notices.map((n: any) => n.file)).toEqual(['LICENSE.txt', 'COPYRIGHT.txt']);
      expect(r.member.crc32).toBeGreaterThan(0); expect(r.member.size).toBeGreaterThan(1e6);
      expect(r.requirements.isolation).toBe(r.requirements.threads);
      expect(r.archive.sha512 === null || /^[a-f0-9]{128}$/.test(r.archive.sha512)).toBe(true);
    }
    // Published SHA512-SUMS exist from 3.5.3 / 4.1.2 on; the generator recorded them.
    for (const id of ['godot-3.5.3-nothreads', 'godot-3.6-threads', 'godot-4.2.2-threads', 'godot-4.4.1-nothreads']) expect(runtimeById(id).archive.sha512).toMatch(/^[a-f0-9]{128}$/);
    for (const id of ['godot-3.5.3-nothreads', 'godot-3.5.3-threads']) expect(runtimeById(id).pinned).toBe(true);
    expect(runtimeById('godot-3.5.3').id).toBe('godot-3.5.3-nothreads');
  });
  it('variant rules follow the shipped template names', () => {
    expect(variantsFromMembers('3.2.3', ['templates/webassembly_release.zip']).map((v: any) => v.variant)).toEqual(['nothreads']);
    expect(variantsFromMembers('3.5.3', ['templates/webassembly_release.zip', 'templates/webassembly_threads_release.zip', 'templates/webassembly_gdnative_release.zip']).map((v: any) => v.variant)).toEqual(['nothreads', 'threads']);
    expect(variantsFromMembers('4.2.2', ['templates/web_release.zip', 'templates/web_dlink_release.zip'])).toEqual([{ variant: 'threads', member: 'templates/web_release.zip', threads: true }]);
    expect(variantsFromMembers('4.3', ['templates/web_release.zip', 'templates/web_nothreads_release.zip']).map((v: any) => v.variant)).toEqual(['nothreads', 'threads']);
    expect([shellFlavor('3.2.3'), shellFlavor('3.3'), shellFlavor('4.4.1')]).toEqual(['godot-legacy', 'godot-config', 'godot-config']);
  });
  it('selects the exact version; threads only when needed or asked; no nearby-version fallback', () => {
    expect(godotVersion('4.3.0')).toBe('4.3'); expect(godotVersion('3.5.3')).toBe('3.5.3');
    expect(selectRuntime({ version: '4.3.0' }).runtime.id).toBe('godot-4.3-nothreads');
    expect(selectRuntime({ version: '4.3', threads: true }).runtime.id).toBe('godot-4.3-threads');
    expect(selectRuntime({ version: '4.2.2' }).runtime.id).toBe('godot-4.2.2-threads');
    expect(selectRuntime({ version: '4.2.2', threads: false }).blockers).toEqual(['no-non-threaded-web-runtime']);
    expect(selectRuntime({ version: '3.2.3', threads: true }).blockers).toEqual(['threads-required-but-no-threaded-web-runtime']);
    for (const v of ['4.5', '3.1.2', '4.3.1']) expect(selectRuntime({ version: v }).blockers).toEqual(['no-official-web-runtime-for-version']);
  });
});

describe('detection in the normal inspect flow', () => {
  const dir = (files: Record<string, Buffer>) => { const root = temp(); for (const [n, b] of Object.entries(files)) { mkdirSync(join(root, n, '..'), { recursive: true }); writeFileSync(join(root, n), b); } return root; };
  const detect = (root: string) => detectEngines(inventory(root), root);
  it('embedded Godot 4.3: recommends the engine path with a valid suggested profile', () => {
    const root = dir({ 'game.exe': g4.embeddedFixture({ version: '4.3' }) }), r = detect(root);
    expect(r.recommendation.path).toBe('engineProfile');
    const e = r.engines[0];
    expect(e).toMatchObject({ engine: 'godot', adapter: 'godot4', version: '4.3', build: B43, packLocation: 'embedded-trailer', packFormat: 2, blockers: [] });
    expect(e.runtime).toMatchObject({ id: 'godot-4.3-nothreads', threads: false, crossOriginIsolation: false });
    const cfg = { id: 'detected', name: 'Detected', engineProfile: r.recommendation.profile };
    expect(() => validateConfig(cfg)).not.toThrow();
    expect(cfg.engineProfile).toMatchObject({ runner: 'game.exe', width: 320, height: 180, threads: false, pack: { location: 'embedded-trailer' } });
  });
  it('pairs standalone packs with the runner by name; thread use selects the threaded runtime', () => {
    const files = { ...g4.fixtureFiles('4.3'), 'worker.gd': Buffer.from('extends Node\nvar t = Thread.new()\n') };
    const root = dir({ 'bin/other.exe': Buffer.from('MZ not godot'), 'bin/game.x86_64': g4.makeRunner(), 'bin/game.pck': g4.makePack({ files }) });
    const e = detect(root).engines.find((x: any) => x.pack === 'bin/game.pck');
    expect(e.runner).toBe('bin/game.x86_64'); expect(e.requirements.threads).toBe('required');
    expect(e.runtime).toMatchObject({ id: 'godot-4.3-threads', crossOriginIsolation: true });
    expect(e.suggestedProfile).toMatchObject({ threads: true, pack: { location: 'adjacent', from: 'bin/game.pck' } });
  });
  it('Godot 3 detection uses the runner version; pack-only and runner-only inputs are blocked', () => {
    const ok = detect(dir({ 'g.exe': g3.makeRunner(), 'g.pck': g3.makePack() }));
    expect(ok.engines[0]).toMatchObject({ adapter: 'godot3', version: '3.5.3', runtime: { id: 'godot-3.5.3-nothreads' } });
    expect(detect(dir({ 'g.exe': g3.makeRunner() })).engines[0].blockers).toEqual(['pack-not-found']);
    const packOnly = detect(dir({ 'g.pck': g3.makePack() }));
    expect(packOnly.engines[0].blockers).toContain('runner-not-found'); expect(packOnly.recommendation.path).toBe('pipeline');
  });
  it('blocked engines fall back to lifting with reasons; 3.2 has no threaded runtime', () => {
    const files = { ...g3.fixtureFiles(), 'w.gd': Buffer.from('var t = Thread.new()') };
    const r = detect(dir({ 'g.exe': g3.makeRunner('', { version: '3.2.3', build: runtimeById('godot-3.2.3-nothreads').build }), 'g.pck': g3.makePack({ files, version: [3, 2, 3] }) }));
    expect(r.engines[0].blockers).toContain('threads-required-but-no-threaded-web-runtime');
    expect(r.recommendation).toMatchObject({ path: 'pipeline' }); expect(r.recommendation.reason).toMatch(/blocked/);
    const enc = detect(dir({ 'game.exe': g4.makeRunner(), 'game.pck': g4.makePack({ flags: 1 }) }));
    expect(enc.engines[0].blockers).toContain('encrypted-pack');
    const unknown = detect(dir({ 'game.exe': g4.makeRunner({ version: '4.5', build: 'a'.repeat(40) }), 'game.pck': g4.makePack({ version: '4.5' }) }));
    expect(unknown.engines[0].blockers).toContain('no-official-web-runtime-for-version');
  });
  it('version strings inside an appended pack do not identify the runner', () => {
    const files = { ...g4.fixtureFiles('4.3'), 'fake.gd': Buffer.from('# 4.3.stable.official ' + B43) };
    const runner = Buffer.alloc(512); runner.write('MZ'); runner.writeUInt32LE(128, 60); runner.write('PE\0\0', 128);
    const pack = g4.makePack({ files, flags: 2 }), trailer = Buffer.alloc(12); trailer.writeBigUInt64LE(BigInt(pack.length)); trailer.write('GDPC', 8);
    const r = detect(dir({ 'game.exe': Buffer.concat([runner, pack, trailer]) }));
    expect(r.engines[0].blockers).toEqual(expect.arrayContaining(['runner-exact-version/build-unverified']));
  });
  it('reports other engines without an adapter and recommends lifting when nothing is known', () => {
    const r = detect(dir({ 'Game_Data/globalgamemanagers': Buffer.from('x'.repeat(32)), 'UnityPlayer.dll': Buffer.from('MZ'.padEnd(64, '\0')), 'www/js/rpg_core.js': Buffer.from('//'.repeat(16)) }));
    expect(r.otherEngines.map((e: any) => e.engine)).toEqual(['unity', 'rpgmaker-mv/mz']);
    expect(r.recommendation.path).toBe('pipeline');
    expect(detect(dir({ 'a.exe': Buffer.from('MZ'.padEnd(64, '\0')) })).recommendation.reason).toMatch(/no known engine/);
  });
  it('npm run inspect prints the recommendation and records engines in inventory.json', () => {
    const root = dir({ 'game.exe': g4.embeddedFixture({ version: '4.3' }) }), out = join(temp(), 'inv.json');
    const r = spawnSync(process.execPath, ['tools/inspect/inspect.mjs', root, '--out', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/engine: godot 4\.3 \(build 77dcf97d8\)/); expect(r.stdout).toMatch(/RECOMMENDED PATH: engineProfile/);
    expect(JSON.parse(readFileSync(out, 'utf8')).engines.recommendation.profile.runtime).toBe('godot-4.3-nothreads');
  });
  it('detectProfile binds a detection to an explicit runtime and reports version mismatches', () => {
    const root = dir({ 'game.exe': g4.embeddedFixture({ version: '4.3' }) }), inv = inventory(root);
    expect(detectProfile(inv, { root, runner: 'game.exe', runtimeId: 'godot-4.3-threads' }).blockers).toEqual([]);
    expect(detectProfile(inv, { root, runner: 'game.exe', runtimeId: 'godot-4.4-nothreads' }).blockers).toContain('runtime-version-mismatch');
    expect(detectProfile(inv, { root, runner: 'game.exe', runtimeId: 'godot-3.5.3' }).blockers).toContain('runtime-version-mismatch');
  });
});

// Minimal ZIP writer (stored/deflated) for synthetic CC0 archives.
function zip(files: Record<string, Buffer>, { deflate = false } = {}) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const body = deflate ? deflateRawSync(data) : data, n = Buffer.from(name), c = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(c, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const d = Buffer.alloc(46); d.writeUInt32LE(0x02014b50, 0); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(deflate ? 8 : 0, 10); d.writeUInt32LE(c, 16); d.writeUInt32LE(body.length, 20); d.writeUInt32LE(data.length, 24); d.writeUInt16LE(n.length, 28); d.writeUInt32LE(offset, 42);
    local.push(h, n, body); central.push(d, n); offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, e]);
}
function mockHost(files: Record<string, Buffer>) {
  const log: { url: string; range: string | null }[] = [];
  const fetchImpl = async (url: string, init: any = {}) => {
    const body = files[url], range = init.headers?.Range ?? null; log.push({ url, range });
    if (!body) return new Response('missing', { status: 404 });
    if (!range) return new Response(new Uint8Array(body), { status: 200, headers: { 'Content-Length': String(body.length) } });
    const [a, b] = range.slice(6).split('-').map(Number);
    return new Response(new Uint8Array(body.subarray(a, b + 1)), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/${body.length}` } });
  };
  return { fetchImpl, log };
}

describe('runtime download and verification (synthetic official host)', () => {
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const inner = zip({ 'godot.js': Buffer.from('/* CC0 */'), 'godot.wasm': wasm, 'godot.html': Buffer.from('<html>'), 'godot.service.worker.js': Buffer.from('//') }, { deflate: true });
  const tpz = zip({ 'templates/version.txt': Buffer.from('4.3.stable'), 'templates/web_nothreads_release.zip': inner, 'templates/padding.bin': Buffer.alloc(200000, 7) });
  const notices = { 'https://notices/LICENSE.txt': Buffer.from('MIT'), 'https://notices/COPYRIGHT.txt': Buffer.from('(c)') };
  const entry = (patch: any = {}) => ({ id: 'cc0-synthetic-nothreads', adapter: 'godot4', engine: 'godot', version: '4.3', build: B43, variant: 'nothreads', entry: 'godot.js',
    archive: { url: 'https://host/t.tpz', size: tpz.length, sha512: null, ...patch.archive }, member: { name: 'templates/web_nothreads_release.zip', size: inner.length, crc32: crc32(inner), sha256: null, ...patch.member },
    requirements: { renderer: 'webgl2', threads: false, isolation: false },
    notices: [{ file: 'LICENSE.txt', sha256: sha(notices['https://notices/LICENSE.txt']), url: 'https://notices/LICENSE.txt' }, { file: 'COPYRIGHT.txt', sha256: sha(notices['https://notices/COPYRIGHT.txt']), url: 'https://notices/COPYRIGHT.txt' }], ...patch.top });
  const host = () => mockHost({ 'https://host/t.tpz': tpz, ...notices });
  it('pinned member: range-fetches only the web template and checks its SHA-256', async () => {
    const store = temp(), h = host(), runtime = entry({ member: { sha256: sha(inner) } });
    const r = await fetchRuntime(runtime.id, { store, runtime, fetchImpl: h.fetchImpl });
    expect(r.verification).toBe('pinned-member-sha256'); expect(r.receipt.archiveSha256).toBe(sha(inner));
    const fetched = h.log.filter(x => x.url.endsWith('.tpz'));
    expect(fetched.every(x => x.range)).toBe(true);
    const bytes = fetched.reduce((n, x) => { const [a, b] = x.range!.slice(6).split('-').map(Number); return n + b - a + 1; }, 0);
    expect(bytes).toBeLessThan(tpz.length / 2);
    expect(bundledRuntimeFiles(r.runtimeFiles).sort()).toEqual(['godot.js', 'godot.wasm']);
    expect(verifyRuntime(runtime.id, { store, runtime }).verification).toBe('pinned-member-sha256');
    writeFileSync(join(r.target, 'godot.wasm'), 'tampered');
    expect(() => verifyRuntime(runtime.id, { store, runtime })).toThrow(/hash mismatch: godot.wasm/);
    await expect(fetchRuntime(runtime.id, { store: temp(), runtime: entry({ member: { sha256: '0'.repeat(64) } }), fetchImpl: h.fetchImpl })).rejects.toThrow(/SHA-256 mismatch/);
  });
  it('published SHA-512: downloads the whole archive and refuses a mismatch', async () => {
    const h = host(), runtime = entry({ archive: { sha512: sha(tpz, 'sha512') } });
    const r = await fetchRuntime(runtime.id, { store: temp(), runtime, fetchImpl: h.fetchImpl });
    expect(r.verification).toBe('published-archive-sha512');
    await expect(fetchRuntime(runtime.id, { store: temp(), runtime: entry({ archive: { sha512: '0'.repeat(128) } }), fetchImpl: h.fetchImpl })).rejects.toThrow(/SHA-512/);
  });
  it('no published checksum: refused unless --allow-unpublished, then recorded as weak manifest-crc32', async () => {
    const h = host(), runtime = entry(), store = temp();
    await expect(fetchRuntime(runtime.id, { store, runtime, fetchImpl: h.fetchImpl })).rejects.toThrow(/allow-unpublished/);
    const r = await fetchRuntime(runtime.id, { store, runtime, fetchImpl: h.fetchImpl, allowUnpublished: true });
    expect(r.verification).toBe('manifest-crc32');
    await expect(fetchRuntime(runtime.id, { store: temp(), runtime: entry({ member: { crc32: 1 } }), fetchImpl: h.fetchImpl, allowUnpublished: true })).rejects.toThrow(/differs from the manifest pin/);
  });
  it('notices are hash-pinned; an offline .tpz import verifies the published SHA-512', async () => {
    const bad = mockHost({ 'https://host/t.tpz': tpz, 'https://notices/LICENSE.txt': Buffer.from('changed'), 'https://notices/COPYRIGHT.txt': notices['https://notices/COPYRIGHT.txt'] });
    await expect(fetchRuntime('x', { store: temp(), runtime: entry({ member: { sha256: sha(inner) } }), fetchImpl: bad.fetchImpl })).rejects.toThrow(/notice SHA-256 mismatch/);
    const dirp = temp(), file = join(dirp, 't.tpz'); writeFileSync(file, tpz);
    writeFileSync(join(dirp, 'LICENSE.txt'), 'MIT'); writeFileSync(join(dirp, 'COPYRIGHT.txt'), '(c)');
    const r = await fetchRuntime('x', { store: temp(), runtime: entry({ archive: { sha512: sha(tpz, 'sha512') } }), from: file, fetchImpl: async () => { throw new Error('no network'); } });
    expect(r.verification).toBe('published-archive-sha512');
    writeFileSync(file, Buffer.concat([tpz.subarray(0, 10), Buffer.from([tpz[10] ^ 1]), tpz.subarray(11)]));
    await expect(fetchRuntime('x', { store: temp(), runtime: entry({ archive: { sha512: sha(tpz, 'sha512') } }), from: file })).rejects.toThrow(/SHA-512/);
  });
});

describe('deployable bundle: shell, headers, serving', () => {
  it('threaded runtimes get COOP/COEP in _headers, headers.json and the local server; others do not', async () => {
    const on = staticHeaders({ isolation: true }), off = staticHeaders({ isolation: false });
    expect(on.global).toMatchObject({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    expect(off.global['Cross-Origin-Embedder-Policy']).toBeUndefined();
    expect(headersFile(on)).toMatch(/^\/\*\n(.*\n)* {2}Cross-Origin-Embedder-Policy: require-corp\n/m);
    expect(headersFile(on)).toContain('/*.wasm\n  Content-Type: application/wasm');
    expect(headersFor(on, '/game.pck')['Content-Type']).toBe('application/octet-stream');
    const root = temp(), html = '<html>CC0</html>', hj = JSON.stringify(on), wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
    writeFileSync(join(root, 'index.html'), html); writeFileSync(join(root, 'headers.json'), hj); writeFileSync(join(root, 'godot.wasm'), wasm);
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ schema: 'game-cask/engine-build/2', path: 'engineProfile', engineProfile: { requirements: { isolation: true } },
      files: { 'index.html': sha(Buffer.from(html)), 'headers.json': sha(Buffer.from(hj)), 'godot.wasm': sha(wasm) } }));
    const s = await serveEngine(root, { port: Number(process.env.BGT_E2E_PORT ?? 5189) });
    try {
      const page = await fetch(s.url), w = await fetch(s.url + 'godot.wasm');
      expect(page.headers.get('cross-origin-opener-policy')).toBe('same-origin'); expect(w.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
      expect(w.headers.get('content-type')).toBe('application/wasm');
    } finally { await s.close(); }
    writeFileSync(join(root, 'headers.json'), JSON.stringify(off));
    const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')); m.files['headers.json'] = sha(Buffer.from(JSON.stringify(off))); writeFileSync(join(root, 'manifest.json'), JSON.stringify(m));
    await expect(serveEngine(root, { port: Number(process.env.BGT_E2E_PORT ?? 5189) })).rejects.toThrow(/cross-origin isolation/);
  });
  it('shell uses the right engine JS API per version and checks isolation for threads', () => {
    const shell = (id: string) => generateShell({ id: 'g', name: 'G', runtime: runtimeById(id), packSize: 1, wasmSize: 2, packSha256: 'p' });
    expect(shell('godot-3.2.3-nothreads')).toMatch(/new Engine\(\);[\s\S]*setCanvas\(canvas\)[\s\S]*startGame\("godot","game.pck"\)/);
    expect(shell('godot-3.5.3-nothreads')).toMatch(/new Engine\(config\)/); expect(shell('godot-3.5.3-nothreads')).not.toMatch(/crossOriginIsolated/);
    expect(shell('godot-4.3-threads')).toMatch(/crossOriginIsolated/); expect(shell('godot-4.3-threads')).toContain('"ensureCrossOriginIsolationHeaders":false');
    expect(shell('godot-4.3-nothreads')).toContain('"fileSizes":{"godot.wasm":2,"game.pck":1}');
  });
});
