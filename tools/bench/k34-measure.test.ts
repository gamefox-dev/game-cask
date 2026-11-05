// Original CC0-1.0. Measurement only; no speed threshold.
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless } from '../../tests/support/headless';
import { k34WorkloadDir } from './k34-fixture';
import { oracle } from '../../tests/oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';

it('measures the CC0 bytecode workload and checks 300 oracle frames', async () => {
  const dir = k34WorkloadDir();
  const manifest = buildGame(dir, { quiet: true });
  buildGame(dir, { quiet: true, interpretOnly: true });
  const suspension = process.env.BGT_ORACLE_SUSPENSION === 'jspi' ? 'jspi' : 'asyncify';
  const differential = await oracle('k34-workload', 300);
  expect(differential.identical, JSON.stringify(differential)).toBe(true);
  expect(differential.comparedFrames).toBe(300);
  expect(differential.errors).toEqual({ lifted: null, interpreted: null });
  const samples: number[] = [];
  let metrics: unknown, logs: string[] = [];
  for (let i = 0; i < 8; i++) {
    const h = await loadHeadless('k34-workload', { suspension });
    const start = performance.now();
    await h.stepAsync(300);
    if (i) samples.push(performance.now() - start);
    metrics = h.host.metrics(); logs = h.logs;
    expect((metrics as { interp_insns: number }).interp_insns).toBe(0);
    expect((metrics as { stubs: unknown[] }).stubs).toEqual([]);
    expect(logs).toContain('guest: k34 workload checksum 88bf80fb');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  writeFileSync(process.env.BGT_K34_REPORT ?? join(dir, 'measure-' + suspension + '.json'), JSON.stringify({
    suspension, samples, median_ms: sorted[3], metrics, logs, manifest, oracle: differential,
    method: 'One discarded fresh-instance warmup, seven fresh instances; 300 updates including startup, then Sleep. Not guest frames or pure CPU time.',
  }, null, 2) + '\n');
});
