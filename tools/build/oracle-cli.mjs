#!/usr/bin/env node
// npm run oracle -- <gameDir> [frames]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ROOT } from './toolchain.mjs';
import { oracleFailure, writeOracleReport } from '../report/oracle-report.mjs';

const [dir, frames] = process.argv.slice(2);
if (!dir) { console.error('usage: npm run oracle -- <gameDir> [frames]'); process.exit(1); }
let id = basename(resolve(ROOT, dir)).replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown';
const requested = Number(frames ?? 600);
let stage = 'setup';
try {
  const config = JSON.parse(readFileSync(resolve(ROOT, dir, 'game.json'), 'utf8'));
  if (typeof config.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(config.id)) throw new Error('invalid oracle game id');
  id = config.id;
  if (!Number.isSafeInteger(requested) || requested <= 0) throw new Error('oracle frames must be a positive safe integer');
  // Replace stale evidence even if the child cannot start or dies before reaching its test.
  stage = 'runner';
  writeOracleReport(ROOT, oracleFailure(id, requested, stage, 'oracle runner did not complete'));
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/oracle/oracle.test.ts', '--config', 'vitest.oracle.config.ts', '--reporter=verbose'], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, ORACLE_GAME: dir, ORACLE_FRAMES: String(requested) },
  });
} catch (e) {
  const status = Number.isInteger(e.status) && e.status > 0 ? e.status : 1;
  let report = oracleFailure(id, requested, stage, e.message, status);
  if (stage === 'runner') {
    try {
      const current = JSON.parse(readFileSync(join(ROOT, 'reports', `oracle-${id}.json`), 'utf8'));
      report = { ...current, identical: false, exitStatus: status };
      if (!current.error || current.failureStage === 'runner') {
        report.error = e.message;
        report.failureStage = 'runner';
      }
    } catch { /* retain the fresh runner failure */ }
  }
  writeOracleReport(ROOT, report);
  process.exit(status);
}
