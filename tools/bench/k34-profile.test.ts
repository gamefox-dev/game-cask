// Original CC0-1.0. Opt-in attribution profile; not a timing gate.
import { it, expect } from 'vitest';
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless } from '../../tests/support/headless';
import { k34WorkloadDir } from './k34-fixture';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';

it('profiles 100 fresh-instance CC0 bytecode workloads including setup', async () => {
  const dir = k34WorkloadDir();
  buildGame(dir, { quiet: true });
  buildGame(dir, { quiet: true, interpretOnly: true });
  const session = new Session(); session.connect();
  const post = (method: string, params: Record<string, unknown> = {}) => new Promise<{ profile?: object }>((resolve, reject) =>
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result as { profile?: object })));
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 100 });
  await post('Profiler.start');
  for (let i = 0; i < 100; i++) {
    const h = await loadHeadless('k34-workload', { suspension: 'jspi' });
    await h.stepAsync(300);
    expect(h.logs).toContain('guest: k34 workload checksum 88bf80fb');
  }
  const { profile } = await post('Profiler.stop');
  writeFileSync(process.env.BGT_K34_PROFILE ?? join(dir, 'k34.cpuprofile'), JSON.stringify(profile));
  session.disconnect();
});
