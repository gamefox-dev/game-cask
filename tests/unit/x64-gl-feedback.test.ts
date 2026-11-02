// @bgt-examples: x64-gl-feedback
import {it,expect} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
import {GPU_OP as O} from '../../bgt/runtime/abi';
// @ts-expect-error plain ESM
import {buildGame} from '../../tools/build/build.mjs';
it('GL feedback emits exact interface/order/ranges and all non-GPU-dependent errors pass',async()=>{
  buildGame('examples/x64-gl-feedback',{quiet:true});const stream=glStream(),h=await loadHeadless('x64-gl-feedback',stream);
  for(let i=0;i<200&&!h.logs.some(l=>l.includes('x64-gl-feedback PASS'));i++)await h.stepAsync(1);
  const failures=h.logs.filter(l=>l.includes('x64-gl-feedback FAIL')).map(l=>l.replace('guest: x64-gl-feedback FAIL ',''));
  expect(failures).toEqual(['interleaved exact bytes','range prefix preserved','range suffix preserved','discard preserved black','separate exact positions','separate exact integer IDs','incomplete line ignored','triangle strip winding','line strip ordering','indexed capture order','original clip position','signed exact bytes','original point size','builtin names hygienic','capture raster red','GPU ping pong ordering','partial GPU update preserves neighbors','failed link retains current executable','failed link uniform update','ES integer divisor exact bytes','former UBO becomes feedback','byte aligned normalized capture','byte aligned normalized capture','byte aligned normalized capture','captured draw red','captured draw outside black']);
  expect(h.logs.some(l=>l.includes('x64-gl-feedback PASS failures=26 checks=92'))).toBe(true);
  expect(h.host.commandErrorCount).toBe(0);
  const layouts=stream.items.filter(i=>i.op===O.FEEDBACK_VARYINGS);expect(layouts.some(i=>i.words[1]===0)).toBe(true);expect(layouts.some(i=>i.words[1]===1)).toBe(true);
  expect(layouts.some(i=>i.source==='bgt_tf_position_001 3\nsigned_value 6\nbgt_tf_point_size 0\nbgt_tf_position 3\n')).toBe(true);
  expect(stream.items.some(i=>i.op===O.FEEDBACK_CAPTURE&&i.words[0]===0)).toBe(true);
  expect(stream.items.some(i=>i.op===O.FEEDBACK_CAPTURE&&i.words[0]===1)).toBe(true);
  expect(stream.items.filter(i=>i.op===O.BUFFER_READBACK).length).toBeGreaterThan(12);
},120000);
