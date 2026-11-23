// K68: engineProfile build variants (Q11) and engine delivery metrics (Q12): variant resolution, shared evidence
// resolved from the port root, brotli/gzip bundle metrics, first-frame sample classification, precompressed serving.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync, constants as zc } from 'node:zlib';
import { createHash } from 'node:crypto';
// @ts-expect-error plain ESM orchestration
import { validateConfig, selectVariants, resolveVariant, resolveEvidence, buildEngine, VARIANT_FIELDS, outputConflict, variantStatus } from '../../tools/engine/framework.mjs';
// @ts-expect-error plain ESM sizes
import { bundleMetrics, compressedSizes, compressedOutputs, COMPRESSION, keepCompressed } from '../../tools/engine/sizes.mjs';
// @ts-expect-error plain ESM perf helpers
import { classifyFrameSample } from '../../tools/engine/perf.mjs';
// @ts-expect-error plain ESM server
import { acceptedEncoding } from '../../tools/engine/server.mjs';
// @ts-expect-error runtime manifest
import { runtimeById } from '../../tools/engine/runtime.mjs';
// @ts-expect-error CC0 fixture writer
import { embeddedFixture, makePack, DUPLICATE_SIGNAL_ERROR } from '../fixtures/engine/godot3-fixture.mjs';
// @ts-expect-error static adapter
import { sha256 } from '../../tools/engine/godot.mjs';

const H = (c: string) => c.repeat(64);
const runtime = runtimeById('godot-3.5.3');
const allow = { message: DUPLICATE_SIGNAL_ERROR, justification: 'The CC0 fixture main.gd connects tree_entered to _noop twice in _ready.', evidence: '../reports/evidence/dup.txt' };
const config = (extra: Record<string, unknown> = {}): { id: string; name: string; private: boolean; engineProfile: Record<string, any> } => ({ id: 'mmx-like', name: 'CC0', private: true, engineProfile: {
  schema: 'game-cask/engine-profile/2', allowed: true, choice: 'CC0', adapter: 'godot3', runtime: runtime.id, version: runtime.version, build: runtime.build,
  renderer: 'webgl2', threads: false, runner: 'r.exe', runnerSha256: H('a'), pack: { location: 'embedded-trailer', sha256: H('b') },
  engineArgs: ['--fixed-fps', '60'], allowedErrors: [allow], ...extra } });

