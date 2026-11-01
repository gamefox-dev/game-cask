// Build/record fixtures before timed browser tests or contexts exist. Cold Zig/Asyncify compilation
// is synchronous and can otherwise exhaust a test's deadline while preventing its timer from firing.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareSlice } from '../support/slice-fixture';
import { ROOT } from '../support/headless';

export default async function globalSetup(): Promise<void> {
  // LANE-K7i: the dedicated required scale job selects only x64-scale.spec.ts,
  // which never consumes strict-slice fixtures. The default/full run is unchanged.
  if (process.env.BGT_E2E_SCALE_ONLY === '1') return;
  const prepared: Record<string, { id: string }> = {};
  for (const example of ['win32-hello', 'win32-conformance']) {
    const started = performance.now();
    const fixture = await prepareSlice(example);
    prepared[example] = { id: fixture.id };
    console.log(`Prepared browser slice ${fixture.id} in ${Math.round(performance.now() - started)} ms`);
  }
  const dir = mkdtempSync(join(ROOT, 'node_modules/.cache/bgt/browser-slices-'));
  const index = join(dir, 'index.json');
  writeFileSync(index, JSON.stringify(prepared));
  // Playwright propagates global-setup environment changes to every project worker.
  process.env.BGT_E2E_SLICE_INDEX = index;
}
