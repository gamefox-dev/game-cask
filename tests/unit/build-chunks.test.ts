import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error ESM build tool
import { partitionFunctions } from '../../tools/build/chunks.mjs';
// @ts-expect-error ESM build tool
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error ESM build tool
import { leaseCache, pruneCache } from '../../tools/build/cache.mjs';
// @ts-expect-error ESM tool
import { withBuildWriters } from '../../tools/build/exec.mjs';
// @ts-expect-error CC0 source generator
import { generate } from '../../examples/x64-scale/generate.mjs';

it('partitions deterministically without splitting or dropping oversized functions',()=>{
  const f=[{addr:3,insns:800},{addr:1,insns:128},{addr:2,insns:128},{addr:4,insns:1}];
  expect(partitionFunctions(f,256)).toEqual([[1,2],[3],[4]]);
  expect(()=>partitionFunctions(f,0)).toThrow();
});
it('bounds cache bytes without evicting live-build leases',()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/cache-test-'));
  try {
    const a=join(dir,'a.o'),b=join(dir,'b.o');writeFileSync(a,'aaaa');writeFileSync(b,'bbbb');
    const release=leaseCache(dir,[a]);
    expect(pruneCache(dir,0)).toEqual({bytes:4,removed:4,pinnedBytes:4});
    expect(readFileSync(a,'utf8')).toBe('aaaa'); release();
    expect(pruneCache(dir,0).bytes).toBe(0);
    // A drained generation cannot be pinned by kill(pid,0), even if its owner
    // remains alive/zombie. The writer barrier, not PID reuse/reaping, is authority.
    writeFileSync(a,'aaaa');const token=join(dir,'generation');writeFileSync(token+'.writers','');
    const done=withBuildWriters(token,()=>leaseCache(dir,[a]));
    expect(pruneCache(dir,0).pinnedBytes).toBe(4);
    rmSync(token+'.writers');expect(pruneCache(dir,0).bytes).toBe(0);done();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
it('generator is deterministic and native checksum equals the fully lifted large fixture',async()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/native-scale-'));
  try {
    const tiny=generate(dir,8),one=readFileSync(join(dir,tiny[0]));
    generate(dir,8);expect(readFileSync(join(dir,tiny[0]))).toEqual(one);
    const generated=join(ROOT,'node_modules/.cache/bgt/pipeline/x64-scale/fixture/generated');
    const sources=JSON.parse(readFileSync(join(generated,'sources.json'),'utf8')) as string[];
    const exe=join(dir,'native');
    execFileSync('cc',['-O2',...sources.map((f)=>join(generated,f)),'-o',exe]);
    const native=execFileSync(exe,[],{encoding:'utf8'}).trim();
    const h=await loadHeadless('x64-scale');await h.stepAsync(300);
    expect(h.logs.some((s)=>s.includes(native)),h.logs.join('\n')).toBe(true);
    expect(h.logs.some((s)=>s.includes('scale tick 240'))).toBe(true);
    expect((h.host.metrics() as any).interp_insns).toBe(0);
    const manifest=JSON.parse(readFileSync(join(ROOT,'web/public/games/x64-scale/manifest.json'),'utf8'));
    expect(manifest.pipeline.metrics.lifted_insns).toBeGreaterThanOrEqual(1_000_000);
    expect(manifest.pipeline.metrics.lifted_insns).toBeLessThanOrEqual(2_000_000);
    expect(manifest.pipeline.modules[0].functions).toBeGreaterThanOrEqual(10_000);
    expect(manifest.pipeline.modules[0].scale.chunks).toBeGreaterThan(1);
  } finally {rmSync(dir,{recursive:true,force:true});}
},120_000);
it('chunked lift is cached, byte stable, oracle-equivalent, and invalidated by codegen options',async()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/chunk-test-'));
  const id='x64-scale-chunk-test';
  const cfg={id,name:'chunks',pipeline:{platform:'win32',chunkInstructions:256,
    fixture:{target:'x86_64-windows-gnu',crt:true,out:'small.exe',sources:[] as string[]},modules:[{from:'./build/small.exe',main:true}]}};
  cfg.pipeline.fixture.sources=generate(dir,8);
  try {
    writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
    const a=buildGame(dir,{quiet:true});
    const b=buildGame(dir,{quiet:true});
    expect(b.pipeline.modules[0].scale.chunks_lifted).toBe(0);
    expect(b.pipeline.modules[0].scale.chunks_cached).toBe(a.pipeline.modules[0].scale.chunks);
    expect(b.pipeline.metrics.objects_compiled).toBe(0);
    expect(b.wasm.sha256).toBe(a.wasm.sha256);
    buildGame(dir,{quiet:true,interpretOnly:true});
    const r=await oracle(id,300);expect(r.identical).toBe(true);expect(r.errors).toEqual({lifted:null,interpreted:null});
    const h=await loadHeadless(id);await h.stepAsync(300);expect((h.host.metrics() as any).interp_insns).toBe(0);
    (cfg.pipeline as any).flagLiveness=true;writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
    const changed=buildGame(dir,{quiet:true});
    expect(changed.pipeline.modules[0].scale.chunks_lifted).toBe(changed.pipeline.modules[0].scale.chunks);
    expect(changed.pipeline.modules[0].scale.analysis_cached).toBe(true);
  } finally {
    rmSync(dir,{recursive:true,force:true});
    for(const name of [id,id+'-interp']) {rmSync(join(ROOT,'web/public/games',name),{recursive:true,force:true});rmSync(join(ROOT,'node_modules/.cache/bgt/pipeline',name),{recursive:true,force:true});}
  }
},120_000);
