// K59: engine-runtime test tooling (pack delivery classification, GPU/perf helpers, recorded error allowlist).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain ESM capture
import { buildAssets, classifyCancellation, expectedBodies } from '../../tools/engine/capture.mjs';
// @ts-expect-error plain ESM perf helpers
import { SOFTWARE_RENDERER, softwareRenderer, chromiumLaunch, chromiumSoftwareArgs, engineRenderer } from '../../tools/engine/perf.mjs';
// @ts-expect-error plain ESM probe CLI
import { parseEngineProbeArgs } from '../../tools/engine/probe.mjs';
// @ts-expect-error plain ESM orchestration
import { validateConfig, validateAllowedErrors, validateEngineArgs, buildEngine } from '../../tools/engine/framework.mjs';
// @ts-expect-error shell generator
import { generateShell } from '../../tools/engine/shell.mjs';
// @ts-expect-error runtime manifest
import { runtimeById } from '../../tools/engine/runtime.mjs';
// @ts-expect-error CC0 fixture writer
import { embeddedFixture, makePack, variantScript, script, DUPLICATE_SIGNAL_ERROR } from '../fixtures/engine/godot3-fixture.mjs';
// @ts-expect-error static adapter
import { sha256 } from '../../tools/engine/godot.mjs';

const H = (c: string) => c.repeat(64);
const done = (n: number, extra = {}) => ({ token: 't', received: n, done: true, length: n, ...extra });
const PACK = { sha256: H('a'), bytes: 1000 };

describe('K59 Q2: pack delivery is classified like the wasm', () => {
  it('an abort after the complete, pinned pack is canceled-after-complete', () => {
    expect(classifyCancellation('net::ERR_ABORTED', done(1000), { ...done(1000), status: 200, sha256: H('a') }, PACK)).toBe('canceled-after-complete');
  });
  it.each([
    ['partial at cancellation', done(1000, { received: 10, done: false }), { ...done(1000), status: 200, sha256: H('a') }],
    ['wrong hash', done(1000), { ...done(1000), status: 200, sha256: H('b') }],
    ['HTTP error', done(1000), { ...done(1000), status: 500, sha256: H('a') }],
    ['manifest length differs from Content-Length', done(999), { ...done(999), status: 200, sha256: H('a') }],
    ['no evidence', null, null],
  ])('fails: %s', (_name, first, final) => {
    expect(classifyCancellation('net::ERR_ABORTED', first, final, PACK)).toBe('failure');
  });
  it('fails for other errors and untracked names', () => {
    expect(classifyCancellation('net::ERR_FAILED', done(1000), { ...done(1000), status: 200, sha256: H('a') }, PACK)).toBe('failure');
    expect(classifyCancellation('net::ERR_ABORTED', done(1000), { ...done(1000), status: 200, sha256: H('a') }, null)).toBe('failure');
  });
  it('expected bodies: runtime .wasm plus build pack/wasm with manifest lengths; conflicts refused', () => {
    const manifest = { path: 'engineProfile', files: { 'godot.wasm': H('c'), 'godot.js': H('d'), 'game.pck': H('a'), 'index.html': H('e') },
      metrics: { files: { 'godot.wasm': { bytes: 5 }, 'game.pck': { bytes: 1000 } } } };
    const assets = buildAssets(manifest);
    expect(assets).toEqual({ 'godot.wasm': { sha256: H('c'), bytes: 5 }, 'game.pck': PACK });
    expect(expectedBodies({ 'godot.wasm': H('c'), 'godot.js': H('d') }, assets)).toEqual({ 'godot.wasm': { sha256: H('c'), bytes: 5 }, 'game.pck': PACK });
    expect(expectedBodies({ 'godot.wasm': H('c') })).toEqual({ 'godot.wasm': { sha256: H('c'), bytes: null } });
    expect(() => expectedBodies({ 'godot.wasm': H('c') }, { 'godot.wasm': H('f') })).toThrow(/conflicting/);
    expect(() => expectedBodies({}, { 'game.pck': 'nothex' })).toThrow(/invalid expected body/);
    expect(() => buildAssets({ path: 'engineProfile', files: { 'godot.wasm': H('c') } })).toThrow(/no pack/);
    expect(() => buildAssets({ path: 'pipeline', files: {} })).toThrow(/not an engine build/);
  });
});

