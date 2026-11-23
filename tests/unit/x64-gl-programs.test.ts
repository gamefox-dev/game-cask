// @bgt-examples: x64-gl-programs
// SPDX-License-Identifier: CC0-1.0. Real GL profile path (K70, Q126) on the recording backend: the program-startup
// fixture compiles 48 stages and links 24 programs before its first present, each compile/link stage module and
// glReadPixels a blocking request result that the guest polls with time-neutral transport yields. Breakage caught:
// a profile that stops polling (results read before they exist), a startup that presents or advances guest time
// while waiting (the burst could not continue), lost or extra shader modules. Page-loop waiting and pixels on both
// browser backends: tests/e2e/gl-programs.spec.ts.
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';

it('x64-gl-programs: 48 compiles + 24 links polled as time-neutral transport waits before the first present', async () => {
  const stream = glStream();
  const h = await loadHeadless('x64-gl-programs', stream);
  const done = () => h.logs.find(l => l.includes('gl-programs done'));
  for (let i = 0; i < 2000 && !done(); i++) await h.stepAsync(1);
  expect(done(), h.logs.join('\n')).toMatch(/gl-programs done programs=24 compiled=48 linked=24 pixels=\d+ fnv=[0-9a-f]{8} error=0x0 ticks=0 /);
  const m = h.host.metrics() as { guest_time?: { neutral_yields?: number | string } };
  // Every blocking result costs at least one time-neutral yield (2 compiles, 2 link modules, 1 readback per program).
  expect(Number(m.guest_time?.neutral_yields ?? 0)).toBeGreaterThanOrEqual(24 * 4);
  // 48 compile-time modules + 48 link-time stage modules, each with its own request.
  expect(stream.items.filter(i => i.op === O.SHADER_CREATE)).toHaveLength(96);
  await h.stepAsync(130);
  expect(h.logs.some(l => l.includes('gl-programs frame presents=120'))).toBe(true);
});
