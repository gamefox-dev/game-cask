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
import { ROOT } from '../support/headless';
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
