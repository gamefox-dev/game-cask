// @bgt-examples: x64-gl-limits
// SPDX-License-Identifier: CC0-1.0. K51: the guest sees the device's real GL_MAX_UNIFORM_BLOCK_SIZE.
// Would catch a profile that still reports a fixed 65536 (or a validator/translator ignoring the device limit).
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
it.each([16384, 32768, 65536])('x64-gl-limits: device uniform range %i is the guest limit and binding size', async (limit) => {
  const stream = glStream();
  stream.gpuBackend = { ...stream.gpuBackend!, maxUniformRange: limit };
  const h = await loadHeadless('x64-gl-limits', stream);
  // Each compile/link waits for its backend completion on a later host frame: step until the pixel log.
  for (let i = 0; i < 60 && !h.logs.some(l => l.includes('x64-gl-limits default-pixel=')); i++) await h.stepAsync(1);
  expect(h.logs.filter(s => /FAIL|command error/.test(s)), h.logs.join('\n')).toEqual([]);
  expect(h.logs).toContain(`guest: x64-gl-limits uniform-block-limit=${limit}`);
  expect(h.logs).toContain(`guest: x64-gl-limits PASS checks limit=${limit} failures=0`);
  expect(h.host.commandErrorCount).toBe(0);
  // The user block binds exactly its linked std140 size (== limit), even though the guest bound twice that.
  const binds = stream.items.filter(i => i.op === O.UNIFORM_BUFFER).map(i => i.words.slice(0, 4).join(','));
  // Slot 1 also carries the split program's 32-byte profile block (below); the user block binds are the large ones.
  const user = stream.items.filter(i => i.op === O.UNIFORM_BUFFER && i.words[0] === 1 && i.words[3] > 32).map(i => i.words[3]);
  expect(user.length).toBeGreaterThan(0); expect(new Set(user)).toEqual(new Set([limit]));
  // 1023 default-block vec4s + sampler. Inline, the profile block is meta 16 + uniforms 16368 + swizzle 16 = 16400 bytes:
  // above a 16384 device limit, so there the guest uniforms stay alone in slot 0 (16368 bytes) and the meta vec4 plus
  // the swizzle ivec4 (32 bytes) split to slot 1 at the next 256-aligned offset, 16384, of the same buffer.
  // Larger devices keep the unchanged inline layout (one 16400-byte slot-0 binding, no split binding).
  const split = stream.items.filter(i => i.op === O.UNIFORM_BUFFER && i.words[0] === 1 && i.words[3] === 32);
  const slot0 = (size: number) => stream.items.some(i => i.op === O.UNIFORM_BUFFER && i.words[0] === 0 && i.words[3] === size);
  if (limit === 16384) {
    expect(split.length, binds.join(' ')).toBeGreaterThan(0); expect(split.every(i => i.words[2] === 16384)).toBe(true);
    expect(stream.items.some(i => i.op === O.UNIFORM_BUFFER && i.words[0] === 0 && i.words[1] === split[0].words[1] && i.words[3] === 16368)).toBe(true);
    expect(slot0(16400)).toBe(false);
  } else { expect(split, binds.join(' ')).toEqual([]); expect(slot0(16400)).toBe(true); }
  expect(h.logs).toContain('guest: x64-gl-limits ok 1023 default-block vec4 uniforms + sampler link');
  // The at-limit block and default-block programs reach the backend; the over-limit source never does.
  expect(stream.items.filter(i => i.op === O.PIPELINE_CREATE)).toHaveLength(2);
  const m = h.host.metrics() as Record<string, any>;
  expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
}, 60_000);
