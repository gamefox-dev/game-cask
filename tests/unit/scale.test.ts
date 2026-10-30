import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
// @ts-expect-error plain ESM
import { buildFixture, x86tool } from '../../tools/build/pipeline.mjs';
// @ts-expect-error plain ESM
import { analyzePeMetadata } from '../../tools/x86/pe-metadata.mjs';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
import { oracle } from '../oracle/oracle';

const temp = () => mkdtempSync(join(ROOT,'node_modules/.cache/bgt/scale-'));

it('x64 metadata reports full-width base/unwind records and the pipeline now lifts that image', () => {
  const dir=temp();
  const exe=buildFixture(join(ROOT,'tests/fixtures/win32'),{sources:['wide.c'],out:'wide.exe',entry:'entry',libs:['kernel32'],target:'x86_64-windows-gnu'},dir);
  const m=analyzePeMetadata(exe);
  expect(m.pe32plus).toBe(true); expect(BigInt(m.imageBase)).toBeGreaterThan(0xffffffffn);
  expect(m.runtimeFunctions.length).toBeGreaterThan(0); expect(m.runtimeFunctions.every((r: any)=>r.version===1)).toBe(true);
  expect(m.conversion.supported).toBe(true); expect(m.errors).toEqual([]);
  const cli=execFileSync(process.execPath,[join(ROOT,'tools/x86/analyze-cli.mjs'),exe,'--metadata'],{encoding:'utf8'});
  expect(JSON.parse(cli).runtimeFunctions).toEqual(m.runtimeFunctions);
  writeFileSync(join(dir,'game.json'),JSON.stringify({id:'scale-wide',name:'wide',pipeline:{platform:'win32',modules:[{from:'./wide.exe',main:true}]}}));
  const built=buildGame(dir,{check:true,quiet:true});
  expect(built.pipeline.modules[0].base).toBeLessThan(0x100000000);
  expect(built.pipeline.modules[0].functions).toBeGreaterThan(0);
  expect(built.pipeline.metrics.lifted_insns).toBeGreaterThan(0);
  expect(built.pipeline.exceptions.overrides).toEqual([]);
},120_000);

it('local flag liveness shrinks generated flag work while both builds retain identical API traces', async () => {
  const dir=temp(), fx=join(ROOT,'node_modules/.cache/bgt/pipeline/win32-hello/fixture/hello.exe');
  const live=join(dir,'live.c'), full=join(dir,'full.c');
  execFileSync(x86tool(),['lift',fx,'--name','fixture','--out',live,'--flag-liveness','on'],{stdio:'ignore'});
  execFileSync(x86tool(),['lift',fx,'--name','fixture','--out',full,'--flag-liveness','off'],{stdio:'ignore'});
  expect(JSON.parse(readFileSync(live+'.stats.json','utf8')).flagsElided).toBeGreaterThan(0);
  expect(JSON.parse(readFileSync(full+'.stats.json','utf8')).flagsElided).toBe(0);
  expect(readFileSync(live,'utf8').split('xs_alu(').length).toBeLessThan(readFileSync(full,'utf8').split('xs_alu(').length);
  const man=JSON.parse(readFileSync(join(ROOT,'web/public/games/win32-hello/manifest.json'),'utf8'));
  expect(man.pipeline.metrics.wasm_bytes_per_insn).toBeGreaterThan(0);
  cpSync(join(ROOT,'examples/win32-hello/src'),join(dir,'src'),{recursive:true});
  const cfg=JSON.parse(readFileSync(join(ROOT,'examples/win32-hello/game.json'),'utf8')); cfg.id='scale-flag-oracle'; cfg.pipeline.flagLiveness=true;
  writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
  buildGame(dir,{quiet:true}); buildGame(dir,{quiet:true,interpretOnly:true});
  const r=await oracle('scale-flag-oracle',100);
  expect(r.identical).toBe(true); expect(r.errors).toEqual({lifted:null,interpreted:null});
  const h=await loadHeadless('scale-flag-oracle'); h.step(5); expect((h.host.metrics() as any).interp_insns).toBe(0);
},120_000);

it('measured object cache reuses compilation, with unchanged wasm bytes', () => {
  const dir=temp(); mkdirSync(join(dir,'src'));
  writeFileSync(join(dir,'src/entry.c'),'#include <windows.h>\nint _tls_index; void entry(void){Sleep(1);ExitProcess(0);}\n');
  writeFileSync(join(dir,'game.json'),JSON.stringify({id:'scale-cache',name:'cache',pipeline:{platform:'win32',fixture:{sources:['src/entry.c'],out:'cache.exe',entry:'entry',libs:['kernel32']},modules:[{from:'./build/cache.exe',main:true}]}}));
  const a=buildGame(dir,{outRoot:join(dir,'out'),quiet:true});
  const bytes=readFileSync(join(dir,'out/scale-cache/game.wasm'));
  const b=buildGame(dir,{outRoot:join(dir,'out'),quiet:true});
  expect(b.pipeline.metrics.asyncify_cached).toBe(true);
  expect(b.pipeline.metrics.objects_compiled).toBe(0); expect(b.pipeline.metrics.objects_cached).toBeGreaterThan(0);
  expect(b.pipeline.metrics.peak_child_rss_bytes).toBeGreaterThan(0);
  expect(readFileSync(join(dir,'out/scale-cache/game.wasm'))).toEqual(bytes);
  expect(a.pipeline.metrics.wasm_bytes).toBe(b.pipeline.metrics.wasm_bytes);
},120_000);
