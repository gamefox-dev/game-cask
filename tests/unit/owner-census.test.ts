// @bgt-examples: none
// Original CC0-1.0 (K51). Hand-counted guest code: the opt-in owner census (BGT_OWNER_CENSUS=1) must
// attribute exactly the retired instructions of each lifted-function owner, lifted and interpreted,
// AMD64 and i386, both suspension modes; per-present frame tables must sum to exact accounting deltas.
// OFF builds report enabled:0 and null tables. Would catch misattribution, double counting, missing
// generic/interpreted owners, nondeterministic ordering or invented zero tables.
import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { GameHost } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { testSuspensionModes } from '../support/suspension-modes';
import { glStream } from '../support/x64-gl-stream';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { ownerCensus } from '../../tools/build/pipeline.mjs';

/** entry calls a() and b() five times. Hand-counted answers, independent of every runtime counter:
 * entry: [subq] + movl + 5 x (call a, call b, decl, jnz) + ExitProcess argument + call; a: 3 x 5;
 * b: AMD64 pushq/xorl/cpuid/popq/ret (CPUID runs through the shared generic core) x 5, i386 xorl/ret x 5. */
function program(wide: boolean) {
  const sym = (s: string) => wide ? s : '_' + s;
  const t = ['.text', ...(wide ? [] : ['.def @feat.00; .scl 3; .type 0; .endef', '.set @feat.00, 1']),
    '.globl ' + sym('entry'), sym('entry') + ':', ...(wide ? ['  subq $40, %rsp'] : []), '  movl $5, %esi', 'again:',
    '  call ' + sym('a'), '  call ' + sym('b'), '  decl %esi', '  jnz again',
    ...(wide ? ['  movl $0, %ecx', '  call *__imp_ExitProcess(%rip)'] : ['  pushl $0', '  call *"__imp__ExitProcess@4"']),
    '.globl ' + sym('a'), sym('a') + ':', '  movl $1, %eax', '  addl $2, %eax', '  ret',
    '.globl ' + sym('b'), sym('b') + ':', ...(wide ? ['  pushq %rbx', '  xorl %eax, %eax', '  cpuid', '  popq %rbx'] : ['  xorl %eax, %eax']), '  ret'];
  const expected = { entry: (wide ? 1 : 0) + 1 + 5 * 4 + 2, a: 5 * 3, b: 5 * (wide ? 5 : 2) };
  return { source: t.join('\n') + '\n', expected };
}
const owners = (rows: any[]) => rows.map((r: any) => Number(r.total)).sort((a, b) => b - a);

it('census option validation', () => {
  expect(ownerCensus({})).toBe(false); expect(ownerCensus({ BGT_OWNER_CENSUS: '1' })).toBe(true);
  expect(() => ownerCensus({ BGT_OWNER_CENSUS: 'yes' })).toThrow(/0 or 1/);
  expect(() => ownerCensus({ BGT_OWNER_CENSUS: '1', BGT_CPU_ACCOUNTING: '0' })).toThrow(/accounting/);
});

