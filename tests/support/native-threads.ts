// Execute only this original CC0 host build, never the PE or game input.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './headless';
export function nativeThreads(): string {
  const cache = join(ROOT, 'node_modules/.cache/bgt/native-threads');
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, 'reference-')), exe = join(dir, 'reference');
  try {
    execFileSync(process.env.CC ?? 'cc', ['-O2', '-std=c11', '-pthread',
      join(ROOT, 'examples/x64-threads/threads.c'), '-o', exe]);
    return execFileSync(exe, [], { encoding: 'utf8' }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
