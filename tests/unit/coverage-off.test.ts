// @bgt-examples: none
// Original CC0-1.0 (K51). A coverage-off performance build (BGT_COVERAGE=off / build.mjs --no-coverage) must:
// compile every coverage hook out (no `coverage_entry` import, X86_COVERAGE_MODE=3, unavailable counters),
// keep the guest API trace identical to the normal build, and still pass the lifted-vs-interpreted oracle.
// Would catch: hooks left in perf builds, a mode that perturbs guest semantics, or fabricated zero counters.
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { defaultScript } from '../oracle/oracle';
import { testSuspensionModes } from '../support/suspension-modes';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { coverageInstrumentation } from '../../tools/build/pipeline.mjs';

async function trace(dir: string, suspension: 'asyncify' | 'jspi', frames: number) {
  const h = await loadHeadless('', { dir, suspension, storage: new Map() });
  const script = defaultScript(frames, h.host.logicalWidth, h.host.logicalHeight), hashes: string[] = [];
  for (let f = 0; f < frames; f++) {
    for (const st of script.filter(s => s.frame === f)) { if (st.pointer) h.pointer(...st.pointer); if (st.key) h.key(...st.key); }
    await h.stepAsync(1); hashes.push(h.host.stateHash() ?? '');
  }
  return { hashes, metrics: h.host.metrics() as Record<string, any>, logs: h.logs };
}
const imports = (dir: string) => WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(join(dir, 'game.wasm')))).map(i => i.name);

it('coverage option validation rejects ambiguous combinations', () => {
  expect(coverageInstrumentation({}, {})).toBe('on');
  expect(coverageInstrumentation({}, { BGT_COVERAGE: 'off' })).toBe('off');
  expect(() => coverageInstrumentation({}, { BGT_COVERAGE: '0' })).toThrow(/on or off/);
  expect(() => coverageInstrumentation({ slice: {} }, { BGT_COVERAGE: 'off' })).toThrow(/strict/);
  expect(() => coverageInstrumentation({}, { BGT_COVERAGE: 'off', BGT_COVERAGE_DIRECT: '1' })).toThrow(/DIRECT/);
});

for (const example of ['x64-basics', 'win32-hello'])
  it(`${example}: coverage-off build has no hooks, identical traces and a passing oracle`, async () => {
    const root = join(ROOT, 'node_modules/.cache/bgt/k51-coverage', example), id = 'k51-covoff-' + example;
    rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
    cpSync(join(ROOT, 'examples', example), root, { recursive: true, filter: s => !s.includes('/build') });
    const cfg = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
    cfg.id = id; cfg.pipeline.suspensionBuild = 'dual';
    writeFileSync(join(root, 'game.json'), JSON.stringify(cfg));
    try {
      buildGame(root, { quiet: true, outRoot: join(root, 'on') });
      buildGame(root, { quiet: true, outRoot: join(root, 'off'), coverage: 'off' });
      buildGame(root, { quiet: true, outRoot: join(root, 'off'), coverage: 'off', interpretOnly: true });
      const on = join(root, 'on', id), off = join(root, 'off', id), interp = join(root, 'off', id + '-interp');
      const manifest = JSON.parse(readFileSync(join(off, 'manifest.json'), 'utf8'));
      expect(manifest.pipeline.instrumentation.coverage).toBe('off');
      expect(manifest.toolchain.cflags).toContain('-DX86_COVERAGE_MODE=3');
      expect(JSON.parse(readFileSync(join(on, 'manifest.json'), 'utf8')).pipeline.instrumentation.coverage).toBe('buffered');
      expect(imports(on)).toContain('coverage_entry');
      expect(imports(off)).not.toContain('coverage_entry');
      for (const mode of testSuspensionModes()) {
        const a = await trace(on, mode, 300), b = await trace(off, mode, 300), c = await trace(interp, mode, 300);
        expect(new Set(a.hashes).size, 'trace must actually change over the run').toBeGreaterThan(1);
        expect(b.hashes, `${mode}: coverage-off vs normal lifted trace`).toEqual(a.hashes);
        expect(c.hashes, `${mode}: coverage-off lifted vs interpreted oracle`).toEqual(b.hashes);
        expect(a.metrics.coverage_mode).toBe(1); expect(a.metrics.coverage_events).toBeGreaterThan(0);
        expect(b.metrics.coverage_mode).toBe(3); expect(b.metrics.coverage_events).toBeNull();
        expect(b.metrics.coverage_crossings).toBeNull(); expect(b.metrics.interp_insns).toBe(0);
        expect(b.logs).toEqual(a.logs);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 900_000);
