// Original CC0-1.0. K52 fast lifting mode benchmark (opt-in measurement, never a CI gate).
// BGT_K52_STEP=prepare  build each fixture x variant (exact, exact-fast preset, fast and fast
//                       ablations) + native, check every variant prints the exact-mode line;
// BGT_K52_STEP=time     rotating fresh-instance samples: ns per retired guest instruction;
// BGT_K52_STEP=count    dynamic wasm operators per guest instruction (k41 counter, JSPI).
// Run with BGT_COVERAGE=off BGT_CPU_PROFILE=0 (performance artifacts). Raw JSON under BGT_K52_OUT.
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadHeadless, ROOT } from '../../tests/support/headless';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';
// @ts-expect-error plain ESM
import { k52Fixture, k52BuildNative, K52_KINDS } from './k52-fixture.mjs';
// @ts-expect-error plain ESM
import { instrumentWat } from './k41-wasm-count.mjs';

type Pipeline = Record<string, unknown>;
const VARIANTS: Record<string, Pipeline> = {
  exact: {},
  'exact-fast': { liftPreset: 'fast' },
  fast: { liftMode: 'fast' },
  'fast-range': { liftMode: 'fast', liftFast: { memory: 'range' } },
  'fast-noinline': { liftMode: 'fast', liftFast: { inline: '0' } },
  'fast-nostack': { liftMode: 'fast', liftFast: { stack: 'off' } },
  'fast-mem-checked': { liftMode: 'fast', liftFast: { memory: 'off' } },
  'fast-all-entries': { liftMode: 'fast', liftFast: { entries: 'all' } },
  'fast-block-quantum': { liftMode: 'fast', liftFast: { quantum: 'block' } },
  'fast-nofuse': { liftMode: 'fast', liftFast: { fuse: 'off' } },
  'fast-noresume': { liftMode: 'fast', liftFast: { resume: 'off' } },
  'fast-flagsabi': { liftMode: 'fast', liftFast: { flags: 'abi' } }, /* K75: the K52 flag rule (no observed-flags analysis) */
};
const root = process.env.BGT_K52_OUT ?? '';
const kinds = (process.env.BGT_K52_KINDS ?? K52_KINDS.join(',')).split(',');
const variants = (process.env.BGT_K52_VARIANTS ?? Object.keys(VARIANTS).join(',')).split(',');
const modes = (process.env.BGT_K52_MODES ?? 'jspi,asyncify').split(',') as ('jspi' | 'asyncify')[];
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const clock = (h: { host: { metrics(): unknown } }) => Number((h.host.metrics() as { guest_instruction_clock: number | string }).guest_instruction_clock);
const gameDir = (variant: string, kind: string) => join(root, variant + '-' + kind, 'game');
async function firstLine(id: string, dir: string, suspension: 'jspi' | 'asyncify', prefix: string) {
  const h = await loadHeadless(id, { dir, suspension });
  for (let n = 0; n < 60 && !h.logs.some((s) => s.startsWith(prefix)); n++) await h.stepAsync(1);
  const hashes: (string | null)[] = [];
  for (let n = 0; n < 20; n++) { await h.stepAsync(1); hashes.push(h.host.stateHash()); }
  const m = h.host.metrics() as Record<string, unknown>;
  return { line: h.logs.find((s) => s.startsWith(prefix)) ?? null, fail: h.logs.filter((s) => /FAIL|x86:/.test(s)),
    hashes, interp: m.interp_insns, generic: m.generic_insn_execs };
}

