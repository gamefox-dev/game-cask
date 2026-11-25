// @bgt-examples: x64-time
import {test,expect,openGame,assertBackend,step,diagnostics} from './fixtures';
for(const suspension of ['asyncify','jspi'])test('guest-frame clock and worker audio '+suspension,async({page,backendParam,collector},info)=>{
  collector.allow(/guest:/);
  expect(await openGame(page,backendParam,{game:'x64-time',suspension,deterministic:'1'})).toBe('ready');
  await assertBackend(page,backendParam,info);
  const times:number[]=[], hashes:(string|null)[]=[];
  for(let i=0;i<10;i++) {
    await step(page,1);
    const d=await diagnostics(page),m=d.metrics as any;
    times.push(Number(m.guest_time.virtual_us));
    hashes.push(await page.evaluate(()=>(window as any).__BGT_TEST__.stateHash()));
    expect(m.execution_summary.guest_frames.count).toBe(i+1);
  }
  for(let i=1;i<times.length;i++)expect(times[i]-times[i-1]).toBe(16667);
  expect(hashes[9]).not.toBe(hashes[0]);
  const result=await page.evaluate(async()=>{
    const t=(window as any).__BGT_TEST__;
    // K77: JSPI checkpoints work at returnable presentation boundaries; a live native JSPI wait refuses with its documented error.
    let snap;
    try {snap=await t.snapshot();} catch(e) {
      if(t.diagnostics().suspension==='jspi')return {unsupported:String(e).includes('suspended JSPI'),equal:null};
      throw e;
    }
    const runs=[];
    for(let run=0;run<3;run++) {
      if(run)await t.restore(run===2?await t.importSnapshot(t.exportSnapshot(snap)):snap);
      const trace=[];
      for(let i=0;i<30;i++) {await t.step(1);trace.push([t.stateHash(),t.diagnostics().metrics.guest_time]);}
      runs.push(trace);
    }
    return {unsupported:false,equal:JSON.stringify(runs[0])===JSON.stringify(runs[1])&&JSON.stringify(runs[0])===JSON.stringify(runs[2])};
  });
  // Either a supported checkpoint whose restored suffixes are identical, or (JSPI only) the documented refusal.
  if(result.unsupported)expect(suspension).toBe('jspi');else expect(result.equal).toBe(true);
  await step(page,50);
  const d=await diagnostics(page);
  expect((d.metrics as any).exited).toBe(1);expect(d.errors).toEqual([]);expect(d.commandErrors.count).toBe(0);
});
