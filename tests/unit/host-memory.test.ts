// @bgt-examples: none
// Original CC0-1.0: real wasm runtime backing, host malloc errno, FILE ferror/no read before OOM.
import { expect, it } from 'vitest';
import { compileC } from '../support/compile';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
// @ts-expect-error plain ESM build tool
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM build tool
import { runPipeline, hostArenaSize } from '../../tools/build/pipeline.mjs';

it('real bounded host reservation: GL pressure, CRT/FILE ENOMEM, exact recovery and read bytes', async () => {
  const wasm = await compileC('tests/fixtures/c/host_memory.c', ['_GNU_SOURCE', 'X86_FLAT_GUEST=1', 'X86_HOST_ARENA_BYTES=16u*1048576u'], true, ['platforms/x86','platforms/win32']);
  const logs: string[] = [];
  const { instance } = await WebAssembly.instantiate(wasm, { bgt: {
    log: (_level: number, ptr: number, n: number) => logs.push(new TextDecoder().decode(new Uint8Array(memory.buffer,ptr,n))),
    abort: () => { throw new Error('unexpected runtime fault'); },
  }});
  const memory = instance.exports.memory as WebAssembly.Memory;
  const ex = instance.exports as unknown as { check_host: () => number; host_limit: () => number };
  expect(ex.host_limit()).toBe(16*1024**2);
  expect(ex.check_host(), 'failing C assertion line').toBe(0);
  expect(logs.some(s => /consumer=crt size=65536 .*used=\d+ .*limit=16777216/.test(s))).toBe(true);
  expect(logs.some(s => /consumer=file size=16384 .*used=\d+ .*limit=16777216/.test(s))).toBe(true);
}, 30_000);

it('validates host reservation settings before any pipeline build or filesystem mutation', () => {
  expect(hostArenaSize()).toBe(64); expect(hostArenaSize({hostArenaMiB:null})).toBe(64);
  for (const hostArenaMiB of [16,32,64,128,512]) expect(hostArenaSize({hostArenaMiB})).toBe(hostArenaMiB);
  for (const hostArenaMiB of [0,15,513,1.5,'64']) {
    expect(() => runPipeline('', {pipeline:{memory:{hostArenaMiB}}}, '')).toThrow(/hostArenaMiB/);
  }
});

it('host reservation configuration reaches generated compiler flags, manifest and actual runtime', async () => {
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/host-config-'));
  try {
    writeFileSync(join(dir,'host.c'), `/* Original CC0-1.0. */
#include <windows.h>
unsigned _tls_index;
void entry(void);void (*volatile entry_ref)(void)=entry;
void entry(void){ExitProcess(0);}
`);
    writeFileSync(join(dir,'game.json'),JSON.stringify({id:'x64-host-config',name:'CC0 bounded host config',private:false,license:'CC0-1.0',
      pipeline:{platform:'win32',memory:{hostArenaMiB:32,guestWindowMiB:128},fixture:{target:'x86_64-windows-gnu',sources:['host.c'],out:'host.exe',libs:['kernel32']},modules:[{from:'./build/host.exe',main:true}]}}));
    buildGame(dir,{quiet:true});
    const manifest=JSON.parse(readFileSync(join(ROOT,'web/public/games/x64-host-config/manifest.json'),'utf8'));
    expect(manifest.memory).toMatchObject({hostArenaMiB:32,guestWindowMiB:128});
    const h=await loadHeadless('x64-host-config');await h.stepAsync(4);
    expect(h.host.metrics()).toMatchObject({host_limit:32*1024**2,exited:1,interp_insns:0,stubs:[]});
  } finally {rmSync(dir,{recursive:true,force:true});rmSync(join(ROOT,'web/public/games/x64-host-config'),{recursive:true,force:true});}
}, 60_000);
