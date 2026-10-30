// Breakages caught: recursive worker deadlocks, lost CV wakes, shared TLS, corrupt guest stacks,
// wrong thread exit codes, non-deterministic arbitration and interpreting lifted continuations.
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../support/headless';
import { oracle } from '../oracle/oracle';
import { nativeThreads } from '../support/native-threads';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { importStatus } from '../../tools/x86/imports-coverage.mjs';

it('normal CRT -O2 worker pool matches native source, fully lifted and deterministic for 300 frames', async () => {
  const reference = nativeThreads();
  expect(reference).toBe('threads checksum=d494e6e3159c5fea processed=96 exits=406 errors=0 PASS');
  const hashes: (string | null)[][] = [];
  for (let run = 0; run < 2; run++) {
    const h = await loadHeadless('x64-threads');
    const sequence: (string | null)[] = [];
    try {
      for (let i = 0; i < 300; i++) { await h.stepAsync(1); sequence.push(h.host.stateHash()); }
    } catch (e) { throw new Error(`${e}\n${h.logs.join('\n')}`); }
    expect(h.logs.some((s) => s.endsWith(reference)), h.logs.join('\n')).toBe(true);
    const m = h.host.metrics() as any;
    expect(m.interp_insns).toBe(0);
    expect(m.stubs).toEqual([]);
    expect(m.exited).toBe(1);
    expect(m.apis_hit).toEqual(expect.arrayContaining(['CreateThread', '_beginthreadex',
      'SleepConditionVariableCS', 'WaitForMultipleObjects', 'WaitForSingleObject', 'ReleaseSemaphore']));
    hashes.push(sequence);
  }
  expect(hashes[0]).toEqual(hashes[1]);
  const manifest = JSON.parse(readFileSync(join(ROOT, 'web/public/games/x64-threads/manifest.json'), 'utf8'));
  expect(manifest.pipeline.fixture).toMatchObject({ normalCrt: true, optimization: '-O2' });
  buildGame('examples/x64-threads', { interpretOnly: true, quiet: true });
  const result = await oracle('x64-threads', 300);
  expect(result.errors).toEqual({ lifted: null, interpreted: null });
  expect(result.identical, JSON.stringify(result)).toBe(true);
}, 120_000);

it('the import census uses the shared thread registry on both guest widths', () => {
  for (const machine of ['i386', 'x86-64']) {
    for (const name of ['CreateThread', '_beginthreadex', 'SleepConditionVariableSRW', 'TlsAlloc',
      'FlsAlloc', 'WaitOnAddress', 'InterlockedCompareExchange64', 'EnterCriticalSection']) {
      expect(importStatus(name, 'kernel32.dll', machine)).toEqual({ status: 'implemented', group: 'threads' });
    }
  }
});

it('i386 threads resume nested lifted callers with private FS/TLS and correct stdcall cleanup', async () => {
  const h = await loadHeadless('x86-threads');
  try { await h.stepAsync(300); } catch (e) { throw new Error(`${e}\n${h.logs.join('\n')}`); }
  expect(h.logs).toContain('guest: x86-threads PASS exits=23 value=3');
  expect((h.host.metrics() as any).interp_insns).toBe(0);
  expect((h.host.metrics() as any).stubs).toEqual([]);
  buildGame('examples/x86-threads', { interpretOnly: true, quiet: true });
  const result = await oracle('x86-threads', 300);
  expect(result.errors).toEqual({ lifted: null, interpreted: null });
  expect(result.identical, JSON.stringify(result)).toBe(true);
}, 120_000);
