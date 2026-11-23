// Original CC0-1.0. K65 Asyncify precision benchmark (opt-in measurement, never a CI gate).
// BGT_K65_STEP=prepare  build each fixture once (dual), then derive Asyncify variants from the SAME
//                       linked wasm: {whole, partitioned} x {binaryen, precise}; check every variant
//                       prints the same guest lines and per-update state hashes as JSPI.
// BGT_K65_STEP=time     rotating fresh-instance samples: ms per host update (one present each).
// Run with BGT_COVERAGE=off BGT_CPU_PROFILE=0 (performance artifacts). Raw JSON under BGT_K65_OUT.
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadHeadless, ROOT } from '../../tests/support/headless';
// @ts-expect-error plain ESM
import { buildGame, WASM_OPT_FEATURES } from '../build/build.mjs';
// @ts-expect-error plain ESM
import { transform } from '../build/asyncify.mjs';
// @ts-expect-error plain ESM
import { functionNames } from '../build/wasm-names.mjs';
// @ts-expect-error plain ESM
import { k65Fixture } from './k65-fixture.mjs';

const root = process.env.BGT_K65_OUT ?? '';
const FIXTURES: Record<string, Record<string, unknown>> = {
  'k65-fast': { liftMode: 'fast' },
  'k65-exact': { liftMode: 'exact' },
  // Counts/sizes at scale (12,078 guest functions, 1.6M lifted insns, production 8 MiB partitions); no timing.
  'x64-scale-fast': { example: 'x64-scale', liftMode: 'fast' },
};
const fixtures = (process.env.BGT_K65_FIXTURES ?? Object.keys(FIXTURES).join(',')).split(',');
const VARIANTS = ['jspi', 'whole-binaryen', 'whole-precise', 'part-binaryen', 'part-precise'];
const variants = (process.env.BGT_K65_VARIANTS ?? VARIANTS.join(',')).split(',');
const partitionBytes = Number(process.env.BGT_K65_PARTITION_BYTES ?? 1048576);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const vdir = (fixture: string, variant: string) => join(root, fixture, variant);

async function trace(id: string, dir: string, suspension: 'jspi' | 'asyncify', updates: number) {
  const h = await loadHeadless(id, { dir, suspension });
  const hashes: (string | null)[] = [];
  for (let n = 0; n < updates; n++) { await h.stepAsync(1); hashes.push(h.host.stateHash()); }
  const m = h.host.metrics() as Record<string, unknown>;
  return { logs: h.logs, hashes, yields: h.host.yields, interp: m.interp_insns, stubs: m.stubs };
}