for (const wide of [false, true]) it('exact per-owner retirement, lifted and interpreted ' + (wide ? 'AMD64' : 'i386'), async () => {
  const root = join(ROOT, 'node_modules/.cache/bgt/owner-census'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'case-')), id = 'owner-census-' + Number(wide), p = program(wide);
  const total = p.expected.entry + p.expected.a + p.expected.b;
  const saved = process.env.BGT_OWNER_CENSUS;
  try {
    writeFileSync(join(dir, 'counts.S'), p.source); // An absolute data reference makes the tiny AMD64 image relocatable.
    writeFileSync(join(dir, 'anchor.c'), '/* CC0 */ int _tls_index;' + (wide ? ' extern void entry(void); void (*volatile entry_anchor)(void) = entry;' : ''));
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 owner census', pipeline: { platform: 'win32', streamModules: false,
      suspensionBuild: 'dual', fixture: { out: 'counts.exe', sources: ['counts.S', 'anchor.c'], libs: ['kernel32'], target: wide ? 'x86_64-windows-gnu' : 'x86-windows-gnu' },
      modules: [{ from: './build/counts.exe', main: true }] } }));
    for (const census of [true, false]) for (const interpreted of [false, true]) {
      if (census) process.env.BGT_OWNER_CENSUS = '1'; else delete process.env.BGT_OWNER_CENSUS;
      const out = join(dir, (census ? 'on-' : 'off-') + (interpreted ? 'interpreted' : 'lifted'));
      const manifest = buildGame(dir, { outRoot: out, interpretOnly: interpreted, quiet: true }), game = join(out, manifest.id);
      expect(manifest.pipeline.instrumentation.ownerCensus).toBe(census);
      for (const mode of testSuspensionModes()) {
        const wasm = mode === 'jspi' ? manifest.variants.jspi.url : manifest.wasm.url, logs: string[] = [];
        const vfs = new Vfs(); for (const a of manifest.assets) vfs.add(a.path, new Uint8Array(readFileSync(join(game, 'assets', a.path))));
        const host = await GameHost.create(readFileSync(join(game, wasm.split('?')[0])), { vfs, now: () => 0, log: (_n, s) => logs.push(s) },
          { backend: 3, caps: 0, seed: 1, displayWidth: 64, displayHeight: 64, arg0: 0, arg1: 0, suspensionMode: mode });
        host.init();
        for (let i = 0; i < 10 && !logs.some(s => s.includes('ExitProcess')); i++) await host.update();
        expect(logs).toContain('win32 profile: ExitProcess');
        const m = host.metrics() as any, c = m.owner_census;
        if (!census) { expect(c).toEqual({ enabled: 0, cumulative: null, frames: null }); expect(m.execution_summary.owner_census.status).toBe('unavailable'); continue; }
        expect(c.enabled).toBe(1); expect(c.unattributed).toBe('0'); expect(c.rows).toBe(3);
        expect(c.cumulative.total).toBe(String(total));
        expect(c.cumulative.total).toBe(m.execution_accounting.retired.total);
        expect(owners(c.cumulative.rows)).toEqual(Object.values(p.expected).sort((a, b) => b - a));
        for (const r of c.cumulative.rows) {
          expect(BigInt(r.lifted) + BigInt(r.generic) + BigInt(r.interpreted)).toBe(BigInt(r.total));
          if (interpreted) expect(r.interpreted).toBe(r.total); else expect(r.interpreted).toBe('0');
        }
        // AMD64 CPUID runs through the shared semantic core inside lifted b(): owned by b, kind generic.
        if (wide && !interpreted) expect(c.cumulative.rows.find((r: any) => Number(r.total) === p.expected.b).generic).toBe('5');
        expect(new Set(c.cumulative.rows.map((r: any) => r.owner)).size).toBe(3);
        expect(c.cumulative.rows.every((r: any) => r.owner !== 0xffffffff)).toBe(true);
        const s = m.execution_summary.owner_census;
        expect(s.status).toBe('available'); expect(s.cumulative.instructions).toBe(total);
        expect(s.cumulative.rows.map((r: any) => r.instructions)).toEqual(Object.values(p.expected).sort((a, b) => b - a));
      }
    }
  } finally { if (saved === undefined) delete process.env.BGT_OWNER_CENSUS; else process.env.BGT_OWNER_CENSUS = saved; rmSync(dir, { recursive: true, force: true }); }
}, 900_000);

// Per-present tables: a real SwapBuffers loop (examples/x64-gl-limits, C/CRT). Each frame table must sum to the
// exact accounting retirement between the same two presents, and steady-state frames are identical.
it('per-present frame tables equal exact accounting deltas and are deterministic', async () => {
  const saved = process.env.BGT_OWNER_CENSUS, out = mkdtempSync(join(ROOT, 'node_modules/.cache/bgt/owner-census-frames-'));
  try {
    process.env.BGT_OWNER_CENSUS = '1';
    const manifest = buildGame(join(ROOT, 'examples/x64-gl-limits'), { outRoot: out, quiet: true });
    const runs = [];
    for (let run = 0; run < 2; run++) {
      const h = await loadHeadless('x64-gl-limits', { ...glStream(), dir: join(out, manifest.id) });
      // Step to a present count, not an update count: setup costs one update per compile/link/readback wait
      // (the fixture's later 1023-uniform program and second readback moved the first present from update 6 to
      // 10). Ten presents fill the 8-frame ring with steady frames after the frame-1 readbacks (present 2).
      const presents = () => Number((h.host.metrics() as any).execution_summary?.guest_frames?.count ?? 0);
      for (let i = 0; i < 60 && presents() < 10; i++) await h.stepAsync(1);
      expect(presents()).toBe(10);
      runs.push(h.host.metrics() as any);
    }
    const [m] = runs, frames = m.owner_census.frames.snapshots, accounting = m.execution_accounting.frames.snapshots;
    expect(frames.length).toBe(8); expect(m.owner_census.unattributed).toBe('0');
    const retiredAt = new Map(accounting.map((s: any) => [s.present, BigInt(s.retired.total)]));
    let checked = 0;
    for (const f of frames) {
      const now = retiredAt.get(f.present), before = retiredAt.get(String(BigInt(f.present) - 1n));
      if (now === undefined || before === undefined) continue;
      expect(BigInt(f.total)).toBe((now as bigint) - (before as bigint));
      expect(f.rows.reduce((s: bigint, r: any) => s + BigInt(r.total), 0n) <= BigInt(f.total)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(6);
    const strip = (f: any) => ({ total: f.total, rows: f.rows });
    expect(strip(frames[frames.length - 1])).toEqual(strip(frames[frames.length - 2]));
    expect(runs[1].owner_census).toEqual(runs[0].owner_census); // deterministic across fresh instances
  } finally { if (saved === undefined) delete process.env.BGT_OWNER_CENSUS; else process.env.BGT_OWNER_CENSUS = saved; rmSync(out, { recursive: true, force: true }); }
}, 900_000);
