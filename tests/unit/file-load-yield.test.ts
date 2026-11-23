// @bgt-examples: x64-file-load
// SPDX-License-Identifier: CC0-1.0. K66 (Q123): the profile reports time-neutral transport yields exactly.
// Catches: a blocking ReadFile load whose yields are not reported (the page loop could not run it faster than
// one read per display tick), and a report that leaks into presented or time-advancing frames (the page loop
// would then run normal frames faster than the display).
import {expect,it} from 'vitest';
import {loadHeadless} from '../support/headless';
import {glStream} from '../support/x64-gl-stream';
it('every update of a blocking ReadFile load is a transport yield; presented frames never are',async()=>{
 const h=await loadHeadless('x64-file-load',glStream());
 const kinds:boolean[]=[];let begin=-1,end=-1;
 for(let i=0;i<1200&&(end<0||i<end+60);i++){ // one present per update before/after the load
  await h.stepAsync(1);kinds.push(h.host.transportYield());
  if(begin<0&&h.logs.some(s=>s.includes('file-load begin')))begin=i;
  if(end<0&&h.logs.some(s=>s.includes('file-load done')))end=i;
 }
 expect(h.logs.find(s=>s.includes('file-load done'))).toMatch(/^guest: file-load done ok reads=768 fnv=[0-9a-f]{8} presents=30 /);
 expect(begin).toBeGreaterThanOrEqual(30);
 // Each ReadFile chunk is one request and one update boundary; the update that logs "done" ends at a present.
 const load=kinds.slice(begin,end);
 expect(load.length).toBeGreaterThanOrEqual(768);expect(load.every(Boolean)).toBe(true);
 expect(kinds.slice(0,begin).filter(Boolean)).toHaveLength(0); // 30 presented frames before the load
 expect(kinds.slice(end,end+60).filter(Boolean)).toHaveLength(0); // presented frames after it
 const m=h.host.metrics() as {guest_time:{neutral_yields:string}};
 expect(Number(m.guest_time.neutral_yields)).toBe(kinds.filter(Boolean).length);
},120000);
