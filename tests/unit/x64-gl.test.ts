// @bgt-examples: x64-gl
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../support/headless';
import { glStream, gpuDigest } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { importStatus } from '../../tools/x86/imports-coverage.mjs';

it('x64-gl: seven lifted scenes produce valid §13 ops, cached state and portable binding slots', async () => {
  const stream = glStream();
  const h = await loadHeadless('x64-gl', stream);
  await h.stepAsync(45);
  expect(h.logs.filter((s) => /command error|unexpected|failed|incomplete/.test(s))).toEqual([]);
  expect(h.host.commandErrorCount).toBe(0);
  expect(h.logs.some((s) => s.includes('x64-gl PASS scenes=7')) , h.logs.join('\n')).toBe(true);
  expect(h.logs.some((s) => s.includes('errors=0500,0501,0502,0501 cleared'))).toBe(true);
  expect(h.logs.some((s) => s.includes('readback=8,0'))).toBe(true);
  const m = h.host.metrics() as Record<string, any>;
  expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]);
  expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_calls).toBeGreaterThan(100); expect(m.gl_state_changes).toBeGreaterThan(50);
  expect(m.gl_draws).toBeGreaterThan(100);
  // Triangle/strip + blend + stencil-equality states; retained blend factors stay immutable while disabled.
  expect(m.gl_pipelines).toBe(5);
  const ops = (op: number) => stream.items.filter((it) => it.op === op);
  expect(ops(O.PIPELINE_CREATE)).toHaveLength(5);
  expect(ops(O.DRAW).length + ops(O.DRAW_INDEXED).length).toBe(m.gl_draws);
  expect(ops(O.DRAW_INDEXED).length).toBeGreaterThan(ops(O.DRAW).length);
  expect(ops(O.DRAW_INDEXED).some((it) => it.words[1] === 3)).toBe(true);
  const draws = stream.items.filter((it) => it.op === O.DRAW || it.op === O.DRAW_INDEXED);
  expect(draws.slice(0, 7).map((it) => [it.op, ...it.words])).toEqual([
    [O.DRAW_INDEXED, 3, 1, 0, 0, 0], [O.DRAW_INDEXED, 3, 1, 0, 0, 0],
    [O.DRAW_INDEXED, 6, 1, 0, 0, 0], [O.DRAW, 4, 1, 0, 0],
    [O.DRAW_INDEXED, 6, 3, 0, 0, 0], [O.DRAW, 4, 3, 0, 0], [O.DRAW_INDEXED, 6, 3, 0, 0, 0],
  ]);
  const textureUploads = ops(O.TEXTURE_UPDATE);
  expect([...textureUploads[0].data!]).toEqual([
    0, 0, 255, 128, 255, 255, 255, 128, 255, 0, 0, 128, 0, 255, 0, 128,
  ]); // GL bottom-up upload converted to BGT top-down
  // glGenerateMipmap is now a GPU-side §13.7 operation: the profile uploads level 0 only.
  expect(textureUploads).toHaveLength(1);
  expect(ops(O.TEXTURE_GENERATE_MIPS).map((it) => it.words)).toEqual([[1, 0]]);
  expect(ops(O.PASS_BEGIN)).toHaveLength(ops(O.PASS_END).length);
  expect(ops(O.PASS_BEGIN).some((it) => it.words[7] !== 0)).toBe(true);
  for (const p of ops(O.PIPELINE_CREATE)) {
    expect(p.words[21]).toBe(3); // profile uniform slot 0, Scene block slot 1
    expect(p.words[22]).toBe(1); // texture slot 0, independent of GL unit 2
    expect(p.words[7]).toBe(1); expect(p.words[10]).toBe(1); // depth + stencil
    expect(p.words.slice(23, 26)).toEqual([2, 3, 1]); // shared interleaved VBO plus instance buffer
  }
  expect(new Set(ops(O.UNIFORM_BUFFER).map((it) => it.words[0]))).toEqual(new Set([0, 1]));
  expect(ops(O.TEXTURE).every((it) => it.words[0] === 0)).toBe(true);
  expect(stream.readbacks).toBe(2);
  const sources = ops(O.SHADER_CREATE).map((it) => it.source);
  expect(sources.every((s) => s?.startsWith('#version 330 core\n'))).toBe(true);
  expect(sources.some((s) => s?.includes('uniform bgt_u1'))).toBe(true);
  expect(sources.some((s) => s?.includes('tc+=vec2(1.25e-2)'))).toBe(true);
  expect(sources.some((s) => s?.includes('sprite,0.0,1.0)'))).toBe(true);
  expect(sources.some((s) => /0 \\. 0/.test(s ?? ''))).toBe(false);
  expect(new Set(ops(O.UNIFORM_BUFFER).filter((it) => it.words[0] === 1).map((it) => it.words[3])))
    .toEqual(new Set([16, 32]));
  expect(sources.some((s) => s?.includes('sampler2D bgt_t0'))).toBe(true);
  // Real WebGPU rejects the old #define-based lowering. Both backends accept ordinary GLSL.
  expect(sources.every(s => !s?.includes('#define'))).toBe(true);
  expect(sources.some(s => s?.includes('texture(bgt_t0,bgt_gl_uv(coords()))'))).toBe(true);
  expect(sources.some((s) => s?.includes('gl_Position.z=(gl_Position.z+gl_Position.w)*0.5'))).toBe(true);
  expect(importStatus('wglCreateContext', 'opengl32.dll').status).toBe('implemented');
  expect(importStatus('glDrawElements', 'opengl32.dll').status).toBe('implemented');
  expect(importStatus('glTexBuffer', 'opengl32.dll').status).toBe('stub');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'web/public/games/x64-gl/manifest.json'), 'utf8'));
  expect(manifest.pipeline.fixture).toMatchObject({ normalCrt: true, optimization: '-O2' });
  buildGame('examples/x64-gl', { interpretOnly: true, quiet: true });
  const report = await oracle('x64-gl', 300);
  expect(report.identical).toBe(true); expect(report.errors).toEqual({ lifted: null, interpreted: null });
  expect((report.metrics.lifted as any).gl_draws).toBeGreaterThan(1000);
  expect((report.metrics.lifted as any).interp_insns).toBe(0);
  expect((report.metrics.interpreted as any).interp_insns).toBeGreaterThan(0);
  expect(report.hashes.lifted).toMatch(/^[0-9a-f]+:[0-9a-f]{8}$/);
}, 180_000);


