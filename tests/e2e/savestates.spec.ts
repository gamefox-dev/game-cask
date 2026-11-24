// @bgt-examples: sample2d x64-gl-fbo x64-threads
// Original CC0 fixtures: catch omitted Asyncify/guest scheduler/GPU attachment state,
// hidden globals, input edges and accidental boot replay during checkpoint restore.
import { test, expect, openGame, assertBackend, diagnostics, step } from './fixtures';
import type { BGTTestAPI } from '../../bgt/runtime/testapi';

for (const game of ['sample2d','x64-gl-fbo','x64-threads']) for (const suspension of ['asyncify','jspi']) {
  if(game==='x64-threads'&&suspension==='jspi')continue; // its live wait is covered by the refusal test below
  test('savestate ' + game + ' ' + suspension + ': continuous and two restored suffixes agree every update',async({page,backendParam,collector},info)=>{
    void collector;
    // x64-gl-fbo steps 300 extra updates; Asyncify on the CI software rasterizer needs ~70 s (dev.29/dev.33 CI timeouts).
    if(game==='x64-gl-fbo')test.setTimeout(180_000);
    expect(await openGame(page,backendParam,{game,suspension,deterministic:'1'})).toBe('ready');
    await assertBackend(page,backendParam,info);
    expect((await diagnostics(page)).suspension).toBe(suspension);
    await step(page,game==='x64-threads'?1:3);
    if(game==='x64-threads') expect(((await diagnostics(page)).metrics as {exited:number}).exited).toBe(0);
    const result = await page.evaluate(async ({game,suspension}) => {
      const fileBytes=async(s:ReadableStream<Uint8Array>)=>{const r=s.getReader();let n=0;for(;;){const p=await r.read();if(p.done)return n;n+=p.value.length;}};
      const t = (window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
      // The first presentation follows several shader/readback transport waits.
      // Early presents may also retain the startup probe's packed stencil.
      // Search for a returnable, GPU-capturable boundary; propagate unrelated errors.
      const checkpoint=async()=>{
        for(let i=0;i<120;i++) {
          try{return await t.snapshot();}catch(e){
            if(game!=='x64-gl-fbo'||suspension!=='jspi'||
              !/suspended JSPI continuation|Unsupported savestate GPU provenance/.test(String(e)))throw e;
          }
          await t.step(1);
        }
        throw new Error('No returnable GL presentation within 120 updates');
      };
      const early=game==='x64-gl-fbo'?await checkpoint():null;
      if(early)await t.step(300);
      const snap = await checkpoint();
      const wasSuspended=t.diagnostics().suspended;
      const earlyBytes=early?await fileBytes(t.exportSnapshot(early)):null;
      const savedHash=t.stateHash(),savedBytes=await fileBytes(t.exportSnapshot(snap)),restoreMs:number[]=[];
      const traces: {hash:string|null;pixels:string}[][] = [];
      for(let run=0;run<3;run++) {
        if(run) {const start=performance.now();await t.restore(run === 2 ? await t.importSnapshot(t.exportSnapshot(snap)) : snap);restoreMs.push(performance.now()-start);}
        const trace = [];
        for(let i=0;i<(game==='x64-threads'?24:8);i++) {
          t.input([{type:'key',code:'ArrowRight',down:i<4},{type:'button',button:'A',down:i===2}]);
          await t.step(1);
          const px = await t.readPixels();
          if (!px) throw new Error('Missing framebuffer');
          trace.push({hash:t.stateHash(),pixels:px.base64});
        }
        traces.push(trace);
      }
      return {savedHash,wasSuspended,exited:(t.diagnostics().metrics as {exited?:number})?.exited, measurement:{game,bytes:savedBytes,earlyBytes,stats:snap.stats,restoreMs},hashes:traces[0].map(x=>x.hash),
        equal:traces.slice(1).map(trace=>trace.map((x,i)=>x.hash===traces[0][i].hash && x.pixels===traces[0][i].pixels)),
        errors:t.diagnostics().errors,commandErrors:t.diagnostics().commandErrors.count};
    },{game,suspension});
    if(result.measurement) await info.attach('savestate-measurement.json',{body:JSON.stringify(result.measurement),contentType:'application/json'});
    // Pipeline fixtures must actually park at an update boundary, not exit or silently choose another artifact.
    if(game!=='sample2d') expect(result.wasSuspended).toBe(true);
    {
      if(game==='x64-gl-fbo')expect(result.measurement!.bytes).toBeLessThan(result.measurement!.earlyBytes!*2);
      expect(result.hashes!.every(x=>x!==null)).toBe(true);
      const updates=game==='x64-threads'?24:8;
      expect(result.equal).toEqual([Array(updates).fill(true),Array(updates).fill(true)]);
      if(game==='x64-threads') {
        // This fixture completes in update2: prove the LIVE update1 checkpoint
        // progressed to its exit, not that already-exited suffix frames keep changing.
        expect(result.hashes![0]).not.toBe(result.savedHash);expect(result.exited).toBe(1);
      }
      expect(result.errors).toEqual([]); expect(result.commandErrors).toBe(0);
    }
  });
}

// The worker is live at update 1, but the Wait/Sleep path still owns a native
// continuation. Refuse both operations without losing the running thread or advancing time.
test('savestate x64-threads jspi: refuses a live native wait without changing the suffix',async({page,backendParam,collector},info)=>{
  void collector;
  const run=async(reject:boolean)=>{
    expect(await openGame(page,backendParam,{game:'x64-threads',suspension:'jspi',deterministic:'1'})).toBe('ready');
    await assertBackend(page,backendParam,info);
    return page.evaluate(async reject=>{
      const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
      await t.step(1);
      const d=t.diagnostics(), before=t.stateHash(), errors:string[]=[];
      if(reject){
        // No checkpoint should even be inspected while the JSPI stack is live.
        const unreadable=new Proxy({} as Awaited<ReturnType<BGTTestAPI['snapshot']>>,{ownKeys(){throw new Error('restore inspected input');}});
        for(const attempt of [()=>t.snapshot(),()=>t.restore(unreadable)]){
          try{await attempt();errors.push('accepted');}catch(e){errors.push(String(e));}
        }
        if(t.stateHash()!==before||t.diagnostics().frame!==d.frame)throw new Error('Refusal changed live guest');
      }
      const hashes:(string|null)[]=[];
      for(let i=0;i<24;i++){await t.step(1);hashes.push(t.stateHash());}
      const end=t.diagnostics();
      return {mode:d.suspension,suspended:d.suspended,live:!(d.metrics as {exited:number}).exited,
        exited:(end.metrics as {exited:number}).exited,errors,guestErrors:end.errors,before,hashes,pixels:(await t.readPixels())?.base64};
    },reject);
  };
  const control=await run(false),actual=await run(true);
  expect(actual.errors).toHaveLength(2);
  for(const error of actual.errors)expect(error).toContain('suspended JSPI continuation (not a returnable frame boundary)');
  expect({...actual,errors:[]}).toEqual(control);
  expect(actual.mode).toBe('jspi');expect(actual.suspended).toBe(true);expect(actual.live).toBe(true);expect(actual.exited).toBe(1);
  expect(actual.hashes[0]).not.toBe(actual.before);expect(actual.guestErrors).toEqual([]);expect(actual.pixels).toBeTruthy();
});

test('savestate x64-gl-fbo jspi: returnable dispatch preserves conventional JSPI presents',async({page,backendParam,collector},info)=>{
  void collector;
  const runs=[];
  for(const deterministic of ['0','1']){
    expect(await openGame(page,backendParam,{game:'x64-gl-fbo',suspension:'jspi',deterministic})).toBe('ready');
    await assertBackend(page,backendParam,info);
    runs.push(await page.evaluate(async()=>{
      const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__,trace=[];
      for(let i=0;i<6;i++){
        await t.step(10);
        const d=t.diagnostics(),metrics=d.metrics as {guest_time:unknown;exited:number};
        trace.push({mode:d.suspension,exited:metrics.exited,clock:metrics.guest_time,hash:t.stateHash(),pixels:(await t.readPixels())?.base64});
      }
      return {trace,errors:t.diagnostics().errors};
    }));
  }
  expect(runs[1]).toEqual(runs[0]);
  expect(runs[0].errors).toEqual([]);
  expect(runs[0].trace.every(x=>x.mode==='jspi'&&!x.exited&&x.pixels)).toBe(true);
  expect(new Set(runs[0].trace.map(x=>x.hash)).size).toBeGreaterThan(1);
});

test('savestates are opt-in and reject overlapping updates',async({page,backendParam,collector})=>{
  void collector;
  expect(await openGame(page,backendParam)).toBe('ready');
  expect(await page.evaluate(async()=>{try{await (window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__.snapshot();return '';}catch(e){return String(e);}})).toContain('before boot');
  expect(await openGame(page,backendParam,{deterministic:'1'})).toBe('ready');
  await step(page,1);
  expect(await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__, pending=t.step(2);
    let error='';try{await t.snapshot();}catch(e){error=String(e);}await pending;return error;
  })).toContain('quiescent');
});

// K69 breakage caught: every snapshot/compaction replays into a temporary WebGL2 renderer. Its destroy() used to leave
// the context restorable (webglcontextlost preventDefault), which WebKit keeps allocated in the page's 16-context budget;
// from the 17th context on WebKit recycles the least recently used one ("too many active WebGL contexts" console
// errors; in the docs/webkit.md repro an idle live context is the one lost). Chromium never shows it; WebKit does.
test('idle snapshots keep the live game context',async({page,backendParam,collector},info)=>{
  void collector;
  expect(await openGame(page,backendParam,{deterministic:'1'})).toBe('ready');await assertBackend(page,backendParam,info);
  await step(page,2);
  const result=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__,before=(await t.readPixels())!.base64;
    for(let i=0;i<20;i++)await t.snapshot(); // paused: the live context is idle between temporaries
    await new Promise(r=>setTimeout(r,50)); // context loss is delivered as a task
    const after=await t.readPixels();await t.step(1);
    return {same:after?.base64===before,stepped:!!(await t.readPixels()),errors:t.diagnostics().errors.map(e=>e.message)};
  });
  expect(result.errors).toEqual([]);expect(result.same).toBe(true);expect(result.stepped).toBe(true);
});
