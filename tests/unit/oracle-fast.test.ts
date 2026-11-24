// @bgt-examples: none
// K75: the differential oracle on FAST lifted builds (pipeline.liftMode "fast"), lifted vs interpreted, comparing the
// API/GL trace and the guest-state hash every frame. Fast variants of kit fixtures (the example's own CC0 sources,
// copied into a test-owned directory, id `<example>-fast`, so no new example): x64-cpp (C++ throw: RaiseException
// and RtlCaptureContext store EFLAGS in CONTEXT records), x64-heap (HEAP_GENERATE_EXCEPTIONS: the profile raises
// with the EFLAGS of the HeapAlloc call), x64-time (QPC/timeGetTime from the instruction clock across quantum
// boundaries, three threads) and x64-gl-programs (GL stream). Before K75 the first three diverged in guest memory
// (captured EFlags; a QPC value one microsecond late after a fast quantum dropped its overshoot).
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { jspiApi } from '../../bgt/runtime/jspi';
import { oracle, defaultStateParts } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

function fixture(example: string, liftFast: Record<string, string> = {}) {
  const id = `${example}-fast`, dir = join(ROOT, 'node_modules/.cache/bgt/oracle-fast', id);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  cpSync(join(ROOT, 'examples', example), dir, { recursive: true, filter: (s) => !/[/\\]build$/.test(s) });
  const game = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
  game.id = id; game.pipeline.liftMode = 'fast';
  if (Object.keys(liftFast).length) game.pipeline.liftFast = liftFast;
  writeFileSync(join(dir, 'game.json'), JSON.stringify(game));
  buildGame(dir, { quiet: true }); buildGame(dir, { quiet: true, interpretOnly: true });
  return id;
}

// Frames: each fixture's divergence (or its end) lies well inside; x64-time's first QPC difference was at frame 13.
// (The compact16 options keep their own oracle in x64-compact.test.ts.)
for (const [example, frames, liftFast] of [['x64-cpp', 30, {}], ['x64-heap', 30, {}], ['x64-time', 90, {}],
  ['x64-gl-programs', 30, {}]] as [string, number, Record<string, string>][])
it(`fast-mode oracle: ${example}${Object.keys(liftFast).length ? ' (compact16)' : ''} lifted vs interpreted, trace + guest state`, async () => {
  const id = fixture(example, liftFast);
  expect(defaultStateParts(id, {})).toBe(13);
  const r = await oracle(id, frames);
  expect(r.errors).toEqual({ lifted: null, interpreted: null });
  expect(r.state?.available).toBe(true);
  expect(r.identical, JSON.stringify(r.state)).toBe(true);
}, 900000);

// vK75 review: the inline quantum probe must count the carried instructions exactly as the cap check does. With a
// 2000001-unit cap, a fast poll a few instructions past the quantum charges 2000000 and carries the rest; a probe that
// ignored the carry ran the quantum inline, the cap check then waited for the next frame inside lifted code
// (Asyncify: a fault). Single thread, every frame ends at the cap; both suspension modes; the guest's own output must
// equal the interpreter's.
const CAP_SOURCE = ['/* Original CC0-1.0. */', '#include <windows.h>', '#include <stdint.h>', 'static volatile uint32_t sink;',
  '__attribute__((noinline)) uint32_t mix(uint32_t v) { return v * 2654435761u + 7u; }',
  'int main(void) { uint32_t v = 1; for (uint32_t n = 0; n < 12; n++) { for (int i = 0; i < 1000000; i++) v = mix(v); sink = v;',
  '  char t[64]; wsprintfA(t, "cap %u %08x", n, v); OutputDebugStringA(t); } OutputDebugStringA("cap done"); return 0; }', ''].join('\n');
it('fast quantum exactly at the instruction cap: no inline wait, same guest output as the interpreter (both suspension modes)', async () => {
  const id = 'oracle-fast-cap', dir = join(ROOT, 'node_modules/.cache/bgt/oracle-fast', id);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'main.c'), CAP_SOURCE);
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 fast quantum at the instruction cap', pipeline: {
    platform: 'win32', liftMode: 'fast', liftFast: { inline: '0' }, suspensionBuild: 'dual', timeModel: { instructionCap: 2000001 },
    fixture: { target: 'x86_64-windows-gnu', crt: true, sources: ['main.c'], out: 'cap.exe', libs: ['kernel32', 'user32'] },
    modules: [{ from: './build/cap.exe', main: true }] } }));
  buildGame(dir, { quiet: true }); buildGame(dir, { quiet: true, interpretOnly: true });
  const run = async (game: string, suspension: 'asyncify' | 'jspi') => {
    const h = await loadHeadless(game, { suspension });
    for (let f = 0; f < 200 && !h.logs.some((l) => l.includes('cap done')); f++) await h.stepAsync(1);
    const m = h.host.metrics() as { guest_time?: { cap_hits?: string } };
    return { lines: h.logs.filter((l) => /cap (\d+ [0-9a-f]{8}|done)/.test(l)), faults: h.logs.filter((l) => /x86:|fault|FAIL/i.test(l)), capHits: Number(m.guest_time?.cap_hits ?? 0) };
  };
  const reference = await run(`${id}-interp`, 'asyncify');
  expect(reference.lines.length).toBe(13);
  for (const suspension of ['asyncify', ...(jspiApi() ? ['jspi'] : [])] as ('asyncify' | 'jspi')[]) {
    const fast = await run(id, suspension);
    expect(fast.faults, suspension).toEqual([]);
    expect(fast.lines, suspension).toEqual(reference.lines);
    expect(fast.capHits, suspension).toBeGreaterThan(10);
  }
}, 900000);
