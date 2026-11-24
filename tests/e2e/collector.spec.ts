// SPDX-License-Identifier: CC0-1.0. K73: the `collector` fixture (used by every kit and port spec) in a real browser.
// Catches: (1) a network-level request failure (connection refused / aborted, Playwright `requestfailed`) that the
// collector did not see, so the test passed (before K73: only console errors, page errors and HTTP >= 400 counted);
// (2) an allowlist that cannot bound an authentic repeated error; (3) a navigation's own cancellations (the old
// document's in-flight loads) counted as failures. The "fails" cases use test.fail(): they pass only if the
// collector's teardown assertion is expected to fail after the stimulus completes.
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

test.beforeEach(async ({ collector }) => { void collector; });

const PROBE = '**/k73-collector-probe';
async function failRequest(page: Page, reason: 'connectionrefused' | 'aborted') {
  await page.route(PROBE, (route) => route.abort(reason));
  await page.goto('/games/index.json');
  const [, result] = await Promise.all([
    page.waitForEvent('requestfailed', { predicate: r => r.url().endsWith('/k73-collector-probe'), timeout: 5_000 }),
    page.evaluate(() => fetch('/k73-collector-probe').then(() => 'ok', (e) => String(e))),
  ]);
  expect(result).toMatch(/TypeError/); // the guest-side view: a failed fetch, no HTTP status
}

// Real pending HTTP loads (intercepted routes never reach the network). No guessed port or external server.
async function hangingRequest(page: Page, path: string) {
  const server = createServer();
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + path;
  const close = () => { server.close(); server.closeAllConnections(); };
  try {
    const [request] = await Promise.all([
      page.waitForRequest(r => r.url() === url, { timeout: 5_000 }),
      page.evaluate(u => {
        const c = new AbortController();
        (window as unknown as { abortProbe(): void }).abortProbe = () => c.abort();
        void fetch(u, { mode: 'no-cors', signal: c.signal }).catch(() => {});
      }, url),
      once(server, 'request', { signal: AbortSignal.timeout(5_000) }),
    ]);
    return { request, close };
  } catch (e) { close(); throw e; }
}

