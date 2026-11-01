// Catches pseudo-handle truncation, alias lifetime/rights/flags bugs and scheduler-slot consumption.
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { importStatus, runtimeRegistry } from '../../tools/x86/imports-coverage.mjs';

for(const id of ['x64-handles','x86-handles']) it(`${id}: owned handles preserve Windows object identity, rights and lifetime`, async () => {
  const h=await loadHeadless(id);
  try { await h.stepAsync(300); } catch(e) { throw new Error(`${e}\n${h.logs.join('\n')}`); }
  expect(h.logs.filter(s=>s.includes('FAIL')),h.logs.join('\n')).toEqual([]);
  expect(h.logs.some(s=>/handles checks=\d+ failures=0 PASS$/.test(s)),h.logs.join('\n')).toBe(true);
  expect(h.host.metrics()).toMatchObject({interp_insns:0,stubs:[],exited:1});
  expect(h.logs.filter(s=>s.startsWith('guest stdout: ')).map(s=>s.slice(14)).join('')).toBe('A'.repeat(127)+'\0'+'A'.repeat(171)+'Z');
  const manifest=JSON.parse(readFileSync(join(ROOT,`web/public/games/${id}/manifest.json`),'utf8'));
  expect(manifest.pipeline.fixture).toMatchObject(id==='x64-handles'?{normalCrt:true,optimization:'-O2'}:{normalCrt:false,optimization:'-O1'});
  buildGame(`examples/${id}`,{interpretOnly:true,quiet:true});
  const result=await oracle(id,300);
  expect(result.errors).toEqual({lifted:null,interpreted:null});
  expect(result.identical,JSON.stringify(result)).toBe(true);
},120_000);

it('both width registries distinguish result-producing handles from unavailable context/process creation',()=>{
  for(const width of ['i386','x86-64']) {
    for(const name of ['GetStdHandle','DuplicateHandle','CloseHandle','GetHandleInformation','SetHandleInformation',
      'OpenThread','OpenProcess','GetThreadId','GetProcessId','GetExitCodeThread','GetExitCodeProcess','TerminateProcess']) {
      expect(importStatus(name,'kernel32.dll',width)).toEqual({status:'implemented',group:'threads'});
      expect(runtimeRegistry(width).filter((e:any)=>e.name===name)).toHaveLength(1);
    }
    /* K6d: deletion is now a real (tombstoning) contract, no longer an advertised-success stub. */
    for(const name of ['RegDeleteValueA','RegDeleteValueW']) {
      expect(importStatus(name,'advapi32.dll',width)).toEqual({status:'implemented',group:'kernel'});
      expect(runtimeRegistry(width).filter((e:any)=>e.name===name)).toHaveLength(1);
    }
    for(const name of ['GetThreadContext','SetThreadContext','CreateProcessW','CreatePipe'])
      expect(importStatus(name,'kernel32.dll',width)).toMatchObject({status:'implemented',capability:'failure-only'});
  }
});
