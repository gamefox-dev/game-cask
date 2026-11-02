// Original CC0 regression: a hand-written suspending override is NOT a native generated wrapper.
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT,loadHeadless} from '../support/headless';
// @ts-expect-error ESM build tool
import {buildGame} from '../../tools/build/build.mjs';
// @ts-expect-error ESM analyzer
import {x86tool} from '../../tools/build/pipeline.mjs';
it('keeps a real yield inside a measured override instrumented while excluding only generated wrappers',async()=>{
 const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/asyncify-override-')),id=basename(dir).toLowerCase();
 try {
  writeFileSync(join(dir,'guest.c'),'/* Original CC0 */\n#include <windows.h>\nint _tls_index;\n__declspec(dllexport) __declspec(noinline) unsigned target(unsigned x){return x+7;}\nunsigned (*volatile target_ptr)(unsigned)=target;\nvoid entry(void){char s[80];unsigned x=target_ptr(5);wsprintfA(s,"override result %u",x);OutputDebugStringA(s);for(;;)Sleep(5);}\n');
  const cfg={id,name:'CC0 suspending override',pipeline:{platform:'win32',fixture:{target:'x86_64-windows-gnu',sources:['guest.c'],out:'guest.exe',entry:'entry',libs:['kernel32','user32']},modules:[{from:'./build/guest.exe',main:true}]}};
  writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
  const initial=buildGame(dir,{quiet:true});
  const base=initial.pipeline.modules[0].base;
  const pe=join(ROOT,'node_modules/.cache/bgt/pipeline',id,'fixture/guest.exe');
  const analysis=JSON.parse(execFileSync(x86tool(),['analyze',pe,'--base',base.toString(16)],{encoding:'utf8'}));
  const address=analysis.exports.find((e:{name:string})=>e.name==='target').addr;
  mkdirSync(join(dir,'overrides'));
  writeFileSync(join(dir,'overrides/target.c'),`/* CC0 test-only measured exception: prove override Asyncify safety. */\n#include "x86_lift.h"\n#include "bgt.h"\nextern void w32_wait_frame(void);\nX86_OVERRIDE(${address.toString(16).padStart(8,'0')}){unsigned value=(unsigned)X.r[ECX];w32_wait_frame();w32_wait_frame();X.r[EAX]=value+7;X.eip=x86_address(x86_pop());}\n`);
  const m=buildGame(dir,{quiet:true});expect(m.pipeline.exceptions.overrides).toEqual(['0x'+address.toString(16)]);
  const h=await loadHeadless(id);await h.stepAsync(10);
  expect(h.logs).toContain('guest: override result 12');expect(h.host.yields).toBeGreaterThanOrEqual(2);
  expect(h.host.metrics()).toMatchObject({interp_insns:0,stubs:[]});
  expect(readFileSync(join(ROOT,'web/public/games',id,'manifest.json'),'utf8')).toContain('amd64-native-boundaries');
  // An entirely overridden selection legitimately has no generated wrappers/names to remove.
  const entry=analysis.entry;
  writeFileSync(join(dir,'overrides/entry.c'),`/* CC0 all-overridden selection regression. */\n#include "x86_lift.h"\nextern void w32_wait_frame(void);extern void w32_log(const char *);\nX86_OVERRIDE(${entry.toString(16).padStart(8,'0')}){w32_wait_frame();w32_wait_frame();w32_log("all overridden");X.eip=x86_address(x86_pop());}\n`);
  const all=buildGame(dir,{quiet:true});expect(all.pipeline.metrics.asyncify_remove_count).toBe(0);
  const complete=await loadHeadless(id);await complete.stepAsync(10);expect(complete.logs).toContain('all overridden');
  expect(complete.host.metrics()).toMatchObject({interp_insns:0,exited:1,stubs:[]});
 } finally {
  for(const p of [dir,join(ROOT,'web/public/games',id),join(ROOT,'node_modules/.cache/bgt/pipeline',id)])rmSync(p,{recursive:true,force:true});
 }
},120000);
