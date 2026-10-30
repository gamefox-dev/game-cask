import { test, expect, openGame, assertBackend, step, diagnostics, stateHash, catches } from './fixtures';
import { nativeThreads } from '../support/native-threads';

for (const id of ['x64-threads', 'x86-threads']) {
  test(`${id}: worker synchronisation and private thread state complete in a real browser`,
    async ({ page, backendParam, collector }, info) => {
      catches('worker starvation/deadlock, lost event/CV wakes, TLS leakage, wrong checksum or lifted fallback');
      collector.allow(/guest:/);
      const expected = id === 'x64-threads' ? nativeThreads() : 'x86-threads PASS exits=23 value=3';
      const logs: string[] = [];
      page.on('console', (m) => logs.push(m.text()));
      expect(await openGame(page, backendParam, { game: id })).toBe('ready');
      await assertBackend(page, backendParam, info);
      const before = await stateHash(page);
      await step(page, 300);
      expect(await stateHash(page)).not.toBe(before);
      expect(logs.some((s) => s.endsWith(expected)), logs.join('\n')).toBe(true);
      const d = await diagnostics(page);
      expect(d.errors).toEqual([]);
      expect(d.commandErrors.count).toBe(0);
      expect((d.metrics as any).interp_insns).toBe(0);
      expect((d.metrics as any).stubs).toEqual([]);
      expect((d.metrics as any).exited).toBe(1);
    });
}
