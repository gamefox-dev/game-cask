import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,loadHeadless} from '../support/headless';
import {prepareSlice} from '../support/slice-fixture';
import {OutsideSlice} from '../../bgt/runtime/host';
// @ts-expect-error plain ESM
import {buildGame} from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import {staticClosure} from '../../tools/build/coverage.mjs';

it('static call closure lifts recorded callees but not unrelated functions',()=>{
 expect(staticClosure({functions:[{addr:1,calls:[2]},{addr:2,calls:[3]},{addr:3,calls:[]},{addr:4,calls:[]}]},new Set([1]))).toEqual([1,2,3]);
});
it('strict slice packages covered functions/data only, boots, pauses at an uncovered entry and rejects mismatched evidence',async()=>{
 const f=await prepareSlice();
 expect(f.snapshot.code.length).toBeGreaterThan(0);expect(f.sliced.slice.code.length).toBeGreaterThanOrEqual(f.snapshot.code.length);
 expect(f.sliced.packaging.file_chunk_bytes).toBe(0);expect(f.sliced.streams.length).toBeGreaterThan(0);
 for(const file of f.sliced.streams)for(const chunk of file.chunks)expect(existsSync(join(ROOT,'web/public/games',f.id,chunk.url))).toBe(false);
 expect(f.sliced.assets[0].path).toMatch(/^loader\//);
 const h=await loadHeadless(f.id);await h.stepAsync(20);expect(h.host.commandErrorCount).toBe(0);
 expect(f.sliced.packaging.download_bytes_raw).toBeGreaterThan(f.sliced.wasm.size);
 // Native runtime invokes a coverage hook; an empty allowlist must fail at the first real code entry, not trap.
 const wasm=readFileSync(join(ROOT,'web/public/games',f.id,'game.wasm'));
 const {GameHost}=await import('../../bgt/runtime/host');const {Vfs}=await import('../../bgt/runtime/vfs');
 const vfs=new Vfs();for(const a of f.sliced.assets)vfs.add(a.path,new Uint8Array(readFileSync(join(ROOT,'web/public/games',f.id,'assets',a.path))));
 const host=await GameHost.create(wasm,{log:()=>{},vfs,now:()=>0},{backend:3,caps:0,seed:1,displayWidth:640,displayHeight:360,arg0:0,arg1:0,sliceCode:[]});host.init();
 expect(()=>host.update()).toThrow(OutsideSlice);
 const cfg=JSON.parse(readFileSync(join(f.dir,'game.json'),'utf8'));delete cfg.slice;cfg.id='coverage-fallback-fixture';cfg.pipeline.coverage=['coverage.json'];writeFileSync(join(f.dir,'game.json'),JSON.stringify(cfg));
 buildGame(f.dir,{quiet:true});const fallback=await loadHeadless(cfg.id);await fallback.stepAsync(5);
 const click=async(r:number[])=>{fallback.pointer(r[0]+Math.floor(r[2]/2),r[1]+Math.floor(r[3]/2),1);await fallback.stepAsync(1);fallback.pointer(r[0]+Math.floor(r[2]/2),r[1]+Math.floor(r[3]/2),0);await fallback.stepAsync(2);};
 await click((fallback.state() as any).ui.menubar.items[0].rect);await click((fallback.state() as any).ui.popup.items[1].rect);
 expect((fallback.state() as any).ui.windows.some((w:any)=>w.dialog)).toBe(true);expect((fallback.host.metrics() as any).interp_insns).toBeGreaterThan(0);
 expect([...fallback.host.codeCoverage.values()].some((kind)=>(kind&2)!==0)).toBe(true);
 const coverage=JSON.parse(readFileSync(join(f.dir,'coverage.json'),'utf8'));coverage.modules[0].sha256='0'.repeat(64);writeFileSync(join(f.dir,'coverage.json'),JSON.stringify(coverage));
 expect(()=>buildGame(f.dir,{check:true,quiet:true})).toThrow(/identity mismatch/);
},120_000);