test.describe(() => {
  test.skip(({ backendParam }) => backendParam !== 'webgl2', 'browser plumbing only: one project');

  test('a connection-refused request fails the test', async ({ page }) => {
    await failRequest(page, 'connectionrefused');
    test.fail(true, 'the collector must fail this test');
  });
  test('an aborted request fails the test', async ({ page }) => {
    await failRequest(page, 'aborted');
    test.fail(true, 'the collector must fail this test');
  });
  test('allow() does not cover request failures', async ({ page, collector }) => {
    collector.allow(/.*/);
    await failRequest(page, 'connectionrefused');
    test.fail(true, 'the collector must fail this test');
  });
  test('an explicitly allowed intentional abort passes and is logged', async ({ page, browserName, collector }) => {
    // WebKit's inspector blocks intercepted requests without surfacing the reason passed to route.abort().
    const error = { chromium: 'net::ERR_ABORTED', webkit: 'Blocked by Web Inspector', firefox: 'NS_BINDING_ABORTED' }[browserName];
    const pattern = new RegExp('^' + error + ' GET ' + String.raw`http:\/\/127\.0\.0\.1:\d+\/k73-collector-probe$`);
    collector.allowRequestFailure({ pattern, max: 1 });
    await failRequest(page, 'aborted');
    expect(collector.requestFailures).toEqual([expect.stringMatching(pattern)]);
    expect(collector.navigationAborts).toEqual([]);
  });
  test('a capped allowance passes up to max', async ({ page, collector }) => {
    collector.allow({ pattern: /k73 authentic guest error/, max: 2 });
    await page.goto('/games/index.json');
    await page.evaluate(() => { console.error('k73 authentic guest error'); console.error('k73 authentic guest error'); });
    await expect.poll(() => collector.consoleErrors.length).toBe(2);
  });
  test('a capped allowance fails one past max', async ({ page, collector }) => {
    collector.allow({ pattern: /k73 authentic guest error/, max: 2 });
    await page.goto('/games/index.json');
    await page.evaluate(() => { for (let i = 0; i < 3; i++) console.error('k73 authentic guest error'); });
    await expect.poll(() => collector.consoleErrors.length).toBe(3);
    test.fail(true, 'the collector must fail this test');
  });
  test('a request still in flight when the page navigates away does not fail the test', async ({ page, browserName, collector }) => {
    await page.goto('/games/index.json');
    const { request, close } = await hangingRequest(page, '/k73-collector-hang');
    try {
      const target = '/games/index.json?second';
      if (browserName === 'webkit') {
        // Cancellation can precede even the navigation request. Assert it was classified, not dropped.
        expect((await collector.navigateAway(target, request))?.ok()).toBe(true);
        await expect.poll(() => collector.navigationAborts).toEqual([`cancelled GET ${request.url()}`]);
      } else {
        // Keep the original unwrapped navigation. Chromium usually emits no requestfailed for this load.
        expect((await page.goto(target))?.ok()).toBe(true);
        await page.waitForTimeout(300);
        for (const line of collector.navigationAborts) expect(line).toMatch(/k73-collector-hang$/);
      }
      expect(collector.requestFailures).toEqual([]);
    } finally { close(); }
  });
  test('an abort during a navigation that never commits stays a failure', async ({ page, browserName, collector, baseURL }) => {
    // A route abort never commits the destination. WebKit can still cancel the previous document's load.
    await page.goto('/games/index.json');
    const target = new URL('/k76-uncommitted', baseURL).href;
    let cancelled: Promise<unknown> | undefined;
    // In WebKit force the cancellation to arrive before goto rejects, so this exercises rollback.
    await page.route(target, async r => {
      await cancelled?.catch(() => {});
      await r.abort('aborted');
    });
    const { request, close } = await hangingRequest(page, '/k76-uncommitted-hang');
    try {
      if (browserName === 'webkit')
        cancelled = page.waitForEvent('requestfailed', { predicate: r => r === request, timeout: 5_000 });
      const [navigation] = await Promise.all([
        page.waitForEvent('requestfailed', { predicate: r => r.url() === target, timeout: 10_000 }),
        cancelled,
        expect(collector.navigateAway(target, request)).rejects.toThrow(),
      ]);
      expect(collector.requestFailures).toContain(navigation.failure()?.errorText + ' GET ' + target);
      if (browserName === 'webkit') expect(collector.requestFailures).toContain('cancelled GET ' + request.url());
      expect(collector.navigationAborts).toEqual([]);
      test.fail(true, 'a failed navigation and any cancelled load must fail collector teardown');
    } finally { close(); }
  });
  test('a fetch aborted before navigation is still a request failure', async ({ page, browserName, collector }) => {
    await page.goto('/games/index.json');
    const { request, close } = await hangingRequest(page, '/k76-explicit-abort');
    try {
      // A same-document navigation does not abandon the old document's requests.
      const hash = new URL(page.url());
      hash.hash = 'same-document';
      expect(await page.goto(hash.href)).toBeNull();
      const error = { chromium: 'net::ERR_ABORTED', webkit: 'cancelled', firefox: 'NS_BINDING_ABORTED' }[browserName];
      const line = error + ' GET ' + request.url();
      await Promise.all([
        page.waitForEvent('requestfailed', { predicate: r => r === request, timeout: 5_000 }),
        page.evaluate(() => (window as unknown as { abortProbe(): void }).abortProbe()),
      ]);
      await expect(collector.navigateAway('/games/index.json?second', request)).rejects.toThrow(/in-flight/);
      await page.goto('/games/index.json?second');
      expect(collector.requestFailures).toEqual([line]);
      expect(collector.navigationAborts).toEqual([]);
      test.fail(true, 'an unallowed cancellation is a collector failure');
    } finally { close(); }
  });
});
