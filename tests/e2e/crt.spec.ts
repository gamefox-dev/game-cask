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
