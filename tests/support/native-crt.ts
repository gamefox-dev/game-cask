// Compile and run only our original CC0 sources, never a Windows PE or a game binary.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './headless';

export function crtMismatches(reference: string[], actual: string[]): string[] {
  return reference.filter((line) => {
    const ulp = /^ulp ([^=]+)=([0-9a-f]+),([0-9a-f]+)$/.exec(line);
    if (!ulp) return !actual.some((s) => s.endsWith(line));
    const prefix = `ulp ${ulp[1]}=`;
    const found = actual.find((s) => s.includes(prefix));
    const bits = found?.slice(found.indexOf(prefix) + prefix.length).split(',');
    if (!bits || bits.length !== 2) return true;
    return bits.some((b, i) => {
      const distance = BigInt('0x' + b) - BigInt('0x' + ulp[i + 2]);
      return distance < -4n || distance > 4n;
    });
  });
}

export function nativeCrt(id: 'x64-crt' | 'x64-cpprt' | 'x64-memory'): string[] {
  const cache = join(ROOT, 'node_modules/.cache/bgt/native-crt');
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, id + '-'));
  const cpp = id === 'x64-cpprt';
  const source = id === 'x64-crt' ? 'crt.c' : cpp ? 'cpprt.cpp' : 'memory.c';
  const assets = join(ROOT, 'examples', id, 'assets');
  if (existsSync(assets)) cpSync(assets, dir, { recursive: true });
  const exe = join(dir, 'reference');
  execFileSync(cpp ? (process.env.CXX ?? 'c++') : (process.env.CC ?? 'cc'),
    ['-O2', ...(cpp ? ['-std=c++17'] : ['-std=c11']), join(ROOT, 'examples', id, source), '-lm', '-o', exe],
    { cwd: dir, stdio: 'pipe' });
  return execFileSync(exe, [], { cwd: dir, env: { ...process.env, TZ: 'UTC', TMPDIR: dir }, encoding: 'utf8' })
    .trim().split('\n');
}
