import { test,expect,openGame,assertBackend,step,input,diagnostics } from './fixtures';

test('streamed executable self-open and large sparse ranges seek/read/EOF without preloading file contents',async({page,backendParam,collector},info)=>{
 collector.allow(/guest: conformance|guest: files/);
 const chunks:string[]=[],logs:string[]=[];
 page.on('request',(r)=>{if(r.url().includes('/chunks/'))chunks.push(r.url());});
 page.on('console',(m)=>logs.push(m.text()));
 expect(await openGame(page,backendParam,{game:'win32-conformance'})).toBe('ready');
 await assertBackend(page,backendParam,info);await step(page,20);
 expect(chunks).toEqual([]);
 const initial=await diagnostics(page);expect(initial.assets.bytes).toBeLessThan(512*1024);
 await input(page,[{type:'key',code:'KeyF',down:true}]);await step(page,1);
 await input(page,[{type:'key',code:'KeyF',down:false}]);
 for(let i=0;i<40 && !logs.some((s)=>s.includes('files checks='));i++)await step(page,1);
 expect(logs.find((s)=>s.includes('files checks='))).toContain('0000007f');
 expect(chunks.length).toBeGreaterThan(0);expect(chunks.length).toBeLessThan(8);
 expect((await diagnostics(page)).errors).toEqual([]);
});