describe('K68 Q11: engineProfile build variants', () => {
  it('a single-profile game.json (no variants) still validates and selects only the base build', () => {
    const cfg = config();
    expect(() => validateConfig(cfg)).not.toThrow();
    expect(selectVariants(cfg)).toEqual([null]);
    expect(selectVariants(cfg, 'all')).toEqual([null]);
    expect(resolveVariant(cfg, null).cfg).toEqual(cfg);
    expect(() => selectVariants(cfg, 'deploy')).toThrow(/unknown engineProfile variant "deploy" \(defined: none\)/);
  });
  it('a variant overrides only its fields; identity, choice and allowlist are the base profile\'s; id is <id>-<variant>', () => {
    const cfg = config({ variants: { deploy: { engineArgs: [], precompress: true, note: 'real-time deploy bundle' }, small: { width: 320, height: 180 } } });
    expect(() => validateConfig(cfg)).not.toThrow();
    expect(selectVariants(cfg, 'all')).toEqual([null, 'deploy', 'small']);
    expect(selectVariants(cfg, 'deploy')).toEqual(['deploy']);
    expect(selectVariants(cfg, 'base,deploy,deploy')).toEqual([null, 'deploy']);
    const base = resolveVariant(cfg, null), deploy = resolveVariant(cfg, 'deploy');
    expect(base.cfg.id).toBe('mmx-like'); expect(base.variant).toBeNull(); expect(base.cfg.engineProfile).not.toHaveProperty('variants');
    expect(base.cfg.engineProfile.engineArgs).toEqual(['--fixed-fps', '60']);
    expect(deploy.cfg.id).toBe('mmx-like-deploy');
    expect(deploy.cfg.engineProfile.engineArgs).toEqual([]);
    expect(deploy.cfg.engineProfile.precompress).toBe(true);
    expect(deploy.cfg.engineProfile).not.toHaveProperty('variants'); expect(deploy.cfg.engineProfile).not.toHaveProperty('note');
    expect(deploy.variant).toEqual({ name: 'deploy', of: 'mmx-like', overrides: { engineArgs: [], precompress: true }, note: 'real-time deploy bundle' });
    for (const k of ['runtime', 'runnerSha256', 'pack', 'choice', 'allowedErrors', 'adapter', 'build']) expect(deploy.cfg.engineProfile[k]).toEqual(cfg.engineProfile[k]);
    expect(resolveVariant(cfg, 'small').cfg.engineProfile.engineArgs).toEqual(['--fixed-fps', '60']);
    expect(() => validateConfig(deploy.cfg)).not.toThrow();
  });
  it.each([
    ['identity override', { deploy: { runtime: 'godot-4.3-nothreads' } }, /runtime cannot differ between variants/],
    ['allowlist override', { deploy: { allowedErrors: [] } }, /allowedErrors cannot differ/],
    ['pack override', { deploy: { pack: { location: 'adjacent', sha256: H('c') } } }, /pack cannot differ/],
    ['reserved name base', { base: {} }, /not "base" or "all"/],
    ['reserved name all', { all: {} }, /not "base" or "all"/],
    ['upper-case name', { Deploy: {} }, /variant names match/],
    ['name longer than 32', { ['x'.repeat(33)]: {} }, /variant names match/],
    ['non-allowlisted engine option', { deploy: { engineArgs: ['--rendering-driver', 'opengl3'] } }, /not an allowlisted godot3 option/],
    ['bad width', { deploy: { width: 0 } }, /invalid shell width/],
    ['bad precompress', { deploy: { precompress: 'yes' } }, /precompress must be boolean/],
    ['not an object', { deploy: [] }, /must be an object/],
    ['empty', {}, /1\.\.8 entries/],
  ])('refuses %s', (_name, variants, error) => {
    expect(() => validateConfig(config({ variants }))).toThrow(error);
  });
  it('refuses a variant whose build id would exceed 64 characters', () => {
    expect(() => validateConfig({ ...config({ variants: { ['x'.repeat(30)]: {} } }), id: 'a'.repeat(40) })).toThrow(/longer than 64/);
  });
  it('the variant field list is the documented one', () => {
    expect(VARIANT_FIELDS).toEqual(['engineArgs', 'width', 'height', 'precompress', 'note']);
    const schema = JSON.parse(readFileSync(new URL('../../tools/engine/profile.schema.json', import.meta.url), 'utf8'));
    expect(Object.keys(schema.properties.variants.additionalProperties.properties)).toEqual(VARIANT_FIELDS);
  });
});

