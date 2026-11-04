// @bgt-examples: x64-gl-capacity
// Original CC0-1.0. Before Q62 this fails at the 256th name; no simulated rasterization claim.
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
it('full GLuint names, ABI capacity, deletion generations and porter-visible exhaustion metrics', async () => {
  const stream = glStream(), h = await loadHeadless('x64-gl-capacity', stream);
  for (let i = 0; i < 150 && !h.logs.some(l => /x64-gl-capacity (PASS|FAIL) failures=/.test(l)); i++) await h.stepAsync(1);
  expect(h.logs.some(l => /x64-gl-capacity (PASS|FAIL) failures=/.test(l)), h.logs.join('\n')).toBe(true);
  const fails = h.logs.filter(l => l.includes('x64-gl-capacity FAIL ') && !l.includes('failures='));
  expect(fails.map(l => l.replace(/^guest: /, '')).sort()).toEqual([
    'late texture and buffer pixel', 'delete regen pixel', 'full GLuint pixel',
  ].map(l => 'x64-gl-capacity FAIL ' + l).sort());
  expect(h.host.commandErrorCount).toBe(0);
  const m = h.host.metrics() as Record<string, any>;
  expect(m.interp_insns).toBe(0); expect(m.gl_stubs).toEqual([]);
  expect(m.gl_objects.textures).toMatchObject({ peak: 1023, failures: 2, failed_requests: 2 });
  expect(m.gl_objects.buffers).toMatchObject({ peak: 1024, failures: 0, failed_requests: 0 });
  for (const kind of ['vaos', 'samplers', 'fbos', 'rbos', 'gl_queries', 'shaders', 'programs']) expect(m.gl_objects[kind].peak).toBeGreaterThanOrEqual(600);
  expect(h.logs.filter(l => l.includes('GL_OUT_OF_MEMORY object=')).length).toBe(2);
  const textures = stream.items.filter(i => i.op === O.TEXTURE_CREATE_EX).map(i => i.words[0]);
  expect(textures).toContain(1023); expect(textures.some(n => n >= 900 && n <= 921)).toBe(false);
  const buffers = stream.items.filter(i => i.op === O.BUFFER_CREATE).map(i => i.words[0]);
  expect(buffers).toContain(1022); expect(buffers.some(n => n >= 1000 && n <= 1006)).toBe(false);
}, 600000);
