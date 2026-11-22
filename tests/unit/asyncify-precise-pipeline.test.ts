// @bgt-examples: none
// Original CC0 K65 pipeline regression: the guest suspends (Sleep -> host present) deep inside lifted
// code, reached through direct calls and through a function-pointer table, with live values in every
// frame. i386 exact keeps the lifted frames on the wasm stack across bgt.yield; AMD64 fast unwinds them
// first (generated steps are cut points). Catches a wrongly excluded function in the exact Asyncify
// onlylist (whole and partitioned), lost names, and any divergence from the JSPI artifact.
import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, cpSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
// @ts-expect-error ESM build orchestration
import { buildGame, WASM_OPT_FEATURES } from '../../tools/build/build.mjs';
// @ts-expect-error ESM partition orchestration
import { transform } from '../../tools/build/asyncify.mjs';
// @ts-expect-error ESM metadata
import { functionNames } from '../../tools/build/wasm-names.mjs';

const GUEST = `/* Original CC0 */
#include <windows.h>
int _tls_index;
static volatile unsigned sink;
__declspec(noinline) unsigned leaf(unsigned x) { return (x * 2654435761u) ^ (x >> 7); }
__declspec(noinline) unsigned deep3(unsigned x) { unsigned a = x * 3u + 1u, b = leaf(a); Sleep(1); sink = a; return a ^ b ^ leaf(b + a); }
__declspec(noinline) unsigned deep2(unsigned x) { unsigned a = leaf(x); unsigned r = deep3(a); return r + a; }
__declspec(noinline) unsigned deep1(unsigned x) { unsigned a = x ^ 0x55u; unsigned r = deep2(a); return r ^ a; }
__declspec(noinline) unsigned pure(unsigned x) { return leaf(x) + 11u; }
__declspec(noinline) unsigned via_table(unsigned x) { unsigned a = x + 7u; unsigned r = deep2(a); return r - a; }
typedef unsigned (*fn_t)(unsigned);
fn_t volatile table[3] = { via_table, pure, deep1 };
void entry(void) {
  char s[96]; unsigned v = 1;
  for (unsigned i = 0; i < 9; i++) {
    unsigned a = deep1(v + i);
    unsigned b = table[i % 3u](v ^ i);
    v = (a * 33u) ^ b ^ (v << 1);
    wsprintfA(s, "precise %u %08x", i, v); OutputDebugStringA(s);
  }
  OutputDebugStringA("precise done");
  for (;;) Sleep(5);
}
`;

it.each([['x86-windows-gnu', 'exact'], ['x86_64-windows-gnu', 'fast']] as const)('%s %s: deep direct + table suspension resumes identically in whole/partitioned precise Asyncify and JSPI', async (target, liftMode) => {
  const cache = join(ROOT, 'node_modules/.cache/bgt'); mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, 'asyncify-precise-')), id = basename(dir).toLowerCase();
  try {
    writeFileSync(join(dir, 'guest.c'), GUEST);
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 deep suspension', pipeline: { platform: 'win32', suspensionBuild: 'dual', liftMode,
      fixture: { target, sources: ['guest.c'], out: 'guest.exe', entry: 'entry', libs: ['kernel32', 'user32'] }, modules: [{ from: './build/guest.exe', main: true }] } }));
    const linked = join(dir, 'linked.wasm');
    const manifest = buildGame(dir, { quiet: true, onLinkedWasm: (p: string) => cpSync(p, linked) });
    const metrics = manifest.pipeline.metrics;
    expect(metrics.asyncify_analysis).toBe('precise');
    expect(metrics.asyncify_instrumented).toBe(metrics.asyncify_suspending);
    expect(metrics.asyncify_instrumented).toBeLessThan(metrics.asyncify_functions);
    const out = join(ROOT, 'web/public/games', id);
    // Names ship in the Asyncify artifact (profiles), not only in the JSPI one.
    expect(functionNames(readFileSync(join(out, 'game.wasm'))).some((n: { name: string }) => /^F_[0-9a-f]{8}$/.test(n.name))).toBe(true);
    // Partitioned variant of the same linked wasm (the >32 MiB code path), same exact list.
    const part = join(dir, 'part'); mkdirSync(part);
    const remove = liftMode === 'fast' || target.startsWith('x86_64') ? functionNames(readFileSync(linked)).map((n: { name: string }) => n.name).filter((n: string) => /^N_[0-9a-f]{8}$/.test(n)) : [];
    const stats = transform(linked, join(part, 'game.wasm'), [...WASM_OPT_FEATURES, '-O2', '--asyncify', '--pass-arg=asyncify-imports@bgt.yield',
      ...(remove.length ? ['--pass-arg=asyncify-removelist@' + remove.join(',')] : [])], { wholeLimit: 0, partitionBytes: 262144 });
    expect(stats.partitions).toBeGreaterThan(1); expect(stats.instrumented).toBe(stats.suspending);
    writeFileSync(join(part, 'manifest.json'), JSON.stringify({ ...manifest, wasm: { ...manifest.wasm, url: 'game.wasm' }, variants: undefined, preferredSuspension: undefined }));
    symlinkSync(join(out, 'assets'), join(part, 'assets'));
    const runs = [await loadHeadless(id, { suspension: 'asyncify' }), await loadHeadless(id, { dir: part, suspension: 'asyncify' })];
    const jspi = await loadHeadless(id, { suspension: 'jspi' }).catch(() => null);
    if (jspi) runs.push(jspi);
    for (let f = 0; f < 40; f++) {
      for (const r of runs) await r.stepAsync(1);
      for (const r of runs.slice(1)) expect(r.host.stateHash(), 'update ' + f).toBe(runs[0].host.stateHash());
    }
    expect(runs[0].logs).toContain('guest: precise done');
    expect(runs[0].logs.filter((l) => l.startsWith('guest: precise ')).length).toBe(10);
    for (const r of runs.slice(1)) expect(r.logs).toEqual(runs[0].logs);
    // Every Sleep really suspended: the yields happened at depth, not at an outer boundary.
    for (const r of runs) { expect(r.host.yields).toBeGreaterThanOrEqual(18); expect(r.host.metrics()).toMatchObject({ stubs: [] }); }
  } finally {
    for (const p of [dir, join(ROOT, 'web/public/games', id), join(ROOT, 'node_modules/.cache/bgt/pipeline', id)]) rmSync(p, { recursive: true, force: true });
  }
}, 300000);
