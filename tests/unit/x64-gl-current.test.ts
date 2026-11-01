// @bgt-examples: x64-gl-current
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

it('current float attributes and swizzles lower to owned per-draw data, with real API errors', async () => {
  buildGame('examples/x64-gl-current', { quiet: true });
  const stream = glStream(), h = await loadHeadless('x64-gl-current', stream);
  for (let i = 0; i < 120 && !h.logs.some(l => /x64-gl-current (PASS|FAIL) failures=/.test(l)); i++) await h.stepAsync(1);
  expect(h.logs.some(l => /x64-gl-current (PASS|FAIL) failures=/.test(l)), h.logs.join('\n')).toBe(true);
  await h.stepAsync(3);
  // The recorder does not rasterize. All 19 pixel checks deliberately fail here and MUST pass on actual backends.
  const failures = h.logs.filter(l => /x64-gl-current FAIL /.test(l) && !/failures=/.test(l));
  expect(failures.map(l => l.replace(/^guest: /, '')).sort()).toEqual(
    [...Array.from({ length: 16 }, (_, i) => `x64-gl-current FAIL pixel ${i}`),
      'x64-gl-current FAIL instance zero distinct pixel', 'x64-gl-current FAIL instance two distinct pixel',
      'x64-gl-current FAIL incomplete texture ignores object swizzle'].sort());
  for (const label of ['setup errors', 'invalid current index', 'invalid vector index before pointer read',
    'atomic invalid swizzle vector', 'invalid swizzle preserves vector', 'swizzle does not mutate storage', 'parameter errors'])
    expect(h.logs.some(l => l.includes(`x64-gl-current ok ${label}`)), label).toBe(true);
  expect(h.host.commandErrorCount).toBe(0);
  const m = h.host.metrics() as Record<string, any>;
  expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_approximations).toBe(0);
  const current = stream.items.filter(i => i.op === O.BUFFER_UPDATE && i.words[0] === 1023);
  const values = current.map(i => Array.from(new Float32Array(i.data!.buffer, i.data!.byteOffset, i.data!.length / 4)));
  expect(values.some(v => v.slice(12, 16).join() === '0,0,0,1')).toBe(true);
  expect(values.some(v => v.slice(12, 16).join() === '0.25,0,0,1')).toBe(true);
  expect(values.some(v => v.slice(12, 16).join() === '0.25,0.5,0.75,0.5')).toBe(true); // Win64 fifth argument
  expect(values.some(v => v.length === 192 && [0, 64, 128].every(at => v.slice(at + 12, at + 16).join() === '0.5,1,0.25,1'))).toBe(true);
  const shaders = stream.items.filter(i => i.op === O.SHADER_CREATE).map(i => i.source ?? '').join('\n');
  for (const fn of ['texture(', 'textureLod(', 'textureGrad(', 'texelFetch(']) expect(shaders).toContain(`bgt_gl_sw0(${fn}`);
  const uniforms = stream.items.filter(i => i.op === O.BUFFER_UPDATE && i.words[0] !== 1023);
  expect(uniforms.some(i => Array.from(new Int32Array(i.data!.buffer, i.data!.byteOffset, i.data!.length / 4)).slice(-4).join() === '4,0,5,1')).toBe(true);
}, 120000);
