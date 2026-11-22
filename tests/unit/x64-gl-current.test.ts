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
  // K60: draws carry the 256-byte current-attribute block as the tail of their program's uniform upload (bound as
  // the constant vertex slot). K67 (Q115): instanced draws too: the constant slot has stride 0, so one tail serves
  // every instance and the private per-instance buffer 1023 (a synchronous upload, 2 ABI submits) is never written.
  const f32 = (d: Uint8Array) => Array.from(new Float32Array(d.buffer, d.byteOffset, d.length / 4));
  const constantSlots = new Set<string>();
  for (const i of stream.items) if (i.op === O.VERTEX_BUFFER && i.words[1] !== 1023 && i.words[3] === 256) constantSlots.add(`${i.words[1]}:${i.words[2]}`);
  const tails = stream.items.filter(i => i.op === O.BUFFER_UPDATE && i.words[0] !== 1023 &&
    constantSlots.has(`${i.words[0]}:${i.words[1] + i.data!.length - 256}`)).map(i => f32(i.data!).slice(-64));
  expect(tails.some(v => v.slice(12, 16).join() === '0,0,0,1')).toBe(true);
  expect(tails.some(v => v.slice(12, 16).join() === '0.25,0,0,1')).toBe(true);
  expect(tails.some(v => v.slice(12, 16).join() === '0.25,0.5,0.75,0.5')).toBe(true); // Win64 fifth argument
  expect(tails.some(v => v.slice(12, 16).join() === '0.5,1,0.25,1')).toBe(true); // the instanced draw's constant
  expect(stream.items.some(i => (i.op === O.BUFFER_UPDATE || i.op === O.BUFFER_CREATE) && i.words[0] === 1023)).toBe(false);
  // Every pipeline's constant slot (the one bound to a tail) has stride 0; the instanced draw binds 256 bytes, not 3 x 256.
  const instancedDraw = stream.items.findIndex(i => (i.op === O.DRAW || i.op === O.DRAW_INDEXED) && i.words[1] === 3);
  expect(instancedDraw).toBeGreaterThan(0);
  const before = stream.items.slice(0, instancedDraw).reverse();
  const pipe = before.find(i => i.op === O.PIPELINE)!.words[0];
  const layout = [...stream.items].reverse().find(i => i.op === O.PIPELINE_CREATE && i.words[0] === pipe && stream.items.indexOf(i) < instancedDraw)!.words;
  const slots = Array.from({ length: layout[23] }, (_, k) => [layout[26 + k * 2], layout[27 + k * 2]]);
  expect(slots.some(([stride, step]) => stride === 0 && step === 1)).toBe(true);
  const shaders = stream.items.filter(i => i.op === O.SHADER_CREATE).map(i => i.source ?? '').join('\n');
  for (const fn of ['texture(', 'textureLod(', 'textureGrad(', 'texelFetch(']) expect(shaders).toContain(`bgt_gl_sw0(${fn}`);
  const uniforms = stream.items.filter(i => i.op === O.BUFFER_UPDATE && i.words[0] !== 1023);
  const ints = (d: Uint8Array) => Array.from(new Int32Array(d.buffer, d.byteOffset, d.length / 4));
  expect(uniforms.some(i => { const v = ints(i.data!); return v.slice(-4).join() === '4,0,5,1' || v.slice(-68, -64).join() === '4,0,5,1'; })).toBe(true);
}, 120000);
