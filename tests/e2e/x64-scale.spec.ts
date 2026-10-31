import {test,expect,openGame,assertBackend,step,diagnostics,catches} from './fixtures';

test('scale: 1.6M instructions execute 300 fully lifted frames with native checksum',async({page,backendParam,collector},info)=>{
  catches('large wasm compilation/instantiation failure, checksum corruption, dropped chunks, or interpreter fallback');
  collector.allow(/guest:/);
  const logs:string[]=[];page.on('console',(m)=>logs.push(m.text()));
  expect(await openGame(page,backendParam,{game:'x64-scale'})).toBe('ready');
  await assertBackend(page,backendParam,info);await step(page,300);
  expect(logs.some((s)=>s.includes('scale checksum 31c9ceb2 functions 12000')),logs.join('\n')).toBe(true);
  expect(logs.some((s)=>s.includes('scale tick 240'))).toBe(true);
  const d=await diagnostics(page);expect(d.errors).toEqual([]);expect(d.commandErrors.count).toBe(0);
  expect((d.metrics as any).interp_insns).toBe(0);expect((d.metrics as any).stubs).toEqual([]);
  expect(d.timing.wasmStreaming).toBe(true);expect(d.timing.wasmInstantiateMs).toBeGreaterThan(0);
  // Fresh byte buffer/module: isolate browser compile/instantiate from download and profile init.
  const measured=await page.evaluate(async()=>{
    const base='/games/x64-scale/';const manifest=await(await fetch(base+'manifest.json')).json();
    const bytes=await(await fetch(base+manifest.wasm.url)).arrayBuffer();
    const start=performance.now(),module=await WebAssembly.compile(bytes),compileMs=performance.now()-start;
    const bgt:Record<string,()=>number>={};for(const i of WebAssembly.Module.imports(module))bgt[i.name]=()=>{throw new Error('unexpected import during benchmark instantiation');};
    const t=performance.now();await WebAssembly.instantiate(module,{bgt});
    return {compileMs,instantiateMs:performance.now()-t,bytes:bytes.byteLength,coverage:(window as any).__BGT_TEST__.coverage()};
  });
  await info.attach('scale-timings.json',{body:JSON.stringify({backend:backendParam,diagnostics:d.timing,...measured}),contentType:'application/json'});
});
