// @bgt-examples: x64-compact
// K72: examples/x64-compact = the x64-cpprt STL/CRT source with every size option (liftFast sync minimal, outlined
// calls, inline 16, stripped name section). Native-identical output in both suspension modes, no interpretation,
// stripped artifacts with symbol maps, and a lifted-vs-interpreted oracle that also compares guest state.
import { it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT } from '../support/headless';
import { nativeCrt, crtMismatches } from '../support/native-crt';
import { jspiApi } from '../../bgt/runtime/jspi';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

const dir = join(ROOT, 'web/public/games/x64-compact');
const modes = ['asyncify', ...(jspiApi() ? ['jspi'] : [])] as ('asyncify' | 'jspi')[];

it('x64-compact: stripped artifacts, symbol maps and the K72 policy in the manifest', () => {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  expect(manifest.pipeline.liftPolicy).toMatchObject({ liftMode: 'fast', liftFast: { calls: 'outlined', inline: '16', sync: 'minimal' } });
  expect(manifest.pipeline.metrics.wasm_names).toBe('strip');
  for (const file of ['game.wasm', 'game.jspi.wasm']) {
    const bytes = readFileSync(join(dir, file));
    expect(WebAssembly.Module.customSections(new WebAssembly.Module(bytes), 'name'), file).toHaveLength(0);
    expect(manifest.pipeline.metrics.wasm_names_stripped_bytes[file], file).toBeGreaterThan(0);
    const map = JSON.parse(readFileSync(join(dir, file + '.names.json'), 'utf8'));
    expect(map.functions.some((f: { name: string }) => /^N_[0-9a-f]{8}$/.test(f.name)), file).toBe(true);
  }
  expect(existsSync(join(dir, 'game.jspi.wasm'))).toBe(true);
});

for (const suspension of modes)
it(`x64-compact (${suspension}): output equals the native build of the same source, fully lifted`, async () => {
  const h = await loadHeadless('x64-compact', { suspension });
  await h.stepAsync(300);
  expect(crtMismatches(nativeCrt('x64-cpprt'), h.logs), h.logs.join('\n')).toEqual([]);
  expect(h.logs.some((s) => s.includes('FAIL'))).toBe(false);
  const metrics = h.host.metrics() as { interp_insns: number; stubs: unknown[] };
  expect(metrics.interp_insns).toBe(0); expect(metrics.stubs).toEqual([]);
}, 300000);

it('x64-compact: lifted vs interpreted oracle, API trace plus guest CPU and memory', async () => {
  buildGame('examples/x64-compact', { interpretOnly: true, quiet: true });
  const r = await oracle('x64-compact', 300);
  expect(r.errors).toEqual({ lifted: null, interpreted: null });
  expect(r.state?.parts).toBe(13);
  expect(r.identical, JSON.stringify(r.state)).toBe(true);
}, 900000);
