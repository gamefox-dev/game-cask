import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

it('CRT FILE: native byte/position parity, bounded yields, aliases, text/wide, caller buffers and interleaving', async () => {
  const root=join(ROOT,'node_modules/.cache/bgt/crt-buffer');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'case-'));
  const source=readFileSync(join(ROOT,'tests/fixtures/c/crt_buffer.c'),'utf8');
  const data=Buffer.from(Array.from({length:262181},(_,i)=>(i*29+(i>>8))&255));
  writeFileSync(join(dir,'large.bin'),data);writeFileSync(join(dir,'text.txt'),'A\nB\x1aC');
  writeFileSync(join(dir,'wide.bin'),Buffer.from([0x34,0x12,65,0]));writeFileSync(join(dir,'probe.c'),source);
  const edge=Buffer.alloc(65537,75);edge[65535]=13;edge[65536]=88;writeFileSync(join(dir,'cr-boundary.txt'),edge);
  const scanEdge=Buffer.alloc(65538,75);scanEdge.set([65,13,10,66],65534);writeFileSync(join(dir,'scan-boundary.txt'),scanEdge);
  try {
    execFileSync('cc',['-O2','-Wall','-Wextra','-Werror',join(dir,'probe.c'),'-o',join(dir,'native')]);
    const native=execFileSync(join(dir,'native'),{cwd:dir,encoding:'utf8'}).trim().split('\n');
    expect(native.at(-1)).toBe('buffer failures=0');
    writeFileSync(join(dir,'text.txt'),'A\r\nB\x1aC');
    const cfg={id:'crt-buffer-probe',name:'CC0 FILE buffering contracts',pipeline:{platform:'win32',fixture:{target:'x86_64-windows-gnu',crt:true,out:'probe.exe',sources:['probe.c']},modules:[{from:'./build/probe.exe',main:true}]},streams:[{from:'./large.bin',path:'large.bin',chunkSize:65536},{from:'./text.txt',path:'text.txt',chunkSize:4096},{from:'./wide.bin',path:'wide.bin',chunkSize:4096},{from:'./cr-boundary.txt',path:'cr-boundary.txt',chunkSize:65536},{from:'./scan-boundary.txt',path:'scan-boundary.txt',chunkSize:65536}]};
    writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));buildGame(dir,{quiet:true});
    const accounting:Record<string,{consumedBytes:number;observedBytes:number}>={};
    let initialRequests=0;
    const h=await loadHeadless(cfg.id,{onLog:(m)=>{
      if(m.includes('descriptor '))accounting[m.split('descriptor ')[1]]=h.host.fileIo;
      if(m.includes('large read complete'))initialRequests=h.host.fileIo.readAheadRequests;
    }});
    let smallFrames=0,smallRequests=0;
    for(let i=0;i<300;i++){
      await h.stepAsync();
      if(!smallFrames&&h.logs.some(s=>s.includes('small='))){smallFrames=i+1;smallRequests=h.host.fileIo.readAheadRequests;}
      if((h.host.metrics() as any).exited)break;
    }
    expect(h.logs.some(s=>s.includes('FAIL')),h.logs.join('\n')).toBe(false);
    for(const line of native)expect(h.logs).toContain('guest CRT stdout: '+line);
    expect((h.host.metrics() as any).exited).toBe(1);
    expect(smallFrames).toBeGreaterThan(0);expect(smallFrames).toBeLessThanOrEqual(3);
    expect(smallRequests).toBeLessThanOrEqual(2);
    expect(initialRequests).toBe(17); // exactly ceil(262181/16384), independent of later contract tests
    // Initial fills + added scanning/seek, descriptor, wide and explicit tiny-buffer cases.
    expect(h.host.fileIo.readAheadRequests).toBeLessThanOrEqual(50);
    expect(h.host.frameIndex).toBeLessThanOrEqual(64);
    expect(h.host.fileIo.consumedBytes).toBeGreaterThan(262181);
    expect(h.host.fileIo.readAheadBytes).toBeGreaterThan(h.host.fileIo.consumedBytes);
    expect(h.logs.indexOf('guest CRT stdout: buffered flush')).toBeGreaterThanOrEqual(0);
    expect(h.logs.findIndex(s=>s.includes('sink checkpoint'))).toBeGreaterThan(h.logs.indexOf('guest CRT stdout: buffered flush'));
    expect(h.logs.indexOf('guest CRT stdout: buffered all')).toBeGreaterThanOrEqual(0);
    expect(h.logs.findIndex(s=>s.includes('all checkpoint'))).toBeGreaterThan(h.logs.indexOf('guest CRT stdout: buffered all'));
    expect(h.host.fileIo.observedBytes).toBeGreaterThanOrEqual(1);
    expect(accounting['text quota done'].consumedBytes-accounting['accounting start'].consumedBytes).toBe(3);
    expect(accounting['control-z done'].consumedBytes-accounting['text quota done'].consumedBytes).toBe(4);
    expect(accounting['binary done'].consumedBytes-accounting['control-z done'].consumedBytes).toBe(2);
    expect(accounting['peek done'].consumedBytes-accounting['peek start'].consumedBytes).toBe(1);
    expect(accounting['peek done'].observedBytes-accounting['peek start'].observedBytes).toBe(1);
    expect(h.host.fileIo.files.filter(f=>f.path==='cr-boundary.txt')).toEqual([{path:'cr-boundary.txt',offset:0,length:65536},{path:'cr-boundary.txt',offset:65536,length:1}]);
    // Indirect tail jumps through CRT import wrappers are handled by the profile,
    // not executed as lifted guest entries (nor allowed by a guest code slice).
    expect([...h.host.codeCoverage.keys()].filter(addr=>addr>=0x00b00000&&addr<0x00c00000)).toEqual([]);
    const buffered={frames:h.host.frameIndex,smallFrames,smallRequests,...h.host.fileIo};
    buildGame(dir,{quiet:true,interpretOnly:true});const diff=await oracle(cfg.id,300);
    expect(diff.identical,JSON.stringify(diff)).toBe(true);expect(diff.errors).toEqual({lifted:null,interpreted:null});
    // Record, package, replay the semantic CR lookahead dependency, not the speculative fill.
    const full=JSON.parse(readFileSync(join(ROOT,'web/public/games',cfg.id,'manifest.json'),'utf8'));
    writeFileSync(join(dir,'coverage.json'),JSON.stringify({schema:'game-cask/coverage/1',game:cfg.id,modules:full.pipeline.modules,files:h.host.fileIo.files,code:[...h.host.codeCoverage].map(([address,kind])=>({address,kind}))}));
    copyFileSync(join(ROOT,'node_modules/.cache/bgt/pipeline',cfg.id,'fixture/probe.exe'),join(dir,'input.exe'));
    const slicedCfg={...cfg,pipeline:{platform:'win32',modules:[{from:'./input.exe',name:'probe.exe',main:true}]},slice:{coverage:['coverage.json']}};
    writeFileSync(join(dir,'game.json'),JSON.stringify(slicedCfg));buildGame(dir,{quiet:true});
    const sliced=await loadHeadless(cfg.id);await sliced.stepAsync(300);
    expect(sliced.logs.some(s=>s.includes('FAIL')),sliced.logs.join('\n')).toBe(false);
    expect(sliced.logs).toContain('guest CRT stdout: buffer failures=0');expect((sliced.host.metrics() as any).exited).toBe(1);
    // Same 4096-byte workload with no continuation gives an exact request-count comparison.
    writeFileSync(join(dir,'probe.c'),'#define SMALL_ONLY 1\n'+source);
    cfg.id='crt-small-buffered';writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));buildGame(dir,{quiet:true});
    const small=await loadHeadless(cfg.id);let smallExitFrames=0;
    while(!(small.host.metrics() as any).exited&&smallExitFrames<3){await small.stepAsync();smallExitFrames++;}
    expect(small.logs).toContain('guest CRT stdout: '+native[0]);expect(small.logs).toContain('guest CRT stdout: buffer failures=0');
    expect((small.host.metrics() as any).exited).toBe(1);expect(small.host.fileIo.readAheadRequests).toBe(1);
    expect(small.host.fileIo.consumedBytes).toBe(4096);expect(small.host.fileIo.readAheadBytes).toBe(16384);
    // Same source/data, deliberately disabling buffering measures the old one-request-per-byte cost.
    writeFileSync(join(dir,'probe.c'),'#define UNBUFFERED 1\n'+source);
    cfg.id='crt-unbuffered-probe';writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));buildGame(dir,{quiet:true});
    const before=await loadHeadless(cfg.id);let frames=0;
    while(!(before.host.metrics() as any).exited&&frames<4100){await before.stepAsync();frames++;}
    expect(before.logs).toContain('guest CRT stdout: '+native[0]);expect(before.logs).toContain('guest CRT stdout: buffer failures=0');
    expect(before.host.fileIo.readAheadRequests).toBe(4096);expect(frames).toBeGreaterThanOrEqual(4096);expect(frames).toBeLessThanOrEqual(4098);
    writeFileSync(join(dir,'probe.c'),'#define ERROR_ONLY 1\n'+source);cfg.id='crt-buffer-io-error';
    writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));buildGame(dir,{quiet:true});
    const manifestPath=join(ROOT,'web/public/games',cfg.id,'manifest.json');const broken=JSON.parse(readFileSync(manifestPath,'utf8'));
    broken.streams.find((s: any)=>s.path==='large.bin').chunks[0].sha256='0'.repeat(64);writeFileSync(manifestPath,JSON.stringify(broken));
    const ioError=await loadHeadless(cfg.id);await ioError.stepAsync(10);
    expect(ioError.logs.some(s=>s.includes('integrity mismatch'))).toBe(true);
    expect(ioError.logs.some(s=>s.includes('FAIL')),ioError.logs.join('\n')).toBe(false);
    expect(ioError.logs).toContain('guest CRT stdout: buffer failures=0');expect((ioError.host.metrics() as any).exited).toBe(1);
    expect(ioError.host.fileIo.consumedBytes).toBe(0);expect(ioError.host.fileIo.readAheadBytes).toBe(0);
    writeFileSync(join(ROOT,'reports/crt-buffer.json'),JSON.stringify({native,buffered,smallBuffered:{framesToExit:smallExitFrames,...small.host.fileIo},unbuffered:{frames,...before.host.fileIo},oracle:{identical:diff.identical,frames:300}},null,2));
  } finally { rmSync(dir,{recursive:true,force:true}); }
},240_000);
