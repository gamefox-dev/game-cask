// Original CC0-1.0. Old limits fail; every live pair is fetched and late objects produce exact pixels.
import {test,expect,openGame,assertBackend,step,diagnostics,readPixels} from './fixtures';
test('12,000 live GL buffer/VAO pairs draw, churn and recover from real byte exhaustion',async({page,backendParam,collector},info)=>{
 void collector;test.setTimeout(300000);
 expect(await openGame(page,backendParam,{game:'x64-gl-scale'})).toBe('ready');await assertBackend(page,backendParam,info);
 for(let i=0;i<300;i++){await step(page,1);if((await diagnostics(page)).logs.some(l=>/x64-gl-scale (PASS|FAIL) failures=/.test(l.message)))break;}
 await step(page,3);const d=await diagnostics(page),m=d.metrics as Record<string,any>;
 expect(d.errors).toEqual([]);expect(d.commandErrors.count).toBe(1);
 expect(d.commandErrors.recent).toHaveLength(1);expect(d.commandErrors.recent[0]).toMatchObject({code:-3,op:0x40});
 expect(d.logs.filter(l=>l.message.includes('x64-gl-scale FAIL')),JSON.stringify(d.logs)).toEqual([]);
 expect(d.logs.some(l=>l.message.includes('x64-gl-scale PASS failures=0')),JSON.stringify(d.logs)).toBe(true);
 expect(m.gl_objects.buffers).toMatchObject({peak:12002,failures:1,failed_requests:1});
 expect(m.gl_objects.vaos).toMatchObject({peak:12000,failures:0,failed_requests:0});
 expect(d.logs.filter(l=>l.message.includes('GL_OUT_OF_MEMORY object=buffers')).length).toBe(1);
 expect(m.interp_insns).toBe(0);expect(m.gl_unimplemented).toBe(0);expect(m.gl_stubs).toEqual([]);
 const px=await readPixels(page);
 for(const [x0,rgb] of [[80,[255,0,0]],[200,[0,255,0]],[280,[0,0,255]]] as const){
  const x=Math.floor(d.letterbox.x+(x0+.5)*d.letterbox.w/320),y=Math.floor(d.letterbox.y+100.5*d.letterbox.h/200);
  expect(Array.from(px.data.slice((y*px.width+x)*4,(y*px.width+x)*4+4))).toEqual([...rgb,255]);
 }
 await info.attach('scale.png',{body:await page.locator('canvas').screenshot(),contentType:'image/png'});
});
