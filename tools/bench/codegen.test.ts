// Run: BGT_CODEGEN_REPORT=/absolute/report.json npx vitest run --config tools/bench/codegen.config.ts
// CC0 CPU fixture; median of five fresh instances, after one discarded warmup. No idle-only timing claim.
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpus, freemem, totalmem, loadavg } from 'node:os';

function resources() {
  return { at: new Date().toISOString(), cpu: cpus()[0]?.model, cores: cpus().length,
    free_bytes: freemem(), total_bytes: totalmem(), loadavg: loadavg(), process: process.resourceUsage() };
}
import { loadHeadless, ROOT } from '../../tests/support/headless';
import { oracle } from '../../tests/oracle/oracle';
// @ts-expect-error plain ESM
import { resourceSnapshot } from '../probe/resources.mjs';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';

it('reports size, emission counts, build/cache state and 300-frame execution for every fixture', async () => {
  const dir = join(ROOT, 'node_modules/.cache/bgt/codegen-cpu');
  mkdirSync(dir, { recursive: true });
  const rounds = Number(process.env.BGT_CODEGEN_ROUNDS ?? 32);
  expect(Number.isInteger(rounds) && rounds > 0 && rounds <= 65536).toBe(true);
  // Independent u32-pair reference: no generated/lifted guest code supplies this known answer.
  let lo = 1, hi = 0;
  for (let k = 0; k < rounds; k++) for (let i = 0; i < 512; i++) for (let j = 0; j < 32; j++) {
    const sum = lo + i * 313 + j * 17 + 1;
    hi = (hi + (sum > 0xffffffff ? 1 : 0)) >>> 0;
    lo = (sum ^ (i * 7351 + j * 393 + 19)) >>> 0;
  }
  const checksum = `guest: codegen checksum ${hi.toString(16).padStart(8, '0')} ${lo.toString(16).padStart(8, '0')}`;
  if (rounds === 32) expect(checksum).toBe('guest: codegen checksum 00000009 a47a8001');
  let source = '/* Original CC0 CPU-bound codegen fixture. */\n#include <windows.h>\nint _tls_index;\n';
  for (let i = 0; i < 512; i++) {
    source += `__declspec(noinline) unsigned long long f${i}(unsigned long long x) {\n`;
    for (let j = 0; j < 32; j++) source += `x += ${i * 313 + j * 17 + 1}ull; x ^= ${i * 7351 + j * 393 + 19}ull;\n`;
    source += 'return x; }\n';
  }
  source += 'unsigned long long (*const fns[])(unsigned long long) = {';
  source += Array.from({ length: 512 }, (_, i) => `f${i}`).join(',') + '};\n';
  source += `void entry(void) { unsigned long long x=1; for(unsigned k=0;k<${rounds};k++)`;
  source += 'for(unsigned i=0;i<512;i++)x=fns[i](x); char s[80];';
  source += 'wsprintfA(s,"codegen checksum %08x %08x",(unsigned)(x>>32),(unsigned)x);';
  source += 'OutputDebugStringA(s); for(;;)Sleep(5); }\n';
  writeFileSync(join(dir, 'cpu.c'), source);
  writeFileSync(join(dir, 'game.json'), JSON.stringify({
    id: 'codegen-cpu', name: 'CC0 integer CPU codegen benchmark', pipeline: {
      platform: 'win32', fixture: {
        target: 'x86_64-windows-gnu', sources: ['cpu.c'], out: 'cpu.exe', entry: 'entry',
        libs: ['kernel32', 'user32'],
      }, modules: [{ from: './build/cpu.exe', main: true }],
    },
  }));
  const boundaryDir = join(ROOT, 'node_modules/.cache/bgt/codegen-boundary');
  mkdirSync(boundaryDir, { recursive: true });
  cpSync(join(ROOT, 'tools/bench/boundary.c'), join(boundaryDir, 'boundary.c'));
  writeFileSync(join(boundaryDir, 'game.json'), JSON.stringify({
    id: 'codegen-boundary', name: 'CC0 scalar SSE/thunk/vtable benchmark', pipeline: {
      platform: 'win32', fixture: { target: 'x86_64-windows-gnu', sources: ['boundary.c'],
        out: 'boundary.exe', crt: true, libs: ['kernel32'] },
      modules: [{ from: './build/boundary.exe', main: true }],
    },
  }));
  const boundaryKinds = ['codegen-boundary', 'codegen-scalar', 'codegen-imports', 'codegen-vtable', 'codegen-interior'];
  const boundaryChecksums = new Map<string, string>();
  for (const [kind, id] of boundaryKinds.entries()) {
    let sum = 0;
    for (let i = 0; i < 100000; i++) sum = (sum + ((kind === 0 || kind === 3) ?
      ((i & 1) ? ((i & 1023) ^ 0x55) : (i & 1023) + 3) : i & 1023)) >>> 0;
    boundaryChecksums.set(id, `guest: boundary checksum ${sum.toString(16).padStart(8, '0')}`);
    if (!kind) continue;
    const game = join(ROOT, 'node_modules/.cache/bgt', id); mkdirSync(game, { recursive: true });
    writeFileSync(join(game, 'boundary.c'), `#define BOUNDARY_KIND ${kind}\n` + readFileSync(join(ROOT, 'tools/bench/boundary.c'), 'utf8'));
    cpSync(join(ROOT, 'tools/bench/boundary-landing.S'), join(game, 'boundary-landing.S'));
    writeFileSync(join(game, 'game.json'), JSON.stringify({
      id, name: `CC0 isolated boundary pattern ${kind}`, pipeline: {
        platform: 'win32', fixture: { target: 'x86_64-windows-gnu', sources: ['boundary.c', ...(kind === 4 ? ['boundary-landing.S'] : [])],
          out: 'boundary.exe', crt: true, libs: ['kernel32'] },
        modules: [{ from: './build/boundary.exe', main: true }],
      },
    }));
  }
  const liftPreset = process.env.BGT_CODEGEN_PRESET;
  const resourcesBefore = resources();
  const resourceSnapshots = { start: resourceSnapshot(), end: null as unknown };
  const rows = [];
  const ids = process.env.BGT_CODEGEN_IDS?.split(',') ?? ['codegen-cpu', 'x64-basics', 'x64-cpp',
    'x64-cpprt', 'x64-crt', 'x64-gui', 'x64-memory', 'x64-tls', 'win32-hello'];
  const trials = Number(process.env.BGT_CODEGEN_TRIALS ?? 8);
  expect(Number.isInteger(trials) && trials > 0 && trials <= 64).toBe(true);
  for (const id of ids) {
    let game = id === 'codegen-cpu' ? dir : id === 'codegen-boundary' ? boundaryDir : boundaryKinds.includes(id) ?
      join(ROOT, 'node_modules/.cache/bgt', id) : `examples/${id}`;
    if (liftPreset) {
      if (id !== 'codegen-cpu' && !boundaryKinds.includes(id)) {
        game = join(ROOT, 'node_modules/.cache/bgt/codegen-inputs', id);
        cpSync(join(ROOT, 'examples', id), game, { recursive: true, filter: (p) => !p.endsWith('/build') });
      }
      const cfg = JSON.parse(readFileSync(join(game, 'game.json'), 'utf8'));
      cfg.pipeline.liftPreset = liftPreset;
      writeFileSync(join(game, 'game.json'), JSON.stringify(cfg));
    }
    const manifest = buildGame(game, { quiet: true });
    buildGame(game, { quiet: true, interpretOnly: true });
    const differential = await oracle(id, 300);
    expect(differential.identical, id).toBe(true);
    expect(differential.errors).toEqual({ lifted: null, interpreted: null });
    const times: number[] = [], allTrials: number[][] = [];
    let logs: string[] = [];
    let runtime = {};
    for (let sample = 0; sample < 6; sample++) {
      const runs: number[] = [];
      for (let trial = 0; trial < trials; trial++) {
      const h = await loadHeadless(id);
      const start = performance.now();
      await h.stepAsync(300);
      const elapsed = performance.now() - start;
      runs.push(elapsed);
      logs = h.logs;
      runtime = h.host.metrics();
      expect((runtime as { interp_insns: number }).interp_insns, id).toBe(0);
      expect(logs.some((s) => /\bFAIL\b/.test(s)), id).toBe(false);
      if (id === 'codegen-cpu') expect(logs).toContain(checksum);
      if (boundaryChecksums.has(id)) expect(logs).toContain(boundaryChecksums.get(id));
      }
      if (sample) { allTrials.push(runs); times.push(runs.reduce((a, b) => a + b, 0) / trials); }
    }
    const generated = join(ROOT, 'node_modules/.cache/bgt/pipeline', id);
    const emitted = readdirSync(generated, { recursive: true }).filter((p) => String(p).endsWith('.c'))
      .map((p) => readFileSync(join(generated, String(p)), 'utf8')).join('\n');
    const masks = [...emitted.matchAll(/t=xl_alu\([^;\n]+,&flags,0x([a-f0-9]+)u\)/g)].map((m) => Number.parseInt(m[1], 16));
    const legacyFull = [...emitted.matchAll(/t=xl_alu_full\(/g)].length;
    const aluSites = masks.length + legacyFull, materialized = masks.filter((m) => m !== 0).length + legacyFull;
    const referenceDispatches = (differential.metrics.interpreted as { interp_insns: number }).interp_insns;
    const modules: { lift: { specialized: number; generic: number } }[] = manifest.pipeline.modules;
    times.sort((a, b) => a - b);
    const row = {
      id, instructions: manifest.pipeline.metrics.lifted_insns,
      specialized: modules.reduce((n, m) => n + m.lift.specialized, 0),
      generic: modules.reduce((n, m) => n + m.lift.generic, 0),
      wasm_bytes: manifest.wasm.size, ...manifest.pipeline.metrics,
      generic_per_lifted_call: (runtime as { generic_insn_execs: number }).generic_insn_execs /
        (runtime as { lifted_calls: number }).lifted_calls,
      frames: 300, trials_per_sample: trials, run_ms_median: times[2], run_ms_samples: times,
      run_ms_trials: allTrials, logs, runtime,
      oracle: { identical: differential.identical, compared_frames: differential.comparedFrames, hashes: differential.hashes },
      reference_guest_dispatches: referenceDispatches,
      reference_dispatches_per_second: referenceDispatches * 1000 / times[2],
      alu: { sites: aluSites, materialized, materialized_fraction: aluSites ? materialized / aluSites : 0,
        full: legacyFull + masks.filter((m) => m === 0x8d5 || m === 0x8d4).length,
        dead: masks.filter((m) => m === 0).length },
    };
    rows.push(row);
    console.log(`${id}: ${JSON.stringify({ ...row, logs: undefined, runtime: undefined })}`);
  }
  resourceSnapshots.end = resourceSnapshot();
  const report = {
    resources: resourceSnapshots, profileEnabled:process.env.BGT_CPU_PROFILE !== '0',
    coverageMode:process.env.BGT_COVERAGE_DIRECT==='1'?'direct':'buffered',
    asyncifyMode:process.env.BGT_ASYNCIFY_FULL==='1'?'conservative':'amd64-native-boundaries',
    schema: 'game-cask/codegen/1', base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version, platform: `${process.platform}/${process.arch}`, fixtures: rows,
    resources_before: resourcesBefore, resources_after: resources(), cpu_fixture_rounds: rounds,
    lift_preset: liftPreset ?? 'commit default',
    method: 'Whole wasm (profile + Asyncify included); 300 update/render/consume frames per fresh instance. '
      + 'Five batches of fresh instances after a discarded warmup batch; median of batch means; init/compile excluded. '
      + 'Console startup is included, not just idle. Throughput uses the identical interpreter oracle guest-dispatch '
      + 'count, not static lifted instruction memberships or REP micro-iterations. ALU site counts exclude cold replay.',
  };
  const out = process.env.BGT_CODEGEN_REPORT ?? join(ROOT, 'reports/codegen.json');
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  expect(JSON.parse(readFileSync(out, 'utf8')).fixtures).toHaveLength(ids.length);
});
