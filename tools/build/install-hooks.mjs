// npm "prepare" hook: point git at the repo's hooks (private-asset leak check).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './toolchain.mjs';

if (existsSync(join(ROOT, '.git')) && !process.env.CI) {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    // not fatal: hooks are a convenience, CI runs the same check
  }
}
