// @bgt-examples: none
// vK72: the differential oracle compares guest state (every thread's CPU, every mapped guest page), not
// only the API-call trace. A deliberately wrong lifted result (liftFast.testCorrupt "stack": each lifted RET flips a
// byte below RSP) changes RAM but no API argument: the trace-only oracle passes, the guest-state oracle must fail.
import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/headless';
import { oracle, oracleStateParts, divergentParts, defaultStateParts } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

const SOURCE = ['/* Original CC0-1.0. */', '#include <windows.h>', '#include <stdint.h>', 'static volatile uint32_t sink;',
  '__attribute__((noinline)) uint32_t mix(uint32_t v) { return v * 2654435761u + 7u; }',
  'int main(void) { uint32_t v = 1;',
  '  for (uint32_t f = 0;; f++) { for (int i = 0; i < 100; i++) v = mix(v); sink = v;',
  '    if (f % 10 == 0) { char t[64]; wsprintfA(t, "state %08x", v); OutputDebugStringA(t); } Sleep(16); } }', ''].join('\n');

function fixture(id: string, liftFast: Record<string, string>) {
  const dir = join(ROOT, 'node_modules/.cache/bgt/oracle-state', id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'main.c'), SOURCE);
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 guest-state oracle fixture', pipeline: {
    platform: 'win32', liftMode: 'fast', liftFast, fixture: { target: 'x86_64-windows-gnu', crt: true, sources: ['main.c'], out: 'state.exe', libs: ['kernel32', 'user32'] },
    modules: [{ from: './build/state.exe', main: true }] } }));
  buildGame(dir, { quiet: true }); buildGame(dir, { quiet: true, interpretOnly: true });
}

it('state spec parsing and divergence parts', () => {
  expect(oracleStateParts('off')).toBe(0); expect(oracleStateParts('cpu')).toBe(1); expect(oracleStateParts('cpu,flags,memory')).toBe(7);
  expect(() => oracleStateParts('flags')).toThrow(/need cpu/); expect(oracleStateParts('cpu,current,memory')).toBe(13); expect(() => oracleStateParts('ram')).toThrow(/BGT_ORACLE_STATE/);
  expect(divergentParts('ab|c1|m2', 'ab|c1|m3')).toEqual(['memory']); expect(divergentParts('ab|c1|m2', 'ax|c9|m2')).toEqual(['trace', 'cpu']);
  expect(divergentParts('ab', 'ab')).toEqual([]);
});

it('a lifted result that only changes RAM passes the trace-only oracle and fails the guest-state oracle', async () => {
  fixture('oracle-state-corrupt', { inline: '0', testCorrupt: 'stack' });
  const traceOnly = await oracle('oracle-state-corrupt', 30, undefined, { state: 0 });
  expect(traceOnly.identical, JSON.stringify(traceOnly.errors)).toBe(true);
  expect(defaultStateParts('oracle-state-corrupt', {})).toBe(13); // fast mode: running thread's CPU without flags, memory
  const full = await oracle('oracle-state-corrupt', 30);
  expect(full.identical).toBe(false);
  expect(full.errors).toEqual({ lifted: null, interpreted: null });
  expect(full.state?.firstDivergence).toEqual({ frame: 0, parts: ['memory'] });
  // The same program without the injected fault: identical CPU (flags excluded, below) and memory at every frame.
  fixture('oracle-state-clean', { inline: '0' });
  const clean = await oracle('oracle-state-clean', 30);
  expect(clean.state?.parts).toBe(13);
  expect(clean.identical, JSON.stringify(clean.state)).toBe(true);
  // Fast mode treats EFLAGS as dead across calls (Win64 ABI): the flags at a frame boundary inside Sleep differ.
  expect((await oracle('oracle-state-clean', 30, undefined, { state: 3 })).state?.firstDivergence?.parts).toEqual(['cpu']);
}, 900000);
