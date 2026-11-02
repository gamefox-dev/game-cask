// @bgt-examples: x64-contracts x64-gl-default-vao
// Each fixture assertion states an API contract and checks output/error/ownership, not just lookup.
import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/headless';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP } from '../../bgt/runtime/abi';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { runtimeRegistry, importStatus } from '../../tools/x86/imports-coverage.mjs';

it('normal MinGW startup, FILE ABI and existing DLL contracts have checked outcomes', async () => {
  const h = await loadHeadless('x64-contracts');
  try {
    for(let i=0;i<100&&!h.logs.some((s)=>s.endsWith('tracking ready'));i++)await h.stepAsync(1);
    expect(h.logs.some((s)=>s.endsWith('tracking ready'))).toBe(true);
    h.pointer(20,20,0);await h.stepAsync(10);h.pointer(350,250,0);await h.stepAsync(300);
  } catch (e) { throw new Error(`${e}\n${h.logs.join('\n')}`); }
  expect(h.logs.filter((s) => s.endsWith('tracking hover')), h.logs.join('\n')).toHaveLength(1);
  expect(h.logs.filter((s) => s.endsWith('tracking leave'))).toHaveLength(1);
  expect(h.logs.some((s) => s.includes('tracking totals hover=1 leave=1'))).toBe(true);
  expect(h.logs.filter((s) => /FAIL|missing |BAD_/.test(s)), h.logs.join('\n')).toEqual([]);
  const total = h.logs.find((s) => s.includes('contracts totals'));
  expect(total, h.logs.join('\n')).toMatch(/checks=\d+ failures=0/);
  expect(h.logs.filter((s) => /contract .* PASS/.test(s)).length).toBeGreaterThanOrEqual(133);
  const m = h.host.metrics() as any;
  expect(m.stubs).toEqual([]);
  expect(m.interp_insns).toBe(0);
  expect(h.logs).toContain('guest CRT fatal runtime error');
  expect(h.logs.some((s) => s.includes('fixture: No such file or directory')), h.logs.join('\n')).toBe(true);
  expect(m.exited).toBe(1);
  buildGame('examples/x64-contracts', { interpretOnly: true, quiet: true });
  const result = await oracle('x64-contracts', 300);
  expect(result.errors).toEqual({ lifted: null, interpreted: null });
  expect(result.identical).toBe(true);
}, 120_000);

it('census includes every runtime registry, with width/precedence and genuinely missing names', () => {
  for (const machine of ['i386', 'x86-64']) {
    const entries = runtimeRegistry(machine);
    expect(entries.length).toBeGreaterThan(900);
    for (const [dll, name] of [
      ['ole32.dll', 'CoCreateInstance'], ['ole32.dll', 'CoInitialize'],
      ['ole32.dll', 'CoTaskMemFree'], ['ole32.dll', 'PropVariantClear'],
      ['user32.dll', 'GetRawInputData'], ['user32.dll', 'RegisterRawInputDevices'],
    ]) expect(importStatus(name, dll, machine).status, `${machine} ${name}`).toBe('implemented');
    expect(importStatus('Sleep', 'kernel32.dll', machine).group).toBe('threads');
    expect(importStatus('CreateProcessW','kernel32.dll',machine)).toMatchObject({status:'implemented',capability:'failure-only'});
    expect(importStatus('CreatePolygonRgn','gdi32.dll',machine).capability).toBe('failure-only');
    expect(importStatus('GetThreadContext','kernel32.dll',machine).capability).toBe('failure-only');
    expect(importStatus('TrackMouseEvent','user32.dll',machine).capability).toBeUndefined();
    expect(importStatus('FlushInstructionCache', 'kernel32.dll', machine).status).toBe('stub');
    for (const name of ['glMapBuffer', 'glMapBufferRange', 'glFlushMappedBufferRange', 'glUnmapBuffer', 'glGetBufferPointerv'])
      expect(importStatus(name, 'opengl32.dll', machine).status, `${machine} ${name}`).toBe('implemented');
    expect(importStatus('glFenceSync', 'opengl32.dll', machine).status).toBe('stub');
    expect(importStatus('ThisNameDoesNotExist', 'user32.dll', machine).status).toBe('unknown');
    expect(importStatus('Sleep', 'absent-dll.dll', machine).status).toBe('unknown');
  }
  expect(importStatus('llround', 'msvcrt.dll', 'i386').status).toBe('unknown');
  expect(importStatus('llround', 'msvcrt.dll', 'x86-64').status).toBe('implemented');
  expect(importStatus('VirtualQuery', 'kernel32.dll').group).toBe('kernel');
});

