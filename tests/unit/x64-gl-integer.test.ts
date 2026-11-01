// @bgt-examples: x64-gl-integer
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

it('integer profile preserves full-width storage and errors for all 18 classes without float conversion', async () => {
  buildGame('examples/x64-gl-integer', { quiet: true });
  const stream = glStream(), h = await loadHeadless('x64-gl-integer', stream);
  for (let i = 0; i < 250 && !h.logs.some(l => /failures=/.test(l)); i++) await h.stepAsync(1);
  const failures = h.logs.filter(l => /x64-gl-integer FAIL /.test(l) && !/failures=/.test(l));
  // Recorder never rasterizes: these 89 GPU-dependent checks must fail, and no others may fail.
  expect(failures).toHaveLength(89);
  for (const label of ['typed sampling pixel', 'integer swizzle pixel', 'integer output and readpixels', 'rendered GetTexImage'])
    expect(failures.filter(l => l.endsWith(label))).toHaveLength(18);
  for (const label of ['integer allocation', 'integer conversion upload', 'exact converted storage',
    'integer framebuffer complete', 'integer read class mismatch', 'integer upload class mismatch', 'integer final error'])
    expect(h.logs.filter(l => l.endsWith('ok ' + label))).toHaveLength(18);
  for (const label of ['indexed float masked center', 'indexed float untouched corner', 'permuted clear target',
    'unsigned masked indexed clear', 'unsigned clear untouched corner', 'signed masked indexed clear', 'signed clear untouched corner',
    'masked stencil and depth clear via tests', 'stencil clear outside scissor unchanged', 'finish current attribute pixel',
    'large depth growth preserves texel']) expect(failures.filter(l => l.endsWith('FAIL ' + label))).toHaveLength(1);
  for (const label of ['nonNULL depth upload sample', 'depth uploaded GetTexImage']) expect(failures.filter(l => l.endsWith(label))).toHaveLength(3);
  expect(h.host.commandErrorCount).toBe(0);
  const formats = new Set(stream.items.filter(i => i.op === O.TEXTURE_CREATE_EX).map(i => i.words[6]));
  for (let f = 13; f <= 30; f++) expect(formats.has(f)).toBe(true);
}, 120000);
