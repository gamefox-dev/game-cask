// CC0 smoke build; never reads original/ or port/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { embeddedFixture } from '../../tests/fixtures/engine/godot3-fixture.mjs';
import { parsePack, sha256 } from './godot3.mjs';
import { PRIVATE, runtimeById } from './runtime.mjs';
import { buildEngine } from './framework.mjs';
export function buildFixture() {
  const gameDir = join(PRIVATE, 'cc0-fixture'), inputs = join(gameDir, 'inputs'); mkdirSync(inputs, { recursive: true });
  const source = embeddedFixture(), runtime = runtimeById('godot-3.5.3');
  writeFileSync(join(inputs, 'runner.exe'), source);
  const cfg = { id: 'cc0-engine', name: 'CC0 Godot profile fixture', private: true, engineProfile: {
    schema: 'game-cask/engine-profile/1', allowed: true, adapter: 'godot3', runtime: runtime.id,
    version: runtime.version, build: runtime.build, inputRoot: 'inputs', runner: 'runner.exe', runnerSha256: sha256(source),
    pack: { location: 'embedded-trailer', sha256: parsePack(source).packSha256 }, renderer: 'webgl2', threads: false, width: 320, height: 180 } };
  writeFileSync(join(gameDir, 'game.json'), JSON.stringify(cfg, null, 2) + '\n');
  // Built-in operator authorization is restricted to this original CC0 fixture id.
  const policies = join(PRIVATE, 'authorizations'); mkdirSync(policies, { recursive: true });
  writeFileSync(join(policies, cfg.id + '.json'), JSON.stringify({ schema: 'game-cask/engine-authorization/1', game: cfg.id, runnerSha256: cfg.engineProfile.runnerSha256, allowEngineProfile: true }));
  buildEngine(gameDir, cfg, { quiet: true });
  return join(PRIVATE, 'builds', cfg.id);
}
