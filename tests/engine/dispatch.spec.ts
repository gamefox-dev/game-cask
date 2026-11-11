// CC0-only end-to-end regression for the public build:port/test:port/probe workflow.
import { test, expect } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error offline runtime verification
import { verifyRuntime, ENGINE_ROOT } from '../../tools/engine/runtime.mjs';
// @ts-expect-error original CC0 fixture
import { embeddedFixture } from '../fixtures/engine/godot3-fixture.mjs';
// @ts-expect-error static adapter
import { parsePack, sha256 } from '../../tools/engine/godot3.mjs';

test('engine public port and probe dispatch stay separate from the lifting toolchain', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  info.annotations.push({ type: 'catches', description: 'Operator gate, standard build/test dispatch without examples/lifter, probe input/evidence, absent runtime skip and corrupted runtime refusal.' });
  let runtime;
  try { runtime = verifyRuntime('godot-3.5.3'); } catch (e) {
    if (!(e as Error).message.includes('not provisioned')) throw e;
  }
  test.skip(!runtime, 'Official runtime not provisioned; public engine workflow requires offline provisioning');
  const root = mkdtempSync(join(process.env.BGT_TRIAL_SCRATCH ?? tmpdir(), 'k45-dispatch-'));
  // Deliberately omit examples/. Old unconditional BGT global setup fails this regression.
  for (const name of ['tools', 'tests', 'bgt', 'platforms', 'package.json', 'playwright.config.ts', 'tsconfig.json', '.zig-version']) cpSync(join(ENGINE_ROOT, name), join(root, name), { recursive: true });
  mkdirSync(join(root, 'docs')); cpSync(join(ENGINE_ROOT, 'docs/trial-brief.md'), join(root, 'docs/trial-brief.md'));
  symlinkSync(join(ENGINE_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  const run = (args: string[]) => execFileSync('npm', ['run', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 90000 });
  // No runtime: skip cleanly, not a false passing boot. A malformed provision is NOT skipped.
  const absent = run(['test:engine', '--', 'godot3.spec.ts']);
  expect(absent).toContain('2 skipped');
  const target = join(root, '.engine-private/runtimes', runtime!.runtime.id); mkdirSync(target, { recursive: true });
  expect(() => run(['test:engine', '--', 'godot3.spec.ts'])).toThrow();
  cpSync(runtime!.target, target, { recursive: true });
  mkdirSync(join(root, 'port/tests'), { recursive: true }); mkdirSync(join(root, 'original'));
  const source = embeddedFixture(), r = runtime!.runtime;
  writeFileSync(join(root, 'original/runner.exe'), source);
  const cfg = { id: 'cc0-engine', name: 'CC0 engine port', private: true, engineProfile: {
    schema: 'game-cask/engine-profile/1', allowed: true, adapter: 'godot3', runtime: r.id, version: r.version, build: r.build,
    runner: 'runner.exe', runnerSha256: sha256(source), pack: { location: 'embedded-trailer', sha256: parsePack(source).packSha256 },
    renderer: 'webgl2', threads: false, width: 320, height: 180 } };
  writeFileSync(join(root, 'port/game.json'), JSON.stringify(cfg));
  cpSync(join(root, 'tests/fixtures/engine/port-smoke.ts.in'), join(root, 'port/tests/engine.spec.ts'));
  expect(() => run(['build:port'])).toThrow(/operator authorization/);
  const brief = run(['trial:brief', '--', '--game', 'runner.exe', '--slug', cfg.id, '--allow-engine-profile']);
  expect(brief).toContain(`<!-- engine-profile: allowed game=${cfg.id} runnerSha256=${cfg.engineProfile.runnerSha256} -->`);
  expect(run(['build:port'])).toContain('engineProfile: cc0-engine');
  expect(run(['test:port'])).toContain('1 passed');
  writeFileSync(join(root, 'explore.mjs'),     'export default async p => { await p.step(20); await p.screenshot("before"); await p.key("Enter"); await p.step(5); await p.screenshot("after"); p.log("engine-profile workflow"); };\n');
  run(['engine:probe', '--', '.engine-private/builds/cc0-engine', 'explore.mjs']);
  const probe = JSON.parse(readFileSync(join(root, 'reports/engine-probe/probe.json'), 'utf8'));
  expect(probe.path).toBe('engineProfile'); expect(probe.errors).toEqual([]);
  expect(probe.engineProfile.runtime.id).toBe(r.id); expect(probe.diagnostics.metrics.raf.samples).toBeGreaterThan(0);
  expect(readFileSync(join(root, 'reports/engine-probe/before.png')).equals(readFileSync(join(root, 'reports/engine-probe/after.png')))).toBe(false);
  await info.attach('public-engine-workflow.json', { body: JSON.stringify({ root, probe }), contentType: 'application/json' });
});
