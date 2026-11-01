import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { oracle } from '../oracle/oracle';
import { translateGLSL, glslVaryings, shaderBindings } from '../../bgt/renderers/webgpu/shaders';
import { translateShader } from '../../bgt/renderers/webgl2/shaders';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

it('x64-glsl: lifted guest asserts GL 3.3 reflection and diagnostics; every translated stage passes both frontends', async () => {
  buildGame('examples/x64-glsl', { quiet: true });
  const stream = glStream();
  const h = await loadHeadless('x64-glsl', stream);
  for (let frame = 0; frame < 100 && !h.logs.some(s => s.includes('x64-glsl PASS tiles=8')); frame++)
    await h.stepAsync(1);
  await h.stepAsync(4); // Four complete draw frames after shader/reflection startup, not a fixed boot-frame guess.
  expect(h.logs.filter((s) => /command error|unexpected|failed|incomplete|wrong|missing|unexpectedly/.test(s))).toEqual([]);
  expect(h.host.commandErrorCount).toBe(0);
  for (const text of ['x64-glsl diagnostics ok', 'x64-glsl reflection ok', 'x64-glsl PASS tiles=8'])
    expect(h.logs.some((s) => s.includes(text)), h.logs.join('\n')).toBe(true);
  const m = h.host.metrics() as Record<string, any>;
  expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]); expect(m.exited).toBe(0);
  expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_pipelines).toBe(8); expect(m.gl_draws).toBeGreaterThanOrEqual(8 * 4);
  const sources = stream.items.filter((it) => it.op === O.SHADER_CREATE).map((it) => ({ stage: it.words[1], source: it.source! }));
  // 15 provisional compiles (including split-source and unnamed-block probes), eight tile links,
  // and the two modules of the temporary unnamed-block reflection program.
  expect(sources.length).toBe(15 + 16 + 2);
  const varyings = [...new Set(sources.flatMap((s) => glslVaryings(s.source, s.stage)))].sort();
  for (const { stage, source } of sources) {
    expect(source.startsWith('#version 330 core\n')).toBe(true);
    expect(source).not.toMatch(/#define|#if|precision|\bnever_used\b|\bunused_attr\b|\bghost\b/);
    const wgsl = translateGLSL(source, stage, 1, varyings);
    expect(shaderBindings(wgsl).length).toBeGreaterThan(0);
    expect(() => translateShader(source, stage, 1)).not.toThrow();
  }
  // Ordinary uniforms are a single std140 block at slot 0; user blocks use slots 1..7; samplers become bgt_tN.
  const pipelines = stream.items.filter((it) => it.op === O.PIPELINE_CREATE);
  expect(pipelines).toHaveLength(8);
  expect(pipelines.map((p) => p.words[21]).sort()).toEqual([1, 1, 1, 1, 1, 1, 1, 3].sort());
  expect(pipelines.filter((p) => p.words[22] === 3)).toHaveLength(1);       // tile 3 samples two slots
  expect(sources.some((s) => s.source.includes('layout(std140) uniform bgt_u1 {'))).toBe(true);
  expect(sources.some((s) => s.source.includes('uniform sampler2D bgt_t0; uniform sampler2D bgt_t1;'))).toBe(true);
  buildGame('examples/x64-glsl', { interpretOnly: true, quiet: true });
  const report = await oracle('x64-glsl', 300);
  expect(report.identical).toBe(true); expect(report.errors).toEqual({ lifted: null, interpreted: null });
  expect((report.metrics.lifted as any).interp_insns).toBe(0);
  expect((report.metrics.interpreted as any).interp_insns).toBeGreaterThan(0);
}, 240_000);

it('x64-glsl: a backend compile failure reaches the GL info log and stops the guest cleanly', async () => {
  const stream = glStream(-6, 'synthetic backend failure');
  const h = await loadHeadless('x64-glsl', stream); await h.stepAsync(15);
  expect(h.logs.some((s) => s.includes('synthetic backend failure')), h.logs.join('\n')).toBe(true);
  expect(h.logs.some((s) => s.includes('shader failed to compile'))).toBe(true);
  expect(h.logs.some((s) => s.includes('PASS tiles'))).toBe(false);
  expect(stream.items.filter((it) => it.op === O.PIPELINE_CREATE)).toEqual([]);
});