it('K52 fast lifting benchmark step', async () => {
  expect(root).toBeTruthy(); mkdirSync(root, { recursive: true });
  const step = process.env.BGT_K52_STEP ?? 'prepare';
  if (step === 'prepare') {
    const results: Record<string, unknown>[] = [];
    for (const kind of kinds) for (const variant of variants) {
      const out = join(root, variant + '-' + kind);
      if (variant === 'native') {
        const native = k52BuildNative(kind, out);
        const { instance } = await WebAssembly.instantiate(readFileSync(native.path), {});
        const checksum = ((instance.exports as { run(): number }).run() >>> 0).toString(16).padStart(8, '0');
        results.push({ kind, variant, ...native, checksum }); continue;
      }
      const id = 'k52-' + kind + '-' + variant;
      const { dir, expected } = k52Fixture(kind, { id, pipeline: VARIANTS[variant] });
      const started = performance.now();
      const manifest = buildGame(dir, { quiet: true });
      const buildMs = performance.now() - started;
      rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
      cpSync(join(ROOT, 'web/public/games', id), join(out, 'game'), { recursive: true });
      rmSync(join(ROOT, 'web/public/games', id), { recursive: true, force: true });
      const pipe = JSON.parse(readFileSync(join(ROOT, 'node_modules/.cache/bgt/pipeline', id, 'pipeline.json'), 'utf8'));
      const sizes = Object.fromEntries(['game.wasm', 'game.jspi.wasm'].map((f) => [f, existsSync(join(out, 'game', f)) ? statSync(join(out, 'game', f)).size : null]));
      const runs: Record<string, unknown> = {};
      for (const mode of modes) runs[mode] = await firstLine(id, join(out, 'game'), mode, expected);
      results.push({ kind, variant, id, buildMs, sizes, lift: pipe.modules[0].lift, scale: pipe.modules[0].scale,
        generatedLoc: pipe.loc.generated, timings: pipe.timings, manifestBuild: (manifest as { build?: unknown })?.build ?? null, runs });
      writeFileSync(join(out, 'evidence.json'), JSON.stringify(results.at(-1), null, 2));
    }
    const file = join(root, 'prepare-' + Date.now() + '.json');
    writeFileSync(file, JSON.stringify(results, null, 2));
    // Correctness: every lifted variant prints exactly the exact-mode line in every mode, no faults.
    for (const kind of kinds) {
      const rows = results.filter((r) => r.kind === kind && r.variant !== 'native') as { variant: string; runs: Record<string, { line: string | null; fail: string[] }> }[];
      const reference = rows.find((r) => r.variant === 'exact')?.runs[modes[0]].line ?? rows[0]?.runs[modes[0]].line;
      for (const r of rows) for (const mode of modes) {
        expect(r.runs[mode].fail, `${kind}/${r.variant}/${mode}`).toEqual([]);
        expect(r.runs[mode].line, `${kind}/${r.variant}/${mode}`).toBe(reference);
      }
      const native = results.find((r) => r.kind === kind && r.variant === 'native') as { checksum: string } | undefined;
      if (native && reference && kind !== 'vm') expect(reference).toContain('checksum ' + native.checksum);
    }
    return;
  }
  if (step === 'time') {
    const warm = Number(process.env.BGT_K52_WARM ?? 5), timed = Number(process.env.BGT_K52_UPDATES ?? 30);
    const rounds = Number(process.env.BGT_K52_ROUNDS ?? 5);
    const rows: Record<string, unknown>[] = [];
    for (const kind of kinds) for (const mode of modes) {
      const samples: Record<string, { ms: number; insns: number; ns: number }[]> = {};
      const lifted = variants.filter((v) => v !== 'native');
      const insnsLine = JSON.parse(readFileSync(join(root, 'exact-' + kind, 'evidence.json'), 'utf8')).runs[modes[0]].line as string;
      const perRun = Number(/insns (\d+)/.exec(insnsLine)?.[1]);
      for (let round = 0; round < rounds; round++) {
        const order = round & 1 ? [...variants].reverse() : variants;
        for (const variant of order) {
          (samples[variant] ??= []);
          if (variant === 'native') {
            const { instance } = await WebAssembly.instantiate(readFileSync(join(root, 'native-' + kind, 'native.wasm')), {});
            const run = (instance.exports as { run(): number }).run;
            for (let i = 0; i < 3; i++) run();
            const n = 20, start = performance.now(); for (let i = 0; i < n; i++) run(); const ms = performance.now() - start;
            samples[variant].push({ ms, insns: n * perRun, ns: ms * 1e6 / (n * perRun) });
            continue;
          }
          const id = 'k52-' + kind + '-' + variant;
          const h = await loadHeadless(id, { dir: gameDir(variant, kind), suspension: mode });
          await h.stepAsync(warm);
          const c0 = clock(h), start = performance.now();
          await h.stepAsync(timed);
          const ms = performance.now() - start, insns = clock(h) - c0;
          expect(h.logs.some((s) => s.startsWith('guest: k52 ' + kind + ' checksum'))).toBe(true);
          samples[variant].push({ ms, insns, ns: ms * 1e6 / insns });
          await new Promise((r) => setTimeout(r, 0));
        }
        void lifted;
      }
      const summary = Object.fromEntries(Object.entries(samples).map(([v, s]) => [v, { nsPerInsn: median(s.map((x) => x.ns)),
        min: Math.min(...s.map((x) => x.ns)), max: Math.max(...s.map((x) => x.ns)), samples: s }]));
      rows.push({ kind, mode, perRun, summary });
      writeFileSync(join(root, 'time-partial.json'), JSON.stringify(rows, null, 2));
    }
    writeFileSync(join(root, 'time-' + Date.now() + '.json'), JSON.stringify(rows, null, 2));
    return;
  }
  if (step === 'examples') {
    // Every x64 pipeline example, exact vs BGT_LIFT_MODE=fast: guest logs and per-update API-trace hashes.
    const ids = (process.env.BGT_K52_EXAMPLES ?? '').split(',').filter(Boolean);
    const all = ids.length ? ids : readdirSync(join(ROOT, 'examples')).filter((d) => d.startsWith('x64-') && d !== 'x64-scale').sort();
    const updates = Number(process.env.BGT_K52_UPDATES ?? 90), rows: Record<string, unknown>[] = [];
    for (const id of all) {
      const result: Record<string, unknown> = { id };
      for (const mode of ['exact', 'fast']) {
        const outRoot = join(root, 'examples-' + mode); mkdirSync(outRoot, { recursive: true });
        if (mode === 'fast') process.env.BGT_LIFT_MODE = 'fast'; else delete process.env.BGT_LIFT_MODE;
        const started = performance.now();
        try { buildGame(join(ROOT, 'examples', id), { quiet: true, outRoot }); } finally { delete process.env.BGT_LIFT_MODE; }
        const buildMs = performance.now() - started, dir = join(outRoot, id);
        const size = statSync(join(dir, 'game.wasm')).size;
        const hashes: (string | null)[] = []; let error: string | null = null;
        const h = await loadHeadless(id, { dir, suspension: 'asyncify' });
        try { for (let n = 0; n < updates; n++) { await h.stepAsync(1); hashes.push(h.host.stateHash()); } } catch (e) { error = String((e as Error).message ?? e).slice(0, 200); }
        const m = h.host.metrics() as Record<string, unknown>;
        result[mode] = { buildMs, size, logs: h.logs, hashes, error, interp: m.interp_insns, clock: m.guest_instruction_clock };
        rmSync(dir, { recursive: true, force: true });
      }
      const e = result.exact as { logs: string[]; hashes: unknown[]; error: string | null }, f = result.fast as typeof e;
      result.sameLogs = JSON.stringify(e.logs) === JSON.stringify(f.logs);
      result.sameHashes = JSON.stringify(e.hashes) === JSON.stringify(f.hashes);
      result.firstHashDiff = e.hashes.findIndex((x, i) => x !== f.hashes[i]);
      result.sameError = e.error === f.error;
      rows.push(result);
      writeFileSync(join(root, 'examples-partial.json'), JSON.stringify(rows, null, 2));
    }
    writeFileSync(join(root, 'examples-' + Date.now() + '.json'), JSON.stringify(rows, null, 2));
    return;
  }
  if (step === 'count') {
    const rows: Record<string, unknown>[] = [];
    const sumOps = (exports: Record<string, unknown>, labels: string[], group: string) => labels
      .filter((l) => l.startsWith(group + '.') && !/\.(entries|exits)$|\.op\.(block|loop)$|^[a-z]+\.function\.|^[a-z]+\.target\.|^[a-z]+\.site\./.test(l) && !l.includes('.address.') && !l.includes('.memory.'))
      .reduce((n, l) => n + Number((exports['k39_' + l] as WebAssembly.Global).value), 0);
    for (const kind of kinds) for (const variant of variants) {
      const dir = join(root, 'count-' + variant + '-' + kind); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      const insnsLine = JSON.parse(readFileSync(join(root, 'exact-' + kind, 'evidence.json'), 'utf8')).runs[modes[0]].line as string;
      const perRun = Number(/insns (\d+)/.exec(insnsLine)?.[1]);
      const binaryen = join(ROOT, 'node_modules/binaryen/bin');
      const features = ['--enable-mutable-globals', '--enable-nontrapping-float-to-int', '--enable-bulk-memory', '--enable-sign-ext'];
      const source = variant === 'native' ? join(root, 'native-' + kind, 'native.wasm') : join(gameDir(variant, kind), 'game.jspi.wasm');
      execFileSync(process.execPath, [join(binaryen, 'wasm-dis'), source, '-o', join(dir, 'in.wat'), ...features]);
      const { wat, labels } = instrumentWat(readFileSync(join(dir, 'in.wat'), 'utf8'), { native: variant === 'native' });
      writeFileSync(join(dir, 'count.wat'), wat); rmSync(join(dir, 'in.wat'));
      execFileSync(process.execPath, [join(binaryen, 'wasm-as'), join(dir, 'count.wat'), ...features, '-o', join(dir, 'count.wasm')], { maxBuffer: 1 << 30 });
      rmSync(join(dir, 'count.wat'));
      let exports: Record<string, unknown>, insns: number;
      if (variant === 'native') {
        const { instance } = await WebAssembly.instantiate(readFileSync(join(dir, 'count.wasm')), {});
        const run = (instance.exports as { run(): number }).run;
        run(); const before = sumOps(instance.exports as Record<string, unknown>, labels, 'native');
        run(); run();
        exports = instance.exports as Record<string, unknown>; insns = 2 * perRun;
        rows.push({ kind, variant, insns, ops: { native: sumOps(exports, labels, 'native') - before }, opsPerInsn: (sumOps(exports, labels, 'native') - before) / insns });
      } else {
        const game = join(dir, 'game'); cpSync(gameDir(variant, kind), game, { recursive: true }); cpSync(join(dir, 'count.wasm'), join(game, 'game.jspi.wasm'));
        const h = await loadHeadless('k52-' + kind + '-' + variant, { dir: game, suspension: 'jspi' });
        await h.stepAsync(3);
        // Counter globals are module exports; the host passes non-function exports through.
        exports = (h.host as unknown as { exports: Record<string, unknown> }).exports;
        const groups = ['lifted', 'admission', 'runtime'];
        const before = Object.fromEntries(groups.map((g) => [g, sumOps(exports, labels, g)]));
        const c0 = clock(h); await h.stepAsync(4); insns = clock(h) - c0;
        const ops = Object.fromEntries(groups.map((g) => [g, sumOps(exports, labels, g) - before[g]]));
        const total = Object.values(ops).reduce((a, b) => a + b, 0);
        rows.push({ kind, variant, insns, ops, opsPerInsn: total / insns, liftedPerInsn: ops.lifted / insns });
      }
      rmSync(dir, { recursive: true, force: true });
      writeFileSync(join(root, 'count-partial.json'), JSON.stringify(rows, null, 2));
    }
    writeFileSync(join(root, 'count-' + Date.now() + '.json'), JSON.stringify(rows, null, 2));
  }
}, 3600000);
