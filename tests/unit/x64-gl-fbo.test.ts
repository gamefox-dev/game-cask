// @bgt-examples: x64-gl-fbo
import { expect, it } from 'vitest';
import { loadHeadless, type Headless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU, GPU_OP as O } from '../../bgt/runtime/abi';

// Content that depends on rasterization cannot be known to the recording backend; real pixels are asserted on
// WebGL 2 and WebGPU in tests/e2e/x64-gl-fbo.spec.ts. Everything else is checked here, byte for byte.
const RENDER_DEPENDENT = [
  'RGBA16F values above one survive', 'stencil-marked half is green', 'unmarked half keeps clear colour',
  'attachment 1 receives output 1', 'attachment 0 receives output 0',
  'clipped read preserves requested row stride',
  '3D mip chain average', 'array mip layers stay independent', // GPU-side box filter, asserted in the browser
];

// Shader compilation and texture readbacks yield to the host, so a fixed eight updates cannot reach setup.
async function startup(h: Headless) {
  for (let i = 0; i < 120; i++) {
    await h.stepAsync(1);
    if (h.logs.some(s => /x64-gl-fbo (PASS|FAIL) failures=/.test(s))) return;
  }
  throw new Error(`fixture did not finish startup:\n${h.logs.join('\n')}`);
}

it('x64-gl-fbo: GL error codes, completeness statuses and upload round trips match GL 3.3', async () => {
  const stream = glStream(), h = await loadHeadless('x64-gl-fbo', stream);
  await startup(h);
  await h.stepAsync(3);
  expect(h.logs.filter(s => s.includes('unexpected GL error'))).toEqual([]);
  expect(h.host.commandErrorCount).toBe(0);
  const notes = h.logs.map(s => s.replace(/^guest: /, ''))
    .filter(s => s.startsWith('x64-gl-fbo ok ') || s.startsWith('x64-gl-fbo FAIL '))
    .filter(s => !/ failures=/.test(s));
  expect(notes.length, h.logs.join('\n')).toBeGreaterThan(60);
  const failed = notes.filter((s) => s.startsWith('x64-gl-fbo FAIL ')).map((s) => s.slice(16));
  expect(failed.sort()).toEqual([...RENDER_DEPENDENT].sort());
  const m = h.host.metrics() as Record<string, any>;
  expect(m.interp_insns).toBe(0); expect(m.gl_unimplemented).toBe(0); expect(m.gl_stubs).toEqual([]);
  // Valid-but-unsupported GL 3.3 requests are counted and listed, never silently accepted.
  expect(m.gl_approximations).toBe(2);
  expect(m.gl_approximation_kinds).toEqual(['GL_CLAMP_TO_BORDER treated as CLAMP_TO_EDGE', 'GL_TEXTURE_LOD_BIAS ignored']);
});

it('x64-gl-fbo: §13.7 textures, explicit mip levels, depth storage and multi-attachment passes', async () => {
  const stream = glStream(), h = await loadHeadless('x64-gl-fbo', stream);
  await startup(h);
  await h.stepAsync(3);
  const guestLog = h.logs.join('\n');
  const ops = (op: number) => stream.items.filter((it) => it.op === op);
  // The depth texture is real DEPTH32F storage allocated with no upload.
  expect(ops(O.TEXTURE_CREATE_EX).some((it) => it.words.slice(1).join() === [0,64,64,1,7,GPU.FORMAT_DEPTH32F,3].join()),
    guestLog).toBe(true);
  // 3D (dimension 1) and 2D-array (dimension 2) textures go through the extended create/update.
  const created = ops(O.TEXTURE_CREATE_EX).map((it) => it.words.slice(1, 8));
  expect(created).toContainEqual([GPU.DIM_3D, 2, 2, 4, 3, GPU.FORMAT_RGBA8, 1]);
  expect(created).toContainEqual([GPU.DIM_2D_ARRAY, 2, 2, 2, 2, GPU.FORMAT_RGBA8, 1]);
  expect(created.some((c) => c[5] === GPU.FORMAT_RGB10A2)).toBe(true);
  expect(ops(O.TEXTURE_CREATE_EX).some(it => it.words.slice(1).join() === [0,8,8,1,4,GPU.FORMAT_RGBA16F,3].join())).toBe(true);
  // glTexSubImage3D uploads the single z=2 slice.
  expect(ops(O.TEXTURE_UPDATE_EX).some((it) => it.words[4] === 2 && it.words[7] === 1 && it.words[5] === 2)).toBe(true);
  // Explicit mip levels 0,1,2 are uploaded level by level with their own sizes (not generated).
  const mipUploads = ops(O.TEXTURE_UPDATE).filter((it) => it.data?.length === 64 || it.data?.length === 16 || it.data?.length === 4)
    .map((it) => [it.words[1], it.words[4], it.words[5]]);
  expect(mipUploads).toContainEqual([0, 4, 4]); expect(mipUploads).toContainEqual([1, 2, 2]);
  expect(mipUploads).toContainEqual([2, 1, 1]);
  // Only the 3D and array textures are generated; the explicit-level texture never is.
  expect(ops(O.TEXTURE_GENERATE_MIPS)).toHaveLength(2);
  expect(ops(O.TEXTURE_GENERATE_MIPS).every((it) => it.words[1] === 0)).toBe(true);
  // Pass shapes: depth-only (no colour), two colours, colour + depth-stencil.
  const passes = ops(O.PASS_BEGIN).map((it) => ({ colors: it.words[0], depth: it.words[1] }));
  expect(passes).toContainEqual({ colors: 0, depth: expect.any(Number) });
  expect(passes.some((p) => p.colors === 0 && p.depth !== 0)).toBe(true);
  expect(passes.some((p) => p.colors === 2)).toBe(true);
  expect(passes.some((p) => p.colors === 1 && p.depth !== 0)).toBe(true);
  expect(ops(O.PASS_BEGIN)).toHaveLength(ops(O.PASS_END).length);
  // Samplers: 3D wrap-R and non-default LOD use the extended sampler; plain ones stay legacy.
  expect(ops(O.SAMPLER_CREATE_EX).length).toBeGreaterThan(0);
  const sources = ops(O.SHADER_CREATE).map((it) => it.source ?? '');
  expect(sources.some((s) => s.includes('uniform sampler3D bgt_t0') && s.includes('bgt_gl_uv3('))).toBe(true);
  expect(sources.some((s) => s.includes('uniform sampler2DArray bgt_t0'))).toBe(true);
}, 120_000);