describe('K59 Q3: GPU switch and renderer classification', () => {
  it('software regex is the BGT one (bgt/renderers/types.ts softwareRenderer)', () => {
    const ts = readFileSync(new URL('../../bgt/renderers/types.ts', import.meta.url), 'utf8');
    expect(ts).toContain(SOFTWARE_RENDERER.source);
    expect(softwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(softwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)')).toBe(false);
    expect(softwareRenderer('Apple GPU')).toBe(false);
    expect(softwareRenderer(null)).toBe(false);
  });
  it('probe launch: native GPU by default, SwiftShader only with --software', () => {
    expect(chromiumLaunch({ software: true }).args).toEqual(chromiumSoftwareArgs);
    expect(chromiumLaunch().args.join(' ')).not.toMatch(/swiftshader/);
    expect(chromiumLaunch().args).toContain('--ignore-gpu-blocklist');
  });
  it('engine:probe arguments', () => {
    expect(parseEngineProbeArgs(['b', 's.mjs'])).toEqual({ build: 'b', script: 's.mjs', out: 'reports/engine-probe', software: false, browser: 'chromium', measure: null, pace: null, virtualTime: false });
    expect(parseEngineProbeArgs(['b', 's.mjs', 'o', '--software', '--measure', '500'])).toMatchObject({ out: 'o', software: true, measure: 500 });
    expect(parseEngineProbeArgs(['b', '--browser', 'webkit', '--out', 'o'])).toMatchObject({ script: undefined, browser: 'webkit', out: 'o' });
    expect(() => parseEngineProbeArgs(['b'])).toThrow(/SCRIPT is required/);
    expect(() => parseEngineProbeArgs(['b', 'outdir', '--browser', 'webkit'])).toThrow(/\.mjs/);
    expect(() => parseEngineProbeArgs(['b', '--browser', 'webkit', '--software'])).toThrow(/Chromium only/);
    expect(() => parseEngineProbeArgs(['b', 's.mjs', '--browser', 'firefox'])).toThrow(/chromium or webkit/);
    expect(() => parseEngineProbeArgs(['b', 's.mjs', '--measure', '5'])).toThrow(/--measure/);
    expect(() => parseEngineProbeArgs(['b', 's.mjs', '--headed'])).toThrow(/unknown argument/);
    expect(parseEngineProbeArgs(['b', 's.mjs', '--pace', '60'])).toMatchObject({ pace: 60 });
    expect(() => parseEngineProbeArgs(['b', 's.mjs', '--pace', '0'])).toThrow(/--pace/);
    expect(parseEngineProbeArgs(['b', 's.mjs', '--pace', '60', '--virtual-time'])).toMatchObject({ pace: 60, virtualTime: true });
    expect(() => parseEngineProbeArgs(['b', 's.mjs', '--virtual-time'])).toThrow(/needs --pace/);
  });
});

describe('K59 Q5: recorded engine error allowlist', () => {
  const ok = { message: DUPLICATE_SIGNAL_ERROR, justification: 'main.gd of the game connects tree_entered twice (pack offset evidence)', evidence: 'evidence/dup.txt' };
  it('accepts exact messages and specific whole-line patterns', () => {
    expect(validateAllowedErrors([ok])).toHaveLength(1);
    expect(validateAllowedErrors([{ ...ok, message: undefined, pattern: "ERROR: Signal 'tree_entered' is already connected to given method '_noop' in that object\\." }])).toHaveLength(1);
    expect(validateAllowedErrors([{ ...ok, message: undefined, pattern: "SCRIPT ERROR: Invalid get index 'hp' \\(on base: 'Nil'\\)\\. in enemy_[0-9]+" }])).toHaveLength(1);
  });
  it.each([
    ['no justification', { ...ok, justification: undefined }, /justification/],
    ['short justification', { ...ok, justification: 'because' }, /justification/],
    ['no evidence', { ...ok, evidence: undefined }, /evidence/],
    ['absolute evidence', { ...ok, evidence: '/etc/passwd' }, /evidence/],
    ['both forms', { ...ok, pattern: 'ERROR: x' }, /exactly one/],
    ['neither form', { justification: ok.justification, evidence: ok.evidence }, /exactly one/],
    ['unknown field', { ...ok, scope: 'all' }, /unknown field/],
    ['abort line', { ...ok, message: 'Aborted(RuntimeError: unreachable)' }, /only engine ERROR lines/],
    ['trap line', { ...ok, message: 'RuntimeError: memory access out of bounds' }, /only engine ERROR lines/],
    ['warning line', { ...ok, message: 'WARNING: x' }, /only engine ERROR lines/],
    ['catch-all pattern', { ...ok, message: undefined, pattern: 'ERROR: .*' }, /too broad/],
    ['any error pattern', { ...ok, message: undefined, pattern: '(USER |SCRIPT )?ERROR: .+' }, /too broad/],
    ['any duplicate signal', { ...ok, message: undefined, pattern: "ERROR: Signal '.+' is already connected to given method '.+' in that object\\." }, /too broad/],
    ['empty-matching pattern', { ...ok, message: undefined, pattern: '(ERROR: abc)?' }, /too broad/],
    ['pattern without prefix', { ...ok, message: undefined, pattern: ".*Signal 'tree_entered' is already connected to given method '_noop'.*" }, /literal ERROR prefix/],
    ['pattern with few literals', { ...ok, message: undefined, pattern: 'ERROR: [a-z]{3} \\d+ zz' }, /24 literal/],
    ['invalid regex', { ...ok, message: undefined, pattern: 'ERROR: (unclosed' }, /invalid pattern/],
  ])('refuses %s', (_name, entry, error) => {
    expect(() => validateAllowedErrors([entry])).toThrow(error);
  });
  it('refuses more than 32 entries and non-arrays', () => {
    expect(() => validateAllowedErrors(Array(33).fill(ok))).toThrow(/at most 32/);
    expect(() => validateAllowedErrors({})).toThrow(/array/);
  });
  it('validateConfig applies the allowlist rules; the shell carries entries and logs only real errors with console.error', () => {
    const runtime = runtimeById('godot-3.5.3');
    const cfg = { id: 'cc0-engine', name: 'CC0', private: true, engineProfile: { schema: 'game-cask/engine-profile/2', allowed: true, adapter: 'godot3', runtime: runtime.id,
      version: runtime.version, build: runtime.build, renderer: 'webgl2', threads: false, runner: 'r.exe', runnerSha256: H('a'), pack: { location: 'embedded-trailer', sha256: H('b') },
      allowedErrors: [{ ...ok, message: 'ERROR: .*' }] } };
    expect(() => validateConfig(cfg)).not.toThrow(); // exact message 'ERROR: .*' is a literal line, harmless
    cfg.engineProfile.allowedErrors = [{ ...ok, justification: '' }];
    expect(() => validateConfig(cfg)).toThrow(/justification/);
    const html = generateShell({ id: 'x', name: 'x', runtime: { ...runtime, sha256: H('c') }, packSize: 1, wasmSize: 1, packSha256: H('b'),
      allowedErrors: [{ id: 'E1', ...ok, evidenceSha256: H('d') }] });
    expect(html).toContain('"allowedErrors":[{"id":"E1","message":');
    expect(html).toContain('test.engineStderr(x)==="error"?console.error:console.warn');
    expect(generateShell({ id: 'x', name: 'x', runtime: { ...runtime, sha256: H('c') }, packSize: 1, wasmSize: 1, packSha256: H('b') })).not.toContain('allowedErrors');
  });
  it('build refuses an allowlist entry whose evidence file is missing (before runtime verification)', () => {
    const root = mkdtempSync(join(tmpdir(), 'k59-engine-')), inputs = join(root, 'inputs'); mkdirSync(inputs);
    const source = embeddedFixture({ duplicateSignal: true }); writeFileSync(join(inputs, 'runner.exe'), source);
    const runtime = runtimeById('godot-3.5.3');
    const cfg = { id: 'cc0-k59', name: 'CC0', private: true, engineProfile: { schema: 'game-cask/engine-profile/2', allowed: true, adapter: 'godot3', runtime: runtime.id,
      version: runtime.version, build: runtime.build, renderer: 'webgl2', threads: false, inputRoot: 'inputs', runner: 'runner.exe', runnerSha256: sha256(source),
      pack: { location: 'embedded-trailer', sha256: sha256(makePack({ duplicateSignal: true })) }, allowedErrors: [ok] } };
    expect(() => buildEngine(root, cfg, { store: join(root, 'no-store'), outRoot: join(root, 'out'), quiet: true })).toThrow(/evidence not found/);
    mkdirSync(join(root, 'evidence')); writeFileSync(join(root, 'evidence/dup.txt'), 'proof');
    // With the evidence present the build proceeds to runtime verification (no runtime cache here).
    expect(() => buildEngine(root, cfg, { store: join(root, 'no-store'), outRoot: join(root, 'out'), quiet: true })).toThrow(/not provisioned/);
  });
  it('CC0 fixture variants only add the documented lines', () => {
    expect(variantScript()).toBe(script);
    const dup = variantScript({ duplicateSignal: true });
    expect(dup.match(/connect\("tree_entered", self, "_noop"\)/g)).toHaveLength(2);
    expect(variantScript({ tone: true })).toContain('AudioStreamGenerator.new()');
  });
});

describe('K59 Q7: recorded engine command-line options', () => {
  it('accepts allowlisted Godot timing options with valid values', () => {
    for (const adapter of ['godot3', 'godot4']) {
      expect(validateEngineArgs(adapter, ['--fixed-fps', '60'])).toEqual(['--fixed-fps', '60']);
      expect(validateEngineArgs(adapter, ['--fixed-fps', '30', '--time-scale', '0.5', '--frame-delay', '0', '--print-fps'])).toHaveLength(7);
      expect(validateEngineArgs(adapter, [])).toEqual([]);
    }
  });
  it.each([
    ['unknown option', ['--script', 'res://x.gd'], /not an allowlisted/],
    ['positional', ['res://main.tscn'], /not an allowlisted/],
    ['missing value', ['--fixed-fps'], /valid value/],
    ['bad value', ['--fixed-fps', '0'], /valid value/],
    ['non-numeric', ['--time-scale', 'fast'], /valid value/],
    ['option as value', ['--fixed-fps', '--print-fps'], /valid value/],
    ['duplicate', ['--fixed-fps', '60', '--fixed-fps', '30'], /duplicate/],
    ['non-strings', [60], /array of at most 16 strings/],
  ])('refuses %s', (_name, args, error) => { expect(() => validateEngineArgs('godot3', args)).toThrow(error); });
  it('validateConfig checks engineArgs; the shell passes them through the Engine config args and the identity', () => {
    const runtime = runtimeById('godot-3.5.3');
    const cfg = { id: 'cc0-engine', name: 'CC0', private: true, engineProfile: { schema: 'game-cask/engine-profile/2', allowed: true, adapter: 'godot3', runtime: runtime.id,
      version: runtime.version, build: runtime.build, renderer: 'webgl2', threads: false, runner: 'r.exe', runnerSha256: H('a'), pack: { location: 'embedded-trailer', sha256: H('b') },
      engineArgs: ['--fixed-fps', '60'] } };
    expect(() => validateConfig(cfg)).not.toThrow();
    cfg.engineProfile.engineArgs = ['--gpu-index', '1'];
    expect(() => validateConfig(cfg)).toThrow(/not an allowlisted godot3 option/);
    const html = generateShell({ id: 'x', name: 'x', runtime: { ...runtime, sha256: H('c') }, packSize: 1, wasmSize: 1, packSha256: H('b'), engineArgs: ['--fixed-fps', '60'] });
    expect(html).toContain('"args":["--fixed-fps","60"]');
    expect(html).toContain('"engineArgs":["--fixed-fps","60"]');
    const legacy = runtimeById('godot-3.2.3-nothreads');
    expect(() => generateShell({ id: 'x', name: 'x', runtime: { ...legacy, sha256: H('c') }, packSize: 1, wasmSize: 1, packSha256: H('b'), engineArgs: ['--fixed-fps', '60'] })).toThrow(/Engine config API/);
  });
  it('physics fixture variant is exclusive and prints frame-indexed state', () => {
    expect(variantScript({ physics: true })).toContain('print("state ", Engine.get_physics_frames()');
    expect(() => variantScript({ physics: true, tone: true })).toThrow(/exclusive/);
  });
});

describe('vK59 review fixes', () => {
  const ok = { justification: 'main.gd of the game prints this line itself (pack offset evidence)', evidence: 'evidence/dup.txt' };
  it.each([
    ['group break-out (review example 1)', 'ERROR: Signal foo is already connected to)|(?!', /does not compile on its own/],
    ['top-level alternation (review example 2)', 'ERROR: ' + 'a'.repeat(40) + '|USER ERROR: ..+', /top-level alternation/],
    ['lookahead', "ERROR: Signal 'tree_entered' is already connected(?=.*)", /lookarounds/],
    ['lookbehind', "ERROR: Signal 'tree_entered' is already (?<!x)connected", /lookarounds/],
    ['negated class', "ERROR: Signal 'tree_entered' is already connected[^.]*", /negated/],
    ['whitespace escape (matches newlines)', "ERROR: Signal 'tree_entered' is already\\s+connected", /escape \\s/],
    ['unicode escape', "ERROR: Signal 'tree_entered' is already connected\\u000a", /escape \\u/],
    ['backreference', "ERROR: Signal '(tree_entered)' is already connected \\1", /escape \\1/],
    ['literal newline', "ERROR: Signal 'tree_entered' is already connected\nAborted", /control or line-separator/],
  ])('refuses %s', (_name, pattern, error) => {
    expect(() => validateAllowedErrors([{ ...ok, pattern }])).toThrow(error);
  });
  it('still accepts grouped alternation and escaped punctuation', () => {
    expect(validateAllowedErrors([{ ...ok, pattern: "ERROR: Signal 'tree_entered' is already connected to given method '_(noop|idle)' in that object\\." }])).toHaveLength(1);
  });
  it('an unreadable renderer fails closed (software: true, rendererUnknown)', async () => {
    const page = { evaluate: async () => ({ context: null, renderer: null, vendor: null, version: null }) };
    expect(await engineRenderer(page)).toMatchObject({ software: true, rendererUnknown: true });
    const gpu = { evaluate: async () => ({ context: 'webgl2', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)', vendor: 'x', version: 'y' }) };
    expect(await engineRenderer(gpu)).toMatchObject({ software: false, rendererUnknown: false });
  });
  it('evidence must stay inside the game directory or the sibling reports tree', () => {
    const base = mkdtempSync(join(tmpdir(), 'k59-evidence-')), port = join(base, 'port'), inputs = join(port, 'inputs');
    mkdirSync(inputs, { recursive: true }); mkdirSync(join(base, 'reports')); mkdirSync(join(base, 'elsewhere'));
    writeFileSync(join(base, 'reports', 'proof.txt'), 'proof'); writeFileSync(join(base, 'elsewhere', 'proof.txt'), 'proof');
    const source = embeddedFixture({ duplicateSignal: true }); writeFileSync(join(inputs, 'runner.exe'), source);
    const runtime = runtimeById('godot-3.5.3');
    const cfg = (evidence: string) => ({ id: 'cc0-k59', name: 'CC0', private: true, engineProfile: { schema: 'game-cask/engine-profile/2', allowed: true, adapter: 'godot3', runtime: runtime.id,
      version: runtime.version, build: runtime.build, renderer: 'webgl2', threads: false, inputRoot: 'inputs', runner: 'runner.exe', runnerSha256: sha256(source),
      pack: { location: 'embedded-trailer', sha256: sha256(makePack({ duplicateSignal: true })) }, allowedErrors: [{ ...ok, message: DUPLICATE_SIGNAL_ERROR, evidence }] } });
    const build = (evidence: string) => () => buildEngine(port, cfg(evidence), { store: join(base, 'no-store'), outRoot: join(base, 'out'), quiet: true });
    expect(build('../elsewhere/proof.txt')).toThrow(/inside the game directory or \.\.\/reports/);
    expect(build('inputs/../../elsewhere/proof.txt')).toThrow(/inside the game directory/);
    expect(build('../reports/proof.txt')).toThrow(/not provisioned/); // accepted: the build reaches runtime verification
  });
});
