// @bgt-examples: x64-input
// Breakage: dirty zero-sleeps must present once; recorder overflow must only transport.
import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { testSuspensionModes } from '../support/suspension-modes';
it('bounded recorder overflow flushes without a clock boundary or guest present',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-gdi-transport-')),exe=join(dir,'driver');
 try {
  execFileSync(process.env.CC??'cc',['-std=c11','-O1','-Wall','-Wextra','-Werror','-ffunction-sections','-fdata-sections',
   process.platform==='darwin'?'-Wl,-dead_strip':'-Wl,--gc-sections',
   '-I',join(ROOT,'bgt/include'),'-I',join(ROOT,'platforms/x86'),'-I',join(ROOT,'platforms/win32'),
   join(ROOT,'tests/native/gdi_transport_driver.c'),'-o',exe]);
  expect(execFileSync(exe,{encoding:'utf8'})).toContain('unchanged time, no present, restored draw state OK');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
for(const suspension of testSuspensionModes())it('dirty GDI Sleep(0) is exactly one frame '+suspension,async()=>{
 const h=await loadHeadless('x64-input',{suspension});
 await h.stepAsync(1);
 let us=h.host.guestTimeUs()!,presents=Number((h.host.metrics() as any).execution_summary.guest_frames.count);
 for(let i=0;i<5;i++) {
  await h.stepAsync(1);
  const next=h.host.guestTimeUs()!,m=h.host.metrics() as any;
  expect(next-us).toBe(16667);expect(Number(m.execution_summary.guest_frames.count)-presents).toBe(1);
  us=next;presents=Number(m.execution_summary.guest_frames.count);
 }
});
