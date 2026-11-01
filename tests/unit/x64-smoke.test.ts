// @bgt-examples: x64-smoke
import { it, expect } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

it('x64-smoke: fully lifted 600-frame GL/worker/WASAPI/XInput/file loop and identical semantic oracle', async () => {
  const h = await loadHeadless('x64-smoke',glStream()); await h.stepAsync(620);
  expect(h.logs.some(l => /x64-smoke PASS frames=600 worker=8599ce32 files=2 pad=0 buttons=0 audio=joined/.test(l)),
    h.logs.join('\n')).toBe(true);
  expect(h.host.commandErrorCount).toBe(0);
  const m=h.host.metrics() as Record<string,any>;
  expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]); expect(m.gl_draws).toBe(6000);
  buildGame('examples/x64-smoke', { quiet:true, interpretOnly:true });
  const r=await oracle('x64-smoke',600);
  expect(r.frames).toBe(600); expect(r.identical).toBe(true);
  expect(r.errors).toEqual({lifted:null,interpreted:null});
  expect((r.metrics.lifted as any).gl_draws).toBe(6000);
  expect((r.metrics.lifted as any).interp_insns).toBe(0);
},180_000);
