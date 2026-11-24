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

for(const {mib,artifactBytes,updates} of [{mib:64,artifactBytes:2_000_000,updates:256},
  {mib:1024,artifactBytes:300_000_000,updates:2048}]) {
  test('Q112 capture bench: '+artifactBytes+' bytes / '+mib+' MiB / '+updates+' updates',async({page,backendParam,collector},info)=>{
    test.skip(process.env.BGT_K77_BENCH!=='1','run explicitly for scale measurements');
    void collector;test.setTimeout(240_000);
    await page.setViewportSize({width:320,height:200});
    const wasm=await compileC('tests/fixtures/c/savestate-gpu.c',['STRESS_DRAWS=24','K77_MEMORY_MIB='+mib]);
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
      expect(await openGame(page,backendParam,{deterministic:'1',suspension:'asyncify'})).toBe('ready');
      await assertBackend(page,backendParam,info);
      const result=await page.evaluate(async updates=>{
        const t=(window as unknown as {__BGT_TEST__:BGTTestAPI}).__BGT_TEST__;
        const lead=performance.now();await t.step(updates);const leadMs=performance.now()-lead, journal=t.journalStats();
        const start=performance.now(), s=await t.snapshot(), snapshotMs=performance.now()-start;
        await t.step(1);const expected=t.stateHash(), pixels=(await t.readPixels())?.base64;
        const restoreAt=performance.now();await t.restore(s);const restoreMs=performance.now()-restoreAt;
        await t.step(1);
        return {leadMs,journal,snapshotMs,restoreMs,memoryBytes:s.host.wasm.memory.byteLength,pages:s.host.wasm.memory.pages.size,
          stats:s.stats,suspended:t.diagnostics().suspended,errors:t.diagnostics().errors,frame:t.diagnostics().frame,
          equal:!!pixels&&expected===t.stateHash()&&pixels===(await t.readPixels())?.base64};
      },updates);
      console.log('Q112',backendParam,artifactBytes,JSON.stringify(result));
      await info.attach('q112.json',{body:JSON.stringify({backendParam,mib,artifactBytes,updates,...result}),contentType:'application/json'});
      expect(result.frame).toBe(updates+1);expect(result.suspended).toBe(true);expect(result.equal).toBe(true);
      expect(result.errors).toEqual([]);expect(result.memoryBytes).toBeGreaterThan(mib*1024**2);
      expect(result.pages).toBeLessThan(40);
      // Baseline can be measured against the base runtime (the comparable timings
      // are printed above); the dirty/replay work bound is independent of hardware.
      if(result.stats.replayFrames!==undefined) expect(result.stats.replayFrames).toBeLessThan(128);
    } finally {rmSync(path,{force:true});rmSync(dir,{recursive:true,force:true});}
  });
}
