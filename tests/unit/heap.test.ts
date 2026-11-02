// @bgt-examples: x64-heap x86-heap
// Catches linear-scan replacement breaking ownership, payloads, size/alignment, errno or flags.
import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
for(const width of [0,1])it(`native heap ${width?64:32}: 150000 randomized operations, bounded metadata work and full invariants`,()=>{
  const base=join(ROOT,'node_modules/.cache/bgt/heap-probe');mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,'native-'));
  try {
    const bin=join(dir,'probe');
    execFileSync('cc',['-std=c11','-O2','-Wall','-Wextra','-Werror',`-DW32_64=${width}`,join(ROOT,'tests/native/heap_driver.c'),'-o',bin]);
    expect(execFileSync(bin,[],{encoding:'utf8'}).trim()).toBe(`heap native width=${width?64:32} random=150000 invariants=PASS`);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
for(const nested of [false,true])it(`AMD64 exhausted backing: ${nested?'nested SEH fails truthfully':'caught STATUS_NO_MEMORY still dispatches its filter'}`,async()=>{
  const base=join(ROOT,'node_modules/.cache/bgt/heap-probe');mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,'exhaust-'));
  try {
    writeFileSync(join(dir,'heap.c'),'#define HEAP_EXHAUST 1\n'+(nested?'#define HEAP_NESTED 1\n':'')+readFileSync(join(ROOT,'examples/x64-heap/heap.c'),'utf8'));
    const config=JSON.parse(readFileSync(join(ROOT,'examples/x64-heap/game.json'),'utf8'));
    config.id=nested?'x64-heap-exhaust-nested':'x64-heap-exhaust';config.pipeline.memory={guestWindowMiB:128};
    config.pipeline.fixture.sources=['heap.c'];writeFileSync(join(dir,'game.json'),JSON.stringify(config));
    for(const interpretOnly of [false,true]){
      buildGame(dir,{interpretOnly,quiet:true});
      const h=await loadHeadless(config.id+(interpretOnly?'-interp':''));
      if(nested)await expect(h.stepAsync(300)).rejects.toThrow(/STATUS_NO_MEMORY.*nested SEH\/native callback continuation unsupported/);
      else {
        await h.stepAsync(300);
        expect(h.logs).toContain('guest: heap exhaustion PASS');
        expect(h.host.metrics()).toMatchObject({exited:1,stubs:[]});
      }
      expect(h.logs.filter(s=>s.includes('FAIL')),h.logs.join('\n')).toEqual([]);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
// Two cold fixture builds (lifted + interpreted), then 300 exhaustion frames each.
// Keep the real exhaustion/filter assertions; allow compiler FIFO contention on cold CI.
},300_000);
for (const id of ['x64-heap','x86-heap']) {
  it(`${id} heap/CRT contracts and exact-address 300-frame determinism`, async () => {
    const h=await loadHeadless(id);
    await h.stepAsync(300);
    expect(h.logs.filter(s=>s.includes('FAIL')),h.logs.join('\n')).toEqual([]);
    const total=h.logs.find(s=>/heap checks=\d+ failures=0$/.test(s));
    expect(total,h.logs.join('\n')).toBeDefined();
    expect(Number(total!.match(/checks=(\d+)/)![1])).toBeGreaterThan(1_400_000);
    expect(h.host.metrics()).toMatchObject({exited:1,interp_insns:0,stubs:[]});
    buildGame(`examples/${id}`,{interpretOnly:true,quiet:true});
    const diff=await oracle(id,300);
    expect(diff.errors).toEqual({lifted:null,interpreted:null});
    expect(diff.identical,JSON.stringify(diff)).toBe(true);
  },120_000);
  for(const operation of [1,2,3])it(`${id} GENERATE_EXCEPTIONS OOM ${['alloc','realloc','create'][operation-1]} cannot silently return`,async()=>{
    const base=join(ROOT,'node_modules/.cache/bgt/heap-probe');mkdirSync(base,{recursive:true});
    const dir=mkdtempSync(join(base,'case-'));
    try {
      writeFileSync(join(dir,'heap.c'),`/* Original CC0-1.0 failure-only guest probe. */
#include <windows.h>
unsigned _tls_index;
void entry(void);void (*volatile entry_ref)(void)=entry;
void entry(void){HANDLE h=HeapCreate(${operation===1?0:4},0,0);
 void *p=HeapAlloc(h,0,64);if(!h||!p){OutputDebugStringA("heap FAIL: setup");ExitProcess(2);}
 ${operation===1?'HeapAlloc(h,HEAP_GENERATE_EXCEPTIONS,(SIZE_T)-1);':operation===2?'HeapReAlloc(h,0,p,(SIZE_T)-1);':'HeapCreate(HEAP_GENERATE_EXCEPTIONS,(SIZE_T)-1,0);'}
 OutputDebugStringA("heap FAIL: exception returned");ExitProcess(9);}
`);
      const config=JSON.parse(readFileSync(join(ROOT,`examples/${id}/game.json`),'utf8'));
      config.id=`${id}-oom-${operation}`;config.pipeline.fixture.sources=['heap.c'];config.pipeline.fixture.libs=['kernel32'];
      writeFileSync(join(dir,'game.json'),JSON.stringify(config));
      for(const interpretOnly of [false,true]){
        buildGame(dir,{interpretOnly,quiet:true});
        const h=await loadHeadless(config.id+(interpretOnly?'-interp':''));
        await expect(h.stepAsync(300)).rejects.toThrow(/STATUS_NO_MEMORY \(0xc0000017\)/);
        expect(h.logs.filter(s=>s.includes('FAIL')),h.logs.join('\n')).toEqual([]);
      }
    } finally {rmSync(dir,{recursive:true,force:true});}
  },120_000);
}
