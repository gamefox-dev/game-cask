// Opt-in heavy policy matrix; uses only original CC0 pipeline examples, never game inputs.
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../tests/support/headless';
import { oracle } from '../../tests/oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';

it('all-on and all-off pipeline policies have identical 300-frame traces', async () => {
  const rows = [];
  const ids = process.env.BGT_LIFT_POLICY_IDS?.split(',') ?? [
    'x64-crt', 'x64-cpp', 'x64-basics', 'win32-hello', 'x86-threads', 'x64-scale',
  ];
  for (const id of ids) {
    const dir = join(ROOT, 'node_modules/.cache/bgt/lift-policy-inputs', id);
    mkdirSync(dir, { recursive: true });
    cpSync(join(ROOT, 'examples', id), dir, { recursive: true, filter: (p) => !p.endsWith('/build') });
    const cfg = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
    const modes = [];
    for (const preset of ['size', 'fast']) {
      cfg.pipeline.liftPreset = preset;
      writeFileSync(join(dir, 'game.json'), JSON.stringify(cfg));
      const manifest = buildGame(dir, { quiet: true });
      expect(Object.values(manifest.pipeline.liftPolicy)).toEqual(Array(4).fill(preset === 'fast'));
      buildGame(dir, { quiet: true, interpretOnly: true });
      const r = await oracle(id, 300);
      expect(r.identical, `${id}/${preset}`).toBe(true);
      expect(r.errors).toEqual({ lifted: null, interpreted: null });
      const metrics = r.metrics.lifted as { interp_insns: number; stubs: string[] };
      expect(metrics.interp_insns).toBe(0);
      expect(metrics.stubs).toEqual([]);
      modes.push({ preset, wasm_bytes: manifest.wasm.size, identical: r.identical,
        compared_frames: r.comparedFrames, hashes: r.hashes, policy: manifest.pipeline.liftPolicy });
    }
    expect(modes[0].hashes, id).toEqual(modes[1].hashes);
    rows.push({ id, modes });
  }
  const out = process.env.BGT_LIFT_POLICY_REPORT ?? join(ROOT, 'reports/lift-policy.json');
  writeFileSync(out, JSON.stringify({ schema: 'game-cask/lift-policy/1', rows }, null, 2) + '\n');
});
