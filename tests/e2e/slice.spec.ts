import {test,expect,openGame,assertBackend,step,input,debugState,diagnostics} from './fixtures';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Page} from '@playwright/test';
import {ROOT} from '../support/headless';
import {prepareSlice} from '../support/slice-fixture';

async function serveGenerated(page:Page,id:string){
 // Vite snapshots public paths at startup; these fixtures are built after that. Serve exact package bytes,
 // not a mocked runtime/API, through the browser request path.
 await page.route(`**/games/${id}/**`,async(route)=>{
   const path=new URL(route.request().url()).pathname.split(`/games/${id}/`)[1];
   if(!path||path.includes('..'))throw new Error('invalid generated fixture path');
   await route.fulfill({body:readFileSync(join(ROOT,'web/public/games',id,path)),contentType:path.endsWith('.json')?'application/json':path.endsWith('.wasm')?'application/wasm':'application/octet-stream'});
 });
}

test('recorded boot slice loads, then pauses visibly without a trap on an uncovered callback',async({page,backendParam,collector},info)=>{
 test.setTimeout(120_000);
 collector.allow(/guest:/);const f=await prepareSlice();await serveGenerated(page,f.id);
 expect(await openGame(page,backendParam,{game:f.id})).toBe('ready');await assertBackend(page,backendParam,info);await step(page,10);
 expect((await diagnostics(page)).outsideSlice).toBeNull();
 await step(page,2000);
 const stability=await page.evaluate(()=>(window as any).__BGT_TEST__.coverage());
 expect(stability.metrics.errors).toBe(0);expect(stability.metrics.outsideSlice).toBe(0);expect(stability.metrics.frames_measured).toBeGreaterThanOrEqual(2000);
 expect(stability.metrics.load_to_first_frame_ms).toBeGreaterThan(0);expect(stability.metrics.frame_ms_p95).toBeGreaterThanOrEqual(0);
 await info.attach('slice-stability.json',{body:JSON.stringify(stability,null,2),contentType:'application/json'});
 const click=async(r:number[])=>{const x=r[0]+Math.floor(r[2]/2),y=r[1]+Math.floor(r[3]/2);await input(page,[{type:'pointer',x,y,buttons:1}]);await step(page,1);await input(page,[{type:'pointer',x,y,buttons:0}]);await step(page,2);};
 await click((await debugState(page)).ui.menubar.items[0].rect);
 await click((await debugState(page)).ui.popup.items[1].rect);
 const d=await diagnostics(page);expect(d.outsideSlice?.kind).toBe(1);expect(d.failed).toBe(false);expect(d.paused).toBe(true);expect(d.errors).toEqual([]);
 await expect(page.getByRole('status')).toContainText('outside this slice');
 await step(page,50);expect((await diagnostics(page)).frame).toBe(d.frame);
 const c=await page.evaluate(()=>(window as any).__BGT_TEST__.coverage());expect(c.code.some((e:any)=>(e.kind&1)>0)).toBe(true);
});

test('an omitted streamed executable range pauses as outside-slice before any 404 or full-file fallback',async({page,backendParam,collector},info)=>{
 collector.allow(/guest:|asset range failed/);const f=await prepareSlice('win32-conformance');await serveGenerated(page,f.id);
 expect(await openGame(page,backendParam,{game:f.id})).toBe('ready');await assertBackend(page,backendParam,info);await step(page,20);
 await input(page,[{type:'key',code:'KeyF',down:true}]);await step(page,1);await input(page,[{type:'key',code:'KeyF',down:false}]);await step(page,3);
 const d=await diagnostics(page);expect(d.outsideSlice?.kind).toBe(2);expect(d.outsideSlice?.message).toContain('modules/conformance.exe');expect(d.failed).toBe(false);expect(d.errors).toEqual([]);
});
