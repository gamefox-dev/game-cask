#!/usr/bin/env node
// npm run trial:record -- <gameDir> <slug>
// Writes reports/trial.json (kit commit, inputs, pipeline + runtime + oracle + e2e metrics) and, if missing,
// a reports/NOTES.md port-note template. Copy both with the port into the trials repo:
//   game-cask-trials/<game>/<NNN-slug>/{trial.json,NOTES.md,port/,reports/}
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';

const [dirArg, slug] = process.argv.slice(2);
if (!dirArg || !slug) { console.error('usage: npm run trial:record -- <gameDir> <slug>'); process.exit(1); }
const gameDir = resolve(ROOT, dirArg);
const cfg = JSON.parse(readFileSync(join(gameDir, 'game.json'), 'utf8'));
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };
const readJ = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const manifest = readJ(join(ROOT, 'web/public/games', cfg.id, 'manifest.json'));
const oracle = readJ(join(ROOT, 'reports', `oracle-${cfg.id}.json`));
const e2e = readJ(join(ROOT, 'reports', 'e2e-port-results.json'));
const progress = readJ(join(ROOT, 'reports', 'progress.json'));
const errors = readJ(join(ROOT, 'reports', 'errors.json'));
const overrides = manifest?.pipeline?.exceptions ?? null;

const trial = {
  schema: 'game-cask/trial/2',
  game: cfg.id,
  slug,
  recorded: new Date().toISOString(),
  kit: { repo: 'gamefox-dev/game-cask', commit: git('rev-parse', '--short', 'HEAD'), dirty: !!git('status', '--porcelain', '--', 'bgt', 'platforms', 'tools', 'tests', 'web', 'CLAUDE.md', '.claude') },
  inputs: (manifest?.pipeline?.modules ?? []).map((m) => ({ module: m.name, provenance: m.provenance, sha256: m.sha256 })),
  pipeline: manifest?.pipeline ? {
    loc: manifest.pipeline.loc,
    modules: manifest.pipeline.modules.map((m) => ({ name: m.name, functions: m.functions, lift: m.lift })),
    exceptions: overrides,
  } : null,
  oracle: oracle ? { frames: oracle.frames, identical: oracle.identical, firstDivergence: oracle.firstDivergence, errors: oracle.errors, metrics: oracle.metrics?.lifted } : null,
  e2e: e2e?.stats ? { expected: e2e.stats.expected, unexpected: e2e.stats.unexpected, skipped: e2e.stats.skipped, flaky: e2e.stats.flaky } : null,
  levels: { claimed: progress?.achieved_level ?? null, validated: null },
  kitGaps: (errors?.errors ?? []).filter((e) => e.kind === 'kit-gap').map((e) => e.summary),
};
mkdirSync(join(ROOT, 'reports'), { recursive: true });
writeFileSync(join(ROOT, 'reports', 'trial.json'), JSON.stringify(trial, null, 2) + '\n');
const notes = join(ROOT, 'reports', 'NOTES.md');
if (!existsSync(notes)) {
  writeFileSync(notes, `# Port note: ${cfg.id} / ${slug}

**Kit:** \`${trial.kit.commit}\`${trial.kit.dirty ? ' (dirty!)' : ''}. **Level:** ${trial.levels.claimed ?? '?'} (claimed). **Approach:** pipeline (${manifest?.pipeline?.platform ?? '?'}).

## Kit metrics
- generated LOC ${trial.pipeline?.loc?.generated ?? '?'}, hand-written LOC ${trial.pipeline?.loc?.handwritten ?? '?'}, overrides ${trial.pipeline?.exceptions?.overrides?.length ?? '?'}
- oracle: ${trial.oracle ? (trial.oracle.identical ? 'identical' : 'DIVERGED at frame ' + trial.oracle.firstDivergence) : 'not run'}

## What happened
<!-- what worked through the pipeline unchanged, where it needed help -->

## Exceptions (each with evidence)

## Kit gaps / friction

## Try differently next iteration
`);
}
console.log(`trial: wrote reports/trial.json${existsSync(notes) ? ' (+ NOTES.md)' : ''}`);
