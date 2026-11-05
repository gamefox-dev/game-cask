// SPDX-License-Identifier: CC0-1.0
// Paired production builds: npx vitest run --config tests/native-forms-bench.config.ts
import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, cpSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadHeadless, ROOT } from './support/headless';
import { oracle, type OracleReport } from './oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { resourceSnapshot } from '../tools/probe/resources.mjs';
interface Metrics {
  interp_insns: number; generic_insn_execs: number; stubs: unknown[];
  cpu_profile: { exits: { address: number; reason: number; count: number; instructions: number }[]; census_dropped: number };
}
it('pairs baseline/current native-form counts/timing with production census and 300-frame oracles', async () => {
  const suspension = process.env.BGT_ORACLE_SUSPENSION === 'jspi' ? 'jspi' : 'asyncify';
  const before = process.env.BGT_FORMS_BASELINE;
  if (!before) throw new Error('BGT_FORMS_BASELINE must name a local baseline worktree (no downloads or installs)');
  if (!existsSync(join(before, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(before, 'node_modules'));
  const baseline = await import(/* @vite-ignore */ pathToFileURL(join(before, 'tools/build/build.mjs')).href);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const beforeCommit = execFileSync('git', ['-C', before, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const start = resourceSnapshot();
  const rows: { id: string; preset: string; variant: string; median_ms: number; samples_ms: number[];
    metrics: Metrics | undefined; resourcesBefore: unknown; resourcesAfter: unknown; pipeline: unknown; oracle: OracleReport }[] = [];
  const out = process.env.BGT_FORMS_REPORT ?? join(ROOT, 'node_modules/.cache/bgt/native-forms-benchmark.json');
  const save = (complete: boolean) => writeFileSync(out, JSON.stringify({ schema: 1, commit, beforeCommit, suspension, start, end: resourceSnapshot(), complete,
    method: 'Same machine, serial full builds, discarded fresh-instance warmup + seven fresh-instance samples; 300 updates including startup, not guest presents; no rendering.', rows }, null, 2) + '\n');
  for (const preset of ['size', 'fast']) {
    for (const variant of ['before', 'after']) {
      const root = variant === 'before' ? before : ROOT, builder = variant === 'before' ? baseline.buildGame : buildGame;
      const id = 'native-forms-' + preset + '-' + variant, dir = join(root, 'node_modules/.cache/bgt/native-forms-bench-inputs', id);
      mkdirSync(dir, { recursive: true });
      cpSync(join(ROOT, 'tests/fixtures/c/native_forms_bench.S'), join(dir, 'bench.S'));
      writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 native residual forms', pipeline: {
        platform: 'win32', liftPreset: preset, suspensionBuild: 'dual', fixture: { target: 'x86_64-windows-gnu', sources: ['bench.S'], out: 'bench.exe', entry: 'entry', libs: ['kernel32'] },
        modules: [{ from: './build/bench.exe', main: true }],
      } }));
      const resourcesBefore = resourceSnapshot();
      const manifest = builder(dir, { quiet: true }); builder(dir, { quiet: true, interpretOnly: true });
      if (variant === 'before') for (const name of [id, id + '-interp'])
        cpSync(join(root, 'web/public/games', name), join(ROOT, 'web/public/games', name), { recursive: true });
      const differential = await oracle(id, 300);
      expect(differential.identical, JSON.stringify(differential)).toBe(true); expect(differential.comparedFrames).toBe(300);
      expect(differential.errors).toEqual({ lifted: null, interpreted: null });
      const samples: number[] = []; let metrics: Metrics | undefined;
      for (let sample = 0; sample < 8; sample++) {
        const h = await loadHeadless(id, { suspension }); const begin = performance.now(); await h.stepAsync(300);
        const elapsed = performance.now() - begin;
        if (sample) samples.push(elapsed);
        expect(h.logs).toContain('guest: native forms checksum PASS');
        metrics = h.host.metrics() as unknown as Metrics;
        expect(metrics.interp_insns).toBe(0); expect(metrics.stubs).toEqual([]);
        expect(metrics.generic_insn_execs).toBe(variant === 'before' ? 500000 : 0);
        expect(metrics.cpu_profile.census_dropped).toBe(0);
      }
      const sorted = [...samples].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
      expect(metrics!.cpu_profile.census_dropped).toBe(0);
      const opcodeExits = metrics!.cpu_profile.exits.filter(e => e.reason === 1);
      expect(opcodeExits.reduce((n, e) => n + e.instructions, 0)).toBe(variant === 'before' ? 500000 : 0);
      if (variant === 'before') expect(opcodeExits.map(e => e.instructions).sort()).toEqual(Array(5).fill(100000));
      else expect(opcodeExits).toEqual([]);
      rows.push({ id, preset, variant, median_ms: median, samples_ms: samples, metrics, resourcesBefore, resourcesAfter: resourceSnapshot(), pipeline: manifest.pipeline, oracle: differential });
      save(false);
      console.log(id, median, metrics?.generic_insn_execs);
      // Keep only compact reports. Source/generated/runtime object caches remain content-addressed.
      for (const name of [id, id + '-interp']) rmSync(join(ROOT, 'web/public/games', name), { recursive: true, force: true });
    }
    const [a, b] = rows.slice(-2);
    expect(a.metrics!.generic_insn_execs).toBe(500000);
    expect(b.metrics!.generic_insn_execs).toBe(0);
    expect(a.oracle.hashes.liftedTrace).toBe(b.oracle.hashes.liftedTrace);
  }
  save(true);
});
