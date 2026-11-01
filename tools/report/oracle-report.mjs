// Shared by the oracle runner and its CLI: failures must replace stale successful evidence.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function oracleFailure(game, requestedFrames, failureStage, error, exitStatus = 1) {
  return {
    game, requestedFrames, frames: 0, comparedFrames: 0,
    identical: false, firstDivergence: null,
    hashes: { lifted: null, interpreted: null },
    metrics: { lifted: null, interpreted: null },
    errors: { lifted: failureStage.startsWith('preflight-') ? String(error) : null, interpreted: null },
    failureStage, error: String(error), exitStatus,
  };
}

export function writeOracleReport(root, report) {
  if (!/^[A-Za-z0-9_-]+$/.test(report.game)) throw new Error('invalid oracle game id');
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports', `oracle-${report.game}.json`), JSON.stringify(report, null, 2) + '\n');
  return report;
}
