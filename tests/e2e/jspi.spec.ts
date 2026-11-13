// @bgt-examples: win32-hello
// Original CC0 deep shadow-stack regression, plus actual runtime loader selection/fallback.
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { test, expect, openGame as openStrictGame, diagnostics, step, stateHash } from './fixtures';
// These cases deliberately assert loader fallback/failure, not JSPI-mode coverage.
const openGame: typeof openStrictGame = (page, backend, params) =>
  openStrictGame(page, backend, params, {allowSuspensionFallback:true});
import { compileC } from '../support/compile';
import { jspiUnavailableReason } from '../support/suspension-modes';

test('JSPI parks a deep C shadow stack for 300 render/update boundaries', async ({page,backendParam,collector}) => {
  void collector;
  expect(await openGame(page,backendParam,{game:'win32-hello'})).toBe('ready');
  const supported=await page.evaluate(()=>{const w=WebAssembly as any;return typeof w.Suspending==='function'&&typeof w.promising==='function';});
  const reason=jspiUnavailableReason({supported,variantPresent:true}); // compiled below, independent of the example artifact
  if(reason)test.info().skip(true,reason);
  const wasm = Array.from(await compileC('tests/fixtures/c/yield_game.c'));
  const result = await page.evaluate(async ({root,wasm}) => {
    const { GameHost } = await import(root+'/runtime/host.ts');
    const { Vfs } = await import(root+'/runtime/vfs.ts');
    const { jspiApi } = await import(root+'/runtime/jspi.ts');
    if (!jspiApi()) throw new Error('Chromium JSPI APIs are required for this regression');
    const host = await GameHost.create(new Uint8Array(wasm),{vfs:new Vfs(),now:()=>performance.now(),log:()=>{}},
      {backend:3,caps:0,seed:1,displayWidth:100,displayHeight:100,arg0:0,arg1:0,suspensionMode:'jspi'});
    host.init();
    const hashes=[];
    for(let f=0;f<300;f++){await host.update();host.render();host.consume();hashes.push(host.stateHash());}
    return {hashes,yields:host.yields,suspended:host.suspended,width:host.logicalWidth,frames:host.frameIndex};
  }, {root:'/@fs'+resolve('bgt'),wasm});
  expect(result.yields).toBe(300);expect(result.frames).toBe(300);expect(result.suspended).toBe(true);expect(result.width).toBe(128);
  expect(result.hashes).toEqual(Array.from({length:300},(_,i)=>((i+1)*1000+(i?187:0)).toString(16).padStart(8,'0')));
});

test('dual loader defaults/fallback/opt-in have identical 300-frame runtime traces', async ({page,backendParam,collector}) => {
  void collector;
  // This test opts in to the build matrix; normal single-variant builds exercise fallback instead.
  const traces: string[][]=[];
  for(const suspension of ['asyncify','jspi']) {
    expect(await openGame(page,backendParam,{game:'win32-hello',suspension})).toBe('ready');
    const available=await page.evaluate(async()=>{
      const m=await(await fetch('/games/win32-hello/manifest.json')).json();
      const w=WebAssembly as any;
      return typeof w.Suspending==='function'&&typeof w.promising==='function'&&!!m.variants?.jspi;
    });
    const d=await diagnostics(page);
    expect(d.suspensionSelection?.requested).toBe(suspension);
    expect(d.suspensionSelection?.supported && d.suspensionSelection?.variantPresent).toBe(available);
    expect(d.suspension).toBe(suspension==='jspi'&&available?'jspi':'asyncify');
    const hashes=[];
    for(let f=0;f<300;f++){await step(page,1);hashes.push((await stateHash(page))!);}
    expect((await diagnostics(page)).failed).toBe(false);
    traces.push(hashes);
  }
  expect(traces[0]).toEqual(traces[1]);
  await page.addInitScript(() => { Object.defineProperty(WebAssembly, 'Suspending', { value: undefined, configurable: true }); });
  expect(await openGame(page,backendParam,{game:'win32-hello',suspension:'jspi'})).toBe('ready');
  expect((await diagnostics(page)).suspension).toBe('asyncify');
  expect((await diagnostics(page)).suspensionSelection).toMatchObject({requested:'jspi',supported:false});
  const fallback=[];
  for(let f=0;f<300;f++){await step(page,1);fallback.push((await stateHash(page))!);}
  expect(fallback).toEqual(traces[0]);
});


