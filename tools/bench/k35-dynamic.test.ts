// Original CC0-1.0. Private diagnostic builds only; never a timing comparator.
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../../tests/support/headless';
import { k35Fixture } from './k35-fixture';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';

it('counts dynamic guest sites and same-block flag consumers on the sustained VM', async () => {
  const { dir, id, expected } = k35Fixture('vm');
  buildGame(dir, { quiet: true });
  const lifted = join(ROOT, 'node_modules/.cache/bgt/pipeline', id, 'lifted_workload_exe.c');
  const original = readFileSync(lifted, 'utf8');
  const originalKey = readFileSync(lifted + '.key');
  const sites: { address: string; block: boolean; code: string }[] = [];
  const labels = [...original.matchAll(/^(L|N)_([0-9a-f]+):[^\n]*\n/gm)];
  // Append only after each block's guard/quantum reservation. Untaken deoptimizations
  // never count an instruction. Interior N labels and sequential fallthrough count once.
  let instrumented = original.replace(/^(N_([0-9a-f]+): __attribute__\(\(unused\)\);\n)|(L_([0-9a-f]+):;entry_index=0;\n(?:if\(x86_protection_active[^\n]*\n)?if\(budget[^\n]*clock\+=\d+u;budget\+=\d+u;\n)/gm,
    (match, _n, na, _l, la, offset) => {
      const address = na ?? la;
      const next = labels.find(m => m.index! > offset);
      const code = original.slice(offset + match.length, next?.index ?? original.length);
      const index = sites.length; sites.push({ address, block: !!la, code });
      return match + '++k35_site_counts[' + index + '];\n';
    });
  expect(sites.length).toBeGreaterThan(1500);
  const prefix = '#include <stdint.h>\nstatic uint64_t k35_site_counts[' + sites.length + '];\n'
    + '__attribute__((export_name("k35_counts"))) uint32_t k35_counts(unsigned reset){'
    + 'if(reset)for(unsigned i=0;i<' + sites.length + ';i++)k35_site_counts[i]=0;return (uint32_t)(uintptr_t)k35_site_counts;}\n';
  instrumented = prefix + instrumented;
  const out = process.env.BGT_K35_OUT!;
  mkdirSync(out, { recursive: true });
  try {
    writeFileSync(lifted, instrumented);
    const keyPath = lifted + '.key';
    const key = JSON.parse(readFileSync(keyPath, 'utf8'));
    key.source = createHash('sha256').update(instrumented).digest('hex');
    writeFileSync(keyPath, JSON.stringify(key));
    const manifest = buildGame(dir, { quiet: true });
    cpSync(join(ROOT, 'web/public/games', id), join(out, 'game'), { recursive: true });
    const results = [];
    for (const suspension of ['asyncify', 'jspi'] as const) {
      const h = await loadHeadless(id, { dir: join(out, 'game'), suspension });
      await h.stepAsync(100);
      // Explicitly private diagnostic export; no production host ABI addition.
      const ex = (h.host as unknown as { exports: { k35_counts(reset: number): number } }).exports;
      const ptr = ex.k35_counts(1);
      const before = h.host.metrics();
      await h.stepAsync(300);
      const counts = [...new BigUint64Array(h.host.memory.buffer, ptr, sites.length)].map(String);
      expect(h.logs).toContain(expected);
      const after = h.host.metrics();
      type Accounting = { execution_accounting: { enabled: number; retired: { total: string; lifted: string; generic: string; interpreted: string } } };
      const a = (after as unknown as Accounting).execution_accounting;
      const b = (before as unknown as Accounting).execution_accounting;
      if (process.env.BGT_CPU_ACCOUNTING === '1') {
        expect(a.enabled).toBe(1); expect(b.enabled).toBe(1);
        const native = counts.reduce((sum, n) => sum + BigInt(n), 0n);
        expect(BigInt(a.retired.lifted) - BigInt(b.retired.lifted)).toBe(native);
        expect(BigInt(a.retired.interpreted) - BigInt(b.retired.interpreted)).toBe(0n);
        expect(BigInt(a.retired.total) - BigInt(b.retired.total)).toBe(native + BigInt(a.retired.generic) - BigInt(b.retired.generic));
      }
      results.push({ suspension, counts, before, after });
    }
    expect(results[0].counts).toEqual(results[1].counts);
    writeFileSync(join(out, 'dynamic.json'), JSON.stringify({ sites, results, manifest,
      method: 'Diagnostic site counts only, no timing claim. Counts inserted in generated scratch C after successful guard/quantum reservation. Generic fallback sites are separately reported, not guessed.' }, null, 2));
  } finally {
    writeFileSync(lifted, original);
    writeFileSync(lifted + '.key', originalKey);
  }
});
