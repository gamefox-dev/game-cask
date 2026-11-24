// @bgt-examples: sample2d
// CC0 K77 capture benchmark. Payload padding exercises real loader/integrity sizes,
// not 300 MB of generated machine code. Real GPU commands force a packed-depth cut.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {closeSync,mkdtempSync,openSync,readFileSync,rmSync,writeSync,truncateSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test,expect,openGame,assertBackend} from './fixtures';
import {compileC} from '../support/compile';
const wasmUint=(n:number)=>{const out:number[]=[];do{out.push((n&127)|(n>>>7?128:0));n>>>=7;}while(n);return out;};
import type {BGTTestAPI} from '../../bgt/runtime/testapi';

for(const {mib,artifactBytes,updates,heavy} of [{mib:64,artifactBytes:2_000_000,updates:256,heavy:false},
  {mib:1024,artifactBytes:300_000_000,updates:2048,heavy:false},
  {mib:1024,artifactBytes:291_000_000,updates:12262,heavy:true}]) {
  test('Q112 capture bench: '+artifactBytes+' bytes / '+mib+' MiB / '+updates+' updates',async({page,backendParam,collector},info)=>{
    test.skip(process.env.BGT_K77_BENCH!=='1','run explicitly for scale measurements');
    void collector;test.setTimeout(600_000);
    await page.setViewportSize({width:320,height:200});
    const wasm=await compileC('tests/fixtures/c/savestate-gpu.c',['STRESS_DRAWS=24','K77_MEMORY_MIB='+mib,...(heavy?['K77_GPU_HEAVY=1']:[])]);
    const dir=mkdtempSync(join(tmpdir(),'bgt-q112-'));
    const filename='q112-'+process.pid+'.wasm', path=join('web/public/games/sample2d',filename);
    try {
      writeFileSync(join(dir,'in.wasm'),wasm);
      execFileSync(process.execPath,['node_modules/binaryen/bin/wasm-opt',join(dir,'in.wasm'),
        '--enable-bulk-memory','--enable-bulk-memory-opt','--enable-nontrapping-float-to-int','--enable-sign-ext','--enable-mutable-globals',
        '-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield','-o',join(dir,'out.wasm')]);
      const code=readFileSync(join(dir,'out.wasm'));
      const headerSize=1+wasmUint(artifactBytes).length;
      const padding=artifactBytes-code.length-headerSize;
      const header=new Uint8Array([0,...wasmUint(padding),1,112]); // custom name "p"
      expect(code.length+padding+header.length-2).toBe(artifactBytes);
      const file=openSync(path,'w');
      try { writeSync(file,code);writeSync(file,header); } finally { closeSync(file); }
      truncateSync(path,artifactBytes);
      const sha256=createHash('sha256').update(readFileSync(path)).digest('hex');
      await page.route('**/games/sample2d/manifest.json',async route=>{
        const response=await route.fetch(),m=await response.json();delete m.variants;m.suspension='asyncify';
        m.wasm={url:filename,size:artifactBytes,sha256};m.assets=[];
        await route.fulfill({response,json:m});
      });
      await page.addInitScript(()=>{
        const timing={calls:0,ms:0},digest=SubtleCrypto.prototype.digest;
        Object.assign(window,{__k77Digest:timing});
        SubtleCrypto.prototype.digest=async function(...args:Parameters<typeof digest>){
          const at=performance.now();timing.calls++;
          try{return await digest.apply(this,args);}finally{timing.ms+=performance.now()-at;}
        };
      });
      // Boot includes download, artifact integrity hashing and compilation. Stream
      // export and in-memory capture are timed separately below.
      const bootStart=performance.now();
      expect(await openGame(page,backendParam,{deterministic:'1',suspension:'asyncify'})).toBe('ready');
      const bootMs=performance.now()-bootStart;
      await assertBackend(page,backendParam,info);
      const result=await page.evaluate(async ({updates,suffixFrames})=>{
        const {__BGT_TEST__:t,__k77Digest:digest}=window as unknown as {__BGT_TEST__:BGTTestAPI;__k77Digest:{calls:number;ms:number}};
        const bootHash={...digest};
        const lead=performance.now();await t.step(updates);
        if(t.diagnostics().frame!==updates)throw new Error('Benchmark did not complete its lead-in');
        // The fixture yields at the tail of bgt_update; the next host step
        // only returns from that call. Park at the next yield if needed.
        const parkStep=t.diagnostics().suspended?0:1;
        if(parkStep)await t.step(parkStep);
        const leadMs=performance.now()-lead, journal=t.journalStats(), leadState=t.diagnostics();
        if(leadState.frame!==updates+parkStep||!leadState.suspended||leadState.errors.length||leadState.commandErrors.count)
          throw new Error('Benchmark did not reach a suspended capture: '+JSON.stringify({frame:leadState.frame,suspended:leadState.suspended,errors:leadState.errors,commands:leadState.commandErrors}));
        const calls=digest.calls,start=performance.now(), s=await t.snapshot(), snapshotMs=performance.now()-start;
        const captureHashCalls=digest.calls-calls;
        const exportAt=performance.now(), reader=t.exportSnapshot(s).getReader();let fileBytes=0;
        for(;;){const p=await reader.read();if(p.done)break;fileBytes+=p.value.length;}
        const exportMs=performance.now()-exportAt;
        // Two host steps per draw: resume the previous update, then draw/yield.
        // Compare a whole rotation of the 60 textures on both branches.
        const suffix=async()=>{const values:{hash:string;pixels:string}[]=[];
          for(let i=0;i<suffixFrames;i++) {
            await t.step(1);
            const pixels=await t.readPixels(),hash=t.stateHash();
            if(!pixels||hash===null)throw new Error('Missing suffix pixels or guest hash');
            values.push({hash,pixels:pixels.base64});
          }
          return values;
        };
        const expected=await suffix();
        const restoreAt=performance.now();await t.restore(s);const restoreMs=performance.now()-restoreAt;
        const actual=await suffix();
        return {leadMs,journal,snapshotMs,restoreMs,exportMs,fileBytes,bootHash,captureHashCalls,memoryBytes:s.host.wasm.memory.byteLength,pages:s.host.wasm.memory.pages.size,
          stats:s.stats,captureFrame:leadState.frame,suspended:leadState.suspended,errors:t.diagnostics().errors,frame:t.diagnostics().frame,
          distinctImages:new Set(expected.map(value=>value.pixels)).size,
          equal:actual.every((value,i)=>value.hash===expected[i].hash&&value.pixels===expected[i].pixels)};
      },{updates,suffixFrames:heavy?120:2});
      console.log('Q112',backendParam,artifactBytes,JSON.stringify({bootMs,...result}));
      await info.attach('q112.json',{body:JSON.stringify({backendParam,mib,artifactBytes,updates,bootMs,...result}),contentType:'application/json'});
      expect(result.frame).toBe(result.captureFrame+(heavy?120:2));expect(result.suspended).toBe(true);expect(result.equal).toBe(true);
      if(heavy)expect(result.distinctImages).toBeGreaterThanOrEqual(60);
      expect(result.errors).toEqual([]);expect(result.bootHash.calls).toBeGreaterThan(0);expect(result.captureHashCalls).toBe(0);
      expect(result.memoryBytes).toBeGreaterThan(mib*1024**2);
      expect(result.pages).toBeLessThan(heavy?110:40);
      if(heavy)expect(result.stats.nativeBytes).toBeGreaterThanOrEqual(240*1024**2);
      // Baseline can be measured against the base runtime (the comparable timings
      // are printed above); the dirty/replay work bound is independent of hardware.
      if(result.stats.replayFrames!==undefined) expect(result.stats.replayFrames).toBeLessThan(128);
      if(heavy&&result.stats.replayFrames!==undefined)expect(result.stats.readbackBytes).toBeLessThan(1024**2);
    } finally {rmSync(path,{force:true});rmSync(dir,{recursive:true,force:true});}
  });
}
