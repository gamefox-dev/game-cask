// @bgt-examples: x64-gl-limits
// SPDX-License-Identifier: CC0-1.0. K51: the guest sees the device's real GL_MAX_UNIFORM_BLOCK_SIZE.
// Would catch a profile that still reports a fixed 65536 (or a validator/translator ignoring the device limit).
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
it.each([16384, 32768, 65536])('x64-gl-limits: device uniform range %i is the guest limit and binding size', async (limit) => {
  const stream = glStream();
  stream.gpuBackend = { ...stream.gpuBackend, maxUniformRange: limit };
  const h = await loadHeadless('x64-gl-limits', stream);
  await h.stepAsync(6);
  expect(h.logs.filter(s => /FAIL|command error/.test(s)), h.logs.join('\n')).toEqual([]);
  expect(h.logs).toContain(`guest: x64-gl-limits uniform-block-limit=${limit}`);
  expect(h.logs).toContain(`guest: x64-gl-limits PASS checks limit=${limit} failures=0`);
  expect(h.host.commandErrorCount).toBe(0);
  // The user block binds exactly its linked std140 size (== limit), even though the guest bound twice that.
  const ranges = stream.items.filter(i => i.op === O.UNIFORM_BUFFER && i.words[0] === 1).map(i => i.words[3]);
  expect(ranges.length).toBeGreaterThan(0); expect(new Set(ranges)).toEqual(new Set([limit]));
  // Only the at-limit program reaches the backend; the over-limit source never becomes a pipeline.
  expect(stream.items.filter(i => i.op === O.PIPELINE_CREATE)).toHaveLength(1);
  const m = h.host.metrics() as Record<string, any>;
  expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
}, 60_000);
