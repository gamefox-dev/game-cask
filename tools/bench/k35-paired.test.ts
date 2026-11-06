// Original CC0-1.0. Opt-in paired A/B evidence, not a performance threshold.
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../../tests/support/headless';
import { k35Fixture, type K35Fixture } from './k35-fixture';
import { oracle } from '../../tests/oracle/oracle';
import { loadavg, freemem } from 'node:os';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';

it('prepares or compares identical CC0 VM workloads in both suspension modes', async () => {
  const kind = (process.env.BGT_K35_FIXTURE ?? 'vm') as K35Fixture;
  const { id, dir, expected } = k35Fixture(kind);
  const prepare = process.env.BGT_K35_PREPARE_DIR;
  if (prepare) {
    const manifest = buildGame(dir, { quiet: true });
    buildGame(dir, { quiet: true, interpretOnly: true });
    const oracles = [];
    for (const mode of ['asyncify', 'jspi']) {
      process.env.BGT_ORACLE_SUSPENSION = mode;
      const r = await oracle(id, 300);
      expect(r.identical, JSON.stringify(r)).toBe(true);
      expect(r.comparedFrames).toBe(300);
      expect(r.errors).toEqual({ lifted: null, interpreted: null });
      oracles.push({ mode, result: r });
    }
    mkdirSync(prepare, { recursive: true });
    cpSync(join(ROOT, 'web/public/games/' + id), join(prepare, 'game'), { recursive: true });
    writeFileSync(join(prepare, 'evidence.json'), JSON.stringify({ manifest, oracles }, null, 2));
    return;
  }
  const paths: string[] = JSON.parse(process.env.BGT_K35_VARIANTS ?? '[]');
  expect(paths.length).toBeGreaterThanOrEqual(2);
  const evidence = paths.map(p => JSON.parse(readFileSync(join(p, 'evidence.json'), 'utf8')));
  for (const e of evidence.slice(1)) for (let m = 0; m < 2; m++)
    expect(e.oracles[m].result.hashes).toEqual(evidence[0].oracles[m].result.hashes);
  const rows = [];
  for (const suspension of ['asyncify', 'jspi'] as const) {
    const samples: number[][] = paths.map(() => []);
    const resources = [];
    // One discarded warmup pair, nine alternating-order fresh-instance pairs.
    for (let pair = -1; pair < 9; pair++) {
      const order = paths.map((_, i) => i); if (pair & 1) order.reverse();
      resources.push({ pair, load: loadavg(), free: freemem() });
      for (const i of order) {
        const h = await loadHeadless(id, { dir: join(paths[i], 'game'), suspension });
        await h.stepAsync(30);
        const start = performance.now(); await h.stepAsync(300); const ms = performance.now() - start;
        // Host bookkeeping can trigger V8 memory-pressure/GC work at the next
        // wasm invocation. Give it a separate untimed task between instances.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (pair >= 0) samples[i].push(ms);
        expect(h.logs).toContain(expected);
        const metrics = h.host.metrics() as { interp_insns: number; stubs: unknown[] };
        expect(metrics.interp_insns).toBe(0); expect(metrics.stubs).toEqual([]);
      }
    }
    const median = (a: number[]) => [...a].sort((a, b) => a - b)[4];
    rows.push({ suspension, samples, medians: samples.map(median), resources,
      paired: samples.slice(1).map(a => { const delta = a.map((x, n) => x - samples[0][n]);
        return { delta, median: median(delta), min: Math.min(...delta), max: Math.max(...delta) }; }) });
  }
  writeFileSync(process.env.BGT_K35_REPORT!, JSON.stringify({ paths, rows, evidence,
    method: 'Nine alternating-order same-process fresh-instance pairs after one discarded pair per mode; 30 untimed warmup updates followed by 300 timed sustained-work updates and Sleep. Instantiation/init/compile excluded. Not guest frames or isolated wasm CPU time.' }, null, 2));
});