describe('vK68: build id collisions and stale variant builds', () => {
  const deployVariant = { name: 'deploy', of: 'foo', overrides: { engineArgs: [] }, note: null };
  it('an output is replaced only by the same lineage', () => {
    expect(outputConflict({ path: 'engineProfile', id: 'foo' }, { id: 'foo' })).toBeNull(); // pre-K68 manifest: no variant field
    expect(outputConflict({ path: 'engineProfile', id: 'foo', variant: null }, { id: 'foo' })).toBeNull();
    expect(outputConflict({ path: 'engineProfile', id: 'foo-deploy', variant: deployVariant }, { id: 'foo-deploy', variant: deployVariant })).toBeNull();
    // A game named foo-deploy vs variant deploy of foo, both ways.
    expect(outputConflict({ path: 'engineProfile', id: 'foo-deploy', variant: null }, { id: 'foo-deploy', variant: deployVariant })).toMatch(/base build of game "foo-deploy"/);
    expect(outputConflict({ path: 'engineProfile', id: 'foo-deploy', variant: deployVariant }, { id: 'foo-deploy' })).toMatch(/variant "deploy" of "foo"/);
    // foo-bar + variant baz vs foo + variant bar-baz.
    expect(outputConflict({ path: 'engineProfile', id: 'foo-bar-baz', variant: { name: 'baz', of: 'foo-bar' } }, { id: 'foo-bar-baz', variant: { name: 'bar-baz', of: 'foo' } })).toMatch(/variant "baz" of "foo-bar"/);
    expect(outputConflict({ path: 'pipeline', id: 'foo' }, { id: 'foo' })).toBe('not an engine build');
    expect(outputConflict({ path: 'engineProfile', id: 'other' }, { id: 'foo' })).toMatch(/build of "other"/);
  });
  const cfg = config({ variants: { deploy: { engineArgs: [] } } });
  const ep = { packSha256: H('b'), runnerSha256: H('a'), runtime: { id: runtime.id, sha256: H('c'), files: { 'godot.wasm': H('d') } },
    allowedErrors: [{ id: 'E1', ...allow, evidenceSha256: H('e') }] };
  const base = { path: 'engineProfile', id: 'mmx-like', variant: null, files: { 'game.pck': H('f') }, engineProfile: { ...ep, engineArgs: ['--fixed-fps', '60'] } };
  const built = { path: 'engineProfile', id: 'mmx-like-deploy', variant: { name: 'deploy', of: 'mmx-like', overrides: { engineArgs: [] }, note: null }, files: { 'game.pck': H('f') },
    engineProfile: { ...ep, engineArgs: [] } };
  it('a consistent variant build is "built"; missing or without a base it is not', () => {
    expect(variantStatus(cfg, 'deploy', base, built)).toEqual({ status: 'built', mismatches: [] });
    expect(variantStatus(cfg, 'deploy', base, null).status).toBe('missing');
    expect(variantStatus(cfg, 'deploy', null, built)).toEqual({ status: 'unverified', mismatches: ['no base build to compare'] });
  });
  it.each([
    ['another game\'s output (variant.of)', { variant: { ...built.variant, of: 'mmx' } }, 'variant identity'],
    ['old engine args (game.json changed)', { engineProfile: { ...built.engineProfile, engineArgs: ['--fixed-fps', '60'] } }, 'engineArgs'],
    ['older pack', { engineProfile: { ...built.engineProfile, packSha256: H('9') } }, 'packSha256'],
    ['other runtime build', { engineProfile: { ...built.engineProfile, runtime: { ...ep.runtime, sha256: H('8') } } }, 'runtime'],
    ['other runtime files', { engineProfile: { ...built.engineProfile, runtime: { ...ep.runtime, files: { 'godot.wasm': H('7') } } } }, 'runtime files'],
    ['other pack bytes', { files: { 'game.pck': H('6') } }, 'game.pck'],
    ['other evidence', { engineProfile: { ...built.engineProfile, allowedErrors: [{ ...ep.allowedErrors[0], evidenceSha256: H('5') }] } }, 'allowedErrors evidence'],
  ])('stale: %s', (_name, change, mismatch) => {
    const r = variantStatus(cfg, 'deploy', base, { ...built, ...change });
    expect(r.status).toBe('stale'); expect(r.mismatches).toContain(mismatch);
  });
});

