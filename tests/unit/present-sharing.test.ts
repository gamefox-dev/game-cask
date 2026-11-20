// @bgt-examples: none
// Breakages caught (K50 delta review of interval-0 present sharing):
// - sharing one host update across presents exhausts a per-frame GPU budget (upload bytes, vertices)
//   that a one-present-per-update guest stays within (reviewer: GL_OUT_OF_MEMORY from frame 64);
// - jittery frame costs make the cap land mid-frame because only the last frame predicts the next;
// - after a present, an update that ends mid-frame shows the half-drawn next frame instead of
//   deferring that GPU work to the next update.
import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { GPU_OP } from '../../bgt/runtime/abi';
// @ts-expect-error plain ESM build tooling
import { buildGame } from '../../tools/build/build.mjs';
const libs = ['kernel32', 'user32', 'gdi32', 'opengl32'];
async function build(id: string, source: string, wrapper: string | null, gpuBudget?: number) {
  const root = join(ROOT, 'node_modules/.cache/bgt/present-sharing'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'case-'));
  copyFileSync(join(ROOT, 'tests/fixtures/win32', source), join(dir, source));
  if (wrapper) writeFileSync(join(dir, 'main.c'), wrapper + '#include "' + source + '"\n');
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 present sharing', ...(gpuBudget ? { gpu: { budgetBytes: gpuBudget } } : {}),
    pipeline: { platform: 'win32', fixture: { target: 'x86_64-windows-gnu', crt: true, sources: [wrapper ? 'main.c' : source], out: 'p.exe', libs },
      modules: [{ from: './build/p.exe', name: 'p.exe', main: true }], width: 160, height: 100 } }));
  const out = join(dir, 'out'); buildGame(dir, { outRoot: out, quiet: true });
  return { dir, game: join(out, id) };
}
for (const [mode, gpuBudget, perFrame, limit] of [[1, 0, 4194304, 268435456], [1, 16777216, 4194304, 16777216], [2, 0, 300000, 1572864]] as const)
  it(`interval-0 sharing stays inside the per-frame ${mode === 1 ? 'upload' : 'vertex'} budget${gpuBudget ? ' (16 MiB gpu budget)' : ''}`, async () => {
    const id = 'present-budget-' + mode + '-' + (gpuBudget ? 'small' : 'default');
    const { dir, game } = await build(id, 'present-budget.c', `#define MODE ${mode}\n`, gpuBudget || undefined);
    try {
      const h = await loadHeadless(id, { ...glStream(), dir: game });
      const perUpdate: number[] = [];
      for (let i = 0; i < 400 && !h.logs.some((s) => /present-budget (done|FAIL)/.test(s)); i++) {
        const before = h.logs.filter((s) => s.includes('present-budget frame=')).length;
        await h.stepAsync(1);
        perUpdate.push(h.logs.filter((s) => s.includes('present-budget frame=')).length - before);
      }
      expect(h.logs.find((s) => s.includes('present-budget done'))).toBe('guest: present-budget done errors=0 first=0 code=0x0');
      const full = perUpdate.filter((n) => n > 0);
      expect(Math.max(...full)).toBeGreaterThan(1); // presents really share updates
      expect(Math.max(...full)).toBeLessThanOrEqual(Math.floor(limit / perFrame));
      const m = h.host.metrics() as any;
      expect(BigInt(m.guest_time.present_budget_ends)).toBeGreaterThan(0n);
      expect(m.guest_time.deferred_gl_rejects).toBe('0'); expect(m.guest_time.torn_frames).toBe('0');
      expect(m.stubs).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 300_000);
it('jittery interval-0 frames end at presents; a mid-frame cap after a present defers that GPU work', async () => {
  const { dir, game } = await build('present-defer', 'present-defer.c', null);
  try {
    const stream = glStream();
    const h = await loadHeadless('present-defer', { ...stream, dir: game });
    const updates: { clears: number[][]; caps: bigint; jitterDone: boolean; long: boolean }[] = [];
    let seen = 0;
    const f32 = (u: number) => new Float32Array(new Uint32Array([u]).buffer)[0];
    for (let i = 0; i < 400 && !h.logs.some((s) => /present-defer (PASS|FAIL)/.test(s)); i++) {
      await h.stepAsync(1);
      const items = stream.items.slice(seen); seen = stream.items.length;
      const m = h.host.metrics() as any;
      updates.push({ clears: items.filter((it) => it.op === GPU_OP.PASS_BEGIN && it.words[0] >= 1 && it.words[9] === 1)
        .map((it) => [10, 11, 12].map((k) => f32(it.words[k]))), caps: BigInt(m.guest_time.cap_hits),
        jitterDone: h.logs.some((s) => s.includes('jitter done')), long: h.logs.some((s) => s.includes('present-defer long=0')) });
    }
    expect(h.logs.some((s) => s.includes('present-defer PASS')), h.logs.join(' | ')).toBe(true);
    // Jitter: a 3-short/1-long cost cycle never hits the cap mid-frame (max of the last four frames).
    const jitterEnd = updates.findIndex((u) => u.jitterDone);
    expect(updates[jitterEnd].caps).toBe(0n);
    // The overrunning frame hits the cap exactly once, in an update that already presented.
    const capUpdate = updates.findIndex((u) => u.caps > 0n);
    expect(updates.at(-1)!.caps).toBe(1n);
    expect(updates[capUpdate].long).toBe(false);
    const red = (c: number[]) => c[0] === 1;
    expect(updates[capUpdate].clears.length).toBeGreaterThan(0);
    expect(updates[capUpdate].clears.some(red)).toBe(false); // last presented image stays shown
    const next = updates[capUpdate + 1].clears;
    expect(red(next[0])).toBe(true); // deferred work leads the next update, in order
    expect(next[1]).toEqual([0, 0, 1]);
    const m = h.host.metrics() as any;
    expect(m.guest_time.torn_frames).toBe('0'); expect(m.guest_time.deferred_gl_rejects).toBe('0');
    expect(BigInt(m.guest_time.deferred_gl_lists)).toBeGreaterThan(0n);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 300_000);
