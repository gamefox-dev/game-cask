// @bgt-examples: none
// Breakage caught (K50 review HIGH): a condition-variable waiter that timed out but cannot
// reacquire its lock counted as "due now", so the all-idle scheduler pumped forever with
// virtual time frozen and the lock holder's Sleep never completed (update 1 never returned).
// The host clock hook throws after a bounded number of reads, so a regression fails, not hangs.
import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { testSuspensionModes } from '../support/suspension-modes';
// @ts-expect-error plain ESM build tooling
import { buildGame } from '../../tools/build/build.mjs';
for (const wide of [false, true]) it('timed-out CV waiter blocked on its lock lets virtual time reach the holder ' + (wide ? 'AMD64' : 'i386'), async () => {
  const root = join(ROOT, 'node_modules/.cache/bgt/cv-timeout'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'case-'));
  try {
    copyFileSync(join(ROOT, 'tests/fixtures/win32/cv-timeout.c'), join(dir, 'cv.c'));
    const id = 'cv-timeout-' + (wide ? 'x64' : 'x86');
    // Accounting builds observe the host clock on every scheduler idle iteration: that is the bound.
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 CV timeout under a held lock',
      cflags: ['-DX86_ACCOUNTING_ENABLED=1'], pipeline: { platform: 'win32', streamModules: false,
        fixture: { out: 'cv.exe', sources: ['cv.c'], libs: ['kernel32'], target: wide ? 'x86_64-windows-gnu' : 'x86-windows-gnu' },
        modules: [{ from: './build/cv.exe', main: true }] } }));
    const out = join(dir, 'out'); buildGame(dir, { outRoot: out, quiet: true });
    for (const suspension of testSuspensionModes()) {
      let reads = 0;
      const now = () => { if (++reads > 1_000_000) throw new Error('scheduler spun without progress'); return reads; };
      const h = await loadHeadless(id, { dir: join(out, id), suspension, now });
      let updates = 0;
      for (; updates < 20 && !h.logs.some((s) => s.includes('cv-timeout ')); updates++) await h.stepAsync(1);
      const line = h.logs.find((s) => s.includes('cv-timeout ')) ?? h.logs.join(' | ');
      expect(line).toMatch(/cv-timeout cs_ms=5\d srw_ms=5\d PASS$/);
      // Two 50-ms holder sleeps at <= one 16667-us period per update: a handful of updates.
      expect(updates).toBeLessThanOrEqual(10);
      expect(reads).toBeLessThan(20000);
      const m = h.host.metrics() as any;
      expect(m.guest_time.idle_guard_hits).toBe('0');
      expect(h.host.guestTimeUs()).toBeGreaterThanOrEqual(100000);
      expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 300_000);
