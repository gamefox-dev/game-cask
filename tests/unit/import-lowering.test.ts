// @bgt-examples: x64-imports
// Real PE loader/profile, every call form, guarded guest IAT patch and differential API trace.
import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
it('Win64 IAT, thunk tail, copied/saved register and patched IAT calls retain exact behavior', async () => {
  const h = await loadHeadless('x64-imports');
  await h.stepAsync(300);
  expect(h.logs).toContain('guest: imports failures=0');
  const m = h.host.metrics() as { exited: number; interp_insns: number; stubs: string[]; leaf_import_calls: number; direct_import_calls: number };
  expect(m.exited).toBe(1);
  expect(m.interp_insns).toBe(0);
  expect(m.stubs).toEqual([]);
  expect(m.leaf_import_calls).toBeGreaterThanOrEqual(10);
  expect(m.direct_import_calls).toBeGreaterThan(m.leaf_import_calls);
  const file = join(ROOT, 'node_modules/.cache/bgt/pipeline/x64-imports');
  // All four source forms must actually survive the compiler, not optimize to a constant.
  const text = readdirSync(file).filter(f => /^lifted_.*\.c$/.test(f)).map(f => readFileSync(join(file, f), 'utf8')).join('\n');
  expect(text).toContain('x86_try_import');
  buildGame('examples/x64-imports', { interpretOnly: true, quiet: true });
  const result = await oracle('x64-imports', 300);
  expect(result.errors).toEqual({ lifted: null, interpreted: null });
  expect(result.identical, JSON.stringify(result)).toBe(true);
}, 180000);
