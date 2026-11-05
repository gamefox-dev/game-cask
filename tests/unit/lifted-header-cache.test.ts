// @bgt-examples: none
// CC0 harness: exercise a copy of the real helper header, never mutate shared source.
import { basename, join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ROOT } from '../support/headless';
// @ts-expect-error plain ESM build tool
import { buildGame } from '../../tools/build/build.mjs';

it('helper-header edits invalidate dependent objects, linked/JSPI wasm and Asyncify artifacts',()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/lifted-header-'));
  const id=basename(dir).toLowerCase();
  const header=join(dir,'helper.h');
  const original=readFileSync(join(ROOT,'platforms/x86/x86_lift64.h'),'utf8');
  const expression='return xl_alu(op, a, b, n, flags, F_CF | F_PF | F_AF | F_ZF | F_SF | F_OF);';
  expect(original.split(expression)).toHaveLength(2);
  try {
    writeFileSync(header,original);
    writeFileSync(join(dir,'helper.c'),[
      '#define X86_WIDE_CPU 1',
      '#include "helper.h"',
      '__attribute__((export_name("cache_alu"))) uint32_t cache_alu(uint32_t a,uint32_t b){uint32_t f=0;return (uint32_t)xl_alu_full(XO_ADD,a,b,4,&f)^f;}',
    ].join('\n'));
    writeFileSync(join(dir,'entry.c'),
      '__declspec(dllimport) void __stdcall ExitProcess(unsigned); int _tls_index; static void (*volatile entry_anchor)(void); void entry(void){entry_anchor=entry;ExitProcess(0);}'+'\n');
    writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 helper cache',sources:['helper.c'],pipeline:{
      platform:'win32',suspensionBuild:'dual',fixture:{target:'x86-windows-gnu',out:'entry.exe',sources:['entry.c'],libs:['kernel32']},
      modules:[{from:'./build/entry.exe',main:true}],
    }}));
    let linked:Buffer=Buffer.alloc(0);
    const build=()=>buildGame(dir,{quiet:true,onLinkedWasm:(file:string)=>{linked=readFileSync(file);}});
    const first=build(),firstLinked=Buffer.from(linked);
    const warm=build();
    expect(warm.pipeline.metrics.objects_compiled).toBe(0);
    expect(warm.pipeline.metrics.asyncify_cached).toBe(true);
    expect(warm.wasm.sha256).toBe(first.wasm.sha256);
    expect(warm.variants.jspi.sha256).toBe(first.variants.jspi.sha256);
    // Private cache-sensitivity mutation only: change the copied helper's result,
    // keeping every source/config byte fixed. This altered helper is never shipped.
    writeFileSync(header,original.replace(expression,expression.replace(';',' ^ 1u;')));
    const changed=build();
    expect(changed.pipeline.metrics.objects_compiled).toBe(1);
    expect(changed.pipeline.metrics.object_cache_decisions.some((o:any)=>o.source.endsWith('/helper.c') &&
      o.reasons.some((r:any)=>r.input==='header' && r.path.endsWith('/helper.h')))).toBe(true);
    expect(linked).not.toEqual(firstLinked);
    expect(changed.variants.jspi.sha256).not.toBe(first.variants.jspi.sha256);
    expect(changed.wasm.sha256).not.toBe(first.wasm.sha256);
    expect(changed.pipeline.metrics.asyncify_cached).toBe(false);
    const changedWarm=build();
    expect(changedWarm.pipeline.metrics.objects_compiled).toBe(0);
    expect(changedWarm.pipeline.metrics.asyncify_cached).toBe(true);
    expect(changedWarm.wasm.sha256).toBe(changed.wasm.sha256);
    expect(changedWarm.variants.jspi.sha256).toBe(changed.variants.jspi.sha256);
  } finally {
    rmSync(dir,{recursive:true,force:true});
    rmSync(join(ROOT,'web/public/games',id),{recursive:true,force:true});
    rmSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id),{recursive:true,force:true});
  }
},60_000);
