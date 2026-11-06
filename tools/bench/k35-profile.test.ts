// Original CC0-1.0. Sustained attribution; no speed threshold.
import { it, expect } from 'vitest';
import { Session } from 'node:inspector';
import { writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../../tests/support/headless';
import { k34WorkloadDir } from './k34-fixture';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';

it('attributes only warmed sustained CC0 VM work in both actual modes', async () => {
  process.env.BGT_K34_SUSTAINED = '1';
  const dir = k34WorkloadDir();
  const manifest = buildGame(dir, { quiet: true });
  const out = process.env.BGT_K35_OUT!;
  mkdirSync(out, { recursive: true });
  cpSync(join(ROOT, 'node_modules/.cache/bgt/pipeline/k34-workload/lifted_workload_exe.c'), join(out, 'lifted.c'));
  cpSync(join(ROOT, 'node_modules/.cache/bgt/pipeline/k34-workload/analysis_workload_exe.json'), join(out, 'analysis.json'));
  cpSync(join(ROOT, 'web/public/games/k34-workload'), join(out, 'game'), { recursive: true });
  for (const suspension of ['asyncify', 'jspi'] as const) {
    const h = await loadHeadless('k34-workload', { suspension });
    await h.stepAsync(100);
    const session = new Session(); session.connect();
    const post = (method: string, params: Record<string, unknown> = {}) => new Promise<{ profile?: object }>((resolve, reject) =>
      session.post(method, params, (error, result) => error ? reject(error) : resolve(result as { profile?: object })));
    await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 100 });
    await post('Profiler.start');
    await h.stepAsync(10000);
    const { profile } = await post('Profiler.stop'); session.disconnect();
    expect(h.logs).toContain('guest: k34 workload checksum 88bf80fb');
    const metrics = h.host.metrics() as { interp_insns: number; stubs: unknown[] };
    expect(metrics.interp_insns).toBe(0); expect(metrics.stubs).toEqual([]);
    writeFileSync(join(out, suspension + '.cpuprofile'), JSON.stringify(profile));
    writeFileSync(join(out, suspension + '.json'), JSON.stringify({ manifest, metrics, logs: h.logs }, null, 2));
  }
});