describe('K68 Q11: allowlist evidence resolves from the port root for every variant', () => {
  const tree = () => {
    const root = mkdtempSync(join(tmpdir(), 'k68-evidence-')), port = join(root, 'port');
    mkdirSync(join(root, 'reports', 'evidence'), { recursive: true }); mkdirSync(join(port, 'deploy'), { recursive: true });
    writeFileSync(join(root, 'reports', 'evidence', 'dup.txt'), 'main.gd connects tree_entered twice\n');
    return { root, port };
  };
  it('base and variant builds of one game.json get the same evidence entries and hashes', () => {
    const { port } = tree(), cfg = config({ variants: { deploy: { engineArgs: [] } } });
    const base = resolveEvidence(port, resolveVariant(cfg, null).cfg.engineProfile.allowedErrors);
    const deploy = resolveEvidence(port, resolveVariant(cfg, 'deploy').cfg.engineProfile.allowedErrors);
    expect(base).toEqual(deploy);
    expect(base[0]).toMatchObject({ id: 'E1', evidence: '../reports/evidence/dup.txt', evidenceSha256: sha256(Buffer.from('main.gd connects tree_entered twice\n')) });
  });
  it('the pre-K68 workaround (a second game.json in port/deploy/) cannot reach ../reports: why variants exist', () => {
    const { port } = tree();
    expect(() => resolveEvidence(join(port, 'deploy'), [{ ...allow, evidence: '../../reports/evidence/dup.txt' }])).toThrow(/inside the game directory or \.\.\/reports/);
    expect(() => resolveEvidence(join(port, 'deploy'), [allow])).toThrow(/evidence not found/);
  });
  it('buildEngine resolves a variant\'s evidence from the game.json directory before runtime verification', () => {
    const root = mkdtempSync(join(tmpdir(), 'k68-engine-')), port = join(root, 'port'), inputs = join(port, 'inputs'); mkdirSync(inputs, { recursive: true });
    const source = embeddedFixture({ duplicateSignal: true }); writeFileSync(join(inputs, 'runner.exe'), source);
    const cfg = config({ inputRoot: 'inputs', runner: 'runner.exe', runnerSha256: sha256(source), pack: { location: 'embedded-trailer', sha256: sha256(makePack({ duplicateSignal: true })) },
      variants: { deploy: { engineArgs: [] } } });
    const opts = { store: join(root, 'no-store'), outRoot: join(root, 'out'), quiet: true, variant: 'deploy' };
    expect(() => buildEngine(port, cfg, opts)).toThrow(/allowedErrors\[0\]\.evidence not found/);
    mkdirSync(join(root, 'reports', 'evidence'), { recursive: true }); writeFileSync(join(root, 'reports', 'evidence', 'dup.txt'), 'proof');
    expect(() => buildEngine(port, cfg, opts)).toThrow(/not provisioned/);
    expect(() => buildEngine(port, cfg, { ...opts, variant: 'nope' })).toThrow(/unknown engineProfile variant/);
  });
});

describe('K68 Q12: engine bundle delivery metrics', () => {
  const brotli = (b: Buffer) => brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_LGWIN]: 24, [zc.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
  const data = Buffer.from('godot '.repeat(5000) + Array.from({ length: 4000 }, (_, i) => (i * 7919) % 251).join(','));
  it('per-file sizes are raw, gzip -9 and brotli q11 / lgwin 24', () => {
    expect(COMPRESSION).toEqual({ gzip: { level: 9 }, brotli: { quality: 11, lgwin: 24 } });
    expect(compressedSizes(data)).toEqual({ bytes: data.length, gzipBytes: gzipSync(data, { level: 9 }).length, brotliBytes: brotli(data) });
  });
  it('sizes are cached by content hash; entries for other bytes or codecs are ignored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'k68-sizes-')), hash = createHash('sha256').update(data).digest('hex');
    const real = compressedSizes(data, { cacheDir: dir });
    const file = join(dir, `${hash}-gz9-br11w24.json`), entry = JSON.parse(readFileSync(file, 'utf8'));
    expect(entry).toMatchObject(real);
    writeFileSync(file, JSON.stringify({ ...entry, brotliBytes: 7 }));
    expect(compressedSizes(data, { cacheDir: dir }).brotliBytes).toBe(7); // served from the cache
    writeFileSync(file, JSON.stringify({ ...entry, brotliBytes: 7, codec: 'zlib-0-brotli-0' }));
    expect(compressedSizes(data, { cacheDir: dir })).toEqual(real);
    writeFileSync(file, JSON.stringify({ ...entry, brotliBytes: 7, bytes: data.length + 1 }));
    expect(compressedSizes(data, { cacheDir: dir })).toEqual(real);
  });
  it('precompressed outputs decode to the input; a corrupt cached sibling is never reused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'k68-outputs-')), hash = createHash('sha256').update(data).digest('hex');
    const first = compressedOutputs(data, { cacheDir: dir });
    expect(brotliDecompressSync(first.br).equals(data)).toBe(true);
    expect(first.sizes).toEqual(compressedSizes(data));
    writeFileSync(join(dir, `${hash}.br`), Buffer.from('not brotli'));
    expect(brotliDecompressSync(compressedOutputs(data, { cacheDir: dir }).br).equals(data)).toBe(true);
    expect(keepCompressed(1000, 900)).toBe(false); expect(keepCompressed(2000, 1900)).toBe(true); expect(keepCompressed(2000, 1950)).toBe(false);
  });
  it('bundle totals: download = runtime + pack + adapter + shell; bundle adds notices and header files', () => {
    const f = (bytes: number) => ({ bytes, gzipBytes: Math.round(bytes / 2), brotliBytes: Math.round(bytes / 3) });
    const sizes: Record<string, { bytes: number; gzipBytes: number; brotliBytes: number }> = { 'godot.js': f(3000), 'godot.wasm': f(60000),
      'game.pck': { bytes: 9000, gzipBytes: 8700, brotliBytes: 8000 }, 'browser-adapter.js': f(30), 'index.html': f(1200), 'LICENSE.txt': f(99), '_headers': f(9), 'headers.json': f(15) };
    const m = bundleMetrics(sizes, { runtimeFiles: ['godot.js', 'godot.wasm'], wasm: 'godot.wasm', boot: ['godot.js', 'godot.wasm', 'game.pck', 'browser-adapter.js', 'index.html'],
      served: Object.keys(sizes) });
    // vK68: totals count what is served: the pack's gzip saves < 5% (no .gz sibling) and the 30 B adapter is under 1 KiB,
    // so both count raw there; the pack's brotli saves 11% and counts compressed.
    expect(m).toMatchObject({ schema: 'game-cask/engine-bundle-metrics/2', packBytes: 9000, runtimeBytes: 63000, wasmBytes: 60000, downloadBytes: 73230,
      downloadGzipBytes: 1500 + 30000 + 9000 + 30 + 600, downloadBrotliBytes: 1000 + 20000 + 8000 + 30 + 400, bundleBytes: 73353, fileCount: 9 });
    expect(m.files['godot.wasm'].brotliBytes).toBe(20000); expect(m.files['game.pck'].gzipBytes).toBe(8700);
    expect(() => bundleMetrics({}, { runtimeFiles: [], wasm: 'x', boot: [], served: ['x'] })).toThrow(/no sizes/);
  });
});

