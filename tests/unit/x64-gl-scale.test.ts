// @bgt-examples: x64-gl-scale
// Original CC0-1.0. Recording transport never rasterizes; native pixels are separate browser gates.
import {expect,it} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
it('12,000 object demand, churn and counted real budget failure traverse the actual Win64 profile',async()=>{
 const stream=glStream(),h=await loadHeadless('x64-gl-scale',stream);
 for(let i=0;i<300&&!h.logs.some(l=>/x64-gl-scale (PASS|FAIL) failures=/.test(l));i++)await h.stepAsync(1);
 expect(h.logs.some(l=>/x64-gl-scale (PASS|FAIL) failures=/.test(l)),h.logs.join('\n')).toBe(true);
 const fails=h.logs.filter(l=>l.includes('x64-gl-scale FAIL ')&&!l.includes('failures=')).map(l=>l.replace(/^guest: /,''));
 expect(fails.sort()).toEqual(['late red pixel','retained late green pixel','mapped late blue pixel','churn late blue pixel','churn late blue pixel','churn late blue pixel','post exhaustion blue pixel','high feedback exact bytes','high feedback range sentinels','late UBO blue pixel'].map(s=>'x64-gl-scale FAIL '+s).sort());
 expect(h.host.commandErrorCount).toBe(1);expect(h.host.commandErrors).toHaveLength(1);expect(h.host.commandErrors[0]).toMatchObject({code:-3,op:0x40});
 const m=h.host.metrics() as Record<string,any>;
 expect(m.gl_objects.buffers).toMatchObject({peak:12002,failures:1,failed_requests:1});expect(m.gl_objects.vaos).toMatchObject({peak:12000,failures:0,failed_requests:0});
 expect(m.gl_draws).toBeGreaterThanOrEqual(12007);expect(m.interp_insns).toBe(0);expect(m.gl_stubs).toEqual([]);
},300000);
