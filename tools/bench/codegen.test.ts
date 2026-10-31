// Run: BGT_CODEGEN_REPORT=/absolute/report.json npx vitest run --config tools/bench/codegen.config.ts
// CC0 CPU fixture; median of five fresh instances, after one discarded warmup. No idle-only timing claim.
import { it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadHeadless, ROOT } from '../../tests/support/headless';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';

it('reports size, emission counts, build/cache state and 300-frame execution for every fixture', async () => {
  const dir = join(ROOT, 'node_modules/.cache/bgt/codegen-cpu');
  mkdirSync(dir, { recursive: true });
  let source = '/* Original CC0 CPU-bound codegen fixture. */\n#include <windows.h>\nint _tls_index;\n';
  for (let i = 0; i < 512; i++) {
    source += `__declspec(noinline) unsigned long long f${i}(unsigned long long x) {\n`;
    for (let j = 0; j < 32; j++) source += `x += ${i * 313 + j * 17 + 1}ull; x ^= ${i * 7351 + j * 393 + 19}ull;\n`;
    source += 'return x; }\n';
  }
  source += 'unsigned long long (*const fns[])(unsigned long long) = {';
  source += Array.from({ length: 512 }, (_, i) => `f${i}`).join(',') + '};\n';
  source += 'void entry(void) { unsigned long long x=1; for(unsigned k=0;k<32;k++)';
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
  const rows = [];
  const ids = process.env.BGT_CODEGEN_IDS?.split(',') ?? ['codegen-cpu', 'x64-basics', 'x64-cpp',
    'x64-cpprt', 'x64-crt', 'x64-gui', 'x64-memory', 'x64-tls', 'win32-hello'];
  for (const id of ids) {
    const manifest = buildGame(id === 'codegen-cpu' ? dir : `examples/${id}`, { quiet: true });
    const times = [];
    let logs: string[] = [];
    let runtime = {};
    for (let sample = 0; sample < 6; sample++) {
      const h = await loadHeadless(id);
      const start = performance.now();
      await h.stepAsync(300);
      const elapsed = performance.now() - start;
      if (sample) times.push(elapsed);
      logs = h.logs;
      runtime = h.host.metrics();
      expect((runtime as { interp_insns: number }).interp_insns, id).toBe(0);
      expect(logs.some((s) => /\bFAIL\b/.test(s)), id).toBe(false);
      if (id === 'codegen-cpu') expect(logs).toContain('guest: codegen checksum 00000009 a47a8001');
    }
    const modules: { lift: { specialized: number; generic: number } }[] = manifest.pipeline.modules;
    times.sort((a, b) => a - b);
    const row = {
      id, instructions: manifest.pipeline.metrics.lifted_insns,
      specialized: modules.reduce((n, m) => n + m.lift.specialized, 0),
      generic: modules.reduce((n, m) => n + m.lift.generic, 0),
      wasm_bytes: manifest.wasm.size, ...manifest.pipeline.metrics,
      frames: 300, run_ms_median: times[2], run_ms_samples: times, logs, runtime,
    };
    rows.push(row);
    console.log(`${id}: ${JSON.stringify({ ...row, logs: undefined, runtime: undefined })}`);
  }
  const report = {
    schema: 'game-cask/codegen/1', base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version, platform: `${process.platform}/${process.arch}`, fixtures: rows,
    method: 'Whole wasm (profile + Asyncify included); update/render/consume 300 fixed frames; median of five fresh '
      + 'instances after a discarded warmup; init/compile excluded. Console fixtures include CRT startup, '
      + 'not just idle.',
  };
  const out = process.env.BGT_CODEGEN_REPORT ?? join(ROOT, 'reports/codegen.json');
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  expect(JSON.parse(readFileSync(out, 'utf8')).fixtures).toHaveLength(ids.length);
});
