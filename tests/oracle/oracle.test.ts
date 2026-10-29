// npm run oracle -- <gameDir>   (ORACLE_GAME / ORACLE_FRAMES env, used by the npm script)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ROOT } from '../support/headless';
import { oracle } from './oracle';

const dir = process.env.ORACLE_GAME;
test.skipIf(!dir)(`differential oracle: ${dir}`, async () => {
  execFileSync(process.execPath, [join(ROOT, 'tools/build/build.mjs'), dir!], { stdio: 'inherit' });
  execFileSync(process.execPath, [join(ROOT, 'tools/build/build.mjs'), dir!, '--interpret-only'], { stdio: 'inherit' });
  const id = JSON.parse(readFileSync(join(ROOT, dir!, 'game.json'), 'utf8')).id;
  const r = await oracle(id, Number(process.env.ORACLE_FRAMES ?? 600));
  console.log(JSON.stringify({ identical: r.identical, firstDivergence: r.firstDivergence, errors: r.errors }, null, 2));
  expect(r.errors).toEqual({ lifted: null, interpreted: null });
  expect(r.firstDivergence).toBeNull();
}, 600_000);
