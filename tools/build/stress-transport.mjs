#!/usr/bin/env node
// Original tiny C fixtures only. Run outside test deadlines; always remove products.
// Usage: node tools/build/stress-transport.mjs [workers=8] [builds/worker=100] [--legacy]
// --legacy uses native synchronous pipe input (may reproduce the macOS stall).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { execFileSync as nativeExec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from './exec.mjs';
import { prepareObjects } from './objects.mjs';
import { ROOT } from './toolchain.mjs';

if (isMainThread) {
  const workers = Number(process.argv[2] ?? 8), builds = Number(process.argv[3] ?? 100);
  if (![workers, builds].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('positive integer workers/builds required');
  const legacy = process.argv.includes('--legacy');
  const start = performance.now();
  const results = await Promise.all(Array.from({ length: workers }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { builds, legacy } });
    let result;
    worker.on('message', (r) => { result = r; });
    worker.on('error', reject);
    worker.on('exit', (code) => code || !result ? reject(new Error('stress worker failed: ' + code)) : resolve(result));
  })));
  console.log(JSON.stringify({ legacy, workers, builds_per_worker: builds, total_builds: workers * builds,
    duration_ms: performance.now() - start, results }, null, 2));
} else {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-transport-stress-'));
  try {
    const source = join(dir, 'main.c'), out = join(dir, 'main');
    writeFileSync(source, 'int main(void){return 23;}\n');
    const compiler = { path: 'cc', prefix: [], version: execFileSync('cc', ['--version'], { encoding: 'utf8' }) };
    const objects = prepareObjects({ sources: [source], flags: ['-O2'], includes: [], compiler, cache: join(dir, 'objects') });
    let expected, hits = 0, misses = 0;
    for (let i = 0; i < workerData.builds; i++) {
      // Different sizes, including beyond socket capacity. This is not a cache input.
      const padding = 'λ'.repeat([0, 1024, 16384, 65536, 262144, 1048576][i % 6]);
      if (i % 2 === 0) for (const object of objects) rmSync(object.out, { force: true });
      const run = workerData.legacy ? nativeExec : execFileSync;
      const result = JSON.parse(run('python3', ['-I', join(ROOT, 'tools/build/compile.py')], {
        input: JSON.stringify({ objects, link: ['cc', ...objects.map((o) => o.out), '-o', out], jobs: 1, padding }),
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], phase: 'transport stress compile/link', timeout: 10000,
      }));
      hits += result.objects_cached; misses += result.objects_compiled;
      const hash = createHash('sha256').update(readFileSync(out)).digest('hex');
      if (expected && hash !== expected) throw new Error('fixture output bytes changed');
      expected = hash;
    }
    parentPort.postMessage({ builds: workerData.builds, hits, misses, sha256: expected });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
