// SPDX-License-Identifier: CC0-1.0. K73: the `collector` fixture (used by every kit and port spec) in a real browser.
// Catches: (1) a network-level request failure (connection refused / aborted, Playwright `requestfailed`) that the
// collector did not see, so the test passed (before K73: only console errors, page errors and HTTP >= 400 counted);
// (2) an allowlist that cannot bound an authentic repeated error; (3) a navigation's own cancellations (the old
// document's in-flight loads) counted as failures. The "fails" cases use test.fail(): they pass only if the
// collector's teardown assertion fails the test.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures';

test.beforeEach(async ({ collector }) => { void collector; });

const PROBE = '**/k73-collector-probe';
async function failRequest(page: import('@playwright/test').Page, reason: 'connectionrefused' | 'aborted') {
  await page.route(PROBE, (route) => route.abort(reason));
  await page.goto('/games/index.json');
  const result = await page.evaluate(() => fetch('/k73-collector-probe').then(() => 'ok', (e) => String(e)));
  expect(result).toMatch(/TypeError/); // the guest-side view: a failed fetch, no HTTP status
}

test.describe(() => {
  test.skip(({ backendParam }) => backendParam !== 'webgl2', 'browser plumbing only: one project');

  test('a connection-refused request fails the test', async ({ page }) => {
    test.fail(true, 'the collector must fail this test');
    await failRequest(page, 'connectionrefused');
  });
  test('an aborted request fails the test', async ({ page }) => {
    test.fail(true, 'the collector must fail this test');
    await failRequest(page, 'aborted');
  });
  test('allow() does not cover request failures', async ({ page, collector }) => {
    test.fail(true, 'the collector must fail this test');
    collector.allow(/.*/);
    await failRequest(page, 'connectionrefused');
  });
  test('an explicitly allowed intentional abort passes and is logged', async ({ page, collector }) => {
    collector.allowRequestFailure(/net::ERR_\w+ GET http:\/\/[^/]+\/k73-collector-probe$/);
    await failRequest(page, 'aborted');
    expect(collector.requestFailures).toEqual([expect.stringMatching(/^net::ERR_ABORTED GET .*\/k73-collector-probe$/)]);
  });
  test('a capped allowance passes up to max', async ({ page, collector }) => {
    collector.allow({ pattern: /k73 authentic guest error/, max: 2 });
    await page.goto('/games/index.json');
    await page.evaluate(() => { console.error('k73 authentic guest error'); console.error('k73 authentic guest error'); });
    await expect.poll(() => collector.consoleErrors.length).toBe(2);
  });
  test('a capped allowance fails one past max', async ({ page, collector }) => {
    test.fail(true, 'the collector must fail this test');
    collector.allow({ pattern: /k73 authentic guest error/, max: 2 });
    await page.goto('/games/index.json');
    await page.evaluate(() => { for (let i = 0; i < 3; i++) console.error('k73 authentic guest error'); });
    await expect.poll(() => collector.consoleErrors.length).toBe(3);
  });
  test('a request still in flight when the page navigates away does not fail the test', async ({ page, collector }) => {
    // A real in-flight request (an intercepted route never reaches the network, so navigation would not cancel it):
    // a local server that accepts and never answers.
    let reached!: () => void; const pending = new Promise<void>((r) => { reached = r; });
    const server = createServer(() => { reached(); }); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/k73-collector-hang`;
      await page.goto('/games/index.json');
      await page.evaluate((u) => { void fetch(u, { mode: 'no-cors' }).catch(() => {}); }, url);
      await pending;
      await page.goto('/games/index.json?second');
      await page.waitForTimeout(300);
      // Chromium (Playwright 1.x) reports no requestfailed for the old document's cancelled loads at all; an engine
      // that does reports net::ERR_ABORTED / NS_BINDING_ABORTED / cancelled, which the fixture files under
      // navigationAborts (classification unit-tested in browser-collector.test.ts). Either way: no failure.
      expect(collector.requestFailures).toEqual([]);
      for (const line of collector.navigationAborts) expect(line).toMatch(/k73-collector-hang$/);
    } finally { server.closeAllConnections(); server.close(); }
  });
});
