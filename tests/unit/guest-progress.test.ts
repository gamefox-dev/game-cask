import { afterEach, expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { stepUntilLog } from '../e2e/guest-progress';

// Execute the browser callback against a read-only fake test API, not a real browser.
const page = { evaluate: (fn: any, arg: any) => fn(arg) } as Page;
afterEach(() => vi.unstubAllGlobals());

function guest(passAt = Infinity, failAt = Infinity) {
  let frames = 0, stepping = false;
  const api = {
    async step(n: number) {
      expect(n).toBe(1); expect(stepping).toBe(false); stepping = true;
      await Promise.resolve(); frames++; stepping = false;
    },
    diagnostics() {
      expect(stepping).toBe(false);
      return { logs: frames >= passAt ? [{ message: 'fixture PASS tiles=8' }] : [], errors: [] };
    },
    failed: () => frames >= failAt,
  };
  vi.stubGlobal('window', { __BGT_TEST__: api });
  return () => frames;
}

test('stops on the first matching guest update, awaiting each step', async () => {
  const frames = guest(3);
  const result = await stepUntilLog(page, 'fixture PASS', 10);
  expect(result.frames).toBe(3); expect(frames()).toBe(3);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
});

test('missing progress fails at the original deterministic update bound', async () => {
  const frames = guest();
  await expect(stepUntilLog(page, 'fixture PASS', 7)).rejects.toThrow('within 7 updates');
  expect(frames()).toBe(7);
});

test('guest failure fails early rather than exhausting the bound', async () => {
  const frames = guest(Infinity, 2);
  await expect(stepUntilLog(page, 'fixture PASS', 7)).rejects.toThrow('Guest failed');
  expect(frames()).toBe(2);
});
