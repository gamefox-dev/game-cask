// Original CC0-1.0. K72 code-size benchmark (opt-in measurement, never a CI gate): fast-mode emitter size options.
// BGT_K72_STEP=prepare  build every fixture x variant (dual: JSPI + Asyncify artifacts), record wasm bytes and build
//                       time, and check that every variant prints the same guest lines and per-update state hashes as
//                       the base variant in both suspension modes.
// BGT_K72_STEP=time     rotating fresh-instance samples: median ms per host update, JSPI and Asyncify.
// Run with BGT_COVERAGE=off BGT_CPU_PROFILE=0 for timing artifacts. Raw JSON under BGT_K72_OUT.
//   BGT_K72_FIXTURES=k65,cpprt  BGT_K72_VARIANTS=base,sync,...  BGT_K72_ROUNDS / _UPDATES / _WARM
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../../tests/support/headless';
import { nativeCrt, crtMismatches } from '../../tests/support/native-crt';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';
// @ts-expect-error plain ESM
import { k65Fixture } from './k65-fixture.mjs';
// @ts-expect-error plain ESM
import { k52Fixture } from './k52-fixture.mjs';

const root = process.env.BGT_K72_OUT ?? '';
export const K72_VARIANTS: Record<string, Record<string, string>> = {
  base: {},
  sync: { sync: 'minimal' },
  out: { calls: 'outlined' },
  compact: { sync: 'minimal', calls: 'outlined' },
  inl16: { inline: '16' },
  compact16: { sync: 'minimal', calls: 'outlined', inline: '16' },
  // K78: the self-checking diagnostic build of compact16 (its cost; must print and hash like the reference variant).
  check16: { sync: 'minimal', calls: 'outlined', inline: '16', check: 'sync' },
  // Every call a real call: isolates the call-site protocol cost (K52 calls/vm fixtures).
  base0: { inline: '0' },
  compact0: { sync: 'minimal', calls: 'outlined', inline: '0' },
  oz: {},
};
// Candidate (b): clang size optimization for the whole module (an upper bound for -Oz on cold code only).
const K72_CFLAGS: Record<string, string[]> = { oz: ['-Oz'] };
const fixtures = (process.env.BGT_K72_FIXTURES ?? 'k65,cpprt').split(',');
const variants = (process.env.BGT_K72_VARIANTS ?? Object.keys(K72_VARIANTS).join(',')).split(',');
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const vdir = (fixture: string, variant: string) => join(root, fixture, variant);

function gameDir(fixture: string, variant: string) {
  const g = gameDirBase(fixture, variant);
  if (K72_CFLAGS[variant]) {
    const file = join(g.dir, 'game.json'), cfg = JSON.parse(readFileSync(file, 'utf8'));
    cfg.cflags = K72_CFLAGS[variant]; writeFileSync(file, JSON.stringify(cfg));
  }
  return g;
}
function gameDirBase(fixture: string, variant: string) {
  const id = `k72-${fixture}-${variant}`, liftFast = K72_VARIANTS[variant];
  const pipeline = { liftMode: 'fast', ...(Object.keys(liftFast).length ? { liftFast } : {}) };
  if (fixture === 'k65') return { ...k65Fixture({ id, pipeline, functions: Number(process.env.BGT_K65_FUNCTIONS ?? 1500), perFrame: Number(process.env.BGT_K65_PER_FRAME ?? 6000) }), updates: 40 };
  if (fixture === 'calls' || fixture === 'vm') return { ...k52Fixture(fixture, { id, pipeline }), updates: 20 };
  if (fixture === 'cpprt') {
    const dir = join(ROOT, 'node_modules/.cache/bgt/k72', id); mkdirSync(dir, { recursive: true });
    cpSync(join(ROOT, 'examples/x64-cpprt/cpprt.cpp'), join(dir, 'cpprt.cpp'));
    const cfg = JSON.parse(readFileSync(join(ROOT, 'examples/x64-cpprt/game.json'), 'utf8'));
    cfg.id = id; Object.assign(cfg.pipeline, pipeline, { suspensionBuild: 'dual' });
    writeFileSync(join(dir, 'game.json'), JSON.stringify(cfg));
    return { dir, id, expected: null, updates: 300 };
  }
  throw new Error('unknown K72 fixture ' + fixture);
}

