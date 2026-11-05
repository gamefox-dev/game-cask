#!/usr/bin/env node
// Produce deterministic Vitest file shards from the repository's real config.
// CI_LIGHT intentionally excludes build-chunks.test.ts because the required scale
// job runs that file together with its native/browser/oracle checks.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const vitest = join(root, 'node_modules/vitest/vitest.mjs');
const config = join(root, 'vitest.config.ts');
const scaleFile = 'tests/unit/build-chunks.test.ts';

function list(ciLight) {
  const env = { ...process.env };
  if (ciLight) env.BGT_CI_LIGHT = '1';
  else delete env.BGT_CI_LIGHT;
  const out = execFileSync(process.execPath, [vitest, 'list', '--config', config, '--filesOnly'], { cwd: root, env, encoding: 'utf8' });
  return [...new Set(out.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^tests\/(unit|oracle)\//.test(line) && line.endsWith('.test.ts')))].sort();
}

const all = list(false);
const ci = list(true);
const excluded = all.filter((file) => !ci.includes(file));
const covered = [...ci, scaleFile].sort();
if (!existsSync(join(root, scaleFile)) || excluded.length !== 1 || excluded[0] !== scaleFile || covered.join('\n') !== all.join('\n')) {
  throw new Error('CI unit partition drift: shards plus scale must equal full npm test file set, all=' + JSON.stringify(all) + ', ci=' + JSON.stringify(ci) + ', excluded=' + JSON.stringify(excluded));
}
const shardArg = process.argv[2];
if (!shardArg) {
  process.stdout.write(ci.join('\n') + '\n');
  process.exit(0);
}
const match = /^(\d+)\/(\d+)$/.exec(shardArg);
if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2]) || Number(match[2]) < 1) throw new Error('usage: ci-unit-shards.mjs SHARD/COUNT');
const index = Number(match[1]);
const count = Number(match[2]);
const shards = Array.from({ length: count }, () => []);
ci.forEach((file, i) => shards[i % count].push(file));
const union = shards.flat().sort();
if (union.join('\n') !== ci.join('\n')) throw new Error('CI unit shards do not cover the configured Vitest files exactly');
process.stdout.write(shards[index - 1].join('\n') + '\n');