it('K65 Asyncify precision benchmark step', async () => {
  expect(root).toBeTruthy(); mkdirSync(root, { recursive: true });
  const step = process.env.BGT_K65_STEP ?? 'prepare';
  if (step === 'prepare') {
    const results: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const { example, liftMode } = FIXTURES[fixture] as { example?: string; liftMode: string };
      const { dir, id, expected } = example ? { dir: join(ROOT, 'examples', example), id: example, expected: 'guest: scale checksum ' }
        : k65Fixture({ id: fixture, pipeline: FIXTURES[fixture], functions: Number(process.env.BGT_K65_FUNCTIONS ?? 1500), perFrame: Number(process.env.BGT_K65_PER_FRAME ?? 6000) });
      const linked = join(root, fixture + '.linked.wasm'); mkdirSync(join(root, fixture), { recursive: true });
      const outRoot = join(root, fixture, 'build'); rmSync(outRoot, { recursive: true, force: true });
      const started = performance.now();
      const env = { mode: process.env.BGT_LIFT_MODE, build: process.env.BGT_SUSPENSION_BUILD };
      if (example) { process.env.BGT_LIFT_MODE = liftMode; process.env.BGT_SUSPENSION_BUILD = 'dual'; }
      try { buildGame(dir, { quiet: true, outRoot, onLinkedWasm: (p: string) => cpSync(p, linked) }); }
      finally { for (const [k, v] of [['BGT_LIFT_MODE', env.mode], ['BGT_SUSPENSION_BUILD', env.build]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      const buildMs = performance.now() - started;
      const base = join(root, fixture, 'base'); rmSync(base, { recursive: true, force: true });
      cpSync(join(outRoot, id), base, { recursive: true }); rmSync(outRoot, { recursive: true, force: true });
      const remove = functionNames(readFileSync(linked)).map((n: { name: string }) => n.name).filter((n: string) => /^N_[0-9a-f]{8}$/.test(n));
      const row: Record<string, unknown> = { fixture, id, buildMs, linkedBytes: statSync(linked).size, cut: remove.length, variants: {} };
      let reference: Awaited<ReturnType<typeof trace>> | null = null;
      for (const variant of variants) {
        const out = vdir(fixture, variant); rmSync(out, { recursive: true, force: true }); cpSync(base, out, { recursive: true });
        let stats: Record<string, unknown> = {}, ms = 0;
        if (variant !== 'jspi') {
          const [shape, analysis] = variant.split('-');
          const t0 = performance.now();
          stats = transform(linked, join(out, 'game.wasm'), [...WASM_OPT_FEATURES, '-O2', '--asyncify', '--pass-arg=asyncify-imports@bgt.yield',
            ...(remove.length ? ['--pass-arg=asyncify-removelist@' + remove.join(',')] : [])],
          // Partitioned = the >32 MiB code path, forced; the scale example uses the production 8 MiB batches.
          shape === 'part' ? { analysis, wholeLimit: 0, partitionBytes: example ? undefined : partitionBytes } : { analysis, wholeLimit: Infinity });
          ms = performance.now() - t0;
          const bytes = readFileSync(join(out, 'game.wasm'));
          const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
          manifest.wasm = { ...manifest.wasm, url: 'game.wasm', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
          writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
        }
        const bytes = statSync(join(out, variant === 'jspi' ? 'game.jspi.wasm' : 'game.wasm')).size;
        const run = await trace(id, out, variant === 'jspi' ? 'jspi' : 'asyncify', 40);
        expect(run.logs.some((l) => l.startsWith(expected)), fixture + '/' + variant).toBe(true);
        expect(run.logs.filter((l) => /FAIL|x86:/.test(l)), fixture + '/' + variant).toEqual([]);
        if (!reference) reference = run;
        else { expect(run.logs, fixture + '/' + variant).toEqual(reference.logs); expect(run.hashes, fixture + '/' + variant).toEqual(reference.hashes); }
        (row.variants as Record<string, unknown>)[variant] = { bytes, transformMs: ms, stats, yields: run.yields, interp: run.interp };
        console.log(fixture + ' ' + variant + ' ' + bytes + ' B ' + JSON.stringify(stats));
      }
      results.push(row);
      writeFileSync(join(root, 'prepare-partial.json'), JSON.stringify(results, null, 2));
    }
    writeFileSync(join(root, 'prepare-' + Date.now() + '.json'), JSON.stringify(results, null, 2));
    return;
  }
  if (step === 'time') {
    const warm = Number(process.env.BGT_K65_WARM ?? 5), timed = Number(process.env.BGT_K65_UPDATES ?? 30), rounds = Number(process.env.BGT_K65_ROUNDS ?? 5);
    const rows: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const samples: Record<string, number[]> = {};
      for (let round = 0; round < rounds; round++) {
        for (const variant of round & 1 ? [...variants].reverse() : variants) {
          const h = await loadHeadless(fixture, { dir: vdir(fixture, variant), suspension: variant === 'jspi' ? 'jspi' : 'asyncify' });
          await h.stepAsync(warm);
          const start = performance.now(); await h.stepAsync(timed);
          (samples[variant] ??= []).push((performance.now() - start) / timed);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      const jspi = median(samples.jspi ?? []);
      const summary = Object.fromEntries(Object.entries(samples).map(([v, s]) => [v, { msPerUpdate: median(s), vsJspi: median(s) / jspi, min: Math.min(...s), max: Math.max(...s), samples: s }]));
      rows.push({ fixture, warm, timed, rounds, summary });
      console.log(fixture + ' ' + Object.entries(summary).map(([v, s]) => v + ' ' + s.msPerUpdate.toFixed(3) + ' ms (' + s.vsJspi.toFixed(3) + 'x)').join('; '));
      writeFileSync(join(root, 'time-partial.json'), JSON.stringify(rows, null, 2));
    }
    writeFileSync(join(root, 'time-' + Date.now() + '.json'), JSON.stringify(rows, null, 2));
  }
}, 3600000);
