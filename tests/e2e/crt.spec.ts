import { test, expect, openGame, assertBackend, step, diagnostics, catches } from './fixtures';
import { nativeCrt, crtMismatches } from '../support/native-crt';

for (const id of ['x64-crt', 'x64-cpprt', 'x64-memory'] as const) {
  test(`${id}: normal CRT checksums match native source in the browser`, async ({ page, backendParam }, info) => {
    catches('CRT ABI/varargs/math/STL mismatch, uncommitted large heap, or interpreter fallback');
    const reference = nativeCrt(id);
    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    expect(await openGame(page, backendParam, { game: id })).toBe('ready');
    await assertBackend(page, backendParam, info);
    await step(page, 300);
    // Browser console prefixes messages; normalize only that prefix, not the checksum payload.
    const normalized = logs.map((s) => s.replace(/^.*?(?=(?:ulp |crt |cpprt |memory ))/, ''));
    expect(crtMismatches(reference, normalized), logs.join('\n')).toEqual([]);
    const d = await diagnostics(page);
    expect(d.errors).toEqual([]);
    expect(d.commandErrors.count).toBe(0);
    expect((d.metrics as any).interp_insns).toBe(0);
    expect((d.metrics as any).stubs).toEqual([]);
    if (id === 'x64-memory') {
      expect((d.metrics as any).heap_bytes).toBeGreaterThanOrEqual(600 * 1024 ** 2);
      expect((d.metrics as any).guest_committed_bytes).toBe(0x7fff0000);
      expect(logs.some((s) => s.includes('memory window-edge=2147418111 PASS'))).toBe(true);
    }
  });
}

// K72: the same STL/CRT program built with every size option (minimal register sync, outlined call protocol,
// inline 16, stripped name section) must print exactly the native lines in the browser, in both suspension modes.
test('x64-compact: K72 size options keep the native CRT/STL output (stripped names, symbol maps beside)', async ({ page, backendParam }, info) => {
  catches('a compact call site that drops a dirty register, reloads a stale volatile or mis-handles the depth slot; a stripped artifact that no longer loads');
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(process.cwd(), 'web/public/games/x64-compact');
  for (const file of ['game.wasm', 'game.jspi.wasm']) {
    expect(WebAssembly.Module.customSections(new WebAssembly.Module(readFileSync(join(dir, file))), 'name'), file).toHaveLength(0);
    expect(existsSync(join(dir, file + '.names.json')), file).toBe(true);
  }
  const reference = nativeCrt('x64-cpprt');
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  expect(await openGame(page, backendParam, { game: 'x64-compact' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  await step(page, 300);
  const normalized = logs.map((s) => s.replace(/^.*?(?=(?:ulp |crt |cpprt |memory ))/, ''));
  expect(crtMismatches(reference, normalized), logs.join('\n')).toEqual([]);
  const d = await diagnostics(page);
  expect(d.errors).toEqual([]);
  expect(d.commandErrors.count).toBe(0);
  expect((d.metrics as any).interp_insns).toBe(0);
  expect((d.metrics as any).stubs).toEqual([]);
});
