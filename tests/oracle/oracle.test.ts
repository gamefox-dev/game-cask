// npm run oracle -- <gameDir>   (ORACLE_GAME / ORACLE_FRAMES env, used by the npm script)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { ROOT } from '../support/headless';
import { oracle } from './oracle';
// @ts-expect-error shared ESM reporting tool
import { oracleFailure, writeOracleReport } from '../../tools/report/oracle-report.mjs';

const dir = process.env.ORACLE_GAME;
test.skipIf(!dir)(`differential oracle: ${dir}`, async () => {
  const id = JSON.parse(readFileSync(resolve(ROOT, dir!, 'game.json'), 'utf8')).id;
  let stage = 'build-lifted';
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools/build/build.mjs'), dir!], { stdio: 'inherit' });
    stage = 'build-interpreted';
    execFileSync(process.execPath, [join(ROOT, 'tools/build/build.mjs'), dir!, '--interpret-only'], { stdio: 'inherit' });
  } catch (e) {
    writeOracleReport(ROOT, oracleFailure(id, Number(process.env.ORACLE_FRAMES ?? 600), stage, String(e)));
    throw e;
  }
  const r = await oracle(id, Number(process.env.ORACLE_FRAMES ?? 600));
  console.log(JSON.stringify({ identical: r.identical, firstDivergence: r.firstDivergence, errors: r.errors }, null, 2));
  expect(r.identical, JSON.stringify(r)).toBe(true);
  expect(r.comparedFrames).toBe(Number(process.env.ORACLE_FRAMES ?? 600));
  expect(r.errors).toEqual({ lifted: null, interpreted: null });
  expect(r.firstDivergence).toBeNull();
}, 600_000);