// The loader must not misinterpret a raw JSPI-only module as Asyncify when no
// fallback exists. Exercise its real manifest, integrity and host paths on both GPUs.
test('JSPI-only loader runs its oracle and diagnoses missing API/fallback', async ({page,backendParam,collector}) => {
  const bytes=Buffer.from(await compileC('tests/fixtures/c/yield_game.c'));
  const sha256=createHash('sha256').update(bytes).digest('hex');
  await page.route('**/games/win32-hello/manifest.json',async route=>{
    const response=await route.fetch(),manifest=await response.json();
    delete manifest.variants;manifest.suspension='jspi';manifest.wasm={url:'k22-only.wasm',size:bytes.length,sha256};
    await route.fulfill({response,json:manifest});
  });
  await page.route('**/games/win32-hello/k22-only.wasm',route=>route.fulfill({contentType:'application/wasm',body:bytes}));
  expect(await openStrictGame(page,backendParam,{game:'win32-hello',suspension:'jspi'})).toBe('ready');
  expect((await diagnostics(page)).suspension).toBe('jspi');
  await step(page,300);
  expect(await stateHash(page)).toBe((300000+187).toString(16).padStart(8,'0'));
  expect((await diagnostics(page)).failed).toBe(false);
  collector.allow(/JSPI-only build requires/,/Asyncify requested.*no fallback/);
  expect(await openGame(page,backendParam,{game:'win32-hello',suspension:'asyncify'})).toBe('failed');
  await page.addInitScript(()=>{Object.defineProperty(WebAssembly,'Suspending',{value:undefined,configurable:true});});
  expect(await openGame(page,backendParam,{game:'win32-hello',suspension:'jspi'})).toBe('failed');
});


test('per-game JSPI preference selects real JSPI and reports it, with unsupported fallback',async({page,backendParam,collector})=>{
  void collector;
  await page.route('**/games/win32-hello/manifest.json',async route=>{
    const response=await route.fetch(),manifest=await response.json();
    // This test requires dual artifacts; a missing optional variant must still fall back.
    manifest.preferredSuspension='jspi';await route.fulfill({response,json:manifest});
  });
  // Override only the suite-wide URL opt-in; this case must select from the manifest.
  await page.addInitScript(()=>{const u=new URL(location.href);u.searchParams.delete('suspension');history.replaceState(null,'',u);});
  expect(await openGame(page,backendParam,{game:'win32-hello'})).toBe('ready');
  const available=await page.evaluate(async()=>{const w=WebAssembly as any;return typeof w.Suspending==='function'&&typeof w.promising==='function'&&!!(await(await fetch('/games/win32-hello/manifest.json')).json()).variants?.jspi;});
  const d=await diagnostics(page);expect(d.suspension).toBe(available?'jspi':'asyncify');
  expect((d.metrics as any).runtime_profile.suspension).toBe(d.suspension);
  // I12: convergence recordings and the probe summary must identify the active artifact too.
  expect((d.metrics as any).execution_summary.suspension).toBe(d.suspension);
  const coverage=await page.evaluate(()=>(window as any).__BGT_TEST__.coverage());
  expect((coverage as any).metrics.runtime_profile.suspension).toBe(d.suspension);
  expect((coverage as any).metrics.execution.execution_summary.suspension).toBe(d.suspension);
  await step(page,300);expect((await diagnostics(page)).failed).toBe(false);
  await page.addInitScript(()=>{Object.defineProperty(WebAssembly,'Suspending',{value:undefined,configurable:true});});
  expect(await openGame(page,backendParam,{game:'win32-hello'})).toBe('ready');
  expect((await diagnostics(page)).suspension).toBe('asyncify');
});
