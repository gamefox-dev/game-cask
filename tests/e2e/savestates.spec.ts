// @bgt-examples: sample2d x64-gl-fbo x64-threads
// Original CC0 fixtures: catch omitted Asyncify/guest scheduler/GPU attachment state,
// hidden globals, input edges and accidental boot replay during checkpoint restore.
import { test, expect, openGame, assertBackend, diagnostics, step } from './fixtures';
import type { BGTTestAPI } from '../../bgt/runtime/testapi';

for (const game of ['sample2d','x64-gl-fbo','x64-threads']) for (const suspension of ['asyncify','jspi']) {
  test('savestate ' + game + ' ' + suspension + ': continuous and two restored suffixes agree every update',async({page,backendParam,collector},info)=>{
    void collector;
    // x64-gl-fbo steps 300 extra updates; Asyncify on the CI software rasterizer needs ~70 s (dev.29/dev.33 CI timeouts).
    if(game==='x64-gl-fbo')test.setTimeout(180_000);
    expect(await openGame(page,backendParam,{game,suspension,deterministic:'1'})).toBe('ready');
    await assertBackend(page,backendParam,info);
    expect((await diagnostics(page)).suspension).toBe(suspension);
    // The GL fixture boots through shader/readback transports before its first
    // SwapBuffers. Only the present boundary is portable in JSPI.
    await step(page,game==='x64-threads'?1:game==='x64-gl-fbo'&&suspension==='jspi'?40:3);
    if(game==='x64-threads') expect(((await diagnostics(page)).metrics as {exited:number}).exited).toBe(0);
    const wasSuspended = (await diagnostics(page)).suspended;
    const result = await page.evaluate(async (game) => {
      const fileBytes=async(s:ReadableStream<Uint8Array>)=>{const r=s.getReader();let n=0;for(;;){const p=await r.read();if(p.done)return n;n+=p.value.length;}};
    const t = (window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
      const early=game==='x64-gl-fbo'?await t.snapshot():null;
      if(early)await t.step(300);
      const snap = await t.snapshot();
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
      return {savedHash,exited:(t.diagnostics().metrics as {exited?:number})?.exited, measurement:{game,bytes:savedBytes,earlyBytes,stats:snap.stats,restoreMs},hashes:traces[0].map(x=>x.hash),
        equal:traces.slice(1).map(trace=>trace.map((x,i)=>x.hash===traces[0][i].hash && x.pixels===traces[0][i].pixels)),
        errors:t.diagnostics().errors,commandErrors:t.diagnostics().commandErrors.count};
    },game);
    if(result.measurement) await info.attach('savestate-measurement.json',{body:JSON.stringify(result.measurement),contentType:'application/json'});
    // Pipeline fixtures must actually park at an update boundary, not exit or silently choose another artifact.
    if(game!=='sample2d') expect(wasSuspended).toBe(true);
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
