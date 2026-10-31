/* LANE-K1: host entropy and scheduling must not hide behind a differential self-oracle. */
import { expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GameHost } from '../../bgt/runtime/host';
import { CAP_ENTROPY } from '../../bgt/runtime/abi';
import { Vfs } from '../../bgt/runtime/vfs';
import { compileC } from '../support/compile';
import { ROOT } from '../support/headless';
it('entropy uses Web Crypto, chunks above 64 KiB, changes between runs; validates ranges', async () => {
  const wasm = await compileC('tests/fixtures/c/entropy_probe.c');
  const outputs: number[][]=[];
  for(let run=0;run<2;run++) {
    const logs: string[]=[];
    const host=await GameHost.create(wasm,{vfs:new Vfs(),now:()=>0,log:(_l,s)=>logs.push(s),
      entropy: bytes=>{globalThis.crypto.getRandomValues(bytes);outputs.push([...bytes.subarray(0,32)]);}},
    {backend:3,caps:0,seed:1,displayWidth:1,displayHeight:1,arg0:0,arg1:0});
    host.init();host.update();
    expect(host.config.caps&CAP_ENTROPY).toBe(CAP_ENTROPY);
    expect(logs).toEqual(['entropy-ok']);
  }
  expect(outputs).toHaveLength(4);
  expect(outputs[0]).not.toEqual(outputs[2]);
});
it('default entropy source uses real Web Crypto without an injected replay hook', async () => {
  const logs:string[]=[];
  const host=await GameHost.create(await compileC('tests/fixtures/c/entropy_probe.c'),
    {vfs:new Vfs(),now:()=>0,log:(_l,s)=>logs.push(s)},
    {backend:3,caps:0,seed:1,displayWidth:1,displayHeight:1,arg0:0,arg1:0});
  host.init();host.update();expect(logs).toEqual(['entropy-ok']);
});
it('absent crypto clears the capability and returns E_UNSUPPORTED, never simulation bytes', async () => {
  const wasm=await compileC('tests/fixtures/c/entropy_probe.c');
  vi.stubGlobal('crypto', undefined);
  try {
    const logs:string[]=[];
    const host=await GameHost.create(wasm,{vfs:new Vfs(),now:()=>0,log:(_l,s)=>logs.push(s)},
      {backend:3,caps:CAP_ENTROPY,seed:1,displayWidth:1,displayHeight:1,arg0:0,arg1:0});
    expect(host.config.caps&CAP_ENTROPY).toBe(0);
    host.init();host.update();expect(logs).toEqual(['entropy-unavailable']);
  } finally { vi.unstubAllGlobals(); }
});
it('entropy provider failure returns E_IO, never a successful all-zero result', async () => {
  const logs:string[]=[];
  const host=await GameHost.create(await compileC('tests/fixtures/c/entropy_probe.c'),
    {vfs:new Vfs(),now:()=>0,log:(_l,s)=>logs.push(s),entropy: bytes=>{if(bytes.length)throw new Error('offline source');}},
    {backend:3,caps:0,seed:1,displayWidth:1,displayHeight:1,arg0:0,arg1:0});
  host.init();host.update();expect(logs).toEqual(['entropy-failed']);
});
it('late entropy failure leaves the whole guest buffer untouched after an earlier successful chunk', async () => {
  let calls=0;const logs:string[]=[];
  const host=await GameHost.create(await compileC('tests/fixtures/c/entropy_probe.c'),
    {vfs:new Vfs(),now:()=>0,log:(_l,s)=>logs.push(s),entropy: bytes=>{if(++calls===2)throw new Error('late failure');bytes.fill(0x42);}},
    {backend:3,caps:0,seed:1,displayWidth:1,displayHeight:1,arg0:0,arg1:0});
  host.init();host.update();expect(calls).toBe(2);expect(logs).toEqual(['entropy-failed']);
});
it('AVRT scheduler weights are 1:5:3, bounded and cannot be replenished to starve peers', () => {
  const dir=mkdtempSync(join(tmpdir(),'bgt-k1-sched-'));
  try {
    execFileSync('cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-I',join(ROOT,'platforms/x86'),
      join(ROOT,'tests/fixtures/c/sysdll_sched.c'),join(ROOT,'platforms/x86/x86_sched.c'),'-o',join(dir,'sched')]);
    execFileSync(join(dir,'sched'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