describe('K68 Q12: first non-clear frame classification', () => {
  const px = (...colors: number[][]) => new Uint8ClampedArray(colors.flat());
  it.each([
    ['transparent (never drawn)', px([0, 0, 0, 0], [0, 0, 0, 0]), [], 'blank'],
    ['opaque black', px([0, 0, 0, 255], [1, 0, 2, 255]), [], 'blank'],
    ['the GL clear color (Godot default grey)', px([77, 77, 77, 255], [77, 77, 77, 255]), [[77, 77, 77]], 'blank'],
    ['a uniform color nobody cleared to (full-screen rect)', px([255, 0, 0, 255], [255, 0, 0, 255]), [[77, 77, 77]], 'content'],
    ['grey without a recorded clear', px([77, 77, 77, 255], [77, 77, 77, 255]), [], 'content'],
    ['any variation', px([77, 77, 77, 255], [200, 10, 10, 255]), [[77, 77, 77]], 'content'],
    ['variation in alpha only', px([0, 0, 0, 0], [0, 0, 0, 255]), [], 'content'],
    ['empty sample', px(), [], 'blank'],
  ])('%s', (_name, data, clears, expected) => {
    expect(classifyFrameSample(data, clears)).toBe(expected);
  });
});

describe('K68: precompressed serving negotiation', () => {
  it.each([
    ['gzip, deflate, br', { br: 1, gz: 1 }, 'br'],
    ['gzip, deflate, br;q=0', { br: 1, gz: 1 }, 'gz'],
    ['gzip;q=0.5', { br: 1, gz: 1 }, 'gz'],
    ['identity', { br: 1, gz: 1 }, null],
    [undefined, { br: 1, gz: 1 }, null],
    ['br', { gz: 1 }, null],
    ['*', { gz: 1 }, 'gz'],
    ['*, br;q=0', { br: 1, gz: 1 }, 'gz'],
    ['*;q=0', { br: 1, gz: 1 }, null],
    ['identity;q=0', { br: 1, gz: 1 }, null],
    ['br;q=0.1, gzip;q=0.9', { br: 1, gz: 1 }, 'gz'],
    ['gzip;q=0.5, br;q=0.5', { br: 1, gz: 1 }, 'br'],
    ['gzip;q=0, *', { br: 1, gz: 1 }, 'br'],
    ['BR;Q=1', { br: 1, gz: 1 }, 'br'],
  ])('Accept-Encoding %s', (header, available, expected) => {
    expect(acceptedEncoding(header, available)).toBe(expected);
  });
});
