// @bgt-examples: win32-hello
// Original CC0 deep shadow-stack regression, plus actual runtime loader selection/fallback.
import { resolve } from 'node:path';
import { test, expect, openGame, diagnostics, step, stateHash } from './fixtures';
import { compileC } from '../support/compile';

test('JSPI parks a deep C shadow stack for 300 render/update boundaries', async ({page,backendParam,collector}) => {
  void collector;
  expect(await openGame(page,backendParam,{game:'win32-hello'})).toBe('ready');
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
      return !!m.variants?.jspi;
    });
    const d=await diagnostics(page);
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
  const fallback=[];
  for(let f=0;f<300;f++){await step(page,1);fallback.push((await stateHash(page))!);}
  expect(fallback).toEqual(traces[0]);
});
