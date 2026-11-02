// @bgt-examples: x64-gl-ranges
import {it,expect} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
import {GPU_OP as O,GPU_LIMITS,GPU_CONTINUATION_LIMITS} from '../../bgt/runtime/abi';
// @ts-expect-error plain ESM
import {buildGame} from '../../tools/build/build.mjs';
it('per-program std140 sizes, exact mapped ranges, counted zero-tail approximation and thousands of ordered lists',async()=>{
 buildGame('examples/x64-gl-ranges',{quiet:true});const stream=glStream();let max=0;
 const h=await loadHeadless('x64-gl-ranges',{...stream,executeFrame:frame=>{max=Math.max(max,frame.continuationSubmits);stream.executeFrame!(frame);}});
 for(let i=0;i<180&&!h.logs.some(l=>l.includes('x64-gl-ranges PASS'));i++){
   await h.stepAsync(1);
 }
 const failures=h.logs.filter(l=>l.includes('x64-gl-ranges FAIL')).map(l=>l.replace('guest: x64-gl-ranges FAIL ',''));
 expect(failures).toEqual(['MRT absent zero preserved','MRT one written','MRT absent two preserved','MRT three written','MRT color mask intersected','MRT blue mask','MRT absent mask preserved','empty fragment keeps color','80 base bytes','176 base bytes','192 base bytes','odd range zero tail','offset exact linked bytes','relinked range','two blocks independent slots','two blocks independent slots','3000 exact audit words','ping pong final word','generated odd-byte copy','generated undersized UBO prefix and zero tail']);
 const summary=h.logs.find(l=>l.includes('x64-gl-ranges PASS'));expect(summary).toMatch(/x64-gl-ranges PASS failures=20 checks=\d+/);
 console.info(summary,`peak continuation submissions=${max}`);
 expect(h.host.commandErrorCount).toBe(0);expect(max).toBeGreaterThan(6000);
 const ranges=stream.items.filter(i=>i.op===O.UNIFORM_BUFFER&&i.words[0]===1).map(i=>i.words.slice(2));
 expect(ranges).toContainEqual([0,80]);expect(ranges).toContainEqual([0,176]);expect(ranges).toContainEqual([0,192]);expect(ranges).toContainEqual([256,192]);
 expect(ranges.some(w=>w[1]===191||w[1]===193||w[1]===800)).toBe(false);
 expect(stream.items.filter(i=>i.op===O.FEEDBACK_CAPTURE)).toHaveLength(3001);
 expect(stream.items.some(i=>i.op===O.BUFFER_COPY&&i.words[2]===1000&&i.words[4]===4)).toBe(true);
 expect(stream.items.some(i=>i.op===O.BUFFER_DELETE&&i.words[0]===1000)).toBe(true);
 expect(h.logs.filter(l=>l.includes('GL undefined uniform block range zero-filled:')).length).toBe(2);
},120000);
it.each(['upload','wire','uniform'])('partial materialization %s limit retires generated private buffers before source removal',async mode=>{
 buildGame('examples/x64-gl-ranges',{quiet:true});const stream=glStream();let injected=false;
 const h:Awaited<ReturnType<typeof loadHeadless>>=await loadHeadless('x64-gl-ranges',{...stream,onLog:message=>{
   if(message.includes('inject partial materialization limit')){
     injected=true;if(mode==='upload')h.host.frame.gpuUploadBytes=GPU_LIMITS.budget-64;
     else if(mode==='uniform')h.host.frame.gpuUploadBytes=GPU_LIMITS.budget-392;
     else h.host.frame.commandBytes=GPU_CONTINUATION_LIMITS.bytes-128;
   }
   if(message.includes('inject rejected full upload'))h.host.frame.gpuUploadBytes=GPU_LIMITS.budget;
   if(message.includes('restore materialization budget')){h.host.frame.gpuUploadBytes=0;h.host.frame.commandBytes=0;}
 }});h.key('F9',true);
 for(let i=0;i<180&&!h.logs.some(l=>l.includes('failure case done'));i++)await h.stepAsync(1);
 expect(injected).toBe(true);expect(h.logs.some(l=>l.includes('failure case done'))).toBe(true);
 expect(h.logs.filter(l=>l.includes('x64-gl-ranges FAIL')).map(l=>l.replace('guest: x64-gl-ranges FAIL ',''))).toEqual(['failed full upload retains native prefix']);
 expect(h.logs.some(l=>l.includes('ok materialization limit surfaced'))).toBe(true);
 expect(h.logs.some(l=>l.includes('ok generated app source deleted'))).toBe(true);
 expect(stream.items.filter(i=>i.op===O.BUFFER_DELETE&&i.words[0]===1000)).toHaveLength(3);
 expect(h.host.commandErrorCount).toBeGreaterThan(0);
},120000);
