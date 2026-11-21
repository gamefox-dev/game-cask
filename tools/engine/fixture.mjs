// CC0 smoke builds; never read original/ or port/. One fixture game per official runtime under test.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { embeddedFixture as godot3Fixture } from '../../tests/fixtures/engine/godot3-fixture.mjs';
import { embeddedFixture as godot4Fixture } from '../../tests/fixtures/engine/godot4-fixture.mjs';
import { parsePack, sha256 } from './godot.mjs';
import { PRIVATE, runtimeById, verifyRuntime } from './runtime.mjs';
import { buildEngine } from './framework.mjs';

/** runtimeId: godot-3.5.3-nothreads (default), godot-3.x-threads, godot-4.x-nothreads|threads. */
export function buildFixture(runtimeId = 'godot-3.5.3-nothreads', { outRoot = join(PRIVATE, 'builds') } = {}) {
  const runtime = runtimeById(runtimeId), major = Number(runtime.version[0]);
  const id = runtime.id === 'godot-3.5.3-nothreads' ? 'cc0-engine' : 'cc0-' + runtime.id.replace(/\./g, '-');
  const gameDir = join(PRIVATE, 'cc0-fixtures', id), inputs = join(gameDir, 'inputs'); mkdirSync(inputs, { recursive: true });
  const source = major === 3 ? godot3Fixture({ version: runtime.version.split('.').map(Number).concat([0, 0]).slice(0, 3), build: runtime.build })
    : godot4Fixture({ version: runtime.version, build: runtime.build, relative: !/^4\.[0-2](\.|$)/.test(runtime.version) });
  writeFileSync(join(inputs, 'runner.exe'), source);
  const cfg = { id, name: 'CC0 Godot ' + runtime.version + ' ' + runtime.variant + ' fixture', private: true, engineProfile: {
    schema: 'game-cask/engine-profile/2', allowed: true, choice: 'CC0 fixture for the engine-runtime path', adapter: runtime.adapter, runtime: runtime.id,
    version: runtime.version, build: runtime.build, inputRoot: 'inputs', runner: 'runner.exe', runnerSha256: sha256(source),
    pack: { location: 'embedded-trailer', sha256: parsePack(source).packSha256 }, renderer: 'webgl2', threads: runtime.requirements.threads, width: 320, height: 180,
    // Unverified (no published checksum) runtimes need the recorded opt-in, exactly like a port.
    ...(verifyRuntime(runtime.id).verified ? {} : { allowUnverifiedRuntime: true }) } };
  writeFileSync(join(gameDir, 'game.json'), JSON.stringify(cfg, null, 2) + '\n');
  buildEngine(gameDir, cfg, { quiet: true, outRoot });
  return join(outRoot, cfg.id);
}
