// @bgt-examples: sample2d
// vK42 P1: an expected, consumed shader failure is state, not a restore exception.
import {createHash} from 'node:crypto';
import type {Savestate} from '../../bgt/runtime/savestates';
import {test,expect,openGame,step,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
import type {BGTTestAPI} from '../../bgt/runtime/testapi';
for(const suspension of ['asyncify','jspi'])test('savestate preserves live and deleted failed shaders '+suspension,async({page,backendParam,collector},info)=>{
  void collector;
  const bytes=Buffer.from(await compileC('tests/fixtures/c/savestate-bad-shader.c'));
  await page.route('**/games/sample2d/manifest.json',async route=>{
    const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension=suspension;
    m.wasm={url:'bad.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};m.assets=[];
    await route.fulfill({response,json:m});
  });
  await page.route('**/games/sample2d/bad.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
  expect(await openGame(page,backendParam,{deterministic:'1',suspension})).toBe('ready');await assertBackend(page,backendParam,info);
  await step(page,3);
  const result=await page.evaluate(async()=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    const live=await t.snapshot(),traces: (string|null)[][][]=[];
    for(let run=0;run<3;run++){
      if(run)await t.restore(run===2?await t.importSnapshot(t.exportSnapshot(live)):live);
      const trace=[];
      for(let i=0;i<7;i++){await t.step(1);trace.push([t.stateHash(),(await t.readPixels())!.base64]);}
      traces.push(trace);
    }
    const deleted=await t.snapshot();await t.restore(deleted);
    return {same:traces.slice(1).map(x=>JSON.stringify(x)===JSON.stringify(traces[0])),
      deletedShaders:deleted.gpuBase?.frame.items.filter(x=>x.kind==='gpu' && x.op===0x48).length,
      errors:t.diagnostics().errors};
  });
  expect(result.same).toEqual([true,true]);expect(result.deletedShaders).toBe(0);expect(result.errors).toEqual([]);
});


test('restore does not rerun startup exports or retain replacement-only dirty pages',async({page,backendParam,collector},info)=>{
  void collector;
  const bytes=Buffer.from(await compileC('tests/fixtures/c/savestate-startup.c'));
  await page.route('**/games/sample2d/manifest.json',async route=>{
    const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension='asyncify';
    m.wasm={url:'startup.wasm',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};m.assets=[];
    await route.fulfill({response,json:m});
  });
  await page.route('**/games/sample2d/startup.wasm',r=>r.fulfill({contentType:'application/wasm',body:bytes}));
  const [hostModule,ready]=await Promise.all([
    page.waitForResponse(r=>/\/bgt\/runtime\/host\.ts$/.test(new URL(r.url()).pathname)),
    openGame(page,backendParam,{deterministic:'1',suspension:'asyncify'}),
  ]);
  expect(ready).toBe('ready');
  await assertBackend(page,backendParam,info);
  const result=await page.evaluate(async(hostPath)=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    const {GameHost}=await import(hostPath) as typeof import('../../bgt/runtime/host');
    const capture=GameHost.prototype.checkpoint;
    const inspect=async()=>{
      let memory!: Uint8Array;
      GameHost.prototype.checkpoint=function(...args){
        memory=new Uint8Array(this.memory.buffer).slice();return capture.apply(this,args);
      };
      try{return {state:await t.snapshot(),memory};}
      finally{GameHost.prototype.checkpoint=capture;}
    };
    const {state:saved,memory}=await inspect(), before=t.stateHash();
    await t.step(1);
    const live=await t.snapshot();
    const restore=GameHost.prototype.restoreCheckpoint;
    GameHost.prototype.restoreCheckpoint=function(){throw new Error('Injected before host restore');};
    let rejection='';
    try{await t.restore(saved);}catch(e){rejection=String(e);}
    finally{GameHost.prototype.restoreCheckpoint=restore;}
    const startupSideEffect=(await t.snapshot()).services.storage.has('startup-ran');
    await t.restore(saved);
    const after=t.stateHash(), recaptured=await inspect();
    const offsets=(s:Savestate)=>[...s.host.wasm.memory.pages.keys()];
    return {before,after,liveFlag:live.services.storage.get('boot')?.[0],rejection,startupSideEffect,
      sameMemory:memory.length===recaptured.memory.length&&memory.every((byte,i)=>byte===recaptured.memory[i]),
      baseline:saved.host.wasm.memory.baseline,saved:offsets(saved),restored:offsets(recaptured.state)};
  },hostModule.url());
  expect(result.liveFlag).toBe(0x51);
  expect(result.baseline).toBe('module');
  expect(result.before).toBe('00000000');
  expect(result.after).toBe(result.before);
  expect(result.sameMemory).toBe(true);
  expect(result.restored).toEqual(result.saved);
  expect(result.rejection).toMatch(/Injected before host restore/);
  expect(result.startupSideEffect).toBe(false);
});

test('rejected restore is transactional for malformed sections',async({page,backendParam,collector},info)=>{
  void collector;
  // A Vite-transformed import can carry a cache-busting query. Patch the
  // actual module instance loaded by the page, not a second URL for the file.
  const [hostModule, ready]=await Promise.all([
    page.waitForResponse(r=>/\/bgt\/runtime\/host\.ts$/.test(new URL(r.url()).pathname)),
    openGame(page,backendParam,{deterministic:'1',suspension:'asyncify'}),
  ]);
  expect(ready).toBe('ready');
  await assertBackend(page,backendParam,info);await step(page,3);
  const result=await page.evaluate(async(hostPath)=>{
    const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
    const saved=await t.snapshot(),before={hash:t.stateHash(),pixels:(await t.readPixels())!.base64};
    const attempts:[string,(s:Savestate)=>void][]=[
      ['services',s=>{s.services=null as never}],
      ['globals',s=>{s.host.wasm.globals[0]={bits:'bad'} as never}],
      ['memory',s=>{const at=s.host.wasm.memory.pages.keys().next().value!;s.host.wasm.memory.pages.set(at,new Uint8Array(1))}],
      ['gpu',s=>{if(s.gpuBase)s.gpuBase.frame.items.push({kind:'gpu',op:0xffffffff,words:[]})}],
    ];
    const rejected:string[]=[];
    for(const [name,mutate] of attempts){const copy=await t.importSnapshot(t.exportSnapshot(saved));mutate(copy);let failed=false;try{await t.restore(copy);}catch{failed=true}if(!failed)throw new Error(name+' restore unexpectedly succeeded');
      const after={hash:t.stateHash(),pixels:(await t.readPixels())!.base64};if(JSON.stringify(after)!==JSON.stringify(before))throw new Error(name+' restore changed live state');rejected.push(name);}
    const {GameHost}=await import(hostPath) as typeof import('../../bgt/runtime/host');
    const hosts: (typeof GameHost.prototype)[]=[];
    const capture=GameHost.prototype.checkpoint;
    GameHost.prototype.checkpoint=function(...args){hosts.push(this);return capture.apply(this,args);};
    try {await t.snapshot();}finally{GameHost.prototype.checkpoint=capture;}
    const [host]=hosts;
    if(!host)throw new Error('Checkpoint did not call live host');
    const request=host.requests.reserve();if(typeof request==='number')throw new Error('Cannot reserve test request');
    for(const attempt of [()=>t.snapshot(),()=>t.restore(saved)]) {
      try{await attempt();throw new Error('Accepted pending request');}catch(e){if(!String(e).includes('pending requests'))throw e;}
    }
    host.requests.complete(request,new Uint8Array([9]));
    if(!request.done||request.data?.[0]!==9||t.stateHash()!==before.hash)throw new Error('Refusal changed live request/guest');
    const original=GameHost.prototype.restoreCheckpoint;
    GameHost.prototype.restoreCheckpoint=function(s){original.call(this,s);throw new Error('Injected mid-build failure');};
    try{let failed=false;try{await t.restore(saved);}catch(e){if(!String(e).includes('Injected mid-build failure'))throw e;failed=true;}if(!failed)throw new Error('Mid-build exception was lost');
      if(t.stateHash()!==before.hash||(await t.readPixels())!.base64!==before.pixels)throw new Error('Mid-build failure changed live state');rejected.push('mid-build');
    }finally{GameHost.prototype.restoreCheckpoint=original;}
    return {rejected,errors:t.diagnostics().errors};
  },hostModule.url());
  expect(result.rejected).toEqual(['services','globals','memory','gpu','mid-build']);expect(result.errors).toEqual([]);
});
