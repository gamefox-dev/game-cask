#!/usr/bin/env node
// npm run oracle -- <gameDir> [frames]
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './toolchain.mjs';

const [dir, frames] = process.argv.slice(2);
if (!dir) { console.error('usage: npm run oracle -- <gameDir> [frames]'); process.exit(1); }
try {
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.oracle.config.ts', '--reporter=verbose'], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, ORACLE_GAME: dir, ORACLE_FRAMES: frames ?? '600' },
  });
} catch {
  process.exit(1);
}