async function trace(id: string, dir: string, suspension: 'jspi' | 'asyncify', updates: number) {
  const h = await loadHeadless(id, { dir, suspension });
  const hashes: (string | null)[] = [];
  // API trace hash plus the guest-state hash (every thread's CPU without flags (dead across calls in fast mode), every mapped guest page; vK72).
  for (let n = 0; n < updates; n++) { await h.stepAsync(1); hashes.push(`${h.host.stateHash()}|${h.host.guestStateHash(5)}`); }
  const m = h.host.metrics() as Record<string, unknown>;
  return { logs: h.logs, hashes, interp: m.interp_insns, stubs: m.stubs };
}

it('K72 code-size benchmark step', async () => {
  expect(root).toBeTruthy(); mkdirSync(root, { recursive: true });
  const step = process.env.BGT_K72_STEP ?? 'prepare';
  if (step === 'prepare') {
    const results: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const row: Record<string, unknown> = { fixture, variants: {} };
      let reference: Record<string, Awaited<ReturnType<typeof trace>>> | null = null;
      for (const variant of variants) {
        const { dir, id, expected, updates } = gameDir(fixture, variant);
        const outRoot = join(root, fixture, 'build'); rmSync(outRoot, { recursive: true, force: true });
        const started = performance.now();
        const env = process.env.BGT_SUSPENSION_BUILD; process.env.BGT_SUSPENSION_BUILD = 'dual';
        try { buildGame(dir, { quiet: true, outRoot }); } finally { if (env === undefined) delete process.env.BGT_SUSPENSION_BUILD; else process.env.BGT_SUSPENSION_BUILD = env; }
        const buildMs = performance.now() - started;
        const out = vdir(fixture, variant); rmSync(out, { recursive: true, force: true });
        cpSync(join(outRoot, id), out, { recursive: true }); rmSync(outRoot, { recursive: true, force: true });
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        const runs: Record<string, Awaited<ReturnType<typeof trace>>> = {};
        for (const mode of ['jspi', 'asyncify'] as const) {
          const run = await trace(id, out, mode, updates);
          if (expected) expect(run.logs.some((l) => l.startsWith(expected)), `${fixture}/${variant}/${mode}`).toBe(true);
          else expect(crtMismatches(nativeCrt('x64-cpprt'), run.logs), `${fixture}/${variant}/${mode} vs native`).toEqual([]);
          expect(run.logs.filter((l) => /FAIL|x86:/.test(l)), `${fixture}/${variant}/${mode}`).toEqual([]);
          if (reference) { expect(run.logs, `${fixture}/${variant}/${mode} logs`).toEqual(reference[mode].logs); expect(run.hashes, `${fixture}/${variant}/${mode} hashes`).toEqual(reference[mode].hashes); }
          runs[mode] = run;
        }
        reference ??= runs;
        const sizes = { jspi: statSync(join(out, 'game.jspi.wasm')).size, asyncify: statSync(join(out, 'game.wasm')).size };
        (row.variants as Record<string, unknown>)[variant] = { liftFast: K72_VARIANTS[variant], buildMs, sizes, metrics: manifest.pipeline?.metrics ?? null, interp: runs.jspi.interp };
        console.log(`${fixture} ${variant} jspi ${sizes.jspi} B asyncify ${sizes.asyncify} B build ${(buildMs / 1000).toFixed(1)} s`);
      }
      results.push(row);
      writeFileSync(join(root, 'prepare-partial.json'), JSON.stringify(results, null, 2));
    }
    writeFileSync(join(root, 'prepare-' + Date.now() + '.json'), JSON.stringify(results, null, 2));
    return;
  }
  if (step === 'coverage') {
    // Never-entered lifted bytes after a run (coverage-recording builds in web/public/games): BGT_K72_GAMES=id,id BGT_K72_STEPS=N.
    // @ts-expect-error plain ESM
    const { functionSizes, coverageSplit } = await import('../report/wasm-size.mjs');
    const rows: Record<string, unknown>[] = [];
    for (const id of (process.env.BGT_K72_GAMES ?? 'x64-cpprt').split(',')) {
      const dir = join(ROOT, 'web/public/games', id), manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      const mode = manifest.suspension === 'jspi' ? 'jspi' : 'asyncify';
      const h = await loadHeadless(id, { suspension: mode });
      await h.stepAsync(Number(process.env.BGT_K72_STEPS ?? 300));
      const code = [...(h.host as unknown as { codeCoverage: Map<number, number> }).codeCoverage.keys()];
      const wasm = readFileSync(join(dir, mode === 'jspi' && manifest.variants?.jspi ? 'game.jspi.wasm' : 'game.wasm'));
      const split = coverageSplit(functionSizes(wasm), { code });
      const metrics = h.host.metrics() as Record<string, unknown>;
      rows.push({ id, steps: Number(process.env.BGT_K72_STEPS ?? 300), split, interp_insns: metrics.interp_insns, interp_functions: metrics.interp_functions, selection: manifest.pipeline?.modules?.map((m: { selection?: unknown }) => m.selection) ?? null });
      // The same run as a coverage recording (pipeline.coverage input; coverageGameId = this id).
      writeFileSync(join(root, id + '.coverage.json'), JSON.stringify({ schema: 'game-cask/coverage/1', game: id, modules: manifest.pipeline.modules, files: [],
        code: [...(h.host as unknown as { codeCoverage: Map<number, number> }).codeCoverage].map(([address, kind]) => ({ address, kind })) }));
      console.log(`${id}: never entered ${split.never.functions}/${split.lifted.functions} lifted functions, ${split.never.bytes}/${split.lifted.bytes} B (${(100 * split.neverShare).toFixed(1)}%)`);
    }
    writeFileSync(join(root, 'coverage-' + Date.now() + '.json'), JSON.stringify(rows, null, 2));
    return;
  }
  if (step === 'time') {
    const warm = Number(process.env.BGT_K72_WARM ?? 5), timed = Number(process.env.BGT_K72_UPDATES ?? 30), rounds = Number(process.env.BGT_K72_ROUNDS ?? 5);
    const rows: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const samples: Record<string, number[]> = {};
      for (let round = 0; round < rounds; round++) {
        for (const variant of round & 1 ? [...variants].reverse() : variants) for (const mode of ['jspi', 'asyncify'] as const) {
          const h = await loadHeadless(`k72-${fixture}-${variant}`, { dir: vdir(fixture, variant), suspension: mode });
          await h.stepAsync(warm);
          const start = performance.now(); await h.stepAsync(timed);
          (samples[`${variant}/${mode}`] ??= []).push((performance.now() - start) / timed);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      const summary = Object.fromEntries(Object.entries(samples).map(([v, s]) => [v, { msPerUpdate: median(s), min: Math.min(...s), max: Math.max(...s), samples: s }]));
      rows.push({ fixture, warm, timed, rounds, summary });
      console.log(fixture + ' ' + Object.entries(summary).map(([v, s]) => `${v} ${s.msPerUpdate.toFixed(3)}`).join('; '));
      writeFileSync(join(root, 'time-partial.json'), JSON.stringify(rows, null, 2));
    }
    writeFileSync(join(root, 'time-' + Date.now() + '.json'), JSON.stringify(rows, null, 2));
  }
}, 7200000);
