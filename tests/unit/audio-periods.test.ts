// @bgt-examples: none
// Breakage caught (K50 review LOW): a present snapping virtual time across several 10-ms WASAPI
// engine periods delivered only one event, so a client writing one period per event produced
// ~40% too little audio. Also checks padding/position stay consistent with elapsed virtual time.
import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
import { testSuspensionModes } from '../support/suspension-modes';
// @ts-expect-error plain ESM build tooling
import { buildGame } from '../../tools/build/build.mjs';
it('one WASAPI event per elapsed engine period across interval-1 present snaps', async () => {
  const root = join(ROOT, 'node_modules/.cache/bgt/audio-periods'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'case-'));
  try {
    copyFileSync(join(ROOT, 'tests/fixtures/win32/audio-periods.c'), join(dir, 'periods.c'));
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id: 'audio-periods', name: 'CC0 one-period WASAPI writer',
      pipeline: { platform: 'win32', fixture: { target: 'x86_64-windows-gnu', crt: true, sources: ['periods.c'], out: 'periods.exe',
        libs: ['kernel32', 'user32', 'gdi32', 'opengl32', 'ole32', 'uuid'] },
      modules: [{ from: './build/periods.exe', name: 'periods.exe', main: true }], width: 160, height: 100 } }));
    const out = join(dir, 'out'); buildGame(dir, { outRoot: out, quiet: true });
    for (const suspension of testSuspensionModes()) {
      let sunk = 0;
      const audio = { sampleRate: 48000, queued: () => 0, push: () => { throw new Error('stereo WASAPI must not be folded into mono'); },
        pushStereo: (s: Int16Array) => { sunk += s.length / 2; return s.length / 2; } };
      const h = await loadHeadless('audio-periods', { ...glStream(), dir: join(out, 'audio-periods'), suspension, audio });
      for (let i = 0; i < 400 && !h.logs.some((s) => /audio-periods (PASS|FAIL)/.test(s)); i++) await h.stepAsync(1);
      expect(h.logs.some((s) => s.includes('audio-periods PASS')), h.logs.join(' | ')).toBe(true);
      const line = h.logs.find((s) => s.includes('audio-periods us='))!;
      const v = (k: string) => Number(line.split(k + '=')[1].split(' ')[0]);
      const us = v('us'), rate = v('rate'), period = v('period');
      expect(period).toBe(rate / 100);
      expect(us).toBeGreaterThanOrEqual(120 * 16667);
      const expected = rate * us / 1e6;
      // Frames produced and frames played per virtual second equal the device rate within one period.
      expect(Math.abs(v('written') - expected)).toBeLessThanOrEqual(period);
      expect(Math.abs(v('position') - expected)).toBeLessThanOrEqual(period);
      expect(v('short')).toBe(0);
      expect(rate).toBe(48000); expect(sunk).toBeGreaterThan(v('position'));
      const m = h.host.metrics() as any;
      expect(m.guest_time.audio_events_coalesced).toBe('0');
      expect(m.interp_insns).toBe(0); expect(m.stubs).toEqual([]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 300_000);
