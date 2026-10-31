#!/usr/bin/env node
// Apple ships clang as "gcc"; lint with a real GCC too when one is on PATH.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { ROOT } from './toolchain.mjs';

export function findGcc(path = process.env.PATH ?? '', run = spawnSync) {
  const candidates = ['gcc'];
  for (const dir of path.split(delimiter).filter(Boolean)) {
    try {
      const names = readdirSync(dir).filter((name) => /^gcc-\d+$/.test(name));
      names.sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
      candidates.push(...names.map((name) => join(dir, name)));
    } catch { /* Missing or inaccessible PATH directories are not compilers. */ }
  }
  for (const cc of candidates) {
    const result = run(cc, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (result.status === 0 && /\b(gcc|GCC|Free Software Foundation)\b/.test(result.stdout) &&
        !/clang/i.test(result.stdout)) return cc;
  }
  return null;
}

export function checkHostGcc(cc = findGcc(), run = execFileSync) {
  if (!cc) return; // GCC is optional; absence must be silent.
  const dir = mkdtempSync(join(tmpdir(), 'bgt-host-gcc-'));
  try {
    run(cc, ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-o', join(dir, 'x86tool'),
      join(ROOT, 'tools/x86/x86tool.c'), join(ROOT, 'platforms/x86/x86_decode.c')],
    { cwd: ROOT, stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) checkHostGcc();
