// @bgt-examples: x64-cpprt x64-crt x64-memory
import { it, expect } from 'vitest';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../support/headless';
import { nativeCrt, crtMismatches } from '../support/native-crt';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { crtRegistry, importsCoverage, importStatus } from '../../tools/x86/imports-coverage.mjs';

for (const id of ['x64-crt', 'x64-cpprt', 'x64-memory'] as const) {
  it(`${id}: matches native CC0 source, fully lifted, identical 300-frame oracle`, async () => {
    const reference = nativeCrt(id);
    const h = await loadHeadless(id);
    const initialBytes = h.host.memoryBytes;
    if (id === 'x64-memory') expect(initialBytes).toBeLessThan(128 * 1024 ** 2);
    try { await h.stepAsync(300); } catch (e) { throw new Error(`${e}\n${h.logs.join('\n')}`); }
    expect(crtMismatches(reference, h.logs), h.logs.join('\n')).toEqual([]);
    expect(h.logs.some((s) => s.includes('FAIL'))).toBe(false);
    const metrics = h.host.metrics() as any;
    expect(metrics.interp_insns).toBe(0);
    expect(metrics.stubs).toEqual([]);
    if (id === 'x64-crt') {
      const hits = crtRegistry().filter((e: any) => metrics.apis_hit.includes(e.name));
      expect(hits.length).toBeGreaterThanOrEqual(60);
      for (const group of ['stdio', 'stdlib', 'string', 'math', 'time', 'locale', 'startup']) {
        expect(hits.some((e: any) => e.group === group), group).toBe(true);
      }
    }
    if (id === 'x64-memory') {
      expect(metrics.heap_bytes).toBeGreaterThanOrEqual(600 * 1024 * 1024);
      expect(metrics.guest_committed_bytes).toBe(0x7fff0000);
      expect(h.logs).toContain('guest CRT stdout: memory window-edge=2147418111 PASS');
      expect(h.host.memoryBytes).toBeGreaterThan(2 * 1024 ** 3);
    }
    const manifest = JSON.parse(readFileSync(join(ROOT, 'web/public/games', id, 'manifest.json'), 'utf8'));
    expect(manifest.memory.guestWindowMiB).toBe(id === 'x64-memory' ? 2048 : 1024);
    expect(manifest.pipeline.fixture).toMatchObject({ normalCrt: true, optimization: '-O2' });
    const build = JSON.parse(readFileSync(join(ROOT, 'node_modules/.cache/bgt/pipeline', id,
      'fixture/fixture-build.json'), 'utf8'));
    expect(build.args).toContain('-O2');
    expect(build.args).not.toContain('-nostdlib');
    expect(build.args.some((s: string) => s.startsWith('-Wl,--entry'))).toBe(false);
    const wasm = new WebAssembly.Module(readFileSync(join(ROOT, 'web/public/games', id, 'game.wasm')));
    expect(WebAssembly.Module.imports(wasm).every((i) => i.module === 'bgt')).toBe(true);
    buildGame(`examples/${id}`, { interpretOnly: true, quiet: true });
    const result = await oracle(id, 300);
    expect(result.errors).toEqual({ lifted: null, interpreted: null });
    expect(result.identical, JSON.stringify(result)).toBe(true);
    expect((result.metrics.lifted as any).exited).toBe(1);
    expect((result.metrics.interpreted as any).exited).toBe(1);
    expect((result.metrics.lifted as any).interp_insns).toBe(0);
    expect((result.metrics.interpreted as any).interp_insns).toBeGreaterThan(0);
    writeFileSync(join(ROOT, 'reports', `crt-${id}.json`), JSON.stringify({
      reference, logs: h.logs, initialWasmBytes: initialBytes, finalWasmBytes: h.host.memoryBytes,
      metrics, groups: Object.fromEntries(['stdlib', 'stdio', 'string', 'math', 'locale', 'time', 'startup']
        .map((g) => [g, crtRegistry().filter((e: any) => e.group === g).length])),
    }, null, 2));
  }, 120_000);
}

it('import census shares CRT aliases and distinguishes unknown imports and declared stubs', () => {
  const file = join(ROOT, 'node_modules/.cache/bgt/pipeline/x64-crt/fixture/crt.exe');
  const report = importsCoverage(file);
  expect(report.imports.length).toBeGreaterThan(60);
  expect(report.imports).toContainEqual({
    dll: 'api-ms-win-crt-utility-l1-1-0.dll', name: 'qsort', status: 'implemented', group: 'stdlib',
  });
  for (const dll of ['msvcrt.dll', 'ucrtbase.dll', 'api-ms-win-crt-math-l1-1-0.dll']) {
    expect(importStatus('llround', dll).status).toBe('implemented');
  }
  expect(importStatus('not_a_crt_function', 'ucrtbase.dll').status).toBe('unknown');
  expect(importStatus('llround', 'not-a-system.dll').status).toBe('unknown');
  expect(importStatus('FlushInstructionCache', 'kernel32.dll').status).toBe('stub');
});

it('a missing static UCRT import faults with the entire DLL and symbol, not a truncated alias', async () => {
  const root = join(ROOT, 'node_modules/.cache/bgt/crt-diagnostic');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'case-'));
  const pe = readFileSync(join(ROOT, 'node_modules/.cache/bgt/pipeline/x64-crt/fixture/crt.exe'));
  const pos = pe.indexOf(Buffer.from('qsort\0'));
  expect(pos).toBeGreaterThan(0);
  pe.write('zzzzz', pos, 'ascii');
  writeFileSync(join(dir, 'case.exe'), pe);
  writeFileSync(join(dir, 'game.json'), JSON.stringify({
    id: 'crt-missing-import', name: 'CC0 missing-import regression',
    pipeline: { platform: 'win32', modules: [{ from: './case.exe', main: true }] },
  }));
  buildGame(dir, { quiet: true, outRoot: dir });
  const h = await loadHeadless('crt-missing-import', { dir: join(dir, 'crt-missing-import') });
  await expect(h.stepAsync(10)).rejects.toThrow('api-ms-win-crt-utility-l1-1-0.dll!zzzzz');
}, 120_000);