// Real compiled Win64 profile calls, not registry metadata or fabricated map success.
// Pixel/generated-value checks belong to the required-device fixture; this recorder checks owned CPU bytes.
it('glMapBuffer/glUnmapBuffer commit real mapped writes and retain them across named VAOs', async () => {
  const stream = glStream(), h = await loadHeadless('x64-gl-default-vao', stream);
  for (let i = 0; i < 160 && !h.logs.some(l => /x64-gl-default-vao (PASS|FAIL) failures=/.test(l)); i++)
    await h.stepAsync(1);
  expect(h.logs.some(l => /x64-gl-default-vao (PASS|FAIL) failures=/.test(l)), h.logs.join('\n')).toBe(true);
  for (const label of ['VAO0 map whole', 'VAO0 unmap whole', 'VAO0 map explicit', 'VAO0 unmap explicit',
    'VAO0 map invalidate', 'VAO0 unmap invalidate', 'all five index ranges retained', 'VAO0 upload errors',
    'real VAO map', 'real VAO unmap', 'Win64 mapped pointer query', 'mapped flags query',
    'mapped index draw rejected', 'mapped subdata rejected'])
    expect(h.logs, label).toContain('guest: x64-gl-default-vao ok ' + label);
  // Whole-buffer map changes bytes24..35 before unmap. A fake pointer/success return cannot emit these bytes.
  const whole = stream.items.find(i => i.op === GPU_OP.BUFFER_UPDATE && i.words[0] === 10 &&
    i.words[1] === 0 && i.data?.length === 49152);
  expect(whole).toBeDefined();
  expect(Array.from(whole!.data!.slice(24, 36))).toEqual([0,0,1,0,2,0,2,0,1,0,3,0]);
  // Explicit flush commits the quad at36; subsequent guest memset must NOT leak on unmap.
  const explicit = stream.items.find(i => i.op === GPU_OP.BUFFER_UPDATE && i.words[0] === 10 && i.words[1] === 36);
  expect(explicit).toBeDefined();
  expect(Array.from(explicit!.data!)).toEqual([0,0,1,0,2,0,2,0,1,0,3,0]);
  expect(h.host.commandErrorCount).toBe(0);
  const metrics = h.host.metrics() as any;
  expect(metrics.gl_unimplemented).toBe(0); expect(metrics.gl_stubs).toEqual([]);
}, 120_000);

for (const [machine, target] of [['i386', 'x86-windows-gnu'], ['x86-64', 'x86_64-windows-gnu']]) {
  it(`census and runtime GetProcAddress agree for every ${machine} registered symbol`, async () => {
    const root = join(ROOT, 'node_modules/.cache/bgt/registry-parity');
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'case-'));
    try {
      const names = [...new Set(runtimeRegistry(machine).map((e: any) => e.name))] as string[];
      writeFileSync(join(dir, 'registry.c'), `/* Original generated CC0 registry probe. */
#include <windows.h>
unsigned _tls_index;
static const char *names[]={${names.map((n) => JSON.stringify(n)).join(',')}};
void entry(void){
 HMODULE h=LoadLibraryA("kernel32.dll");unsigned failed=0;
 for(unsigned i=0;i<sizeof names/sizeof *names;i++)if(!GetProcAddress(h,names[i])){OutputDebugStringA(names[i]);failed++;}
 if(GetProcAddress(h,"NeverRegisteredContractName"))failed++;
 OutputDebugStringA(failed?"registry parity FAIL":"registry parity PASS");ExitProcess(failed);
}
`);
      writeFileSync(join(dir, 'game.json'), JSON.stringify({ id: `registry-${machine}`, name: 'CC0 registry parity',
        pipeline: { platform: 'win32', fixture: { target, sources: ['registry.c'], out: 'registry.exe', entry: 'entry', libs: ['kernel32'] },
          modules: [{ from: './build/registry.exe', main: true }] } }));
      buildGame(dir, { quiet: true, outRoot: dir });
      const h = await loadHeadless(`registry-${machine}`, { dir: join(dir, `registry-${machine}`) });
      await h.stepAsync(10);
      expect(h.logs.filter((s) => s.startsWith('guest: '))).toEqual(['guest: registry parity PASS']);
      expect(names.length).toBeGreaterThan(machine === 'i386' ? 900 : 1300);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  for (const [operation, protection, code] of [
    ['readonly-write', 'PAGE_READONLY', '*p=7;'],
    ['noaccess-read', 'PAGE_NOACCESS', 'if(*p)ExitProcess(3);'],
    ['nonexecutable-call', 'PAGE_READWRITE', '((void (*)(void))p)();'],
    ['readonly-crt-write', 'PAGE_READONLY', '((void *(*)(void *,int,size_t))GetProcAddress(LoadLibraryA("msvcrt.dll"),"memset"))((void *)p,7,4);'],
    ['noaccess-crt-read', 'PAGE_NOACCESS', '((int (*)(const void *,const void *,size_t))GetProcAddress(LoadLibraryA("msvcrt.dll"),"memcmp"))((void *)p,"abc",3);'],
  ]) {
    it(`${machine} ${operation} faults in lifted and interpreted memory paths`, async () => {
      const root = join(ROOT, 'node_modules/.cache/bgt/registry-parity');
      mkdirSync(root, { recursive: true });
      const dir = mkdtempSync(join(root, 'protect-'));
      try {
        writeFileSync(join(dir, 'probe.c'), `/* Original CC0 memory access probe. */
#include <windows.h>
unsigned _tls_index;
void entry(void);void (*volatile entry_ref)(void)=entry;
void entry(void){volatile char *p=VirtualAlloc(0,4096,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
 DWORD old;*p=(char)0xc3;
 if(!VirtualProtect((void *)p,4096,${protection},&old)||old!=PAGE_READWRITE){OutputDebugStringA("BAD protection");ExitProcess(2);}
 ${code}
 OutputDebugStringA("BAD access permitted");ExitProcess(1);
}
`);
        const id = `protect-${machine}-${operation}`;
        writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 page protection probe',
          pipeline: { platform: 'win32', fixture: { target, sources: ['probe.c'], out: 'probe.exe', entry: 'entry', libs: ['kernel32'] },
            modules: [{ from: './build/probe.exe', main: true }] } }));
        for (const interpretOnly of [false, true]) {
          const outRoot = join(dir, interpretOnly ? 'interpreted' : 'lifted');
          buildGame(dir, { interpretOnly, quiet: true, outRoot });
          const h = await loadHeadless(id, { dir: join(outRoot, id + (interpretOnly ? '-interp' : '')) });
          await expect(h.stepAsync(10)).rejects.toThrow(/guest memory access violation/);
          expect(h.logs.filter((s) => s.includes('BAD'))).toEqual([]);
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, 120_000);
  }
}