it('x64-gl32: stdcall/doubles/aliases, sticky errors and visible unsupported entries', async () => {
  buildGame('tests/fixtures/x64-gl32', { quiet: true });
  const stream = glStream(), h = await loadHeadless('x64-gl32', stream);
  await h.stepAsync(10);
  expect(h.logs.some((s) => s.includes('x64-gl32 PASS')), h.logs.join('\n')).toBe(true);
  expect(h.host.commandErrorCount).toBe(0);
  const clear = stream.items.find((it) => it.op === O.PASS_BEGIN)!;
  const float = (w: number) => new Float32Array(new Uint32Array([w]).buffer)[0];
  expect(float(clear.words[5])).toBe(0.25);
  expect(clear.words.slice(10).map(float)).toEqual([0.25, 0.5, 0.75, 1]);
  const metrics = h.host.metrics() as Record<string, any>;
  expect(metrics.gl_unimplemented).toBe(2);
  expect(metrics.gl_stubs).toEqual(['glTexBuffer', 'glDefinitelyNotAnEntry']);
  expect(metrics.interp_insns).toBe(0);
}, 120_000);


it('GPU digest ignores transport addresses but detects uniforms, uploads and source changes', () => {
  const item = { kind: 'gpu' as const, op: O.BUFFER_UPDATE, words: [700, 0, 1024, 4],
    data: new Uint8Array([0, 0, 128, 63]) };
  const hash = gpuDigest([item]);
  expect(gpuDigest([{ ...item, words: [700, 0, 4096, 4] }])).toBe(hash);
  expect(gpuDigest([{ ...item, data: new Uint8Array([0, 0, 0, 63]) }])).not.toBe(hash);
  expect(gpuDigest([{ ...item, words: [700, 16, 1024, 4] }])).not.toBe(hash);
  expect(gpuDigest([{ ...item, source: 'different source' }])).not.toBe(hash);
});


it('x64-gl: backend compile failure reaches GL compile status and info log without creating a pipeline', async () => {
  const stream = glStream(-6, 'synthetic backend compilation failure');
  const h = await loadHeadless('x64-gl', stream); await h.stepAsync(15);
  expect(h.logs.some((s) => s.includes('synthetic backend compilation failure')), h.logs.join('\n')).toBe(true);
  expect(h.logs.some((s) => s.includes('shader compile failed'))).toBe(true);
  expect(h.logs.some((s) => s.includes('PASS scenes'))).toBe(false);
  expect(stream.items.filter((it) => it.op === O.PIPELINE_CREATE)).toEqual([]);
  expect(h.host.commandErrorCount).toBe(0);
});

it('x64-gl: absent GPU capability visibly declines WGL rather than pretending to draw', async () => {
  const h = await loadHeadless('x64-gl'); await h.stepAsync(10);
  expect(h.logs.some((s) => s.includes('x64-gl GPU unavailable')), h.logs.join('\n')).toBe(true);
  expect((h.host.metrics() as any).gl_draws).toBe(0);
  expect(h.host.commandErrorCount).toBe(0);
});
