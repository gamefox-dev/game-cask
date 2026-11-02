// @bgt-examples: x64-gl-blit
import { expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP as O } from '../../bgt/runtime/abi';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

it('blit profile validates GL errors and preserves ordered rectangles/aspects in transport', async () => {
  buildGame('examples/x64-gl-blit',{quiet:true});
  const stream=glStream(),h=await loadHeadless('x64-gl-blit',stream);
  for(let i=0;i<160&&!h.logs.some(l=>l.includes('x64-gl-blit PASS'));i++)await h.stepAsync(1);
  const failures=h.logs.filter(l=>l.includes('x64-gl-blit FAIL'));
  // Recorder never rasterizes: exactly these GPU-dependent checks fail, and no contract check may fail.
  expect(failures.map(l=>l.replace('guest: x64-gl-blit FAIL ',''))).toEqual([
    'scaled bottom left','scaled bottom right','scaled top left','scaled top right','source flipped','destination flipped',
    'scissor untouched','linear interior ignores masks','linear interpolated','source clipped mapping','ordered repeat',
    'source stencil region before blit','stencil scissor preserves outside','stencil scissor updates inside',
    'stencil blit preserves depth','stencil transferred bits','stencil distinct region rejected',
    'stencil rendered region transferred','depth transferred','depth blit preserves stencil','one to one copy',
    'same image snapshot','default round trip',
  ]);
  expect(h.logs.some(l=>l.includes('x64-gl-blit PASS failures=23 checks=46'))).toBe(true);
  for(const label of ['depth linear rejected','bad filter','bad mask','incomplete source','NONE read no-op','empty rectangle and scissor no-op'])
    expect(h.logs.some(l=>l.endsWith('ok '+label))).toBe(true);
  const blits=stream.items.filter(i=>i.op===O.BLIT);
  expect(new Set(blits.map(i=>i.words[12]))).toEqual(new Set([1,2,4,6]));
  expect(blits.some(i=>i.words[13]===1)).toBe(true);
  expect(blits.some(i=>i.words[4]>i.words[6])).toBe(true);
  expect(blits.some(i=>i.words[0]===0)).toBe(true);
  expect(blits.some(i=>i.words[2]===0)).toBe(true);
  expect(h.host.commandErrorCount).toBe(0);
},120000);
