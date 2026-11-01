#!/usr/bin/env node
// Original CC0 scale fixture only: cache the native reference with the same exact
// dependency/object protocol as wasm. No Windows executable is ever run on host.
import { execFileSync, withBuildWriters } from './exec.mjs';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './toolchain.mjs';
import { buildLock } from './lock.mjs';
import { prepareObjects } from './objects.mjs';
import { leaseCache, pruneCache, touchCache } from './cache.mjs';

export function nativeScale() {
  const dir = join(ROOT, 'node_modules/.cache/bgt/native-scale');
  mkdirSync(dir, { recursive: true });
  const lock = buildLock(dir, 'native');
  try { return withBuildWriters(lock.token, () => {
    const generated = join(ROOT, 'node_modules/.cache/bgt/pipeline/x64-scale/fixture/generated');
    if (!existsSync(join(generated, 'sources.json'))) throw new Error('build examples/x64-scale before its native reference');
    const sources = JSON.parse(readFileSync(join(generated, 'sources.json'), 'utf8')).map((f) => join(generated, f));
    const cc = process.env.CC || 'cc';
    const compiler = { path: cc, prefix: [], version: execFileSync(cc, ['--version'], { encoding: 'utf8' }) };
    const cache = join(dir, 'objects');
    const objects = prepareObjects({ sources, flags: ['-O2'], includes: [generated], compiler, cache });
    const executable = join(dir, 'reference'), temporary = executable + '.' + process.pid + '.tmp';
    const release = leaseCache(cache, objects.map((o) => o.out));
    try {
      pruneCache(cache, 64 * 1048576);
      execFileSync('python3', ['-I', join(ROOT, 'tools/build/compile.py')], {
        input: JSON.stringify({ objects, link: [cc, ...objects.map((o) => o.out), '-o', temporary], jobs: Number(process.env.BGT_BUILD_JOBS ?? 2) }),
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'],
      });
      renameSync(temporary, executable);
      touchCache(objects.map((o) => o.out));
    } finally { rmSync(temporary, { force: true }); release(); }
    pruneCache(cache, 64 * 1048576);
    return executable;
  }); } finally { lock(); }
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(nativeScale());
